import mongoose from 'mongoose';
import AlumniProfile from '../../models/AlumniProfile.js';
import MentorshipRequest from '../../models/MentorshipRequest.js';
import AlumniJob from '../../models/AlumniJob.js';
import AlumniEvent from '../../models/AlumniEvent.js';
import Chapter from '../../models/Chapter.js';
import ChapterMember from '../../models/ChapterMember.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../../utils/http.js';
import { applyPrivacy, batchApplyPrivacy } from '../../utils/alumniPrivacy.js';
import { logActivity } from '../../utils/activity.js';
import { notifyRoles, notifyUsers } from '../../utils/notify.js';
import { sameId } from '../../utils/permissions.js';
import { env } from '../../config/env.js';
import { DEPARTMENTS, MENTORSHIP_DOMAINS, PRIVACY_FIELDS, PRIVACY_LEVELS } from '../../constants.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar phone designation employeeId rollNo';

function calculateCompleteness(profile, user) {
  let score = 0;
  if (profile.gradYear) score += 15;
  if (profile.company) score += 15;
  if (profile.designation) score += 10;
  if (profile.location) score += 10;
  if (profile.headline) score += 10;
  if (profile.about) score += 10;
  if (profile.linkedin) score += 10;
  if (profile.skills && profile.skills.length > 0) score += 10;
  if (user?.avatar) score += 10;
  return Math.min(100, score);
}

// ── GET /api/alumni/me ──────────────────────────────────────────────
export const getMyProfile = asyncHandler(async (req, res) => {
  let profile = await AlumniProfile.findOne({ user: req.user._id }).populate('user', PUBLIC_USER_FIELDS);

  if (!profile) {
    // Return unpersisted template for newly assigned alumni
    const template = {
      user: req.user,
      gradYear: new Date().getFullYear(),
      isVerified: false,
      mentorshipAvailable: false,
      maxActiveMentees: 3,
      activeMenteeCount: 0,
      domains: [],
      skills: [],
      showInDirectory: true,
      openToReferrals: false,
      completeness: req.user.avatar ? 10 : 0,
      avgRating: 0,
      ratingCount: 0,
    };
    return res.json(template);
  }

  const completeness = calculateCompleteness(profile, profile.user);
  const out = profile.toObject();
  out.completeness = completeness;

  res.json(out);
});

// ── PUT /api/alumni/me ──────────────────────────────────────────────
export const updateMyProfile = asyncHandler(async (req, res) => {
  const allowed = [
    'gradYear', 'company', 'designation', 'location', 'linkedin',
    'headline', 'about', 'skills', 'program', 'domains',
    'mentorshipAvailable', 'maxActiveMentees', 'mentorshipNote',
    'openToReferrals', 'showInDirectory', 'privacy',
  ];
  const patch = pick(req.body, allowed);

  let profile = await AlumniProfile.findOne({ user: req.user._id });

  if (patch.maxActiveMentees !== undefined) {
    const currentActive = profile ? profile.activeMenteeCount : 0;
    if (patch.maxActiveMentees < currentActive) {
      throw new ApiError(409, `Max mentees cannot be less than currently active mentees (${currentActive})`);
    }
  }

  if (patch.privacy) {
    for (const [k, v] of Object.entries(patch.privacy)) {
      if (!PRIVACY_FIELDS.includes(k)) throw new ApiError(422, `Invalid privacy field: ${k}`);
      if (!PRIVACY_LEVELS.includes(v)) throw new ApiError(422, `Invalid privacy level: ${v}`);
    }
  }

  const previousVerified = profile?.isVerified;
  let reVerificationNeeded = false;

  if (profile) {
    const gradYearChanged = patch.gradYear && patch.gradYear !== profile.gradYear;
    const companyChanged = patch.company !== undefined && patch.company !== profile.company;
    if ((gradYearChanged || companyChanged) && profile.isVerified) {
      patch.isVerified = false;
      reVerificationNeeded = true;
    }
    patch.rejectionReason = undefined;

    Object.assign(profile, patch);
    await profile.save();
  } else {
    profile = await AlumniProfile.create({
      user: req.user._id,
      ...patch,
      isVerified: false,
    });
    reVerificationNeeded = true;
  }

  await profile.populate('user', PUBLIC_USER_FIELDS);

  if (reVerificationNeeded && previousVerified) {
    // Notify admin & HOD that profile requires re-verification
    await notifyRoles(['admin', 'hod'], {
      type: 'alumni',
      title: 'Alumni Profile Awaiting Verification',
      message: `${req.user.name} updated their graduation year / company and requires verification.`,
      link: '/alumni?tab=verification',
    });
  }

  logActivity(req, 'alumni.profile_update', { entityType: 'user', entityId: req.user._id });

  const completeness = calculateCompleteness(profile, profile.user);
  const out = profile.toObject();
  out.completeness = completeness;

  res.json(out);
});

// ── GET /api/alumni/:userId ────────────────────────────────────────
export const getAlumniProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const profile = await AlumniProfile.findOne({ user: userId }).populate('user', PUBLIC_USER_FIELDS);
  if (!profile) throw new ApiError(404, 'Alumni profile not found');

  const viewer = req.user;
  const isOwner = sameId(profile.user._id, viewer._id);
  const isStaff = ['admin', 'hod', 'principal', 'dean', 'chairman', 'ao'].includes(viewer.role);

  if (!profile.isVerified && !isOwner && !isStaff) {
    throw new ApiError(404, 'Alumni profile is not verified');
  }

  // Check mentee relation
  let isMentee = false;
  if (['student', 'club_admin'].includes(viewer.role)) {
    const rel = await MentorshipRequest.findOne({
      student: viewer._id,
      alumni: profile.user._id,
      status: { $in: ['accepted', 'completed'] },
    });
    isMentee = Boolean(rel);
  }

  const projected = applyPrivacy(profile, viewer, { isMentee });

  // Get last 5 reviews
  const reviews = await MentorshipRequest.find({
    alumni: profile.user._id,
    status: 'completed',
    rating: { $exists: true, $ne: null },
  })
    .sort({ ratedAt: -1 })
    .limit(5)
    .populate('student', 'name')
    .lean();

  projected.recentReviews = reviews.map((r) => ({
    rating: r.rating,
    review: r.review,
    ratedAt: r.ratedAt,
    studentFirstName: r.student?.name ? r.student.name.split(' ')[0] : 'Student',
  }));

  // Counts of open jobs and upcoming events
  const [openJobsCount, upcomingEventsCount] = await Promise.all([
    AlumniJob.countDocuments({ postedBy: profile.user._id, status: 'open' }),
    AlumniEvent.countDocuments({ createdBy: profile.user._id, status: 'scheduled', startsAt: { $gte: new Date() } }),
  ]);

  projected.openJobsCount = openJobsCount;
  projected.upcomingEventsCount = upcomingEventsCount;
  projected.completeness = calculateCompleteness(profile, profile.user);

  res.json(projected);
});

// ── GET /api/alumni/filters ────────────────────────────────────────
export const getAlumniFilters = asyncHandler(async (_req, res) => {
  const verifiedProfiles = await AlumniProfile.find({ isVerified: true, showInDirectory: true })
    .populate('user', 'department')
    .lean();

  const deptSet = new Set();
  const yearSet = new Set();
  const companyCounts = {};
  const locationCounts = {};
  const domainCounts = {};

  for (const p of verifiedProfiles) {
    if (p.user?.department) deptSet.add(p.user.department);
    if (p.gradYear) yearSet.add(p.gradYear);
    if (p.company) companyCounts[p.company] = (companyCounts[p.company] || 0) + 1;
    if (p.location) locationCounts[p.location] = (locationCounts[p.location] || 0) + 1;
    if (p.domains) {
      p.domains.forEach((d) => {
        domainCounts[d] = (domainCounts[d] || 0) + 1;
      });
    }
  }

  const topCompanies = Object.entries(companyCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const topLocations = Object.entries(locationCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const domainFacets = MENTORSHIP_DOMAINS.map((key) => ({
    key,
    count: domainCounts[key] || 0,
  }));

  res.json({
    departments: [...deptSet].sort(),
    gradYears: [...yearSet].sort((a, b) => b - a),
    topCompanies,
    locations: topLocations,
    domains: domainFacets,
  });
});

// ── GET /api/alumni (Directory) ────────────────────────────────────
export const listAlumniDirectory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 12, 50);
  const {
    search,
    department,
    domain,
    company,
    gradYear,
    location,
    skill,
    mentorshipAvailable,
    openToReferrals,
    sort = 'recent',
    unverified,
  } = req.query;

  const viewer = req.user;
  const isStaff = ['admin', 'hod'].includes(viewer.role);
  const showUnverifiedOnly = unverified === 'true' && isStaff;

  const filter = {};

  if (showUnverifiedOnly) {
    filter.isVerified = false;
  } else {
    filter.isVerified = true;
    filter.showInDirectory = true;
  }

  if (domain) filter.domains = domain;
  if (gradYear) filter.gradYear = Number(gradYear);
  if (openToReferrals === 'true') filter.openToReferrals = true;
  if (skill) filter.skills = new RegExp(escapeRegex(skill), 'i');

  if (company) {
    filter.company = new RegExp(escapeRegex(company), 'i');
  }

  if (location) {
    filter.location = new RegExp(escapeRegex(location), 'i');
  }

  if (mentorshipAvailable === 'true') {
    filter.mentorshipAvailable = true;
    filter.$expr = { $lt: ['$activeMenteeCount', '$maxActiveMentees'] };
  }

  // Pre-filter user IDs if search or department filter is requested
  const userFilter = { role: 'alumni', isActive: true };
  if (department) {
    userFilter.department = department;
  }
  if (viewer.role === 'hod' && showUnverifiedOnly) {
    userFilter.department = viewer.department;
  }

  if (search && search.trim()) {
    const q = escapeRegex(search.trim());
    userFilter.$or = [
      { name: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
    ];
  }

  const matchingUsers = await User.find(userFilter).distinct('_id');
  if (department || search || (viewer.role === 'hod' && showUnverifiedOnly)) {
    filter.user = { $in: matchingUsers };
  }

  let sortOption = { createdAt: -1 };
  if (sort === 'rating') sortOption = { ratingAvg: -1, ratingCount: -1 };
  else if (sort === 'name') sortOption = { 'user.name': 1 };
  else if (sort === 'gradYear') sortOption = { gradYear: -1 };

  const [items, total] = await Promise.all([
    AlumniProfile.find(filter)
      .populate('user', PUBLIC_USER_FIELDS)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean(),
    AlumniProfile.countDocuments(filter),
  ]);

  const projectedItems = await batchApplyPrivacy(items, viewer);

  res.json({
    items: projectedItems,
    ...pageMeta(total, page, limit),
  });
});

// ── PATCH /api/alumni/:id/verify ───────────────────────────────────
export const verifyAlumniProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const profile = await AlumniProfile.findById(id).populate('user');
  if (!profile) throw new ApiError(404, 'Alumni profile not found');

  if (req.user.role === 'hod' && profile.user.department !== req.user.department) {
    throw new ApiError(403, 'HOD can only verify alumni from their own department');
  }

  profile.isVerified = true;
  profile.verifiedBy = req.user._id;
  profile.verifiedAt = new Date();
  profile.rejectionReason = undefined;
  await profile.save();

  // Auto-join batch and department chapters if enabled
  if (env.alumni.chapterAutojoin) {
    const matchingChapters = await Chapter.find({
      $or: [
        { type: 'batch', gradYear: profile.gradYear },
        { type: 'department', department: profile.user.department },
      ],
      archived: false,
    });

    for (const ch of matchingChapters) {
      await ChapterMember.updateOne(
        { chapter: ch._id, user: profile.user._id },
        { $setOnInsert: { role: 'member', status: 'active' } },
        { upsert: true }
      );
      await Chapter.updateOne({ _id: ch._id }, { $inc: { memberCount: 1 } });
    }
  }

  await notifyUsers([profile.user._id], {
    type: 'alumni',
    title: 'Alumni Profile Verified! 🎉',
    message: 'Your alumni profile has been verified. You now appear in the alumni directory and can post jobs or mentor students.',
    link: '/alumni?tab=my_profile',
  });

  logActivity(req, 'alumni.verify_profile', { entityType: 'user', entityId: profile.user._id });
  res.json({ ok: true, message: 'Alumni profile verified successfully' });
});

// ── POST /api/alumni/:id/reject ────────────────────────────────────
export const rejectAlumniProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason || reason.trim().length < 5) {
    throw new ApiError(422, 'Rejection reason of at least 5 characters is required');
  }

  const profile = await AlumniProfile.findById(id).populate('user');
  if (!profile) throw new ApiError(404, 'Alumni profile not found');

  if (req.user.role === 'hod' && profile.user.department !== req.user.department) {
    throw new ApiError(403, 'HOD can only review alumni from their own department');
  }

  profile.isVerified = false;
  profile.rejectionReason = reason.trim().slice(0, 300);
  await profile.save();

  await notifyUsers([profile.user._id], {
    type: 'alumni',
    title: 'Alumni Profile Needs Changes',
    message: `Verification review: ${reason.trim().slice(0, 200)}`,
    link: '/alumni?tab=my_profile',
  });

  logActivity(req, 'alumni.reject_profile', { entityType: 'user', entityId: profile.user._id });
  res.json({ ok: true, message: 'Profile marked as rejected with reason' });
});
