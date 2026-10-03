import AlumniProfile from '../../models/AlumniProfile.js';
import MentorshipRequest from '../../models/MentorshipRequest.js';
import MentorshipSession from '../../models/MentorshipSession.js';
import AlumniJob from '../../models/AlumniJob.js';
import JobApplication from '../../models/JobApplication.js';
import AlumniEvent from '../../models/AlumniEvent.js';
import AlumniEventRsvp from '../../models/AlumniEventRsvp.js';
import Chapter from '../../models/Chapter.js';
import ChapterPost from '../../models/ChapterPost.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler } from '../../utils/http.js';

let cache = { data: null, expiresAt: 0, dept: null };

// ── GET /api/alumni/analytics ──────────────────────────────────────
export const getAlumniAnalytics = asyncHandler(async (req, res) => {
  const user = req.user;
  const isHod = user.role === 'hod';
  const hodDept = user.department;
  const now = Date.now();

  const cacheKey = isHod ? hodDept : 'all';
  if (cache.data && cache.dept === cacheKey && cache.expiresAt > now) {
    return res.json(cache.data);
  }

  // Pre-filter alumni user IDs for HOD scope
  let alumniUserIds = null;
  if (isHod) {
    alumniUserIds = await User.find({ role: 'alumni', department: hodDept, isActive: true }).distinct('_id');
  }

  const profileMatch = {};
  if (alumniUserIds) profileMatch.user = { $in: alumniUserIds };

  // Totals
  const [
    totalAlumni,
    verifiedAlumni,
    unverifiedAlumni,
    mentorsCount,
    referralsCount,
    oldestUnverified,
  ] = await Promise.all([
    AlumniProfile.countDocuments(profileMatch),
    AlumniProfile.countDocuments({ ...profileMatch, isVerified: true }),
    AlumniProfile.countDocuments({ ...profileMatch, isVerified: false }),
    AlumniProfile.countDocuments({ ...profileMatch, isVerified: true, mentorshipAvailable: true }),
    AlumniProfile.countDocuments({ ...profileMatch, isVerified: true, openToReferrals: true }),
    AlumniProfile.findOne({ ...profileMatch, isVerified: false }).sort({ createdAt: 1 }).select('createdAt'),
  ]);

  let verificationBacklogOldestDays = 0;
  if (oldestUnverified?.createdAt) {
    verificationBacklogOldestDays = Math.max(0, Math.floor((now - oldestUnverified.createdAt.getTime()) / (24 * 60 * 60 * 1000)));
  }

  // Distribution by grad year
  const byGradYear = await AlumniProfile.aggregate([
    { $match: { ...profileMatch, isVerified: true } },
    { $group: { _id: '$gradYear', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { year: '$_id', count: 1, _id: 0 } },
  ]);

  // Distribution by department
  const byDepartment = await AlumniProfile.aggregate([
    { $match: { ...profileMatch, isVerified: true } },
    { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userInfo' } },
    { $unwind: '$userInfo' },
    { $group: { _id: '$userInfo.department', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { department: '$_id', count: 1, _id: 0 } },
  ]);

  // Top companies & locations
  const [topCompanies, topLocations] = await Promise.all([
    AlumniProfile.aggregate([
      { $match: { ...profileMatch, isVerified: true, company: { $exists: true, $ne: '' } } },
      { $group: { _id: '$company', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { company: '$_id', count: 1, _id: 0 } },
    ]),
    AlumniProfile.aggregate([
      { $match: { ...profileMatch, isVerified: true, location: { $exists: true, $ne: '' } } },
      { $group: { _id: '$location', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      { $project: { location: '$_id', count: 1, _id: 0 } },
    ]),
  ]);

  // Mentorship Analytics
  const reqMatch = {};
  if (alumniUserIds) reqMatch.alumni = { $in: alumniUserIds };

  const [reqStatuses, completedSessionsCount, topMentorsAgg] = await Promise.all([
    MentorshipRequest.aggregate([
      { $match: reqMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    MentorshipSession.countDocuments(alumniUserIds ? { alumni: { $in: alumniUserIds }, status: 'completed' } : { status: 'completed' }),
    AlumniProfile.find({ ...profileMatch, isVerified: true, ratingCount: { $gt: 0 } })
      .populate('user', 'name')
      .sort({ ratingAvg: -1, ratingCount: -1 })
      .limit(5)
      .lean(),
  ]);

  const requestsByStatus = { pending: 0, accepted: 0, declined: 0, completed: 0, cancelled: 0, expired: 0 };
  let totalRequests = 0;
  for (const s of reqStatuses) {
    requestsByStatus[s._id] = s.count;
    totalRequests += s.count;
  }

  const acceptedTotal = requestsByStatus.accepted + requestsByStatus.completed;
  const acceptanceRate = totalRequests > 0 ? Math.round((acceptedTotal / totalRequests) * 100) : 0;

  // Capacity utilisation
  const capacityAgg = await AlumniProfile.aggregate([
    { $match: { ...profileMatch, isVerified: true, mentorshipAvailable: true } },
    { $group: { _id: null, active: { $sum: '$activeMenteeCount' }, max: { $sum: '$maxActiveMentees' } } },
  ]);
  const activeMentees = capacityAgg[0]?.active || 0;
  const maxCapacity = capacityAgg[0]?.max || 0;
  const capacityUtilisation = maxCapacity > 0 ? Math.round((activeMentees / maxCapacity) * 100) : 0;

  // Median response time
  const respondedReqs = await MentorshipRequest.find({
    ...reqMatch,
    respondedAt: { $exists: true, $ne: null },
  }).select('createdAt respondedAt').lean();

  let medianResponseHours = 0;
  if (respondedReqs.length > 0) {
    const hours = respondedReqs
      .map((r) => (r.respondedAt.getTime() - r.createdAt.getTime()) / (1000 * 60 * 60))
      .sort((a, b) => a - b);
    medianResponseHours = Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10;
  }

  const avgRatingAgg = await AlumniProfile.aggregate([
    { $match: { ...profileMatch, isVerified: true, ratingCount: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: '$ratingAvg' } } },
  ]);
  const avgRating = avgRatingAgg[0]?.avg ? Math.round(avgRatingAgg[0].avg * 10) / 10 : 0;

  const topMentors = topMentorsAgg.map((p) => ({
    name: p.user?.name || 'Mentor',
    avgRating: p.ratingAvg,
    completed: p.ratingCount,
  }));

  // Jobs Analytics
  const jobMatch = {};
  if (alumniUserIds) jobMatch.postedBy = { $in: alumniUserIds };

  const [openJobs, totalApplications, referredApplications] = await Promise.all([
    AlumniJob.countDocuments({ ...jobMatch, status: 'open' }),
    JobApplication.countDocuments(alumniUserIds ? { poster: { $in: alumniUserIds } } : {}),
    JobApplication.countDocuments(alumniUserIds ? { poster: { $in: alumniUserIds }, status: 'referred' } : { status: 'referred' }),
  ]);

  const referralConversion = totalApplications > 0 ? Math.round((referredApplications / totalApplications) * 100) : 0;

  // Events Analytics
  const [upcomingEvents, totalRsvps, checkedInRsvps] = await Promise.all([
    AlumniEvent.countDocuments({ status: 'scheduled', startsAt: { $gte: new Date() } }),
    AlumniEventRsvp.countDocuments({ status: 'going' }),
    AlumniEventRsvp.countDocuments({ status: 'going', checkedInAt: { $exists: true } }),
  ]);
  const attendanceRate = totalRsvps > 0 ? Math.round((checkedInRsvps / totalRsvps) * 100) : 0;

  // Chapters Analytics
  const [chapterCount, totalChapterMembers, postsLast7d] = await Promise.all([
    Chapter.countDocuments({ archived: false }),
    Chapter.aggregate([{ $group: { _id: null, sum: { $sum: '$memberCount' } } }]),
    ChapterPost.countDocuments({ createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) }, deletedAt: null }),
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      alumni: totalAlumni,
      verified: verifiedAlumni,
      unverified: unverifiedAlumni,
      verificationBacklogOldestDays,
      mentors: mentorsCount,
      openToReferrals: referralsCount,
    },
    byGradYear,
    byDepartment,
    topCompanies,
    topLocations,
    mentorship: {
      availableMentors: mentorsCount,
      capacityUtilisation,
      requestsByStatus,
      acceptanceRate,
      medianResponseHours,
      avgRating,
      sessionsCompleted: completedSessionsCount,
      topMentors,
    },
    jobs: {
      open: openJobs,
      applications: totalApplications,
      referred: referredApplications,
      referralConversion,
      topSkills: [],
    },
    events: {
      upcoming: upcomingEvents,
      rsvps: totalRsvps,
      attendanceRate,
    },
    chapters: {
      count: chapterCount,
      members: totalChapterMembers[0]?.sum || 0,
      postsLast7d,
    },
  };

  cache = { data: payload, expiresAt: now + 60 * 1000, dept: cacheKey };
  res.json(payload);
});

// ── GET /api/alumni/analytics/export ───────────────────────────────
export const exportDirectoryCSV = asyncHandler(async (req, res) => {
  const user = req.user;
  const isHod = user.role === 'hod';

  const filter = { isVerified: true };
  if (isHod) {
    const userIds = await User.find({ role: 'alumni', department: user.department }).distinct('_id');
    filter.user = { $in: userIds };
  }

  const profiles = await AlumniProfile.find(filter)
    .populate('user', 'name email department phone')
    .sort({ gradYear: -1 })
    .lean();

  const headers = ['#', 'Name', 'Email', 'Department', 'Grad Year', 'Company', 'Designation', 'Location', 'Phone', 'Mentorship Available', 'Rating'];
  const rows = profiles.map((p, idx) => [
    idx + 1,
    `"${p.user?.name || ''}"`,
    `"${p.user?.email || ''}"`,
    `"${p.user?.department || ''}"`,
    p.gradYear || '',
    `"${p.company || ''}"`,
    `"${p.designation || ''}"`,
    `"${p.location || ''}"`,
    `"${p.user?.phone || ''}"`,
    p.mentorshipAvailable ? 'Yes' : 'No',
    p.ratingAvg || 0,
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="alumni-directory-${Date.now()}.csv"`);
  res.send(csv);
});
