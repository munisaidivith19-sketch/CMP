import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
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
import { addDays, campusParts, dayFilter, dayKey, resolveRange, toDay, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';

export const LOW_ATTENDANCE_THRESHOLD = 75;
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
  // Admin and Principal see every department; Principal is otherwise read-only.
  if (['admin', 'principal'].includes(user.role)) return {};
  const subjects = await Subject.find({ faculty: user._id }).distinct('_id');
  const or = [{ subject: { $in: subjects } }];
  // HOD has no personal subjects, so this becomes a plain department filter for them.
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

/** Who may view a class roster at all (reading, not writing). */
function assertCanMark(user, subject) {
  if (user.role === 'principal') throw new ApiError(403, 'Principal access is read-only');
  if (user.role === 'faculty' && !isAssigned(subject, user)) {
    throw new ApiError(403, 'You are not assigned to this subject');
  }
  // HOD marks for their whole department, not just subjects they personally teach.
  if (user.role === 'hod' && subject.department !== user.department) {
    throw new ApiError(403, 'You can only mark attendance for your own department');
  }
}

// ── Time rules (server clock, campus timezone) ─────────────────────

/** Today's campus date and time — never taken from the client. */
function campusNow() {
  const now = clock.now();
  const parts = campusParts(now);
  return { day: toDay(now), weekday: parts.weekday, time: parts.time };
}

/** UPCOMING before start, ACTIVE from start until (not including) end, COMPLETED after. */
export function periodStatus({ startTime, endTime }, time) {
  if (time < startTime) return 'UPCOMING';
  if (time < endTime) return 'ACTIVE';
  return 'COMPLETED';
}

/**
 * Write rules for a class's attendance on `day`:
 * - Faculty: only their own timetable period, today, while it is ACTIVE.
 *   The window comes from the session snapshot once one exists, so a timetable
 *   edit mid-period does not move an in-progress session's window.
 * - HOD: their department, today only (any time of day).
 * - Admin: any past or current date.
 */
function assertCanWrite(user, { subject, day, slot, session, viaSlot }) {
  const now = campusNow();
  if (day > now.day) throw new ApiError(422, 'Attendance cannot be marked for a future date');
  if (user.role === 'principal') throw new ApiError(403, 'Principal access is read-only');
  if (user.role === 'admin') return;
  if (user.role === 'hod') {
    if (subject.department !== user.department) throw new ApiError(403, 'You can only edit attendance for your own department');
    if (day.getTime() !== now.day.getTime()) throw new ApiError(403, 'HOD can only edit attendance for today’s date');
    return;
  }
  if (user.role === 'faculty') {
    // Faculty pick the timetable period; they never type subject/date/period themselves.
    if (!slot || !viaSlot) throw new ApiError(403, 'Take attendance from your timetable period');
    if (!sameId(slot.faculty, user)) throw new ApiError(403, 'This period is assigned to another faculty member');
    if (day.getTime() !== now.day.getTime() || slot.dayOfWeek !== now.weekday) {
      throw new ApiError(403, 'Attendance can only be taken on the day of the class');
    }
    const window = session || slot;
    const status = periodStatus(window, now.time);
    if (status === 'UPCOMING') throw new ApiError(403, `Attendance opens at ${window.startTime}`);
    if (status === 'COMPLETED') throw new ApiError(403, 'This period has ended — attendance is closed');
    return;
  }
  throw new ApiError(403, 'You cannot mark attendance');
}

/**
 * The class being marked. With `slotId` the timetable entry is the source of
 * truth: subject, section, period and (for faculty) the date all come from the
 * slot / server, and anything the client sent for them is ignored. Without it
 * (HOD / admin editing by subject), the matching timetable entry is looked up.
 */
async function resolveClass(user, src) {
  if (src.slotId) {
    const slot = await TimetableSlot.findOne({ _id: oid(src.slotId, 'timetable period'), isActive: true, isBreak: { $ne: true } });
    if (!slot) throw new ApiError(404, 'Timetable period not found');
    const day = user.role === 'faculty' || !src.date ? campusNow().day : toDay(src.date);
    const session = await AttendanceSession.findOne({ timetableSlot: slot._id, date: day }).lean();
    if (!session && weekdayOf(day) !== slot.dayOfWeek) throw new ApiError(422, `This period is not held on ${weekdayOf(day)}`);
    // An existing session's snapshot wins over the (possibly edited) slot.
    const subject = await Subject.findById(session?.subject || slot.subject);
    if (!subject) throw new ApiError(404, 'Subject not found');
    return { slot, session, subject, day, section: session?.section || slot.section, period: session?.period || slot.period, viaSlot: true };
  }
  const subject = await Subject.findById(oid(src.subjectId, 'subject'));
  if (!subject || !subject.isActive) throw new ApiError(404, 'Subject not found');
  const section = normaliseSection(subject, src.section);
  const day = toDay(src.date);
  const period = Number(src.period);
  if (!Number.isInteger(period) || period < 1 || period > 12) throw new ApiError(422, 'Invalid period');
  const slot = await TimetableSlot.findOne({ subject: subject._id, dayOfWeek: weekdayOf(day), period, isActive: true, ...(section ? { section } : {}) });
  const session = slot ? await AttendanceSession.findOne({ timetableSlot: slot._id, date: day }).lean() : null;
  return { slot, session, subject, day, section, period };
}

/** Freeze the timetable entry as it is now, for this class meeting. */
async function ensureSession({ slot, session, subject, day }, user) {
  if (session || !slot) return session;
  const faculty = slot.faculty ? await User.findById(slot.faculty).select('name').lean() : null;
  try {
    return (
      await AttendanceSession.create({
        timetableSlot: slot._id,
        date: day,
        period: slot.period,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subject: subject._id,
        subjectName: subject.name,
        subjectCode: subject.code,
        faculty: slot.faculty,
        facultyName: faculty?.name,
        department: slot.department,
        section: slot.section,
        semester: slot.semester,
        year: slot.year,
        room: slot.room,
        createdBy: user._id,
      })
    ).toObject();
  } catch (err) {
    if (err.code === 11000) return AttendanceSession.findOne({ timetableSlot: slot._id, date: day }).lean();
    throw err;
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
  const cls = await resolveClass(req.user, req.query);
  const { subject, section, day, period: p, slot, session } = cls;
  if (!(req.user.role === 'faculty' && slot && sameId(slot.faculty, req.user))) assertCanMark(req.user, subject);

  const [students, existing, slotInfo] = await Promise.all([
    User.find(rosterFilter(subject, section)).select('name rollNo avatar section department year').sort({ rollNo: 1, name: 1 }).lean(),
    AttendanceRecord.find({ subject: subject._id, date: day, period: p, ...(section ? { section } : {}) }).populate('markedBy', 'name').lean(),
    slot ? TimetableSlot.findById(slot._id).populate('faculty', 'name').lean() : null,
  ]);
  const byStudent = Object.fromEntries(existing.map((r) => [String(r.student), r]));
  const last = existing.sort((a, b) => new Date(b.markedAt) - new Date(a.markedAt))[0];

  let editable = true;
  let lockedReason = null;
  try {
    assertCanWrite(req.user, cls);
  } catch (e) {
    editable = false;
    lockedReason = e.message;
  }
  // What the class looked like when attendance was taken (or looks like now, if not yet taken).
  const slotView = session
    ? { ...slotInfo, period: session.period, startTime: session.startTime, endTime: session.endTime, room: session.room, faculty: { _id: session.faculty, name: session.facultyName }, snapshot: true }
    : slotInfo;

  res.json({
    subject: { _id: subject._id, name: subject.name, code: subject.code, department: subject.department, semester: subject.semester, sections: subject.sections },
    section: section || null,
    date: dayKey(day),
    period: p,
    slot: slotView,
    sessionId: session?._id || null,
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
  const { records } = req.body;
  const user = req.user;

  const cls = await resolveClass(user, req.body);
  const { subject, section, day, period } = cls;
  assertCanWrite(user, cls);
  const session = await ensureSession(cls, user);
  const sessionCreated = Boolean(session && !cls.session);

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
            $setOnInsert: { student: id, subject: subject._id, date: day, period, department: subject.department, ...(section ? { section } : {}), ...(session ? { session: session._id } : {}) },
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
            $push: { history: { from: prev[id], to: status, by: user._id, at: now, reason: `Edited by ${user.role}` } },
          },
        },
      });
    }
  });
  if (ops.length) await AttendanceRecord.bulkWrite(ops, { ordered: false });

  if (sessionCreated) {
    logActivity(req, 'attendance.session_created', {
      entityType: 'attendance_session',
      entityId: session._id,
      summary: `${subject.code} ${session.department}-${session.section} ${dayKey(day)} P${session.period} ${session.startTime}–${session.endTime}`,
    });
  }
  // Every edit of existing marks is audited with actor role, date and before → after.
  const edits = ids.filter((id) => id in prev && prev[id] !== statusById.get(id));
  logActivity(req, existing.length ? 'attendance.edited' : 'attendance.mark', {
    entityType: session ? 'attendance_session' : 'subject',
    entityId: session?._id || subject._id,
    summary: `[${user.role}] ${subject.code}${section ? ` ${section}` : ''} ${dayKey(day)} P${period}: ${created} new, ${changed} changed${
      edits.length ? ` (${edits.slice(0, 4).map((id) => `${id.slice(-4)} ${prev[id]}→${statusById.get(id)}`).join(', ')}${edits.length > 4 ? '…' : ''})` : ''
    }`,
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
    sessionId: session?._id || null,
  });
});

// ── Faculty: today's periods with their live status ────────────────

/**
 * Today's timetable periods for the signed-in faculty member, each with
 * UPCOMING / ACTIVE / COMPLETED computed on the server clock, and whether
 * attendance was already taken. Only ACTIVE periods can be marked.
 */
export const getMyPeriods = asyncHandler(async (req, res) => {
  const now = campusNow();
  const slots = await TimetableSlot.find({ faculty: req.user._id, dayOfWeek: now.weekday, isActive: true, isBreak: { $ne: true } })
    .populate('subject', 'name code')
    .sort({ startTime: 1 })
    .lean();
  const sessions = await AttendanceSession.find({ timetableSlot: { $in: slots.map((s) => s._id) }, date: now.day }).lean();
  const bySlot = Object.fromEntries(sessions.map((s) => [String(s.timetableSlot), s]));
  const marked = new Set(
    (await AttendanceRecord.find({ session: { $in: sessions.map((s) => s._id) } }).distinct('session')).map(String)
  );

  res.json({
    date: dayKey(now.day),
    weekday: now.weekday,
    time: now.time,
    periods: slots.map((slot) => {
      const session = bySlot[String(slot._id)];
      const window = session || slot;
      return {
        slotId: slot._id,
        period: window.period,
        startTime: window.startTime,
        endTime: window.endTime,
        subject: session ? { _id: session.subject, name: session.subjectName, code: session.subjectCode } : slot.subject,
        department: slot.department,
        section: slot.section,
        semester: slot.semester,
        year: slot.year,
        room: window.room,
        status: periodStatus(window, now.time),
        marked: Boolean(session && marked.has(String(session._id))),
      };
    }),
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
  const outsideDept = student.department !== req.user.department;
  // HOD (and Principal, who never reaches here — see assertCanMark) is department-only: no subject fallback.
  if (req.user.role === 'hod' && outsideDept) {
    throw new ApiError(403, 'This student is outside your department');
  }
  if (req.user.role === 'faculty' && outsideDept) {
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
        department: { $first: '$department' },
        session: { $max: '$session' },
      },
    },
    { $sort: { '_id.date': -1, '_id.period': -1 } },
    { $limit: 200 },
    { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, code: 1 } }] } },
    { $unwind: '$subject' },
    {
      $lookup: {
        from: 'attendancesessions',
        localField: 'session',
        foreignField: '_id',
        as: 'snap',
        pipeline: [{ $project: { startTime: 1, endTime: 1, timetableSlot: 1, subjectName: 1, subjectCode: 1, facultyName: 1 } }],
      },
    },
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
        department: 1,
        snapshot: { $first: '$snap' },
      },
    },
  ]);
  // The same rule the server enforces on save: admin any date, HOD today in
  // their department, faculty only through their live timetable period.
  const todayDay = campusNow().day.getTime();
  const editable = (s) =>
    req.user.role === 'admin' || (req.user.role === 'hod' && s.department === req.user.department && new Date(s.date).getTime() === todayDay);
  res.json(sessions.map((s) => ({ ...s, editable: editable(s) })));
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
    } else if (req.user.role === 'hod' && req.user.department) {
      filter.subject = { $in: await Subject.find({ department: req.user.department }).distinct('_id') };
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
  } else if (req.user.role === 'hod') {
    const subject = await Subject.findById(request.subject).select('department');
    if (!subject || subject.department !== req.user.department) {
      throw new ApiError(403, 'You can only review corrections for your own department');
    }
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
