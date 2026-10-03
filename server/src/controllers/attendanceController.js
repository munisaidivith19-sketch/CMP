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
import {
  assertAssigned,
  assignmentsBySubject,
  classInChargeFilter,
  classInChargeRecordFilter,
  facultyAssignments,
  facultyClassInChargeScope,
  facultyClasses,
  inClasses,
  ownDepartment,
} from '../utils/academicScope.js';
import { buildReport, byRollNo, reportFilename, reportPeriods } from '../services/attendanceReport.js';
import { renderReportPdf } from '../services/attendanceReportPdf.js';
import { safeFilename } from '../utils/pdf.js';
import { ACADEMIC_READ_ONLY_ROLES, COLLEGE_WIDE_ROLES, yearOfSemester } from '../constants.js';

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
 * The attendance records a staff account may read, derived from the
 * authenticated account alone.
 *
 * - Admin, Principal, Chairman, Dean, AO (COLLEGE_WIDE_ROLES): every
 *   department. All but admin are read-only.
 * - Faculty: ONLY their actual teaching assignments — subject + department +
 *   section. Their own department is deliberately NOT a grant: a faculty
 *   member assigned 3rd-year Section A must never see Section B, another year
 *   or another faculty member's class. Where the timetable schedules them for
 *   a subject, those exact sections are the scope; a subject they are listed
 *   on but have no timetable row for falls back to that subject's own declared
 *   sections, which is still an explicit assignment, never a department.
 * - HOD: their own department, from the account.
 *
 * A faculty member's READ scope is the union of their two legitimate scopes:
 * Handling Class (above) and Our Class — the complete attendance of the one
 * class they are Class In-Charge of (classInChargeRecordFilter, exact by
 * year and semester). This is reading only: marking and editing are decided
 * by assertCanMark / assertCanWrite, which look at the subject-handling
 * assignment and are untouched by Class In-Charge.
 */
async function staffScope(user) {
  if (COLLEGE_WIDE_ROLES.includes(user.role)) return {};
  if (user.role === 'hod') return { department: ownDepartment(user) };

  if (user.role === 'faculty') {
    const [assignments, listed, ourClass] = await Promise.all([
      facultyAssignments(user),
      Subject.find({ faculty: user._id, isActive: true }).select('department sections').lean(),
      facultyClassInChargeScope(user),
    ]);
    const scheduled = new Set(assignments.map((a) => String(a.subject)));
    const clauses = assignments.map((a) => ({ subject: a.subject, department: a.department, section: a.section }));
    for (const subject of listed) {
      if (scheduled.has(String(subject._id))) continue; // the timetable is more precise
      const sections = (subject.sections || []).map((x) => String(x).toUpperCase()).filter(Boolean);
      clauses.push(
        sections.length
          ? { subject: subject._id, department: subject.department, section: { $in: sections } }
          : { subject: subject._id, department: subject.department }
      );
    }
    if (ourClass.length) {
      const classRecords = await classInChargeRecordFilter(ourClass);
      if (classRecords.$or) clauses.push(...classRecords.$or);
    }
    return clauses.length ? { $or: clauses } : { _id: null };
  }

  // Any other role (Security, Warden) has no academic scope at all. The
  // routes already refuse them; this keeps the filter safe if that changes.
  return { _id: null };
}

/**
 * Combine a role's authorization scope with the narrowing filters a client
 * sent. They are `$and`-ed, never merged, so a request can only ever
 * intersect the authorized scope — a sent department or section can never
 * overwrite the scope's own constraint on the same field.
 */
function scopedMatch(scope, narrow = {}) {
  const keys = Object.keys(narrow).filter((k) => narrow[k] !== undefined);
  if (!keys.length) return scope;
  const clean = Object.fromEntries(keys.map((k) => [k, narrow[k]]));
  if (!Object.keys(scope).length) return clean;
  return { $and: [scope, clean] };
}

/** The narrowing filters every staff attendance read accepts, normalised. */
function narrowFromQuery(query = {}) {
  return {
    section: query.section ? String(query.section).toUpperCase() : undefined,
    department: query.department ? String(query.department) : undefined,
    subject: query.subject ? oid(query.subject, 'subject') : undefined,
  };
}

/**
 * Students who belong to a subject's class: department + year + section +
 * semester. Year is exact, so 2nd-year and 3rd-year students of the same
 * section letter never share a roster. A student with no semester on file
 * (legacy, flagged by the academic migration) still matches on year.
 */
function rosterFilter(subject, section) {
  const filter = { role: { $in: STUDENT_ROLES }, isActive: true, department: subject.department };
  if (section) filter.section = section;
  if (subject.semester) {
    filter.year = subject.year ?? yearOfSemester(subject.semester);
    filter.semester = { $in: [subject.semester, null] };
  }
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
  if (ACADEMIC_READ_ONLY_ROLES.includes(user.role)) throw new ApiError(403, 'Your access to attendance is read-only');
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
  if (ACADEMIC_READ_ONLY_ROLES.includes(user.role)) throw new ApiError(403, 'Your access to attendance is read-only');
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
        year: slot.year ?? yearOfSemester(slot.semester),
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

/**
 * Staff view of one student's attendance. An HOD is confined to their own
 * department; a faculty member to the students of the classes they actually
 * teach, and then to their own subjects within that student's record — their
 * department alone authorizes nothing.
 */
export const getStudentAttendance = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id).select('name rollNo avatar department section semester year role').lean();
  if (!student || !STUDENT_ROLES.includes(student.role)) throw new ApiError(404, 'Student not found');
  const query = { ...req.query };

  if (req.user.role === 'hod' && student.department !== ownDepartment(req.user)) {
    throw new ApiError(403, 'This student is outside your department');
  }

  if (req.user.role === 'faculty') {
    // Our Class: the Class In-Charge sees the complete record of their own
    // class's students, across every subject.
    if (inClasses(await facultyClassInChargeScope(req.user), student)) {
      return res.json({ student, ...(await studentSummary(student._id, query)) });
    }
    // The same class scope People and Chat use, so the three modules never
    // disagree about which students a faculty account may see.
    if (!inClasses(await facultyClasses(req.user), student)) {
      throw new ApiError(403, 'This student is not in one of your classes');
    }
    const mine = await Subject.find({ faculty: req.user._id }).distinct('_id');
    const summary = await studentSummary(student._id, query);
    summary.subjects = summary.subjects.filter((s) => mine.some((m) => sameId(m, s._id)));
    const present = summary.subjects.reduce((a, s) => a + s.presentPeriods, 0);
    const total = summary.subjects.reduce((a, s) => a + s.totalPeriods, 0);
    summary.overall = { presentPeriods: present, totalPeriods: total, absentPeriods: total - present, percentage: percentage(present, total) };
    summary.belowThreshold = summary.subjects.filter((s) => s.percentage < LOW_ATTENDANCE_THRESHOLD);
    return res.json({ student, ...summary });
  }

  res.json({ student, ...(await studentSummary(student._id, query)) });
});

// ── Our Class (faculty Class In-Charge) ────────────────────────────

/** A session counts once it has finished on the server clock (earlier days always have). */
function isFinished(session, now) {
  const day = new Date(session.date).getTime();
  return day < now.day.getTime() || (day === now.day.getTime() && now.time >= session.endTime);
}

/**
 * "Our Class": the complete attendance of the class the signed-in faculty
 * member is Class In-Charge of, for today / a week / a month / a semester / a
 * custom range. No subject is chosen — the class comes from the account
 * (facultyClassInChargeScope), and nothing the client sends can change it.
 *
 * AttendanceSession is the class-level bridge: the class's sessions are found
 * by department + year + section + semester, and the records by those session
 * ids, so a same-letter section of another year can never leak in. Only
 * periods that have finished on the server clock are counted; a running
 * period's partly-marked attendance is not.
 */
export const getOurClassAttendance = asyncHandler(async (req, res) => {
  const [ourClass] = await facultyClassInChargeScope(req.user);
  if (!ourClass) return res.json({ class: null });

  const now = campusNow();
  const window = resolveRange(req.query, 'day');
  const df = dayFilter(window);
  const sessions = await AttendanceSession.find({ ...classInChargeFilter([ourClass]), ...(df ? { date: df } : {}) })
    .sort({ date: 1, period: 1 })
    .lean();
  const finished = sessions.filter((sess) => isFinished(sess, now));

  const [records, roster] = await Promise.all([
    finished.length ? AttendanceRecord.find({ session: { $in: finished.map((sess) => sess._id) } }).select('student status session').lean() : [],
    User.find({
      role: { $in: STUDENT_ROLES },
      isActive: true,
      department: ourClass.department,
      section: ourClass.section,
      year: ourClass.year,
      semester: { $in: [ourClass.semester, null] },
    })
      .select('name rollNo avatar department year section semester')
      .lean(),
  ]);
  roster.sort(byRollNo);

  const perStudent = new Map();
  const perSession = new Map();
  for (const r of records) {
    const st = perStudent.get(String(r.student)) || { presentPeriods: 0, totalPeriods: 0 };
    st.totalPeriods += 1;
    if (r.status === 'present') st.presentPeriods += 1;
    perStudent.set(String(r.student), st);

    const ss = perSession.get(String(r.session)) || { present: 0, total: 0 };
    ss.total += 1;
    if (r.status === 'present') ss.present += 1;
    perSession.set(String(r.session), ss);
  }

  const students = roster.map((st) => {
    const r = perStudent.get(String(st._id)) || { presentPeriods: 0, totalPeriods: 0 };
    return {
      _id: st._id,
      name: st.name,
      rollNo: st.rollNo || null,
      avatar: st.avatar,
      department: st.department,
      program: st.department,
      year: st.year,
      section: st.section,
      semester: st.semester ?? ourClass.semester,
      totalPeriods: r.totalPeriods,
      presentPeriods: r.presentPeriods,
      absentPeriods: r.totalPeriods - r.presentPeriods,
      percentage: percentage(r.presentPeriods, r.totalPeriods),
    };
  });
  const present = students.reduce((a, st) => a + st.presentPeriods, 0);
  const total = students.reduce((a, st) => a + st.totalPeriods, 0);

  res.json({
    class: { ...ourClass, classInCharge: req.user.name },
    range: { range: window.range || 'all', from: window.from ? dayKey(window.from) : null, to: window.to ? dayKey(window.to) : null },
    overall: {
      totalStudents: students.length,
      classesConducted: finished.length,
      presentPeriods: present,
      absentPeriods: total - present,
      totalPeriods: total,
      percentage: percentage(present, total),
    },
    // Period-level detail: what was held, by whom, and how many attended.
    sessions: finished.map((sess) => {
      const c = perSession.get(String(sess._id)) || { present: 0, total: 0 };
      return {
        _id: sess._id,
        date: dayKey(sess.date),
        period: sess.period,
        startTime: sess.startTime,
        endTime: sess.endTime,
        subject: sess.subjectName,
        subjectCode: sess.subjectCode,
        facultyName: sess.facultyName,
        present: c.present,
        absent: c.total - c.present,
        total: c.total,
      };
    }),
    students,
    belowThreshold: students.filter((st) => st.totalPeriods > 0 && st.percentage < LOW_ATTENDANCE_THRESHOLD),
  });
});

// ── My Classes (faculty) ───────────────────────────────────────────

/**
 * The Subject and Section dropdowns of "My Classes", built from the
 * authenticated faculty member's real teaching assignments. Section lists are
 * per subject, so a subject taught to A and C never offers B. Nothing here is
 * derived from anything the client sent.
 */
export const getMyClassOptions = asyncHandler(async (req, res) => {
  const assignments = await facultyAssignments(req.user);
  res.json({ subjects: assignmentsBySubject(assignments) });
});

/**
 * Attendance for one exact class the authenticated faculty member handles:
 * subject + section, validated against their teaching assignments before any
 * attendance is read. A subjectId or section they are not assigned to is a
 * 403, never a different class's data.
 */
export const getMyClassAttendance = asyncHandler(async (req, res) => {
  const assignments = await facultyAssignments(req.user);
  const subjectId = oid(req.query.subjectId, 'subject');
  const section = req.query.section ? String(req.query.section).toUpperCase() : undefined;
  const matches = assertAssigned(assignments, { subject: subjectId, section });
  const cls = matches[0];

  const subject = await Subject.findById(subjectId).lean();
  if (!subject) throw new ApiError(404, 'Subject not found');

  const sections = section ? [section] : [...new Set(matches.map((m) => m.section))];
  const match = { subject: subject._id, section: { $in: sections } };
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) match.date = df;

  const [stats, conducted, roster] = await Promise.all([
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: '$student', totalPeriods: { $sum: 1 }, presentPeriods: presentExpr } },
    ]),
    AttendanceRecord.aggregate([
      { $match: match },
      { $group: { _id: { date: '$date', period: '$period', section: '$section' } } },
      { $count: 'n' },
    ]),
    User.find({
      role: { $in: STUDENT_ROLES },
      isActive: true,
      department: cls.department,
      section: { $in: sections },
      ...(cls.year !== undefined ? { year: cls.year } : {}),
      ...(cls.semester !== undefined ? { semester: { $in: [cls.semester, null] } } : {}),
    })
      .select('name rollNo avatar department year section semester')
      .lean(),
  ]);
  // Roll numbers sort naturally ("9" before "10"), the same ordering the
  // reports use, so the screen and the PDF never disagree.
  roster.sort(byRollNo);

  const byStudent = Object.fromEntries(stats.map((r) => [String(r._id), r]));
  const students = roster.map((st) => {
    const r = byStudent[String(st._id)] || { totalPeriods: 0, presentPeriods: 0 };
    return {
      _id: st._id,
      name: st.name,
      rollNo: st.rollNo || null,
      avatar: st.avatar,
      department: st.department,
      year: st.year,
      section: st.section,
      semester: st.semester,
      totalPeriods: r.totalPeriods,
      presentPeriods: r.presentPeriods,
      absentPeriods: r.totalPeriods - r.presentPeriods,
      percentage: percentage(r.presentPeriods, r.totalPeriods),
    };
  });
  const present = students.reduce((a, st) => a + st.presentPeriods, 0);
  const total = students.reduce((a, st) => a + st.totalPeriods, 0);

  res.json({
    class: {
      department: cls.department,
      year: cls.year,
      section: section || null,
      sections,
      semester: cls.semester,
      subject: { _id: subject._id, name: subject.name, code: subject.code },
    },
    overall: {
      totalStudents: students.length,
      classesConducted: conducted[0]?.n || 0,
      presentPeriods: present,
      totalPeriods: total,
      absentPeriods: total - present,
      percentage: percentage(present, total),
    },
    students,
    belowThreshold: students.filter((st) => st.totalPeriods > 0 && st.percentage < LOW_ATTENDANCE_THRESHOLD),
  });
});

// ── Day-by-day records ─────────────────────────────────────────────

export const getAttendanceRecords = asyncHandler(async (req, res) => {
  const narrow = {};
  let scope = {};
  if (STUDENT_ROLES.includes(req.user.role)) {
    scope = { student: req.user._id }; // students only ever see their own
  } else {
    scope = await staffScope(req.user);
    Object.assign(narrow, narrowFromQuery(req.query));
    if (req.query.student) narrow.student = oid(req.query.student, 'student');
  }
  if (req.query.subject) narrow.subject = oid(req.query.subject, 'subject');
  if (req.query.status === 'present' || req.query.status === 'absent') narrow.status = req.query.status;
  if (req.query.date) narrow.date = toDay(req.query.date);
  else {
    const df = dayFilter(resolveRange(req.query, 'all'));
    if (df) narrow.date = df;
  }
  const filter = scopedMatch(scope, narrow);

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
  const scope = await staffScope(req.user);
  const narrow = {};
  // "Only mine" narrows the authorized scope to what this account marked; it
  // never replaces the scope, so it cannot be used to widen the view.
  if (req.user.role === 'faculty' && req.query.mine !== 'false') narrow.markedBy = req.user._id;
  if (req.query.subject) narrow.subject = oid(req.query.subject, 'subject');
  const df = dayFilter(resolveRange(req.query, 'month'));
  if (df) narrow.date = df;
  const match = scopedMatch(scope, narrow);

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
  // Department is never a grant for faculty: they must actually be assigned
  // this subject, and staffScope then limits them to their own sections of it.
  if (req.user.role === 'faculty' && !isAssigned(subject, req.user)) {
    throw new ApiError(403, 'Not authorized for this subject');
  }
  if (req.user.role === 'hod' && subject.department !== ownDepartment(req.user)) {
    throw new ApiError(403, 'This subject is outside your department');
  }

  const narrow = { subject: subject._id };
  if (req.query.section) narrow.section = String(req.query.section).toUpperCase();
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) narrow.date = df;
  const match = scopedMatch(await staffScope(req.user), narrow);

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
  const narrow = narrowFromQuery(req.query);
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) narrow.date = df;
  const match = scopedMatch(await staffScope(req.user), narrow);

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
  // Faculty get no section selector at all: their scope is their teaching
  // assignments. An HOD may narrow by section inside their own department.
  // Either way the filters only ever intersect the authorized scope.
  const narrow = narrowFromQuery(req.query);
  if (req.user.role === 'faculty') narrow.department = undefined;
  const df = dayFilter(resolveRange(req.query, 'all'));
  if (df) narrow.date = df;
  const match = scopedMatch(await staffScope(req.user), narrow);
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
  let scope = {};
  const narrow = {};
  if (STUDENT_ROLES.includes(req.user.role)) {
    scope = { student: req.user._id };
  } else {
    scope = await staffScope(req.user);
    Object.assign(narrow, narrowFromQuery(req.query));
    if (req.query.student) narrow.student = oid(req.query.student, 'student');
  }
  if (req.query.subject) narrow.subject = oid(req.query.subject, 'subject');
  const df = dayFilter(resolveRange(req.query, 'month'));
  if (df) narrow.date = df;
  const match = scopedMatch(scope, narrow);

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

// ── Reports (period / date / weekly / monthly / semester) ──────────

/**
 * Generate an attendance report. Authorization, the academic scope and every
 * student row are resolved on the server by the report service; `format=pdf`
 * streams the document straight to the response, so no report file is ever
 * written to disk and no user-supplied value reaches a filesystem path.
 */
export const getAttendanceReport = asyncHandler(async (req, res) => {
  const report = await buildReport(req.user, req.query, req.params.type);
  if (req.query.format !== 'pdf') return res.json(report);

  const pdf = renderReportPdf(report);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(reportFilename(report))}"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(pdf);
});

/**
 * The Period dropdown for a report: "All Periods" plus the real periods of the
 * authorized class on that date, from its own timetable and held sessions.
 */
export const getReportPeriods = asyncHandler(async (req, res) => {
  res.json(await reportPeriods(req.user, req.query));
});

/**
 * What the report controls may offer this account: for a faculty member their
 * own subjects and the sections of each; for an HOD the years, sections and
 * semesters that actually exist in their own department. Derived from the
 * account, so the UI can never present an out-of-scope option.
 */
export const getReportOptions = asyncHandler(async (req, res) => {
  if (req.user.role === 'faculty') {
    const [assignments, ourClass] = await Promise.all([facultyAssignments(req.user), facultyClassInChargeScope(req.user)]);
    return res.json({
      scope: 'faculty',
      department: req.user.department || null,
      subjects: assignmentsBySubject(assignments),
      ourClass: ourClass[0] ? { ...ourClass[0], classInCharge: req.user.name } : null,
    });
  }
  const department = req.user.role === 'hod' ? ownDepartment(req.user) : req.query.department ? String(req.query.department) : undefined;
  const filter = { isActive: true, isBreak: { $ne: true }, ...(department ? { department } : {}) };
  const [years, sections, semesters, subjects] = await Promise.all([
    TimetableSlot.find(filter).distinct('year'),
    TimetableSlot.find(filter).distinct('section'),
    TimetableSlot.find(filter).distinct('semester'),
    Subject.find({ isActive: true, ...(department ? { department } : {}) }).select('name code semester year sections').sort('code').lean(),
  ]);
  res.json({
    scope: req.user.role === 'hod' ? 'department' : 'college',
    department: department || null,
    years: years.filter(Boolean).sort((a, b) => a - b),
    sections: sections.filter(Boolean).sort(),
    semesters: semesters.filter(Boolean).sort((a, b) => a - b),
    subjects,
  });
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

export const notifyStudentLowAttendance = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const student = await User.findOne({ _id: id, role: { $in: STUDENT_ROLES } });
  if (!student) throw new ApiError(404, 'Student not found');

  if (req.user.role === 'hod' && student.department !== req.user.department) {
    throw new ApiError(403, 'You can only notify students in your own department');
  }

  const title = 'Low Attendance Warning';
  const message = req.body?.message || `Notice: Your attendance is currently below the mandatory ${LOW_ATTENDANCE_THRESHOLD}% threshold. Please meet your HOD / mentor immediately.`;

  await notifyUsers([student._id], {
    type: 'attendance',
    title,
    message,
    link: '/attendance',
  });

  logActivity(req, 'attendance.warn_student', { entityType: 'user', entityId: student._id });
  res.json({ ok: true, message: `Notification sent to ${student.name}` });
});

