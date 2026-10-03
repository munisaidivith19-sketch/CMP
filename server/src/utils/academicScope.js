import TimetableSlot from '../models/TimetableSlot.js';
import AttendanceSession from '../models/AttendanceSession.js';
import { ApiError } from './http.js';
import { yearOfSemester } from '../constants.js';

export const STUDENT_ROLES = ['student', 'club_admin'];

const norm = (s) => String(s || '').trim().toUpperCase();
const key = (c) => `${c.department}|${c.year ?? ''}|${c.section}|${c.semester ?? ''}`;

/**
 * The classes (department + year + section + semester) a faculty member
 * actually teaches, read from the timetable — the single source of truth for
 * faculty academic scope across People, Chat, Attendance and Study Materials.
 *
 * Their Class In-Charge class is added too. When the account stores the exact
 * in-charge year and semester, that exact class is used. For a legacy account
 * without them, the section (User.section) is added when no timetable row
 * covers it yet, its year coming from the declared teaching years or the one
 * year that section exists in college-wide — the original People/Chat roster
 * behaviour, kept so existing accounts see no change.
 */
export async function facultyClasses(user) {
  const slots = await TimetableSlot.find({ faculty: user._id, isActive: true, isBreak: { $ne: true } })
    .select('department section year semester')
    .lean();
  const classes = new Map();
  const add = (c) => classes.set(key(c), c);
  slots.forEach((s) =>
    add({ department: s.department, section: norm(s.section), year: s.year ?? yearOfSemester(s.semester), semester: s.semester })
  );

  const section = norm(user.section);
  if (section && user.department && user.inChargeYear != null && user.inChargeSemester != null) {
    add({ department: user.department, section, year: user.inChargeYear, semester: user.inChargeSemester });
  } else if (section && user.department && ![...classes.values()].some((c) => c.department === user.department && c.section === section)) {
    const declared = user.teachingYears?.length ? user.teachingYears : null;
    const years = declared || (await TimetableSlot.find({ department: user.department, section, isActive: true }).distinct('year'));
    if (declared || years.length === 1) years.forEach((year) => add({ department: user.department, section, year }));
    else add({ department: user.department, section });
  }
  return [...classes.values()];
}

/**
 * Whether a student belongs to one of `classes`. Year must match exactly, so
 * "3rd Year Section A" never matches "2nd Year Section A". A student with no
 * semester on file (legacy data, flagged by the migration) matches on year.
 */
export const inClasses = (classes, student) =>
  classes.some(
    (c) =>
      c.department === student.department &&
      c.section === norm(student.section) &&
      (c.year === undefined || c.year === student.year) &&
      (c.semester === undefined || student.semester == null || c.semester === student.semester)
  );

/** Mongo filter matching the students of any of `classes` (same rules as inClasses). */
export function studentsInClassesFilter(classes) {
  if (!classes.length) return { _id: null };
  return {
    role: { $in: STUDENT_ROLES },
    $or: classes.map((c) => ({
      department: c.department,
      section: c.section,
      ...(c.year !== undefined ? { year: c.year } : {}),
      ...(c.semester !== undefined ? { semester: { $in: [c.semester, null] } } : {}),
    })),
  };
}

// ── Class In-Charge ("Our Class") ───────────────────────────────────

/**
 * The exact class a faculty member is Class In-Charge of — "Our Class" — as
 * [{ department, program, year, section, semester }].
 *
 * The identity is User.department + User.section (the fields Gate Pass already
 * routes on) + User.inChargeYear + User.inChargeSemester. It grants COMPLETE
 * visibility of that one class — every subject, period, faculty and student —
 * for Timetable, Attendance and reports. It never grants marking rights; those
 * stay with the subject-handling faculty (facultyAssignments).
 *
 * A legacy account without the stored year/semester is resolved only when the
 * timetable leaves exactly one possibility: that department + section running
 * in a single year and semester college-wide. Anything ambiguous returns [] —
 * a year- or semester-unconstrained class is never a fallback, because it
 * would hand over every same-letter section across years. teachingYears and
 * teachingSections are never used: they describe what the faculty teaches,
 * not which class they are in charge of.
 *
 * Always an array, so a future multi-class assignment needs no call-site change.
 */
export async function facultyClassInChargeScope(user) {
  if (!user || user.role !== 'faculty') return [];
  const department = user.department;
  const section = norm(user.section);
  if (!department || !section) return [];

  if (user.inChargeYear != null && user.inChargeSemester != null) {
    const year = Number(user.inChargeYear);
    const semester = Number(user.inChargeSemester);
    if (yearOfSemester(semester) !== year) return []; // never trust a corrupt pair
    return [{ department, program: department, year, section, semester }];
  }

  const candidates = await TimetableSlot.aggregate([
    { $match: { department, section, isActive: true, isBreak: { $ne: true } } },
    { $group: { _id: { year: '$year', semester: '$semester' } } },
  ]);
  if (candidates.length !== 1) return [];
  const { year, semester } = candidates[0]._id;
  if (year == null || semester == null || yearOfSemester(semester) !== year) return [];
  return [{ department, program: department, year, section, semester }];
}

/**
 * Mongo filter over TimetableSlot / AttendanceSession documents for the
 * Class In-Charge class(es): department + year + section + semester, with no
 * faculty or subject constraint — the whole class.
 */
export const classInChargeFilter = (scopes) => assignmentsFilter(scopes, { withSubject: false });

/**
 * Mongo filter over AttendanceRecord documents for the Class In-Charge
 * class(es).
 *
 * AttendanceRecord carries department + section but not year or semester, so
 * department + section alone would also match the same section letter in every
 * other year. The class's subjects are therefore taken from its own
 * AttendanceSession snapshots (the authoritative class-level bridge, so a
 * subject later removed from the timetable still counts) plus its current
 * timetable. A subject belongs to exactly one department and semester, so
 * department + section + one of those subjects is exactly this class.
 */
export async function classInChargeRecordFilter(scopes) {
  if (!scopes.length) return { _id: null };
  const clauses = [];
  for (const c of scopes) {
    const cls = { department: c.department, year: c.year, section: c.section, semester: c.semester };
    const [fromSessions, fromSlots] = await Promise.all([
      AttendanceSession.find(cls).distinct('subject'),
      TimetableSlot.find({ ...cls, isBreak: { $ne: true } }).distinct('subject'),
    ]);
    const subjects = [...new Map([...fromSessions, ...fromSlots].filter(Boolean).map((id) => [String(id), id])).values()];
    if (subjects.length) clauses.push({ department: c.department, section: c.section, subject: { $in: subjects } });
  }
  return clauses.length ? { $or: clauses } : { _id: null };
}

/**
 * Narrow Class In-Charge scopes by a requested department / year / section /
 * semester. Like matchAssignments it only ever intersects: a request naming a
 * different class matches nothing.
 */
export const matchClassInCharge = (scopes, req = {}) => matchAssignments(scopes, { ...req, subject: undefined });

// ── Teaching assignments (subject-level) ────────────────────────────

/**
 * A faculty member's actual subject/class teaching assignments, straight from
 * the timetable: one entry per distinct
 * department + program + year + section + semester + subject.
 *
 * This — not the faculty's own department — is the authoritative source for
 * what a faculty account may read in Timetable, Attendance and reports. A
 * faculty's class-in-charge section (used by facultyClasses as a People-roster
 * fallback) grants no subject-level authorization, because there is no subject
 * to authorize without a timetable row of its own.
 */
export async function facultyAssignments(user) {
  const slots = await TimetableSlot.find({ faculty: user._id, isActive: true, isBreak: { $ne: true } })
    .select('department section year semester subject')
    .populate('subject', 'name code')
    .lean();

  const byKey = new Map();
  for (const s of slots) {
    if (!s.subject) continue;
    const entry = {
      department: s.department,
      section: norm(s.section),
      year: s.year ?? yearOfSemester(s.semester),
      semester: s.semester,
      subject: s.subject._id,
      subjectName: s.subject.name,
      subjectCode: s.subject.code,
    };
    byKey.set(`${key(entry)}|${entry.subject}`, entry);
  }
  return [...byKey.values()];
}

/**
 * The subjects a faculty member teaches, each with the exact sections they
 * teach it to — what the "My Classes" Subject and Section dropdowns are built
 * from. Section lists are per subject, so a subject taught to A and C never
 * offers B just because another subject of theirs uses it.
 */
export function assignmentsBySubject(assignments) {
  const bySubject = new Map();
  for (const a of assignments) {
    const id = String(a.subject);
    if (!bySubject.has(id)) bySubject.set(id, { _id: a.subject, name: a.subjectName, code: a.subjectCode, classes: [] });
    bySubject.get(id).classes.push({ department: a.department, year: a.year, section: a.section, semester: a.semester });
  }
  return [...bySubject.values()]
    .map((s) => ({ ...s, sections: [...new Set(s.classes.map((c) => c.section))].sort() }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

/**
 * Narrow `assignments` to those matching a requested academic scope. Every
 * field is optional and an absent field does not constrain, so a request can
 * only ever intersect the scope — never widen it. An empty result means the
 * request is unauthorized.
 */
export function matchAssignments(assignments, req = {}) {
  const num = (v) => (v == null || v === '' ? undefined : Number(v));
  const want = {
    department: req.department || undefined,
    section: req.section ? norm(req.section) : undefined,
    year: num(req.year),
    semester: num(req.semester),
    subject: req.subject ? String(req.subject) : undefined,
  };
  return assignments.filter(
    (a) =>
      (want.department === undefined || a.department === want.department) &&
      (want.section === undefined || a.section === want.section) &&
      (want.year === undefined || a.year === want.year) &&
      (want.semester === undefined || a.semester === want.semester) &&
      (want.subject === undefined || String(a.subject) === want.subject)
  );
}

/**
 * Assert a faculty member actually teaches the requested class and return the
 * matching assignments. The message never reveals the unauthorized class.
 */
export function assertAssigned(assignments, req = {}) {
  const matches = matchAssignments(assignments, req);
  if (!matches.length) throw new ApiError(403, 'You are not assigned to this class');
  return matches;
}

/**
 * Mongo filter over TimetableSlot / AttendanceSession-shaped documents
 * matching any of `assignments` (department + year + section + semester, and
 * the subject unless `withSubject` is false).
 */
export function assignmentsFilter(assignments, { withSubject = true } = {}) {
  if (!assignments.length) return { _id: null };
  const seen = new Set();
  const clauses = [];
  for (const a of assignments) {
    const clause = {
      department: a.department,
      section: a.section,
      ...(a.year !== undefined ? { year: a.year } : {}),
      ...(a.semester !== undefined ? { semester: a.semester } : {}),
      ...(withSubject ? { subject: a.subject } : {}),
    };
    const k = JSON.stringify(clause);
    if (seen.has(k)) continue;
    seen.add(k);
    clauses.push(clause);
  }
  return { $or: clauses };
}

/**
 * The department a department-scoped role (HOD) is confined to, taken from the
 * authenticated account only — never from the request.
 */
export function ownDepartment(user) {
  if (!user.department) throw new ApiError(403, 'Your account has no department assigned');
  return user.department;
}
