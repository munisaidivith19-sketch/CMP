/**
 * Exam timetable ↔ class attendance. The single place that decides which
 * exams concern a class, which regular periods a published exam blocks, and
 * which period is the "first post-exam period" that can trigger automatic
 * Present marking. Attendance marking, the roster, "my periods", the event
 * integration and the exam controller all ask this module, so they can never
 * disagree.
 *
 * Time model (identical to TimetableSlot): a date is a class-day value (UTC
 * midnight of the campus calendar date) and a time is campus-local "HH:mm",
 * 24-hour. AM/PM is a display concern only, so an overlap is a plain string
 * comparison and can never straddle a date boundary.
 */
import Exam from '../models/Exam.js';
import TimetableSlot from '../models/TimetableSlot.js';
import { dayKey, weekdayOf } from '../utils/dates.js';

const upper = (s) => String(s || '').trim().toUpperCase();

/** Two [start, end) time windows overlap. */
export const timesOverlap = (a, b) => a.startTime < b.endTime && b.startTime < a.endTime;

/**
 * Does an exam's scope cover a class (department + year + section)? An empty
 * scope list means "All". A class field that is unknown does not constrain
 * (the conservative choice, as for holidays).
 */
export function examCoversClass(exam, { department, year, section } = {}) {
  const deps = exam.departments || [];
  const years = (exam.years || []).map(Number);
  const secs = (exam.sections || []).map(upper);
  if (department && deps.length && !deps.includes(department)) return false;
  if (year != null && years.length && !years.includes(Number(year))) return false;
  if (section && secs.length && !secs.includes(upper(section))) return false;
  return true;
}

/** Mongo clauses for the exams whose scope covers a class (same rules as examCoversClass). */
export function classExamClause({ department, year, section } = {}) {
  const and = [];
  if (department) and.push({ $or: [{ departments: { $size: 0 } }, { departments: department }] });
  if (year != null) and.push({ $or: [{ years: { $size: 0 } }, { years: Number(year) }] });
  if (section) and.push({ $or: [{ sections: { $size: 0 } }, { sections: upper(section) }] });
  return and.length ? { $and: and } : {};
}

/** Two exam scopes share at least one class: on every axis one is "All" or they intersect. */
export function scopesOverlap(a, b) {
  const axis = (x = [], y = []) => !x.length || !y.length || x.some((v) => y.map(String).includes(String(v)));
  return axis(a.departments, b.departments) && axis(a.years, b.years) && axis((a.sections || []).map(upper), (b.sections || []).map(upper));
}

/** "All Departments · 3rd Year · Sections A, B" */
export function scopeLabel(e) {
  const yr = (y) => ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' })[y] || `${y}th`;
  const deps = e.departments?.length ? e.departments.join(', ') : 'All Departments';
  const years = e.years?.length ? `${[...e.years].sort().map(yr).join(', ')} Year` : 'All Years';
  const secs = e.sections?.length ? `Section${e.sections.length > 1 ? 's' : ''} ${e.sections.join(', ')}` : 'All Sections';
  return `${deps} · ${years} · ${secs}`;
}

/** The short form attendance screens carry for an exam. */
export const examBrief = (e) =>
  e && {
    _id: e._id,
    subjectCode: e.subjectCode,
    subjectName: e.subjectName,
    date: dayKey(new Date(e.date)),
    startTime: e.startTime,
    endTime: e.endTime,
    scope: scopeLabel(e),
  };

/** The 12-hour form of an HH:mm campus time, for messages. */
export function to12h(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const examBlockMessage = (e) =>
  `Regular attendance is blocked for this period: the ${e.subjectCode} – ${e.subjectName} exam is scheduled ${to12h(e.startTime)}–${to12h(e.endTime)} for this class.`;

/** Published exams on `day` whose scope covers the class. */
export function publishedExamsFor(cls, day, { session } = {}) {
  return Exam.find({ date: day, status: 'published', ...classExamClause(cls) })
    .sort({ startTime: 1 })
    .session(session || null)
    .lean();
}

/**
 * The class's regular (non-break) timetable periods on `day`, in time order.
 * A class is department + year + section + semester; the semester is only
 * applied when known.
 */
export function classDaySlots(cls, day) {
  return TimetableSlot.find({
    isActive: true,
    isBreak: { $ne: true },
    department: cls.department,
    section: upper(cls.section),
    year: cls.year,
    ...(cls.semester != null ? { semester: cls.semester } : {}),
    dayOfWeek: weekdayOf(day),
  })
    .sort({ startTime: 1 })
    .populate('subject', 'name code')
    .lean();
}

/**
 * The exam plan of one class on one day: for every published exam covering
 * the class, the regular periods it blocks (time overlap with the actual
 * timetable) and its first post-exam period — the first regular period that
 * starts at or after the exam ends and is not itself blocked by an exam. An
 * exam with no blocked period, or no later period that day, has no trigger.
 */
export async function examPlan(cls, day) {
  const exams = await publishedExamsFor(cls, day);
  if (!exams.length) return [];
  const slots = await classDaySlots(cls, day);
  const blockedBy = (slot) => exams.find((e) => timesOverlap(e, slot));
  return exams.map((exam) => {
    const blocked = slots.filter((s) => timesOverlap(exam, s));
    const post = slots.find((s) => s.startTime >= exam.endTime && !blockedBy(s)) || null;
    return { exam, blocked, post: blocked.length ? post : null };
  });
}

/** The published exam blocking a period window of the class on `day`, or null. */
export async function blockingExam(cls, day, window) {
  if (!window?.startTime || !window?.endTime) return null;
  const exams = await publishedExamsFor(cls, day);
  return exams.find((e) => timesOverlap(e, window)) || null;
}

/** The class a timetable slot / session snapshot belongs to. */
export const classOfSlot = (s) => s && { department: s.department, year: s.year, section: s.section, semester: s.semester };
