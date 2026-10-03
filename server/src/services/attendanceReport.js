/**
 * Attendance reports (period / particular-date / weekly / monthly / semester)
 * for faculty and HODs.
 *
 * Every report is authorized and assembled here, on the server:
 *   authenticate → derive role scope → validate the requested class against
 *   that scope → query only authorized attendance → build the report.
 *
 * Nothing in a report comes from a client-supplied list of students, and no
 * client-supplied department / section / subject / faculty id can widen the
 * scope: for faculty it must intersect their real teaching assignments, for an
 * HOD it must fall inside their own department.
 */
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError } from '../utils/http.js';
import { addDays, campusParts, dayKey, toDay, today, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import {
  assertAssigned,
  facultyAssignments,
  facultyClassInChargeScope,
  ownDepartment,
  STUDENT_ROLES,
} from '../utils/academicScope.js';
import { env } from '../config/env.js';
import { COLLEGE_WIDE_ROLES, yearOfSemester } from '../constants.js';

// `current` = today's completed periods only; `custom` = an explicit from/to range.
export const REPORT_TYPES = ['period', 'date', 'current', 'weekly', 'monthly', 'semester', 'custom'];
export const REPORT_SCOPES = ['class', 'handling'];

const upper = (v) => (v ? String(v).trim().toUpperCase() : undefined);
const num = (v) => (v == null || v === '' ? undefined : Number(v));
const pct = (present, total) => (total > 0 ? Math.round((present / total) * 10000) / 100 : 0);

/** Today on the campus clock — the only clock any time rule here consults. */
function serverNow() {
  const now = clock.now();
  const parts = campusParts(now);
  return { day: toDay(now), time: parts.time, weekday: parts.weekday, stamp: `${parts.dateKey} ${parts.time}` };
}

/**
 * Roll numbers sort naturally: "9" before "10", and a missing roll number
 * sorts last rather than first. Both report lists use this one ordering.
 */
export function byRollNo(a, b) {
  const ra = a.rollNo || '';
  const rb = b.rollNo || '';
  if (!ra !== !rb) return ra ? -1 : 1;
  return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' }) || String(a.name).localeCompare(String(b.name));
}

// ── Authorization ──────────────────────────────────────────────────

/**
 * The academic scope a report may cover, derived from the authenticated
 * account and checked against the request.
 *
 * - Faculty, scope=class ("Our Class"): their Class In-Charge class, complete —
 *   every subject, period and handling faculty. No subject or section is
 *   taken from the request; the class comes from facultyClassInChargeScope.
 * - Faculty, scope=handling (default, "Handling Class"): the subject and
 *   section are mandatory and must match a real teaching assignment;
 *   department, program, year and semester then come from that assignment,
 *   never from the request, and only their own periods are included.
 * - HOD: the department is always their own; year, section and semester narrow
 *   it, and an optional subject must belong to their department.
 */
export async function resolveReportScope(user, query = {}) {
  if (user.role === 'faculty' && query.scope === 'class') {
    const [ourClass] = await facultyClassInChargeScope(user);
    if (!ourClass) throw new ApiError(404, 'No class is currently assigned to you as Class In-Charge.');
    return {
      kind: 'class',
      department: ourClass.department,
      year: ourClass.year,
      section: ourClass.section,
      semester: ourClass.semester,
      subject: null,
      classInCharge: user.name,
      // The whole class: periods of every faculty member, not just this one.
      forFaculty: false,
    };
  }

  if (user.role === 'faculty') {
    if (!query.subjectId) throw new ApiError(422, 'Choose one of your subjects');
    if (!query.section) throw new ApiError(422, 'Choose one of your sections');
    const assignments = await facultyAssignments(user);
    const [match] = assertAssigned(assignments, { subject: String(query.subjectId), section: query.section });
    const subject = await Subject.findById(match.subject).select('name code department semester year').lean();
    if (!subject) throw new ApiError(404, 'Subject not found');
    return {
      kind: 'handling',
      department: match.department,
      year: match.year,
      section: match.section,
      semester: match.semester,
      subject,
      facultyId: user._id,
      facultyName: user.name,
      forFaculty: true,
    };
  }

  if (user.role === 'hod') {
    const department = ownDepartment(user);
    let subject = null;
    if (query.subjectId) {
      subject = await Subject.findById(query.subjectId).select('name code department semester year').lean();
      if (!subject) throw new ApiError(404, 'Subject not found');
      // A subject id from another department never widens the HOD's scope.
      if (subject.department !== department) throw new ApiError(403, 'This subject is outside your department');
    }
    return {
      department,
      year: num(query.year),
      section: upper(query.section),
      semester: num(query.semester),
      subject,
      forFaculty: false,
    };
  }

  // Admin, Principal, Chairman, Dean and AO: college-wide, any department.
  if (COLLEGE_WIDE_ROLES.includes(user.role)) {
    let subject = null;
    if (query.subjectId) {
      subject = await Subject.findById(query.subjectId).select('name code department semester year').lean();
      if (!subject) throw new ApiError(404, 'Subject not found');
    }
    return {
      department: query.department ? String(query.department) : subject?.department,
      year: num(query.year),
      section: upper(query.section),
      semester: num(query.semester),
      subject,
      forFaculty: false,
    };
  }

  throw new ApiError(403, 'You cannot generate attendance reports');
}

/** The AttendanceSession filter for a resolved scope. */
function sessionFilter(scope) {
  const filter = { department: scope.department };
  if (scope.section) filter.section = scope.section;
  if (scope.year !== undefined) filter.year = scope.year;
  if (scope.semester !== undefined) filter.semester = scope.semester;
  if (scope.subject) filter.subject = scope.subject._id;
  // A faculty report never includes another faculty member's periods, even of
  // the same subject and section.
  if (scope.forFaculty) filter.faculty = scope.facultyId;
  return filter;
}

/** The students of a resolved scope's class(es), ordered by roll number. */
async function rosterOf(scope) {
  const filter = { role: { $in: STUDENT_ROLES }, isActive: true, department: scope.department };
  if (scope.section) filter.section = scope.section;
  if (scope.year !== undefined) filter.year = scope.year;
  else if (scope.subject?.semester) filter.year = scope.subject.year ?? yearOfSemester(scope.subject.semester);
  if (scope.semester !== undefined) filter.semester = { $in: [scope.semester, null] };
  const students = await User.find(filter).select('name rollNo department year section semester').lean();
  return students.sort(byRollNo);
}

// ── Period completion (server time) ────────────────────────────────

/**
 * A period report exists only once the period has finished. The end time comes
 * from the attendance session's own snapshot (or the timetable entry when no
 * session was created), and "now" from the server clock in the campus
 * timezone — never from anything the client sends, including a date or
 * timestamp in the request.
 */
export function assertPeriodCompleted({ date, endTime }) {
  const now = serverNow();
  if (date.getTime() > now.day.getTime()) throw new ApiError(422, 'That date is in the future');
  if (date.getTime() < now.day.getTime()) return; // an earlier class day is over
  if (now.time < endTime) {
    throw new ApiError(
      409,
      `This period ends at ${endTime}. The period report can be generated once the period has finished (server time ${now.time}).`
    );
  }
}

// ── Reports ────────────────────────────────────────────────────────

const scopeHeader = (scope, extra = {}) => ({
  collegeName: env.collegeName,
  department: scope.department,
  // The department string carries the program (e.g. 'CSE (Cyber Security)').
  program: scope.department,
  year: scope.year ?? null,
  section: scope.section ?? null,
  semester: scope.semester ?? null,
  subject: scope.subject?.name ?? null,
  subjectCode: scope.subject?.code ?? null,
  scope: scope.kind ?? null,
  classInCharge: scope.classInCharge ?? null,
  ...extra,
});

/**
 * Period-wise report: one finished period, split into present and absent
 * students, each list ordered by roll number.
 */
export async function periodReport(user, query) {
  const scope = await resolveReportScope(user, query);
  if (!scope.section) throw new ApiError(422, 'Choose a section');
  const date = toDay(query.date || dayKey(serverNow().day));
  const period = num(query.period);
  if (!Number.isInteger(period) || period < 1 || period > 12) throw new ApiError(422, 'Choose a period');

  const session = await AttendanceSession.findOne({ ...sessionFilter(scope), date, period }).lean();

  // No session yet: the timetable entry still tells us when the period ends,
  // so "not finished" and "not taken" stay two different answers.
  let endTime = session?.endTime;
  let startTime = session?.startTime;
  if (!session) {
    const slotFilter = {
      department: scope.department,
      section: scope.section,
      period,
      dayOfWeek: weekdayOf(date),
      isActive: true,
      isBreak: { $ne: true },
    };
    if (scope.year !== undefined) slotFilter.year = scope.year;
    if (scope.semester !== undefined) slotFilter.semester = scope.semester;
    if (scope.subject) slotFilter.subject = scope.subject._id;
    if (scope.forFaculty) slotFilter.faculty = scope.facultyId;
    const slot = await TimetableSlot.findOne(slotFilter).populate('subject', 'name code').lean();
    if (!slot) throw new ApiError(404, 'No such period in your timetable for that date');
    endTime = slot.endTime;
    startTime = slot.startTime;
    if (!scope.subject && slot.subject) scope.subject = slot.subject;
  }

  assertPeriodCompleted({ date, endTime });

  if (!session) {
    return {
      type: 'period',
      title: 'Period-wise Attendance Report',
      header: scopeHeader(scope, {
        date: dayKey(date),
        period,
        startTime,
        endTime,
        facultyName: scope.facultyName ?? null,
        generatedAt: serverNow().stamp,
      }),
      notTaken: true,
      present: [],
      absent: [],
      totals: { present: 0, absent: 0, total: 0, percentage: 0 },
    };
  }

  const records = await AttendanceRecord.find({ session: session._id })
    .populate('student', 'name rollNo department year section')
    .lean();

  const row = (r) => ({
    name: r.student?.name || 'Unknown',
    rollNo: r.student?.rollNo || null,
    department: r.student?.department || session.department,
    year: r.student?.year ?? session.year,
    section: r.student?.section || session.section,
    status: r.status,
  });
  const present = records.filter((r) => r.status === 'present').map(row).sort(byRollNo);
  const absent = records.filter((r) => r.status === 'absent').map(row).sort(byRollNo);

  return {
    type: 'period',
    title: 'Period-wise Attendance Report',
    header: scopeHeader(
      { ...scope, year: session.year ?? scope.year, semester: session.semester ?? scope.semester, section: session.section },
      {
        date: dayKey(session.date),
        period: session.period,
        startTime: session.startTime,
        endTime: session.endTime,
        subject: session.subjectName,
        subjectCode: session.subjectCode,
        facultyName: session.facultyName ?? scope.facultyName ?? null,
        room: session.room ?? null,
        generatedAt: serverNow().stamp,
      }
    ),
    notTaken: false,
    present,
    absent,
    totals: {
      present: present.length,
      absent: absent.length,
      total: records.length,
      percentage: pct(present.length, records.length),
    },
  };
}

/**
 * Particular-date report: every finished period of that class day, with the
 * present and absent list of each, plus a per-student day total.
 */
export async function dateReport(user, query) {
  const scope = await resolveReportScope(user, query);
  const date = toDay(query.date || dayKey(serverNow().day));
  const now = serverNow();
  if (date.getTime() > now.day.getTime()) throw new ApiError(422, 'That date is in the future');

  const sessions = await AttendanceSession.find({ ...sessionFilter(scope), date }).sort({ period: 1 }).lean();
  // Today's still-running periods are left out, the same server-time rule the
  // single-period report applies.
  const finished = sessions.filter((s) => date.getTime() < now.day.getTime() || now.time >= s.endTime);

  const records = finished.length
    ? await AttendanceRecord.find({ session: { $in: finished.map((s) => s._id) } })
        .populate('student', 'name rollNo department year section')
        .lean()
    : [];

  const periods = finished.map((s) => {
    const mine = records.filter((r) => String(r.session) === String(s._id));
    const row = (r) => ({
      name: r.student?.name || 'Unknown',
      rollNo: r.student?.rollNo || null,
      department: r.student?.department || s.department,
      year: r.student?.year ?? s.year,
      section: r.student?.section || s.section,
      status: r.status,
    });
    const present = mine.filter((r) => r.status === 'present').map(row).sort(byRollNo);
    const absent = mine.filter((r) => r.status === 'absent').map(row).sort(byRollNo);
    return {
      period: s.period,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectName,
      subjectCode: s.subjectCode,
      facultyName: s.facultyName,
      section: s.section,
      year: s.year,
      room: s.room,
      present,
      absent,
      totals: { present: present.length, absent: absent.length, total: mine.length, percentage: pct(present.length, mine.length) },
    };
  });

  const perStudent = new Map();
  for (const r of records) {
    const id = String(r.student?._id || r.student);
    if (!perStudent.has(id)) {
      perStudent.set(id, {
        name: r.student?.name || 'Unknown',
        rollNo: r.student?.rollNo || null,
        department: r.student?.department || scope.department,
        year: r.student?.year ?? scope.year,
        section: r.student?.section || scope.section,
        presentPeriods: 0,
        totalPeriods: 0,
      });
    }
    const row = perStudent.get(id);
    row.totalPeriods += 1;
    if (r.status === 'present') row.presentPeriods += 1;
  }
  const students = [...perStudent.values()]
    .map((s) => ({ ...s, absentPeriods: s.totalPeriods - s.presentPeriods, percentage: pct(s.presentPeriods, s.totalPeriods) }))
    .sort(byRollNo);

  const present = students.reduce((a, s) => a + s.presentPeriods, 0);
  const total = students.reduce((a, s) => a + s.totalPeriods, 0);

  return {
    type: 'date',
    title: 'Attendance Report — Particular Date',
    header: scopeHeader(scope, { date: dayKey(date), generatedAt: now.stamp }),
    periods,
    students,
    totals: {
      periodsConducted: finished.length,
      present,
      absent: total - present,
      total,
      percentage: pct(present, total),
      students: students.length,
    },
  };
}

const RANGES = {
  weekly: { days: 6, title: 'Weekly Attendance Report', type: 'weekly' },
  monthly: { days: 29, title: 'Monthly Attendance Report', type: 'monthly' },
  semester: { days: 179, title: 'Semester Attendance Report', type: 'semester' },
  custom: { days: null, title: 'Custom Range Attendance Report', type: 'custom' },
};

/**
 * Weekly / monthly / semester report: per-student conducted, present, absent
 * and percentage over the window, plus the period-level session list so the
 * day-and-period detail is available when the report is opened.
 */
export async function rangeReport(user, query, kind) {
  const spec = RANGES[kind];
  if (!spec) throw new ApiError(422, 'Unknown report type');
  const scope = await resolveReportScope(user, query);
  const now = serverNow();

  if (kind === 'custom' && (!query.from || !query.to)) throw new ApiError(422, 'Choose a start date and an end date');
  const to = query.to ? toDay(query.to) : now.day;
  const from = query.from ? toDay(query.from) : addDays(to, -spec.days);
  if (from > to) throw new ApiError(422, '"From" must be before "to"');
  if (to > now.day) throw new ApiError(422, 'The end date cannot be in the future');

  const sessions = await AttendanceSession.find({ ...sessionFilter(scope), date: { $gte: from, $lte: to } })
    .sort({ date: 1, period: 1 })
    .lean();
  // A period still running today is not part of any report yet.
  const finished = sessions.filter((s) => dayKey(s.date) < dayKey(now.day) || now.time >= s.endTime);

  const [records, roster] = await Promise.all([
    finished.length
      ? AttendanceRecord.find({ session: { $in: finished.map((s) => s._id) } }).select('student status session').lean()
      : [],
    rosterOf(scope),
  ]);

  const stats = new Map();
  for (const r of records) {
    const id = String(r.student);
    if (!stats.has(id)) stats.set(id, { presentPeriods: 0, totalPeriods: 0 });
    const row = stats.get(id);
    row.totalPeriods += 1;
    if (r.status === 'present') row.presentPeriods += 1;
  }

  const students = roster
    .map((st) => {
      const row = stats.get(String(st._id)) || { presentPeriods: 0, totalPeriods: 0 };
      return {
        name: st.name,
        rollNo: st.rollNo || null,
        department: st.department,
        year: st.year ?? scope.year,
        section: st.section,
        semester: st.semester ?? scope.semester,
        presentPeriods: row.presentPeriods,
        totalPeriods: row.totalPeriods,
        absentPeriods: row.totalPeriods - row.presentPeriods,
        percentage: pct(row.presentPeriods, row.totalPeriods),
      };
    })
    .sort(byRollNo);

  const present = students.reduce((a, s) => a + s.presentPeriods, 0);
  const total = students.reduce((a, s) => a + s.totalPeriods, 0);

  return {
    type: spec.type,
    title: spec.title,
    header: scopeHeader(scope, { from: dayKey(from), to: dayKey(to), generatedAt: now.stamp }),
    students,
    sessions: finished.map((s) => ({
      date: dayKey(s.date),
      period: s.period,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectName,
      subjectCode: s.subjectCode,
      facultyName: s.facultyName,
      section: s.section,
    })),
    totals: {
      periodsConducted: finished.length,
      present,
      absent: total - present,
      total,
      percentage: pct(present, total),
      students: students.length,
    },
  };
}

/**
 * Current Data: today's report from the periods that have ALREADY finished on
 * the server clock. The date is always the server's today — a client-sent date
 * (or now / time / serverTime) is overwritten, never read — and a running or
 * future period is excluded by the same rule the date report applies. With no
 * finished period yet there is no report: an empty one would look like a day
 * with nobody present.
 */
export async function currentReport(user, query) {
  const report = await dateReport(user, { ...query, date: dayKey(serverNow().day) });
  if (!report.periods.length) throw new ApiError(409, 'No completed periods are available for today.');
  return { ...report, type: 'current', title: 'Current Data — Today’s Completed Periods' };
}

/**
 * Build any report type for an authenticated user. A period report for
 * "All Periods" is the particular-date report: every finished period of that
 * day, each listed separately.
 */
export function buildReport(user, query, type) {
  if (type === 'period' && query.period === 'all') return dateReport(user, query);
  if (type === 'period') return periodReport(user, query);
  if (type === 'date') return dateReport(user, query);
  if (type === 'current') return currentReport(user, query);
  if (RANGES[type]) return rangeReport(user, query, type);
  throw new ApiError(422, 'Unknown report type');
}

/**
 * The periods a report may name for one date, derived from the authorized
 * class's own timetable for that weekday plus any attendance sessions already
 * held that day (so a period moved in the timetable after it was held still
 * appears). Nothing is hard-coded and nothing outside the scope is listed.
 */
export async function reportPeriods(user, query) {
  const scope = await resolveReportScope(user, query);
  const date = toDay(query.date || dayKey(serverNow().day));
  const now = serverNow();

  const slotFilter = {
    department: scope.department,
    dayOfWeek: weekdayOf(date),
    isActive: true,
    isBreak: { $ne: true },
  };
  if (scope.section) slotFilter.section = scope.section;
  if (scope.year !== undefined) slotFilter.year = scope.year;
  if (scope.semester !== undefined) slotFilter.semester = scope.semester;
  if (scope.subject) slotFilter.subject = scope.subject._id;
  if (scope.forFaculty) slotFilter.faculty = scope.facultyId;

  const [slots, sessions] = await Promise.all([
    TimetableSlot.find(slotFilter).populate('subject', 'name code').populate('faculty', 'name').lean(),
    AttendanceSession.find({ ...sessionFilter(scope), date }).lean(),
  ]);

  const byPeriod = new Map();
  for (const s of slots) {
    byPeriod.set(s.period, {
      period: s.period,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subject?.name ?? null,
      subjectCode: s.subject?.code ?? null,
      facultyName: s.faculty?.name ?? null,
    });
  }
  // A held session's snapshot is what the report will use, so it wins.
  for (const s of sessions) {
    byPeriod.set(s.period, {
      period: s.period,
      startTime: s.startTime,
      endTime: s.endTime,
      subject: s.subjectName ?? null,
      subjectCode: s.subjectCode ?? null,
      facultyName: s.facultyName ?? null,
    });
  }

  const periods = [...byPeriod.values()]
    .sort((a, b) => a.period - b.period)
    .map((p) => ({
      ...p,
      completed: date.getTime() < now.day.getTime() || (date.getTime() === now.day.getTime() && now.time >= p.endTime),
    }));
  return { date: dayKey(date), serverTime: now.stamp, periods };
}

/**
 * The download filename, e.g.
 * VEXON_Attendance_Period_2026-10-03_CSE_Y3_A.pdf — the academic scope only,
 * never a student name or anything else sensitive.
 */
export function reportFilename(report) {
  const h = report.header;
  const label = {
    period: 'Period',
    date: 'Date',
    current: 'Current',
    weekly: 'Weekly',
    monthly: 'Monthly',
    semester: 'Semester',
    custom: 'Custom',
  }[report.type];
  const parts = ['VEXON', 'Attendance', label];
  if (h.scope === 'class') parts.push('OurClass');
  if (h.date) parts.push(h.date);
  else if (h.to) parts.push(h.to);
  if (h.department) parts.push(h.department);
  if (h.year) parts.push(`Y${h.year}`);
  if (h.section) parts.push(h.section);
  if (report.type === 'period' && h.period) parts.push(`P${h.period}`);
  return `${parts.join('_')}.pdf`;
}

export const reportDayKey = dayKey;
export const reportToday = today;
