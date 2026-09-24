import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import GatePass from '../models/GatePass.js';
import LostFoundItem from '../models/LostFoundItem.js';
import Subject from '../models/Subject.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Club from '../models/Club.js';
import Discussion from '../models/Discussion.js';
import Activity from '../models/Activity.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { canManageClub } from '../utils/permissions.js';
import { campusTimezone, dayFilter, dayKey, resolveRange, timestampFilter } from '../utils/dates.js';
import { LOW_ATTENDANCE_THRESHOLD, STUDENT_ROLES, percentage } from './attendanceController.js';

const presentExpr = { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } };
const pct = (present, total) => ({
  $cond: [{ $gt: [total, 0] }, { $round: [{ $multiply: [{ $divide: [present, total] }, 100] }, 2] }, 0],
});

/** Reporting window + bucket size shared by every dashboard. */
function windowFrom(query, fallback = 'month') {
  const w = resolveRange(query, fallback);
  const days = w.from && w.to ? Math.round((w.to - w.from) / 86400000) + 1 : 366;
  const groupBy = ['day', 'week', 'month'].includes(query.groupBy) ? query.groupBy : days <= 31 ? 'day' : days <= 190 ? 'week' : 'month';
  return { ...w, groupBy, days, days_: dayFilter(w), ts: timestampFilter(w) };
}

const describe = (w) => ({
  range: w.range || 'all',
  from: w.from ? dayKey(w.from) : null,
  to: w.to ? dayKey(w.to) : null,
  groupBy: w.groupBy,
});

/** Bucket expression for a *timestamp* field, in campus time. */
function tsBucket(field, groupBy) {
  const tz = campusTimezone();
  if (groupBy === 'month') return { $dateToString: { format: '%Y-%m', date: field, timezone: tz } };
  if (groupBy === 'week') {
    return { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday', timezone: tz } }, timezone: tz } };
  }
  return { $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } };
}

/** Bucket expression for a *class-day* field (stored as UTC midnight). */
function dayBucket(field, groupBy) {
  if (groupBy === 'month') return { $dateToString: { format: '%Y-%m', date: field } };
  if (groupBy === 'week') return { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday' } } } };
  return { $dateToString: { format: '%Y-%m-%d', date: field } };
}

const attendanceTrend = (match, groupBy) =>
  AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: dayBucket('$date', groupBy), total: { $sum: 1 }, present: presentExpr } },
    { $addFields: { percentage: pct('$present', '$total') } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, bucket: '$_id', total: 1, present: 1, percentage: 1 } },
  ]);

async function attendanceTotals(match) {
  const [row] = await AttendanceRecord.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: 1 }, present: presentExpr } }]);
  const total = row?.total || 0;
  const present = row?.present || 0;
  // Σ present ÷ Σ conducted — never an average of per-subject percentages.
  return { totalPeriods: total, presentPeriods: present, absentPeriods: total - present, percentage: percentage(present, total) };
}

/** Actions per bucket plus distinct active users. */
const engagementTrend = (match, groupBy) =>
  Activity.aggregate([
    { $match: match },
    { $group: { _id: tsBucket('$createdAt', groupBy), actions: { $sum: 1 }, users: { $addToSet: '$user' } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, bucket: '$_id', actions: 1, activeUsers: { $size: '$users' } } },
  ]);

/** Event registrations per bucket, optionally limited to some users or events. */
function registrationTrend({ eventMatch = {}, userIds, ts }, groupBy) {
  const regMatch = {};
  if (ts) regMatch['registrations.registeredAt'] = ts;
  if (userIds) regMatch['registrations.user'] = { $in: userIds };
  return Event.aggregate([
    { $match: eventMatch },
    { $unwind: '$registrations' },
    { $match: regMatch },
    {
      $group: {
        _id: tsBucket('$registrations.registeredAt', groupBy),
        registrations: { $sum: 1 },
        attended: { $sum: { $cond: [{ $eq: ['$registrations.status', 'attended'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, bucket: '$_id', registrations: 1, attended: 1 } },
  ]);
}

async function participationTotals({ eventMatch = {}, userIds, ts }) {
  const regMatch = {};
  if (ts) regMatch['registrations.registeredAt'] = ts;
  if (userIds) regMatch['registrations.user'] = { $in: userIds };
  const [row] = await Event.aggregate([
    { $match: eventMatch },
    { $unwind: '$registrations' },
    { $match: regMatch },
    {
      $group: {
        _id: null,
        registrations: { $sum: 1 },
        waitlisted: { $sum: { $cond: [{ $eq: ['$registrations.status', 'waitlisted'] }, 1, 0] } },
        attended: { $sum: { $cond: [{ $eq: ['$registrations.status', 'attended'] }, 1, 0] } },
        participants: { $addToSet: '$registrations.user' },
        events: { $addToSet: '$_id' },
      },
    },
    { $project: { _id: 0, registrations: 1, waitlisted: 1, attended: 1, participants: { $size: '$participants' }, events: { $size: '$events' } } },
  ]);
  return row || { registrations: 0, waitlisted: 0, attended: 0, participants: 0, events: 0 };
}

// ── Student analytics (self) ───────────────────────────────────────

export const studentAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'semester');
  const uid = req.user._id;
  const attMatch = { student: uid, ...(w.days_ ? { date: w.days_ } : {}) };
  const actMatch = { user: uid, ...(w.ts ? { createdAt: w.ts } : {}) };

  const [attendance, attTrend, subjects, participation, partTrend, byCategory, clubs, discussionsStarted, replies, engagement, topActions, gatePasses] =
    await Promise.all([
      attendanceTotals(attMatch),
      attendanceTrend(attMatch, w.groupBy),
      AttendanceRecord.aggregate([
        { $match: attMatch },
        { $group: { _id: '$subject', total: { $sum: 1 }, present: presentExpr } },
        { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 's', pipeline: [{ $project: { code: 1, name: 1 } }] } },
        { $unwind: '$s' },
        { $project: { _id: 0, subjectId: '$_id', code: '$s.code', name: '$s.name', total: 1, present: 1, percentage: pct('$present', '$total') } },
        { $sort: { code: 1 } },
      ]),
      participationTotals({ userIds: [uid], ts: w.ts }),
      registrationTrend({ userIds: [uid], ts: w.ts }, w.groupBy),
      Event.aggregate([
        { $match: { 'registrations.user': uid } },
        { $unwind: '$registrations' },
        { $match: { 'registrations.user': uid, ...(w.ts ? { 'registrations.registeredAt': w.ts } : {}) } },
        { $group: { _id: '$category', registrations: { $sum: 1 } } },
        { $project: { _id: 0, category: '$_id', registrations: 1 } },
        { $sort: { registrations: -1 } },
      ]),
      Club.find({ members: uid, status: 'approved' }).select('name slug logo category').lean(),
      Discussion.countDocuments({ author: uid, ...(w.ts ? { createdAt: w.ts } : {}) }),
      Discussion.aggregate([
        { $match: { 'replies.author': uid } },
        { $unwind: '$replies' },
        { $match: { 'replies.author': uid, ...(w.ts ? { 'replies.createdAt': w.ts } : {}) } },
        { $count: 'n' },
      ]),
      engagementTrend(actMatch, w.groupBy),
      Activity.aggregate([
        { $match: actMatch },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
        { $project: { _id: 0, action: '$_id', count: 1 } },
      ]),
      GatePass.aggregate([{ $match: { student: uid, ...(w.ts ? { createdAt: w.ts } : {}) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

  const recentActivity = await Activity.find(actMatch).sort({ createdAt: -1 }).limit(12).select('action summary entityType createdAt').lean();

  res.json({
    window: describe(w),
    threshold: LOW_ATTENDANCE_THRESHOLD,
    attendance: { ...attendance, trend: attTrend, subjects },
    events: { ...participation, trend: partTrend, byCategory },
    clubs: { count: clubs.length, list: clubs },
    discussions: { started: discussionsStarted, replies: replies[0]?.n || 0 },
    engagement: { trend: engagement, topActions, recent: recentActivity },
    gatePasses: Object.fromEntries(gatePasses.map((g) => [g._id, g.count])),
  });
});

// ── Faculty analytics (own subjects) ───────────────────────────────

export const facultyAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'month');
  const filter = { isActive: true };
  if (req.user.role === 'faculty' || req.query.mine === 'true') filter.faculty = req.user._id;
  // HOD sees every subject in their department, not just ones they personally teach.
  else if (req.user.role === 'hod' && req.user.department) filter.department = req.user.department;
  const mySubjects = await Subject.find(filter).select('name code department semester sections').lean();
  const subjectIds = mySubjects.map((s) => s._id);
  const match = { subject: { $in: subjectIds }, ...(w.days_ ? { date: w.days_ } : {}) };

  const [overall, trend, subjectStats, belowThreshold, sessions] = await Promise.all([
    attendanceTotals(match),
    attendanceTrend(match, w.groupBy),
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: '$subject', totalPeriods: { $sum: 1 }, presentPeriods: presentExpr, students: { $addToSet: '$student' } } },
      { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, code: 1 } }] } },
      { $unwind: '$subject' },
      { $project: { subject: 1, totalPeriods: 1, presentPeriods: 1, studentCount: { $size: '$students' }, percentage: pct('$presentPeriods', '$totalPeriods') } },
      { $sort: { 'subject.code': 1 } },
    ]),
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: { student: '$student', subject: '$subject' }, total: { $sum: 1 }, present: presentExpr } },
      { $addFields: { pct: pct('$present', '$total') } },
      { $match: { pct: { $lt: LOW_ATTENDANCE_THRESHOLD } } },
      { $lookup: { from: 'users', localField: '_id.student', foreignField: '_id', as: 'studentInfo', pipeline: [{ $project: { name: 1, rollNo: 1, section: 1, avatar: 1 } }] } },
      { $unwind: '$studentInfo' },
      { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subjectInfo', pipeline: [{ $project: { name: 1, code: 1 } }] } },
      { $unwind: '$subjectInfo' },
      { $sort: { pct: 1 } },
      { $limit: 50 },
    ]),
    AttendanceRecord.aggregate([{ $match: match }, { $group: { _id: { s: '$subject', d: '$date', p: '$period', sec: '$section' } } }, { $count: 'n' }]),
  ]);

  // Event participation of students in the classes this faculty teaches.
  const classFilters = mySubjects.flatMap((s) =>
    s.sections?.length ? s.sections.map((sec) => ({ department: s.department, section: sec })) : [{ department: s.department }]
  );
  let participation = null;
  if (classFilters.length) {
    const studentIds = await User.find({ role: { $in: STUDENT_ROLES }, isActive: true, $or: classFilters }).distinct('_id');
    participation = { students: studentIds.length, ...(await participationTotals({ userIds: studentIds, ts: w.ts })) };
  }

  res.json({
    window: describe(w),
    threshold: LOW_ATTENDANCE_THRESHOLD,
    subjects: mySubjects,
    overall: { ...overall, classesConducted: sessions[0]?.n || 0 },
    trend,
    subjectStats,
    belowThreshold,
    participation,
  });
});

// ── Department / section analytics (HOD view: faculty = own department) ──

export const departmentAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'month');
  let dept = req.query.department || req.user.department;
  if (['faculty', 'hod'].includes(req.user.role)) {
    if (req.query.department && req.query.department !== req.user.department) {
      throw new ApiError(403, 'You can view analytics for your own department only');
    }
    dept = req.user.department;
  }
  const match = { ...(dept ? { department: dept } : {}), ...(w.days_ ? { date: w.days_ } : {}) };
  if (req.query.section) match.section = String(req.query.section).toUpperCase();

  const studentFilter = { role: { $in: STUDENT_ROLES }, isActive: true, ...(dept ? { department: dept } : {}) };
  if (match.section) studentFilter.section = match.section;

  const [overall, trend, sectionStats, lowCount, studentIds, clubMembers] = await Promise.all([
    attendanceTotals(match),
    attendanceTrend(match, w.groupBy),
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: '$section', totalPeriods: { $sum: 1 }, presentPeriods: presentExpr, students: { $addToSet: '$student' } } },
      { $project: { section: { $ifNull: ['$_id', '—'] }, _id: 0, totalPeriods: 1, presentPeriods: 1, students: { $size: '$students' }, percentage: pct('$presentPeriods', '$totalPeriods') } },
      { $sort: { section: 1 } },
    ]),
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: '$student', total: { $sum: 1 }, present: presentExpr } },
      { $match: { $expr: { $lt: [pct('$present', '$total'), LOW_ATTENDANCE_THRESHOLD] } } },
      { $count: 'n' },
    ]),
    User.find(studentFilter).distinct('_id'),
    User.countDocuments({ ...studentFilter, 'clubs.0': { $exists: true } }),
  ]);
  const participation = await participationTotals({ userIds: studentIds, ts: w.ts });

  res.json({
    window: describe(w),
    department: dept || 'All',
    threshold: LOW_ATTENDANCE_THRESHOLD,
    overall,
    trend,
    sectionStats,
    lowAttendanceStudents: lowCount[0]?.n || 0,
    totalStudents: studentIds.length,
    studentsInClubs: clubMembers,
    participation,
  });
});

// ── College-level analytics (Admin) ────────────────────────────────

export const collegeAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'month');
  const ts = w.ts ? { createdAt: w.ts } : {};
  const attMatch = w.days_ ? { date: w.days_ } : {};

  const [
    totalStudents,
    totalFaculty,
    newUsers,
    activeUsers,
    totalClubs,
    membershipAgg,
    eventsInRange,
    participation,
    discussionsInRange,
    repliesInRange,
    attendance,
    attTrend,
    deptAttendance,
    engagement,
    regTrend,
    eventsByCategory,
    topClubs,
    gatePassStats,
    lostFoundStats,
  ] = await Promise.all([
    User.countDocuments({ role: { $in: STUDENT_ROLES }, isActive: true }),
    User.countDocuments({ role: 'faculty', isActive: true }),
    User.countDocuments({ ...ts }),
    Activity.distinct('user', { ...ts, user: { $ne: null } }).then((ids) => ids.length),
    Club.countDocuments({ status: 'approved' }),
    Club.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, memberships: { $sum: { $size: '$members' } } } }]),
    Event.countDocuments(w.ts ? { startDate: w.ts } : {}),
    participationTotals({ ts: w.ts }),
    Discussion.countDocuments({ ...ts }),
    Discussion.aggregate([{ $unwind: '$replies' }, { $match: w.ts ? { 'replies.createdAt': w.ts } : {} }, { $count: 'n' }]),
    attendanceTotals(attMatch),
    attendanceTrend(attMatch, w.groupBy),
    AttendanceRecord.aggregate([
      { $match: attMatch },
      { $group: { _id: '$department', total: { $sum: 1 }, present: presentExpr } },
      { $project: { _id: 0, department: '$_id', total: 1, present: 1, percentage: pct('$present', '$total') } },
      { $sort: { department: 1 } },
    ]),
    engagementTrend({ ...ts }, w.groupBy),
    registrationTrend({ ts: w.ts }, w.groupBy),
    Event.aggregate([
      { $match: w.ts ? { startDate: w.ts } : {} },
      { $group: { _id: '$category', events: { $sum: 1 }, registrations: { $sum: '$registeredCount' } } },
      { $project: { _id: 0, category: '$_id', events: 1, registrations: 1 } },
      { $sort: { registrations: -1 } },
    ]),
    Club.aggregate([
      { $match: { status: 'approved' } },
      { $project: { name: 1, slug: 1, logo: 1, category: 1, memberCount: { $size: '$members' } } },
      { $sort: { memberCount: -1 } },
      { $limit: 6 },
    ]),
    GatePass.aggregate([{ $match: { ...ts } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    LostFoundItem.aggregate([{ $match: { ...ts } }, { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } }]),
  ]);

  res.json({
    window: describe(w),
    overview: {
      totalStudents,
      totalFaculty,
      newUsers,
      activeUsers,
      totalClubs,
      clubMemberships: membershipAgg[0]?.memberships || 0,
      events: eventsInRange,
      eventRegistrations: participation.registrations,
      eventAttendance: participation.attended,
      discussions: discussionsInRange,
      replies: repliesInRange[0]?.n || 0,
      overallAttendance: attendance.percentage,
    },
    // Kept for existing consumers: same shape as before.
    totalEvents: eventsInRange,
    attendance: { ...attendance, trend: attTrend },
    departmentAttendance: deptAttendance,
    engagementTrend: engagement,
    registrationTrend: regTrend,
    eventsByCategory,
    topClubs,
    gatePassStats: Object.fromEntries(gatePassStats.map((g) => [g._id, g.count])),
    lostFoundStats,
    activityTrend: engagement.map((e) => ({ _id: e.bucket, count: e.actions })),
  });
});

// ── Club analytics (club admins, advisor, staff) ───────────────────

export const clubAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'semester');
  const club = mongoose.isValidObjectId(req.params.id)
    ? await Club.findById(req.params.id).lean()
    : await Club.findOne({ slug: req.params.id }).lean();
  if (!club) throw new ApiError(404, 'Club not found');
  if (!canManageClub(req.user, club) && !['admin', 'faculty', 'hod', 'principal'].includes(req.user.role)) {
    throw new ApiError(403, 'Only club admins, the faculty advisor or staff can view club analytics');
  }

  const eventMatch = { club: club._id };
  const actMatch = { entityId: club._id, action: { $regex: '^club\\.' }, ...(w.ts ? { createdAt: w.ts } : {}) };

  const [events, upcoming, participation, trend, topEvents, departments, discussions, joinActivity] = await Promise.all([
    Event.countDocuments({ ...eventMatch, ...(w.ts ? { startDate: w.ts } : {}) }),
    Event.countDocuments({ ...eventMatch, endDate: { $gte: new Date() } }),
    participationTotals({ eventMatch, ts: w.ts }),
    registrationTrend({ eventMatch, ts: w.ts }, w.groupBy),
    Event.aggregate([
      { $match: { ...eventMatch, ...(w.ts ? { startDate: w.ts } : {}) } },
      {
        $project: {
          title: 1,
          startDate: 1,
          capacity: 1,
          registeredCount: 1,
          attended: { $size: { $filter: { input: '$registrations', cond: { $eq: ['$$this.status', 'attended'] } } } },
        },
      },
      { $sort: { registeredCount: -1 } },
      { $limit: 6 },
    ]),
    User.aggregate([
      { $match: { _id: { $in: club.members } } },
      { $group: { _id: { $ifNull: ['$department', 'Unspecified'] }, count: { $sum: 1 } } },
      { $project: { _id: 0, department: '$_id', count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Discussion.countDocuments({ club: club._id, ...(w.ts ? { createdAt: w.ts } : {}) }),
    Activity.aggregate([
      { $match: actMatch },
      { $group: { _id: tsBucket('$createdAt', w.groupBy), actions: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, bucket: '$_id', actions: 1 } },
    ]),
  ]);

  const memberIds = new Set(club.members.map(String));
  const membersEngaged = await Event.distinct('registrations.user', { ...eventMatch, ...(w.ts ? { startDate: w.ts } : {}) });
  const engagedMembers = membersEngaged.filter((id) => memberIds.has(String(id))).length;

  res.json({
    window: describe(w),
    club: { _id: club._id, name: club.name, slug: club.slug, logo: club.logo, category: club.category },
    members: {
      total: club.members.length,
      admins: club.admins.length,
      pendingRequests: club.pendingRequests?.length || 0,
      engagedInEvents: engagedMembers,
      engagementRate: percentage(engagedMembers, club.members.length),
      byDepartment: departments,
    },
    events: { inRange: events, upcoming, ...participation, attendanceRate: percentage(participation.attended, participation.registrations - participation.waitlisted) },
    registrationTrend: trend,
    topEvents,
    discussions,
    activityTrend: joinActivity,
  });
});

// ── Gate analytics ─────────────────────────────────────────────────

export const gateAnalytics = asyncHandler(async (req, res) => {
  const w = windowFrom(req.query, 'month');
  const ts = w.ts ? { createdAt: w.ts } : {};

  const [statusCounts, dailyTrend, avgTimeOutside, byReason] = await Promise.all([
    GatePass.aggregate([{ $match: ts }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    GatePass.aggregate([
      { $match: ts },
      {
        $group: {
          _id: tsBucket('$createdAt', w.groupBy),
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $in: ['$status', ['approved', 'active', 'completed']] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    GatePass.aggregate([
      { $match: { ...ts, actualExit: { $ne: null }, actualReturn: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgMs: { $avg: { $subtract: ['$actualReturn', '$actualExit'] } },
          late: { $sum: { $cond: [{ $gt: ['$actualReturn', '$expectedReturn'] }, 1, 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
    GatePass.aggregate([{ $match: ts }, { $group: { _id: '$reason', count: { $sum: 1 } } }, { $project: { _id: 0, reason: '$_id', count: 1 } }, { $sort: { count: -1 } }]),
  ]);

  res.json({
    window: describe(w),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.count])),
    dailyTrend,
    byReason,
    avgTimeOutsideMinutes: avgTimeOutside[0] ? Math.round(avgTimeOutside[0].avgMs / 60000) : 0,
    lateReturns: avgTimeOutside[0]?.late || 0,
    totalCompleted: avgTimeOutside[0]?.count || 0,
  });
});

