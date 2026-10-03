import AlumniJob from '../../models/AlumniJob.js';
import JobApplication from '../../models/JobApplication.js';
import AlumniProfile from '../../models/AlumniProfile.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { notifyUsers } from '../../utils/notify.js';
import { emitToUsers } from '../../config/socket.js';
import { sameId } from '../../utils/permissions.js';
import { env } from '../../config/env.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar phone designation employeeId rollNo';

// ── GET /api/alumni/jobs ───────────────────────────────────────────
export const listJobs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10, 50);
  const { search, type, workMode, location, department, skill, mine, status } = req.query;
  const user = req.user;
  const isStudent = ['student', 'club_admin'].includes(user.role);
  const isStaff = ['admin', 'hod', 'principal', 'dean', 'chairman'].includes(user.role);

  const filter = {};
  const now = new Date();

  if (mine === 'true') {
    filter.postedBy = user._id;
    if (status) filter.status = status;
  } else if (isStudent) {
    filter.status = 'open';
    filter.$or = [{ deadline: { $exists: false } }, { deadline: null }, { deadline: { $gte: now } }];
    if (user.department) {
      filter.$and = [
        {
          $or: [
            { eligibleDepartments: { $exists: false } },
            { eligibleDepartments: { $size: 0 } },
            { eligibleDepartments: user.department },
          ],
        },
      ];
    }
  } else if (!isStaff) {
    filter.status = 'open';
  } else if (status) {
    filter.status = status;
  }

  if (type) filter.type = type;
  if (workMode) filter.workMode = workMode;
  if (location) filter.location = new RegExp(escapeRegex(location), 'i');
  if (department && !filter.$and) {
    filter.eligibleDepartments = department;
  }
  if (skill) filter.skills = new RegExp(escapeRegex(skill), 'i');

  if (search && search.trim()) {
    const q = escapeRegex(search.trim());
    filter.$or = [
      { title: new RegExp(q, 'i') },
      { company: new RegExp(q, 'i') },
      { skills: new RegExp(q, 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    AlumniJob.find(filter)
      .populate('postedBy', PUBLIC_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AlumniJob.countDocuments(filter),
  ]);

  // If student, attach myApplication summary
  if (isStudent && items.length) {
    const jobIds = items.map((j) => j._id);
    const myApps = await JobApplication.find({ job: { $in: jobIds }, student: user._id }).lean();
    const appMap = Object.fromEntries(myApps.map((a) => [String(a.job), a]));

    for (const item of items) {
      item.myApplication = appMap[String(item._id)] || null;
    }
  }

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── POST /api/alumni/jobs ──────────────────────────────────────────
export const createJob = asyncHandler(async (req, res) => {
  const user = req.user;

  // Check verified status for alumni
  if (user.role === 'alumni') {
    const profile = await AlumniProfile.findOne({ user: user._id, isVerified: true });
    if (!profile) {
      throw new ApiError(403, 'Your alumni profile must be verified before you can post jobs');
    }

    // Daily posting rate limit
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayCount = await AlumniJob.countDocuments({
      postedBy: user._id,
      createdAt: { $gte: startOfDay },
    });
    if (todayCount >= env.alumni.jobsPerAlumniPerDay) {
      throw new ApiError(429, `Daily job posting limit reached (${env.alumni.jobsPerAlumniPerDay} jobs/day)`);
    }
  }

  const allowed = [
    'title', 'company', 'type', 'workMode', 'location', 'description',
    'skills', 'experienceMin', 'experienceMax', 'stipendOrSalary',
    'applyMode', 'externalUrl', 'deadline', 'eligibleDepartments', 'eligibleYears',
  ];
  const body = pick(req.body, allowed);

  if (body.applyMode === 'external_link') {
    if (!body.externalUrl || !/^https?:\/\//i.test(body.externalUrl)) {
      throw new ApiError(422, 'A valid https external URL is required for external link jobs');
    }
  }

  const status = env.alumni.jobsRequireApproval && !['admin', 'hod'].includes(user.role)
    ? 'pending_review'
    : 'open';

  const job = await AlumniJob.create({
    postedBy: user._id,
    ...body,
    status,
  });

  await job.populate('postedBy', PUBLIC_USER_FIELDS);

  // Notify students of matching departments if job is open
  if (status === 'open') {
    const studentFilter = { role: { $in: ['student', 'club_admin'] }, isActive: true };
    if (job.eligibleDepartments?.length) {
      studentFilter.department = { $in: job.eligibleDepartments };
    }
    const studentIds = await User.find(studentFilter).distinct('_id');

    if (studentIds.length > 0) {
      await notifyUsers(
        studentIds,
        {
          type: 'alumni',
          title: `New Opportunity: ${job.title}`,
          message: `${job.company} is hiring for ${job.title} (${job.type.replace('_', ' ')}).`,
          link: `/alumni/jobs/${job._id}`,
        },
        { push: studentIds.length <= 200 }
      );
    }
  }

  logActivity(req, 'alumni.job_posted', { entityType: 'alumni_job', entityId: job._id });
  res.status(201).json(job);
});

// ── GET /api/alumni/jobs/:id ───────────────────────────────────────
export const getJobById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await AlumniJob.findById(id).populate('postedBy', PUBLIC_USER_FIELDS);
  if (!job) throw new ApiError(404, 'Job posting not found');

  const user = req.user;
  const isPoster = sameId(job.postedBy._id, user._id);
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);

  if (job.status === 'removed' && !isPoster && !isStaff) {
    throw new ApiError(404, 'Job posting is no longer available');
  }

  // Increment view count asynchronously
  AlumniJob.updateOne({ _id: job._id }, { $inc: { viewCount: 1 } }).exec();

  const out = job.toObject();

  if (['student', 'club_admin'].includes(user.role)) {
    const myApp = await JobApplication.findOne({ job: job._id, student: user._id }).lean();
    out.myApplication = myApp;
  }

  res.json(out);
});

// ── PATCH /api/alumni/jobs/:id ─────────────────────────────────────
export const updateJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job posting not found');

  const user = req.user;
  const isPoster = sameId(job.postedBy, user._id);
  const isAdmin = user.role === 'admin';

  if (!isPoster && !isAdmin) throw new ApiError(403, 'Permission denied');
  if (job.status === 'removed') throw new ApiError(400, 'Cannot edit a removed job posting');

  const allowed = [
    'title', 'company', 'type', 'workMode', 'location', 'description',
    'skills', 'experienceMin', 'experienceMax', 'stipendOrSalary',
    'applyMode', 'externalUrl', 'deadline', 'eligibleDepartments', 'eligibleYears',
  ];
  Object.assign(job, pick(req.body, allowed));
  await job.save();

  await job.populate('postedBy', PUBLIC_USER_FIELDS);
  res.json(job);
});

// ── PATCH /api/alumni/jobs/:id/close & /reopen ──────────────────────
export const closeJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job posting not found');

  const user = req.user;
  if (!sameId(job.postedBy, user._id) && user.role !== 'admin') {
    throw new ApiError(403, 'Permission denied');
  }

  job.status = 'closed';
  await job.save();
  res.json({ ok: true, message: 'Job closed' });
});

export const reopenJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job posting not found');

  const user = req.user;
  if (!sameId(job.postedBy, user._id) && user.role !== 'admin') {
    throw new ApiError(403, 'Permission denied');
  }
  // A poster reopens only what they closed (or what expired). A job removed by
  // staff, or still awaiting review, is not theirs to put back online.
  if (user.role !== 'admin' && !['closed', 'expired'].includes(job.status)) {
    throw new ApiError(403, `A ${job.status.replace('_', ' ')} job cannot be reopened`);
  }

  job.status = 'open';
  await job.save();
  res.json({ ok: true, message: 'Job reopened' });
});

// ── DELETE /api/alumni/jobs/:id ────────────────────────────────────
export const removeJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job posting not found');

  const user = req.user;
  const isPoster = sameId(job.postedBy, user._id);
  const isStaff = ['admin', 'hod'].includes(user.role);

  if (!isPoster && !isStaff) throw new ApiError(403, 'Permission denied');

  if (!isPoster && isStaff && (!reason || reason.trim().length < 5)) {
    throw new ApiError(422, 'Staff removal requires an explanation reason');
  }

  job.status = 'removed';
  job.removedBy = user._id;
  job.removeReason = reason?.trim()?.slice(0, 300);
  await job.save();

  if (!isPoster) {
    await notifyUsers([job.postedBy], {
      type: 'alumni',
      title: 'Job Posting Removed',
      message: `Your job posting "${job.title}" was removed by staff: ${job.removeReason}`,
      link: '/alumni?tab=jobs',
    });
  }

  res.json({ ok: true, message: 'Job posting removed' });
});

// ── POST /api/alumni/jobs/:id/apply ────────────────────────────────
export const applyToJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note, resumeUrl, referralRequested } = req.body;
  const student = req.user;

  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job posting not found');

  if (sameId(job.postedBy, student._id)) {
    throw new ApiError(400, 'Cannot apply to your own job posting');
  }

  if (job.status !== 'open') throw new ApiError(400, 'Job is no longer open for applications');
  if (job.deadline && new Date() > job.deadline) {
    throw new ApiError(400, 'Application deadline has passed');
  }

  // Check if existing application exists
  let application = await JobApplication.findOne({ job: job._id, student: student._id });
  if (application && application.status !== 'withdrawn') {
    throw new ApiError(409, 'You have already applied for this job');
  }

  if (application) {
    // Reactivate previous application
    application.status = 'applied';
    application.note = note?.trim()?.slice(0, 500);
    application.resumeUrl = resumeUrl?.trim();
    application.referralRequested = Boolean(referralRequested);
    application.statusChangedAt = new Date();
    await application.save();
  } else {
    application = await JobApplication.create({
      job: job._id,
      student: student._id,
      poster: job.postedBy,
      note: note?.trim()?.slice(0, 500),
      resumeUrl: resumeUrl?.trim(),
      referralRequested: Boolean(referralRequested),
    });
  }

  await AlumniJob.updateOne({ _id: job._id }, { $inc: { applicationCount: 1 } });

  await application.populate([
    { path: 'student', select: PUBLIC_USER_FIELDS },
    { path: 'job', select: 'title company' },
  ]);

  await notifyUsers([job.postedBy], {
    type: 'alumni',
    title: referralRequested ? 'Referral Request Received' : 'New Job Application',
    message: `${student.name} applied for "${job.title}".`,
    link: `/alumni/jobs/${job._id}`,
  });

  emitToUsers([job.postedBy], 'alumni:job_application', application.toJSON());
  res.status(201).json(application);
});

// ── GET /api/alumni/jobs/:id/applications ──────────────────────────
export const listJobApplications = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.query;
  const { page, limit, skip } = paginate(req, 20, 50);

  const job = await AlumniJob.findById(id);
  if (!job) throw new ApiError(404, 'Job not found');

  const user = req.user;
  const isPoster = sameId(job.postedBy, user._id);
  const isStaff = ['admin', 'hod'].includes(user.role);

  if (!isPoster && !isStaff) throw new ApiError(403, 'Permission denied');

  const filter = { job: id };
  if (status) filter.status = status;
  else filter.status = { $ne: 'withdrawn' };

  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .populate('student', PUBLIC_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobApplication.countDocuments(filter),
  ]);

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── GET /api/alumni/job-applications/mine ──────────────────────────
export const listMyJobApplications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10, 50);
  const filter = { student: req.user._id };

  const [items, total] = await Promise.all([
    JobApplication.find(filter)
      .populate('job')
      .populate('poster', PUBLIC_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobApplication.countDocuments(filter),
  ]);

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── PATCH /api/alumni/job-applications/:id ─────────────────────────
export const updateApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, posterNote } = req.body;
  const user = req.user;

  const app = await JobApplication.findById(id).populate('job', 'title company');
  if (!app) throw new ApiError(404, 'Application not found');

  if (!sameId(app.poster, user._id) && user.role !== 'admin') {
    throw new ApiError(403, 'Permission denied');
  }

  if (!['referred', 'shortlisted', 'rejected'].includes(status)) {
    throw new ApiError(422, 'Status must be referred, shortlisted, or rejected');
  }

  app.status = status;
  if (posterNote !== undefined) app.posterNote = String(posterNote).slice(0, 500);
  app.statusChangedAt = new Date();
  await app.save();

  await notifyUsers([app.student], {
    type: 'alumni',
    title: `Job Application Update: ${app.job.title}`,
    message: `Your application status was updated to "${status.replace('_', ' ')}". ${posterNote ? `Note: "${posterNote}"` : ''}`,
    link: '/alumni?tab=jobs',
  });

  emitToUsers([app.student], 'alumni:job_application', app.toJSON());
  res.json(app);
});

// ── PATCH /api/alumni/job-applications/:id/withdraw ────────────────
export const withdrawApplication = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const app = await JobApplication.findOne({ _id: id, student: req.user._id });
  if (!app) throw new ApiError(404, 'Application not found');

  if (app.status === 'withdrawn') throw new ApiError(400, 'Already withdrawn');

  app.status = 'withdrawn';
  app.statusChangedAt = new Date();
  await app.save();

  await AlumniJob.updateOne({ _id: app.job, applicationCount: { $gt: 0 } }, { $inc: { applicationCount: -1 } });

  res.json({ ok: true, message: 'Application withdrawn' });
});
