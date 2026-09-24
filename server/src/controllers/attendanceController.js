import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceCorrectionRequest from '../models/AttendanceCorrectionRequest.js';
import Notification from '../models/Notification.js';
import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, paginate, pageMeta } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToUsers } from '../config/socket.js';
import { addDays, dayFilter, dayKey, resolveRange, toDay, today, weekdayOf } from '../utils/dates.js';

export const LOW_ATTENDANCE_THRESHOLD = 75;
// Faculty may change a class's attendance for this many days; after that only
// an admin can, or the student goes through a correction request.
const EDIT_WINDOW_DAYS = 7;
// Club admins are students with extra club permissions.
export const STUDENT_ROLES = ['student', 'club_admin'];

const presentExpr = { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } };
const pctExpr = (present, total) => ({
  $cond: [{ $gt: [total, 0] }, { $round: [{ $multiply: [{ $divide: [present, total] }, 100] }, 2] }, 0],
});
const round2 = (n) => Math.round(n * 100) / 100;
/** Percentage = present periods ÷ conducted periods × 100 (never an average of percentages). */
export const percentage = (present, total) => (total > 0 ? round2((present / total) * 100) : 0);

/** Cast a query-string id for aggregation pipelines (Mongoose does not cast there). */
function oid(value, name = 'id') {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(422, `Invalid ${name}`);
  return new mongoose.Types.ObjectId(String(value));
}

const isAssigned = (subject, user) => subject.faculty?.some((f) => sameId(f, user));

/**
 * Records a staff member may see. Admin: everything. Faculty: subjects they
 * teach plus their own department (class mentor / HOD view).
 */
async function staffScope(user) {
  if (user.role === 'admin') return {};
  const subjects = await Subject.find({ faculty: user._id }).distinct('_id');
  const or = [{ subject: { $in: subjects } }];
  if (user.department) or.push({ department: user.department });
  return { $or: or };
}

/** Students who belong to a subject's class (department + section + semester). */
function rosterFilter(subject, section) {
  const filter = { role: { $in: STUDENT_ROLES }, isActive: true, department: subject.department };
  if (section) filter.section = section;
  if (subject.semester) filter.$or = [{ semester: subject.semester }, { semester: null }];
  return filter;
}

function normaliseSection(subject, section) {
  const s = section ? String(section).trim().toUpperCase() : '';
  const allowed = (subject.sections || []).map((x) => String(x).toUpperCase());
  if (allowed.length && !s) throw new ApiError(422, 'Select a section');
  if (allowed.length && !allowed.includes(s)) throw new ApiError(422, `${subject.code} is not taught to section ${s}`);
  return s || undefined;
}

function assertCanMark(user, subject) {
  if (user.role === 'faculty' && !isAssigned(subject, user)) {
    throw new ApiError(403, 'You are not assigned to this subject');
  }
}

function assertEditable(user, day) {
  if (day > today()) throw new ApiError(422, 'Attendance cannot be marked for a future date');
  if (user.role !== 'admin' && day < addDays(today(), -EDIT_WINDOW_DAYS)) {
    throw new ApiError(403, `Attendance older than ${EDIT_WINDOW_DAYS} days can only be changed by an admin or through a correction request`);
  }
}

/** Warn students whose subject attendance just dropped below the threshold (at most every 3 days). */
async function warnLowAttendance(studentIds, subject) {
  if (!studentIds.length) return;
  const stats = await AttendanceRecord.aggregate([
    { $match: { subject: subject._id, student: { $in: studentIds } } },
    { $group: { _id: '$student', total: { $sum: 1 }, present: presentExpr } },
  ]);
  const low = stats.filter((s) => percentage(s.present, s.total) < LOW_ATTENDANCE_THRESHOLD).map((s) => s._id);
  if (!low.length) return;
  const title = `Low attendance in ${subject.code}`;
  const recent = await Notification.find({ user: { $in: low }, title, createdAt: { $gte: addDays(new Date(), -3) } }).distinct('user');
  const due = low.filter((id) => !recent.some((r) => sameId(r, id)));
  const byId = Object.fromEntries(stats.map((s) => [String(s._id), s]));
  await Promise.all(
    due.map((id) =>
      notifyUsers([id], {
        type: 'attendance',
        title,
        message: `Your attendance in ${subject.name} is ${percentage(byId[String(id)].present, byId[String(id)].total)}% (minimum ${LOW_ATTENDANCE_THRESHOLD}%).`,
        link: '/attendance',
      })
    )
  );
}

// ── Class roster for marking ───────────────────────────────────────

export const getRoster = asyncHandler(async (req, res) => {
  const { subjectId, date, period } = req.query;
  const subject = await Subject.findById(oid(subjectId, 'subject'));
  if (!subject || !subject.isActive) throw new ApiError(404, 'Subject not found');
  assertCanMark(req.user, subject);
  const section = normaliseSection(subject, req.query.section);
  const day = toDay(date);
  const p = Number(period);
  if (!Number.isInteger(p) || p < 1 || p > 12) throw new ApiError(422, 'Invalid period');

  const [students, existing, slot] = await Promise.all([
    User.find(rosterFilter(subject, section)).select('name rollNo avatar section department year').sort({ rollNo: 1, name: 1 }).lean(),
    AttendanceRecord.find({ subject: subject._id, date: day, period: p, ...(section ? { section } : {}) }).populate('markedBy', 'name').lean(),
    TimetableSlot.findOne({ subject: subject._id, dayOfWeek: weekdayOf(day), period: p, isActive: true, ...(section ? { section } : {}) })
      .populate('faculty', 'name')
      .lean(),
  ]);
  const byStudent = Object.fromEntries(existing.map((r) => [String(r.student), r]));
  const last = existing.sort((a, b) => new Date(b.markedAt) - new Date(a.markedAt))[0];

  let editable = true;
  let lockedReason = null;
  try {
    assertEditable(req.user, day);
  } catch (e) {
    editable = false;
    lockedReason = e.message;
  }

  res.json({
    subject: { _id: subject._id, name: subject.name, code: subject.code, department: subject.department, semester: subject.semester, sections: subject.sections },
    section: section || null,
    date: dayKey(day),
    period: p,
    slot,
    alreadyMarked: existing.length > 0,
    markedBy: last?.markedBy || null,
    markedAt: last?.markedAt || null,
    editable,
    lockedReason,
    students: students.map((s) => ({ ...s, status: byStudent[String(s._id)]?.status || null })),
  });
});

// ── Mark attendance (faculty / admin) ──────────────────────────────

export const markAttendance = asyncHandler(async (req, res) => {
  const { subjectId, date, period, records } = req.body;
  const user = req.user;

  const subject = await Subject.findById(subjectId);
  if (!subject || !subject.isActive) throw new ApiError(404, 'Subject not found');
  assertCanMark(user, subject);
  const section = normaliseSection(subject, req.body.section);
  const day = toDay(date);
  assertEditable(user, day);

  // One status per student; every id must be a student in this class.
  const statusById = new Map();
  records.forEach((r) => statusById.set(String(r.student), r.status));
  if (statusById.size !== records.length) throw new ApiError(422, 'A student appears more than once');
  const ids = [...statusById.keys()];
  const valid = await User.find({ ...rosterFilter(subject, section), _id: { $in: ids } }).distinct('_id');
  if (valid.length !== ids.length) {
    throw new ApiError(422, `Some students are not in ${subject.code}${section ? ` section ${section}` : ''}`);
  }

  const existing = await AttendanceRecord.find({ subject: subject._id, date: day, period, student: { $in: ids } })
    .select('student status')
    .lean();
  const prev = Object.fromEntries(existing.map((r) => [String(r.student), r.status]));

  const now = new Date();
  const ops = [];
  let created = 0;
  let changed = 0;
  ids.forEach((id) => {
    const status = statusById.get(id);
    if (!(id in prev)) {
      created += 1;
      ops.push({
        updateOne: {
          filter: { student: id, subject: subject._id, date: day, period },
          update: {
            $setOnInsert: { student: id, subject: subject._id, date: day, period, department: subject.department, ...(section ? { section } : {}) },
            $set: { status, markedBy: user._id, markedAt: now },
          },
          upsert: true, // the unique index still rejects a concurrent duplicate
        },
      });
    } else if (prev[id] !== status) {
      changed += 1;
      ops.push({
        updateOne: {
          filter: { student: id, subject: subject._id, date: day, period },
          update: {
            $set: { status, markedBy: user._id, markedAt: now },
            $push: { history: { from: prev[id], to: status, by: user._id, at: now, reason: 'Updated by staff' } },
          },
        },
      });
    }
  });
  if (ops.length) await AttendanceRecord.bulkWrite(ops, { ordered: false });

  logActivity(req, existing.length ? 'attendance.update' : 'attendance.mark', {
    entityType: 'subject',
    entityId: subject._id,
    summary: `${subject.code}${section ? ` ${section}` : ''} ${dayKey(day)} P${period}: ${created} new, ${changed} changed`,
  });

  const touched = ids.filter((id) => !(id in prev) || prev[id] !== statusById.get(id));
  emitToUsers(touched, 'attendance:updated', { subjectId: String(subject._id), date: dayKey(day), period });
  const absentees = touched.filter((id) => statusById.get(id) === 'absent').map((id) => new mongoose.Types.ObjectId(id));
  warnLowAttendance(absentees, subject).catch((err) => console.error('[attendance] low-attendance warning failed:', err.message));

  res.json({
    message: `Attendance saved for ${ids.length} students`,
    created,
    modified: changed,
    unchanged: ids.length - created - changed,
  });
});

// ── Summaries ──────────────────────────────────────────────────────

/** Subject-wise + overall summary for one student. */
async function studentSummary(studentId, query) {
  const match = { student: studentId };
  const window = resolveRange(query, 'all');
  const df = dayFilter(window);
  if (df) match.date = df;
  if (query.subject) match.subject = oid(query.subject, 'subject');
  if (query.semester) {
    const sem = Number(query.semester);
    if (!Number.isInteger(sem)) throw new ApiError(422, 'Invalid semester');
    const inSem = await Subject.find({ semester: sem }).distinct('_id');
    match.subject = match.subject ? { $in: inSem.filter((s) => sameId(s, match.subject)) } : { $in: inSem };
  }

  const subjects = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: '$subject', totalPeriods: { $sum: 1 }, presentPeriods: presentExpr, lastMarked: { $max: '$date' } } },
    { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, code: 1, semester: 1, type: 1, credits: 1 } }] } },
    { $unwind: '$subject' },
    {
      $project: {
        subject: 1,
        totalPeriods: 1,
        presentPeriods: 1,
        lastMarked: 1,
        absentPeriods: { $subtract: ['$totalPeriods', '$presentPeriods'] },
        percentage: pctExpr('$presentPeriods', '$totalPeriods'),
      },
    },
    { $sort: { 'subject.code': 1 } },
  ]);

  // Overall = Σ present ÷ Σ conducted — NOT the average of subject percentages.
  const presentPeriods = subjects.reduce((a, s) => a + s.presentPeriods, 0);
  const totalPeriods = subjects.reduce((a, s) => a + s.totalPeriods, 0);
  const pct = percentage(presentPeriods, totalPeriods);
  // Classes the student can still miss and stay at the threshold, or must attend to recover.
  const t = LOW_ATTENDANCE_THRESHOLD / 100;
  const canMiss = pct >= LOW_ATTENDANCE_THRESHOLD ? Math.floor(presentPeriods / t - totalPeriods) : 0;
  const mustAttend = pct < LOW_ATTENDANCE_THRESHOLD && totalPeriods ? Math.ceil((t * totalPeriods - presentPeriods) / (1 - t)) : 0;

  return {
    range: { from: window.from ? dayKey(window.from) : null, to: window.to ? dayKey(window.to) : null },
    threshold: LOW_ATTENDANCE_THRESHOLD,
    overall: { presentPeriods, totalPeriods, absentPeriods: totalPeriods - presentPeriods, percentage: pct, canMiss, mustAttend },
    subjects,
    belowThreshold: subjects.filter((s) => s.percentage < LOW_ATTENDANCE_THRESHOLD),
  };
}

export const getMyAttendance = asyncHandler(async (req, res) => {
  res.json(await studentSummary(req.user._id, req.query));
});

/** Staff view of one student's attendance (faculty: own department or own subjects). */
export const getStudentAttendance = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id).select('name rollNo avatar department section semester year role').lean();
  if (!student || !STUDENT_ROLES.includes(student.role)) throw new ApiError(404, 'Student not found');
  const query = { ...req.query };
  if (req.user.role === 'faculty' && student.department !== req.user.department) {
    const mine = await Subject.find({ faculty: req.user._id }).distinct('_id');
    if (!mine.length) throw new ApiError(403, 'This student is outside your department and subjects');
    // Restrict to the subjects this faculty teaches.
    const summary = await studentSummary(student._id, query);
    summary.subjects = summary.subjects.filter((s) => mine.some((m) => sameId(m, s._id)));
    if (!summary.subjects.length) throw new ApiError(403, 'This student is outside your department and subjects');
    const present = summary.subjects.reduce((a, s) => a + s.presentPeriods, 0);
    const total = summary.subjects.reduce((a, s) => a + s.totalPeriods, 0);
    summary.overall = { presentPeriods: present, totalPeriods: total, absentPeriods: total - present, percentage: percentage(present, total) };
    summary.belowThreshold = summary.subjects.filter((s) => s.percentage < LOW_ATTENDANCE_THRESHOLD);
    return res.json({ student, ...summary });
  }
  res.json({ student, ...(await studentSummary(student._id, query)) });
});

// ── Day-by-day records ─────────────────────────────────────────────

export const getAttendanceRecords = asyncHandler(async (req, res) => {
  const filter = {};
  if (STUDENT_ROLES.includes(req.user.role)) {
    filter.student = req.user._id; // students only ever see their own
  } else {
    Object.assign(filter, await staffScope(req.user));
    if (req.query.student) filter.student = oid(req.query.student, 'student');
  }
  if (req.query.subject) filter.subject = oid(req.query.subject, 'subject');
  if (req.query.section) filter.section = String(req.query.section).toUpperCase();
  if (req.query.department && !STUDENT_ROLES.includes(req.user.role)) filter.department = String(req.query.department);
  if (req.query.status === 'present' || req.query.status === 'absent') filter.status = req.query.status;
  if (req.query.date) filter.date = toDay(req.query.date);
  else {
    const df = dayFilter(resolveRange(req.query, 'all'));
    if (df) filter.date = df;
  }

  const { page, limit, skip } = paginate(req, 50, 200);
  const [records, total] = await Promise.all([
    AttendanceRecord.find(filter)
      .populate('student', 'name rollNo avatar section department')
      .populate('subject', 'name code')
      .populate('markedBy', 'name')
      .sort({ date: -1, period: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AttendanceRecord.countDocuments(filter),
  ]);

  res.json({ records, pagination: pageMeta(total, page, limit) });
});

/** Class sessions a staff member has marked (history view). */
export const listSessions = asyncHandler(async (req, res) => {
  const match = await staffScope(req.user);
  if (req.user.role === 'faculty' && req.query.mine !== 'false') {
    delete match.$or;
    match.markedBy = req.user._id;
  }
  if (req.query.subject) match.subject = oid(req.query.subject, 'subject');
  const df = dayFilter(resolveRange(req.query, 'month'));
  if (df) match.date = df;

  const sessions = await AttendanceRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: { subject: '$subject', date: '$date', period: '$period', section: '$section' },
        total: { $sum: 1 },
        present: presentExpr,
        markedAt: { $max: '$markedAt' },
        edits: { $sum: { $size: { $ifNull: ['$history', []] } } },
      },
    },
    { $sort: { '_id.date': -1, '_id.period': -1 } },
    { $limit: 200 },
    { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, code: 1 } }] } },
    { $unwind: '$subject' },
    {
      $project: {
        _id: 0,
        subject: 1,
        date: '$_id.date',
        period: '$_id.period',
        section: '$_id.section',
        total: 1,
        present: 1,
        absent: { $subtract: ['$total', '$present'] },
        percentage: pctExpr('$present', '$total'),
        markedAt: 1,
        edits: 1,
      },
    },
  ]);
  res.json(sessions);
});

// ── Subject attendance stats (staff) ───────────────────────────────

export const getSubjectAttendance = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.subjectId);
  if (!subject) throw new ApiError(404, 'Subject not found');
  if (req.user.role === 'faculty' && !isAssigned(subject, req.user) && subject.department !== req.user.department) {
    throw new ApiError(403, 'Not authorized for this subject');
  }

  const match = { subject: subject._id };
  if (req.query.section) match.section = String(req.query.section).toUpperCase();
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) match.date = df;

  const [studentStats, conducted] = await Promise.all([
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: '$student', totalPeriods: { $sum: 1 }, presentPeriods: presentExpr } },
      { $addFields: { percentage: pctExpr('$presentPeriods', '$totalPeriods') } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'studentInfo',
          pipeline: [{ $project: { name: 1, rollNo: 1, avatar: 1, section: 1 } }],
        },
      },
      { $unwind: '$studentInfo' },
      { $sort: { 'studentInfo.rollNo': 1 } },
    ]),
    AttendanceRecord.aggregate([{ $match: match }, { $group: { _id: { date: '$date', period: '$period', section: '$section' } } }, { $count: 'n' }]),
  ]);

  const totalPresent = studentStats.reduce((a, s) => a + s.presentPeriods, 0);
  const totalPeriods = studentStats.reduce((a, s) => a + s.totalPeriods, 0);

  res.json({
    subject: { _id: subject._id, name: subject.name, code: subject.code, department: subject.department, sections: subject.sections },
    overall: {
      totalStudents: studentStats.length,
      classesConducted: conducted[0]?.n || 0,
      averagePercentage: percentage(totalPresent, totalPeriods),
    },
    students: studentStats,
    belowThreshold: studentStats.filter((s) => s.percentage < LOW_ATTENDANCE_THRESHOLD),
  });
});

// ── Section / department attendance (staff) ────────────────────────

export const getSectionAttendance = asyncHandler(async (req, res) => {
  const match = await staffScope(req.user);
  if (req.query.section) match.section = String(req.query.section).toUpperCase();
  if (req.query.department) match.department = String(req.query.department);
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) match.date = df;

  const stats = await AttendanceRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$subject',
        students: { $addToSet: '$student' },
        totalPresent: presentExpr,
        totalConducted: { $sum: 1 },
      },
    },
    { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, code: 1, department: 1 } }] } },
    { $unwind: '$subject' },
    {
      $project: {
        subject: 1,
        totalStudents: { $size: '$students' },
        totalPresent: 1,
        totalConducted: 1,
        percentage: pctExpr('$totalPresent', '$totalConducted'),
      },
    },
    { $sort: { 'subject.code': 1 } },
  ]);

  const grandPresent = stats.reduce((a, s) => a + s.totalPresent, 0);
  const grandTotal = stats.reduce((a, s) => a + s.totalConducted, 0);
  res.json({
    overall: { presentPeriods: grandPresent, totalPeriods: grandTotal, percentage: percentage(grandPresent, grandTotal) },
    subjects: stats,
  });
});

/** Students below the attendance threshold (overall across subjects in scope). */
export const getLowAttendance = asyncHandler(async (req, res) => {
  const match = await staffScope(req.user);
  if (req.query.section) match.section = String(req.query.section).toUpperCase();
  if (req.query.department) match.department = String(req.query.department);
  if (req.query.subject) match.subject = oid(req.query.subject, 'subject');
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) match.date = df;
  const threshold = Math.min(100, Math.max(1, Number(req.query.threshold) || LOW_ATTENDANCE_THRESHOLD));

  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: '$student', total: { $sum: 1 }, present: presentExpr } },
    { $addFields: { percentage: pctExpr('$present', '$total') } },
    { $match: { percentage: { $lt: threshold } } },
    { $sort: { percentage: 1 } },
    { $limit: 200 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'student',
        pipeline: [{ $project: { name: 1, rollNo: 1, avatar: 1, section: 1, department: 1, year: 1 } }],
      },
    },
    { $unwind: '$student' },
  ]);
  res.json({ threshold, students: rows });
});

// ── Trends (daily / weekly / monthly) ──────────────────────────────

export const getAttendanceTrends = asyncHandler(async (req, res) => {
  const match = {};
  if (STUDENT_ROLES.includes(req.user.role)) {
    match.student = req.user._id;
  } else {
    Object.assign(match, await staffScope(req.user));
    if (req.query.student) match.student = oid(req.query.student, 'student');
    if (req.query.section) match.section = String(req.query.section).toUpperCase();
    if (req.query.department) match.department = String(req.query.department);
  }
  if (req.query.subject) match.subject = oid(req.query.subject, 'subject');
  const df = dayFilter(resolveRange(req.query, 'month'));
  if (df) match.date = df;

  const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';
  // Class days are stored as UTC-midnight markers, so grouping in UTC is exact.
  const key =
    groupBy === 'day'
      ? { $dateToString: { format: '%Y-%m-%d', date: '$date' } }
      : groupBy === 'week'
        ? { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$date', unit: 'week', startOfWeek: 'monday' } } } }
        : { $dateToString: { format: '%Y-%m', date: '$date' } };

  const trends = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: { _id: key, total: { $sum: 1 }, present: presentExpr } },
    { $addFields: { absent: { $subtract: ['$total', '$present'] }, percentage: pctExpr('$present', '$total') } },
    { $sort: { _id: 1 } },
  ]);
  res.json(trends);
});

// ── Attendance corrections ─────────────────────────────────────────

export const requestCorrection = asyncHandler(async (req, res) => {
  const { subjectId, date, period, requestedStatus, reason } = req.body;
  const day = toDay(date);
  const record = await AttendanceRecord.findOne({ student: req.user._id, subject: subjectId, date: day, period });
  if (!record) throw new ApiError(404, 'No attendance record found for this date and period');
  if (record.status === requestedStatus) throw new ApiError(422, `This period is already marked "${record.status}"`);

  const existing = await AttendanceCorrectionRequest.exists({
    student: req.user._id,
    subject: subjectId,
    date: day,
    period,
    status: 'pending',
  });
  if (existing) throw new ApiError(409, 'A correction request for this period is already pending');

  const request = await AttendanceCorrectionRequest.create({
    student: req.user._id,
    subject: subjectId,
    date: day,
    period,
    currentStatus: record.status, // taken from the record, not from the client
    requestedStatus,
    reason,
  });

  logActivity(req, 'attendance.correction_request', { entityType: 'attendance', entityId: request._id });

  const subject = await Subject.findById(subjectId).select('faculty code');
  if (subject?.faculty?.length) {
    notifyUsers(subject.faculty, {
      type: 'attendance',
      title: 'Attendance correction request',
      message: `${req.user.name} requested a correction for ${subject.code} (${dayKey(day)}, P${period})`,
      link: '/attendance?tab=corrections',
    });
  }

  res.status(201).json(request);
});

export const listCorrections = asyncHandler(async (req, res) => {
  const filter = {};
  if (STUDENT_ROLES.includes(req.user.role)) {
    filter.student = req.user._id;
  } else {
    if (req.query.student) filter.student = oid(req.query.student, 'student');
    if (req.user.role === 'faculty') {
      filter.subject = { $in: await Subject.find({ faculty: req.user._id }).distinct('_id') };
    }
  }
  if (req.query.subject && !filter.subject) filter.subject = oid(req.query.subject, 'subject');
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) filter.status = req.query.status;

  const { page, limit, skip } = paginate(req, 20);
  const [requests, total] = await Promise.all([
    AttendanceCorrectionRequest.find(filter)
      .populate('student', 'name email rollNo avatar section')
      .populate('subject', 'name code')
      .populate('reviewedBy', 'name')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AttendanceCorrectionRequest.countDocuments(filter),
  ]);

  res.json({ requests, pagination: pageMeta(total, page, limit) });
});

export const reviewCorrection = asyncHandler(async (req, res) => {
  const request = await AttendanceCorrectionRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Correction request not found');
  if (request.status !== 'pending') throw new ApiError(422, 'This request has already been reviewed');

  if (req.user.role === 'faculty') {
    const subject = await Subject.findById(request.subject).select('faculty');
    if (!subject || !isAssigned(subject, req.user)) throw new ApiError(403, 'You are not assigned to this subject');
  }

  const { action, note } = req.body; // 'approved' | 'rejected'
  // Claim the request atomically so two reviewers cannot both act on it.
  const claimed = await AttendanceCorrectionRequest.findOneAndUpdate(
    { _id: request._id, status: 'pending' },
    { $set: { status: action, reviewedBy: req.user._id, reviewNote: note, reviewedAt: new Date() } },
    { new: true }
  );
  if (!claimed) throw new ApiError(409, 'This request was just reviewed by someone else');

  if (action === 'approved') {
    const now = new Date();
    await AttendanceRecord.updateOne(
      { student: request.student, subject: request.subject, date: request.date, period: request.period },
      {
        $set: {
          correctedFrom: request.currentStatus,
          status: request.requestedStatus,
          correctedBy: req.user._id,
          correctedAt: now,
          correctionReason: request.reason,
        },
        $push: { history: { from: request.currentStatus, to: request.requestedStatus, by: req.user._id, at: now, reason: `Correction approved: ${request.reason}`.slice(0, 300) } },
      }
    );
    emitToUsers([request.student], 'attendance:updated', { subjectId: String(request.subject), date: dayKey(request.date), period: request.period });
  }

  logActivity(req, `attendance.correction_${action}`, { entityType: 'attendance', entityId: request._id });
  notifyUsers([request.student], {
    type: 'attendance',
    title: `Attendance correction ${action}`,
    message: note ? `Reviewer note: ${note}` : `Your correction request for ${dayKey(request.date)} (P${request.period}) was ${action}.`,
    link: '/attendance?tab=corrections',
  });

  res.json(claimed);
});
