/**
 * Attendance monitoring and reports for the HOD, Principal and Office.
 *
 * 1. Staff attendance report — per staff member per day:
 *    - DAILY presence (FacultyAttendance: present / absent / leave / unmarked);
 *    - PERIOD-WISE teaching, kept apart from it: periods scheduled, taken by
 *      them, covered by a substitute, not conducted, pending verification,
 *      not submitted, and periods they took as a substitute for someone else;
 *    - early exits.
 *    Daily presence never implies a period was taught, and vice versa.
 *
 * 2. Low-attendance student monitor — subject-wise and overall percentages:
 *    attended ÷ held × 100 over the periods actually conducted (a period
 *    recorded as not conducted, or never held, has no record and so is never
 *    counted). A student with no held periods shows no percentage at all —
 *    never a misleading 0 %.
 *
 * Scope always comes from the account: an HOD sees their own department only
 * (the Science & Humanities HOD: all of 1st year); Principal, Office and the
 * other college roles see the college. Request parameters only narrow it.
 */
import mongoose from 'mongoose';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import FacultyAttendance from '../models/FacultyAttendance.js';
import FacultyEarlyExit from '../models/FacultyEarlyExit.js';
import PeriodCover from '../models/PeriodCover.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { addDays, campusParts, dayKey, resolveRange, today, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { sendCsv } from '../utils/csv.js';
import { isFirstYearHod } from '../constants.js';
import { appliesTo, holidaysBetween } from '../services/holidays.js';
import { LOW_ATTENDANCE_THRESHOLD, STUDENT_ROLES, percentage } from './attendanceController.js';

const MAX_DAYS = 92;
const TEACHING = ['faculty', 'hod'];

/** The department an HOD is confined to; college roles may pick one (or none = all). */
function departmentScope(user, requested) {
  if (user.role === 'hod') {
    if (!user.department) throw new ApiError(403, 'Your account has no department assigned');
    return user.department;
  }
  return requested ? String(requested) : undefined;
}

function window(query) {
  const w = resolveRange(query, 'day');
  const to = w.to || today();
  const from = w.from || to;
  if ((to - from) / 86400000 + 1 > MAX_DAYS) throw new ApiError(422, `Choose a range of at most ${MAX_DAYS} days`);
  return { from, to };
}

function* days(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

// ── Staff attendance report ────────────────────────────────────────

export const staffReport = asyncHandler(async (req, res) => {
  const user = req.user;
  const department = departmentScope(user, req.query.department);
  const { from, to } = window(req.query);
  const staffFilter = { role: { $in: TEACHING }, isActive: true, ...(department ? { department } : {}) };
  if (req.query.faculty) {
    if (!mongoose.isValidObjectId(req.query.faculty)) throw new ApiError(422, 'Invalid staff member');
    staffFilter._id = req.query.faculty;
  }
  const staff = await User.find(staffFilter).select('name employeeId department designation role').sort({ department: 1, name: 1 }).lean();
  if (req.query.faculty && !staff.length) throw new ApiError(403, 'This staff member is outside your scope');
  const ids = staff.map((s) => s._id);

  // Everything for the whole range in a handful of queries — never one per person or day.
  const range = { $gte: from, $lte: to };
  const [daily, slots, sessions, covers, exits, holidays] = await Promise.all([
    FacultyAttendance.find({ faculty: { $in: ids }, date: range }).select('faculty date status source').lean(),
    TimetableSlot.find({ faculty: { $in: ids }, isActive: true, isBreak: { $ne: true } }).select('faculty dayOfWeek startTime endTime department year section').lean(),
    AttendanceSession.find({ date: range, $or: [{ faculty: { $in: ids } }, { takenBy: { $in: ids } }] }).select('timetableSlot date faculty takenBy createdBy cover').lean(),
    PeriodCover.find({ date: range, status: 'active', $or: [{ originalFaculty: { $in: ids } }, { substitute: { $in: ids } }] }).select('timetableSlot date kind originalFaculty substitute').lean(),
    FacultyEarlyExit.find({ faculty: { $in: ids }, date: range, status: { $in: ['pending', 'approved'] } }).select('faculty date status departureTime actualDepartureAt').lean(),
    holidaysBetween(from, to),
  ]);
  const key = (f, d) => `${f}|${d.getTime()}`;
  const dailyOf = new Map(daily.map((r) => [key(r.faculty, new Date(r.date)), r]));
  const exitOf = new Map(exits.map((e) => [key(e.faculty, new Date(e.date)), e]));
  const slotsOf = new Map();
  for (const s of slots) {
    const k = `${s.faculty}|${s.dayOfWeek}`;
    if (!slotsOf.has(k)) slotsOf.set(k, []);
    slotsOf.get(k).push(s);
  }
  const sessionOf = new Map(sessions.map((s) => [`${s.timetableSlot}|${new Date(s.date).getTime()}`, s]));
  const coverOf = new Map(covers.map((c) => [`${c.timetableSlot}|${new Date(c.date).getTime()}`, c]));
  const takenAsSub = new Map();
  for (const s of sessions) {
    const by = s.takenBy || s.createdBy;
    if (by && s.faculty && String(by) !== String(s.faculty) && s.cover) {
      const k = key(by, new Date(s.date));
      takenAsSub.set(k, (takenAsSub.get(k) || 0) + 1);
    }
  }
  const nowDay = today().getTime();
  const nowTime = campusParts(clock.now()).time;

  const rows = [];
  const summary = new Map();
  for (const st of staff) {
    const sum = { present: 0, absent: 0, leave: 0, unmarked: 0, scheduled: 0, taken: 0, covered: 0, notConducted: 0, pending: 0, notSubmitted: 0, substituteTaken: 0, earlyExits: 0 };
    for (const d of days(from, to)) {
      const t = d.getTime();
      const wd = weekdayOf(d);
      const rec = dailyOf.get(key(st._id, d));
      const status = rec?.status || 'unmarked';
      const own = (slotsOf.get(`${st._id}|${wd}`) || []).filter((s) => !holidays.some((h) => appliesTo(h, s, d)));
      const row = {
        date: dayKey(d), weekday: wd, staffId: st._id, name: st.name, employeeId: st.employeeId || '', department: st.department || '',
        dailyStatus: status, dailySource: rec?.source || null,
        scheduled: own.length, taken: 0, covered: 0, notConducted: 0, pending: 0, notSubmitted: 0,
        substituteTaken: takenAsSub.get(key(st._id, d)) || 0,
        earlyExit: null,
      };
      for (const s of own) {
        const sk = `${s._id}|${t}`;
        const sess = sessionOf.get(sk);
        const cover = coverOf.get(sk);
        const finished = t < nowDay || (t === nowDay && s.endTime <= nowTime);
        if (sess && String(sess.takenBy || sess.createdBy) === String(st._id)) row.taken += 1;
        else if (cover?.kind === 'substitute') row.covered += 1;
        else if (cover?.kind === 'not_conducted') row.notConducted += 1;
        else if (cover?.kind === 'pending_verification') row.pending += 1;
        else if (sess) row.taken += 1; // taken by an HOD / admin on their behalf: the class was held
        else if (finished) row.notSubmitted += 1;
      }
      const exit = exitOf.get(key(st._id, d));
      if (exit) row.earlyExit = { status: exit.status, departureTime: exit.departureTime, departedAt: exit.actualDepartureAt || null };
      if (req.query.status && req.query.status !== status) continue;
      rows.push(row);
      sum[status] += 1;
      for (const k of ['scheduled', 'taken', 'covered', 'notConducted', 'pending', 'notSubmitted', 'substituteTaken']) sum[k] += row[k];
      if (exit) sum.earlyExits += 1;
    }
    summary.set(String(st._id), { staffId: st._id, name: st.name, employeeId: st.employeeId || '', department: st.department || '', ...sum });
  }

  // Department comparison (Principal / Office view).
  const byDept = new Map();
  for (const s of summary.values()) {
    const d = byDept.get(s.department) || { department: s.department, staff: 0, present: 0, absent: 0, leave: 0, unmarked: 0, scheduled: 0, taken: 0, notSubmitted: 0 };
    d.staff += 1;
    for (const k of ['present', 'absent', 'leave', 'unmarked', 'scheduled', 'taken', 'notSubmitted']) d[k] += s[k];
    byDept.set(s.department, d);
  }

  if (req.query.format === 'csv') {
    return sendCsv(res, `staff-attendance-${dayKey(from)}-to-${dayKey(to)}.csv`, [
      ['Date', 'Staff', 'Employee ID', 'Department', 'Daily status', 'Daily source', 'Periods scheduled', 'Periods taken', 'Covered by substitute', 'Not conducted', 'Pending verification', 'Not submitted', 'Taken as substitute', 'Early exit'],
      ...rows.map((r) => [
        r.date, r.name, r.employeeId, r.department, r.dailyStatus, r.dailySource || '', r.scheduled, r.taken, r.covered, r.notConducted, r.pending, r.notSubmitted, r.substituteTaken,
        r.earlyExit ? `${r.earlyExit.status} from ${r.earlyExit.departureTime}` : '',
      ]),
    ]);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.set('Cache-Control', 'no-store');
  res.json({
    range: { from: dayKey(from), to: dayKey(to) },
    department: department || null,
    departments: [...byDept.values()].sort((a, b) => a.department.localeCompare(b.department)),
    staff: [...summary.values()],
    rows: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / limit)) },
  });
});

// ── Low-attendance student monitor ─────────────────────────────────

export const lowAttendanceMonitor = asyncHandler(async (req, res) => {
  const user = req.user;
  const studentFilter = { role: { $in: STUDENT_ROLES }, isActive: true };
  if (user.role === 'hod') {
    if (isFirstYearHod(user)) {
      studentFilter.year = 1;
      if (req.query.department) studentFilter.department = String(req.query.department);
    } else {
      studentFilter.department = departmentScope(user);
      studentFilter.year = { $in: [2, 3, 4] };
    }
  } else if (req.query.department) studentFilter.department = String(req.query.department);
  if (req.query.year) {
    const y = Number(req.query.year);
    if (studentFilter.year === 1 && y !== 1) return res.json(emptyMonitor());
    if (studentFilter.year?.$in && !studentFilter.year.$in.includes(y)) return res.json(emptyMonitor());
    studentFilter.year = y;
  }
  if (req.query.section) studentFilter.section = String(req.query.section).toUpperCase();
  if (req.query.semester) studentFilter.semester = Number(req.query.semester);

  const students = await User.find(studentFilter).select('name rollNo department year section semester').lean();
  const ids = students.map((s) => s._id);
  const w = resolveRange(req.query, 'semester');
  const match = { student: { $in: ids }, ...(w.from || w.to ? { date: { ...(w.from ? { $gte: w.from } : {}), ...(w.to ? { $lte: w.to } : {}) } } : {}) };
  if (req.query.subjectId) {
    if (!mongoose.isValidObjectId(req.query.subjectId)) throw new ApiError(422, 'Invalid subject');
    match.subject = new mongoose.Types.ObjectId(String(req.query.subjectId));
  }
  const rows = ids.length
    ? await AttendanceRecord.aggregate([
        { $match: match },
        { $group: { _id: { student: '$student', subject: '$subject' }, held: { $sum: 1 }, attended: { $sum: { $cond: [{ $in: ['$status', ['present', 'od']] }, 1, 0] } }, last: { $max: '$markedAt' } } },
        { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subject', pipeline: [{ $project: { code: 1, name: 1 } }] } },
      ])
    : [];
  const threshold = Math.min(100, Math.max(1, Number(req.query.threshold) || LOW_ATTENDANCE_THRESHOLD));
  const per = new Map();
  for (const r of rows) {
    const id = String(r._id.student);
    if (!per.has(id)) per.set(id, { held: 0, attended: 0, last: null, subjects: [] });
    const p = per.get(id);
    p.held += r.held;
    p.attended += r.attended;
    if (!p.last || r.last > p.last) p.last = r.last;
    p.subjects.push({ subjectId: r._id.subject, code: r.subject[0]?.code || '', name: r.subject[0]?.name || '', held: r.held, attended: r.attended, percentage: percentage(r.attended, r.held), below: percentage(r.attended, r.held) < threshold });
  }
  const all = req.query.all === 'true';
  const list = students
    .map((s) => {
      const p = per.get(String(s._id));
      const held = p?.held || 0;
      return {
        _id: s._id, name: s.name, rollNo: s.rollNo || null, department: s.department, year: s.year, section: s.section, semester: s.semester ?? null,
        held, attended: p?.attended || 0,
        // No held periods → no percentage (never a misleading 0 %).
        percentage: held ? percentage(p.attended, held) : null,
        below: held > 0 && percentage(p.attended, held) < threshold,
        lastUpdated: p?.last || null,
        subjects: (p?.subjects || []).sort((a, b) => a.code.localeCompare(b.code)),
      };
    })
    .filter((s) => all || s.below)
    .sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101) || String(a.rollNo).localeCompare(String(b.rollNo)));

  if (req.query.format === 'csv') {
    const header = ['Roll No', 'Name', 'Department', 'Year', 'Section', 'Semester', 'Periods attended', 'Periods held', 'Overall %', 'Below threshold', 'Subject-wise %', 'Last updated'];
    return sendCsv(res, `low-attendance-${dayKey(today())}.csv`, [
      header,
      ...list.map((s) => [
        s.rollNo || '', s.name, s.department, s.year, s.section || '', s.semester ?? '', s.attended, s.held,
        s.percentage == null ? 'No classes held' : s.percentage, s.below ? 'yes' : 'no',
        s.subjects.map((x) => `${x.code} ${x.percentage}% (${x.attended}/${x.held})`).join('; '),
        s.lastUpdated ? new Date(s.lastUpdated).toISOString() : '',
      ]),
    ]);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.set('Cache-Control', 'no-store');
  res.json({
    threshold,
    range: { from: w.from ? dayKey(w.from) : null, to: w.to ? dayKey(w.to) : null },
    students: list.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: list.length, pages: Math.max(1, Math.ceil(list.length / limit)) },
  });
});

const emptyMonitor = () => ({ threshold: LOW_ATTENDANCE_THRESHOLD, students: [], pagination: { page: 1, limit: 50, total: 0, pages: 1 } });
