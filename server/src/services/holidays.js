/**
 * College holidays — the single place that decides whether a holiday applies
 * to a class on a date. Attendance marking, the timetable, attendance reports
 * and the calendar all ask this module, so they can never disagree.
 *
 * A holiday is one record covering startDate…endDate (inclusive, class-day
 * values). It applies to a class (department + year + section) on a day when
 * it is ACTIVE, the day falls inside its range, and each of its scope fields
 * is either null ("all") or equal to the class's own value.
 *
 * Overlap rule (deterministic): two ACTIVE holidays may not share a date when
 * their scopes overlap — one scope containing the other, or both naming the
 * same class. Such a request is refused (409) and the Principal edits or
 * cancels the existing holiday instead. Disjoint scopes (CSE vs ECE, or CSE-3-A
 * vs CSE-3-B) may share dates. Because of this, at most one holiday ever
 * applies to a given class on a given day; the lookup still prefers the most
 * specific match as a defensive tie-break.
 */
import Holiday from '../models/Holiday.js';
import { ApiError } from '../utils/http.js';
import { addDays, campusParts, dayKey, toDay } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { STUDENT_ROLES } from '../utils/academicScope.js';

export const ALL = 'ALL';
const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const specificity = (h) => (h.department ? 1 : 0) + (h.year != null ? 1 : 0) + (h.section ? 1 : 0);

/** "Entire college", "CSE", "CSE → Year 3", "CSE → Year 3 → Section A". */
export function scopeLabel(h) {
  if (!h.department) return 'Entire college';
  const parts = [h.department];
  if (h.year != null) parts.push(`Year ${h.year}`);
  if (h.section) parts.push(`Section ${h.section}`);
  return parts.join(' → ');
}

/** The API shape: dates as YYYY-MM-DD, "ALL" for an unrestricted scope field. */
export function toApi(h) {
  if (!h) return null;
  return {
    _id: h._id,
    reason: h.reason,
    type: h.type,
    startDate: dayKey(new Date(h.startDate)),
    endDate: dayKey(new Date(h.endDate)),
    department: h.department || ALL,
    year: h.year ?? ALL,
    section: h.section || ALL,
    scope: scopeLabel(h),
    entireCollege: !h.department,
    status: h.status,
    createdBy: h.createdBy && typeof h.createdBy === 'object' && h.createdBy.name ? { _id: h.createdBy._id, name: h.createdBy.name } : h.createdBy,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

/** Active holidays whose range touches from…to (class-day values, inclusive). */
export const rangeFilter = (from, to) => ({ status: 'ACTIVE', startDate: { $lte: to }, endDate: { $gte: from } });

/**
 * Mongo clauses matching the holidays that apply to a class. A class field
 * that is unknown (undefined / null) is not constrained, so a holiday for any
 * value of it still matches — the conservative choice for attendance: when a
 * subject is taught without a section, a section-specific holiday still
 * blocks marking it.
 */
export function classClause({ department, year, section } = {}) {
  const clause = {};
  if (department) clause.department = { $in: [null, department] };
  if (year != null) clause.year = { $in: [null, Number(year)] };
  if (section) clause.section = { $in: [null, String(section).toUpperCase()] };
  return clause;
}

/** In-memory twin of classClause + the date range, for already-loaded holidays. */
export function appliesTo(h, { department, year, section } = {}, day) {
  if (h.status !== 'ACTIVE') return false;
  if (day) {
    const t = day.getTime();
    if (new Date(h.startDate).getTime() > t || new Date(h.endDate).getTime() < t) return false;
  }
  if (department && h.department && h.department !== department) return false;
  if (year != null && h.year != null && Number(h.year) !== Number(year)) return false;
  if (section && h.section && h.section !== String(section).toUpperCase()) return false;
  return true;
}

/** Does `h` cover every class of `scope` (not just some of them)? */
export function coversScope(h, scope = {}) {
  if (h.department && h.department !== scope.department) return false;
  if (h.year != null && Number(h.year) !== Number(scope.year)) return false;
  if (h.section && h.section !== (scope.section ? String(scope.section).toUpperCase() : undefined)) return false;
  return true;
}

const mostSpecific = (list) =>
  [...list].sort((a, b) => specificity(b) - specificity(a) || new Date(a.createdAt) - new Date(b.createdAt))[0] || null;

/** The active holiday covering this class on `day`, or null. */
export async function findHoliday(cls, day) {
  const list = await Holiday.find({ ...rangeFilter(day, day), ...classClause(cls) }).lean();
  return mostSpecific(list);
}

export const holidayMessage = (h) => `HOLIDAY — ${h.reason}. Attendance cannot be taken for this class on this date.`;

/**
 * Refuse any attendance write for a class on a holiday. Called before a
 * session or a single record is created, so nothing at all is written: no
 * session, no present/absent marks, no absentees.
 */
export async function assertNotHoliday(cls, day) {
  const h = await findHoliday(cls, day);
  if (h) throw new ApiError(409, holidayMessage(h), undefined, { holiday: toApi(h) });
}

/** Active holidays touching from…to that apply to (part of) a class or scope. */
export function holidaysBetween(from, to, cls = {}) {
  return Holiday.find({ ...rangeFilter(from, to), ...classClause(cls) })
    .sort({ startDate: 1 })
    .lean();
}

/**
 * Holidays relevant to an attendance report scope over from…to, each flagged
 * with whether it covers the WHOLE scope (`full`) or only part of it (e.g. a
 * Section A holiday inside a department-wide report).
 */
export async function reportHolidays(scope, from, to) {
  const list = await holidaysBetween(from, to, scope);
  return list.map((h) => ({ ...toApi(h), full: coversScope(h, scope) }));
}

/** The holiday (if any) that makes a report's single date not applicable to its whole scope. */
export function fullHolidayOn(holidays, day) {
  const key = dayKey(day);
  return holidays.find((h) => h.full && h.startDate <= key && h.endDate >= key) || null;
}

// ── Timetable week ─────────────────────────────────────────────────

/**
 * The class days of the current campus week, Monday…Saturday. On a Sunday the
 * coming week is shown, matching the timetable, which has no Sunday.
 */
export function currentWeek(now = clock.now()) {
  const day = toDay(now);
  const weekday = campusParts(now).weekday;
  const offset = weekday === 'sunday' ? 1 : -WEEK.indexOf(weekday);
  const monday = addDays(day, offset);
  return Object.fromEntries(WEEK.map((d, i) => [d, addDays(monday, i)]));
}

/**
 * Annotate timetable slots with this week's date of their weekday and the
 * holiday (if any) that cancels that meeting. The slots themselves are never
 * modified in the database — the normal schedule comes back by itself once
 * the holiday has passed or is cancelled.
 */
export async function annotateWeek(slots) {
  const week = currentWeek();
  const days = Object.values(week);
  const holidays = slots.length ? await Holiday.find(rangeFilter(days[0], days[days.length - 1])).lean() : [];
  for (const slot of slots) {
    const day = week[slot.dayOfWeek];
    slot.date = day ? dayKey(day) : null;
    const match = day ? mostSpecific(holidays.filter((h) => appliesTo(h, slot, day))) : null;
    slot.holiday = match ? toApi(match) : null;
  }
  return Object.fromEntries(Object.entries(week).map(([d, day]) => [d, dayKey(day)]));
}

// ── Who sees which holidays ────────────────────────────────────────

/**
 * The holidays a viewer may list: a student only those that apply to their own
 * class; an HOD the college-wide ones and their own department's; faculty and
 * the college-wide roles every holiday (faculty teach across departments, and
 * a holiday's reason and scope are not sensitive).
 */
export function viewerClause(user) {
  if (STUDENT_ROLES.includes(user.role)) {
    return classClause({ department: user.department || '__none__', year: user.year, section: user.section });
  }
  if (user.role === 'hod') return { department: { $in: [null, user.department || '__none__'] } };
  return {};
}

// ── Overlaps ───────────────────────────────────────────────────────

/** Two scopes overlap when, field by field, either side is "all" or both are equal. */
export const scopesOverlap = (a, b) =>
  ['department', 'year', 'section'].every((k) => a[k] == null || b[k] == null || String(a[k]) === String(b[k]));

/** Refuse a holiday that would contradict an existing active one (see the rule above). */
export async function assertNoOverlap(candidate, excludeId) {
  const filter = rangeFilter(candidate.startDate, candidate.endDate);
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = (await Holiday.find(filter).sort({ startDate: 1 }).lean()).find((h) => scopesOverlap(h, candidate));
  if (clash) {
    const when = clash.type === 'SINGLE' ? dayKey(clash.startDate) : `${dayKey(clash.startDate)} to ${dayKey(clash.endDate)}`;
    throw new ApiError(
      409,
      `This overlaps the existing holiday “${clash.reason}” (${when}, ${scopeLabel(clash)}). Edit or delete that holiday first.`,
      undefined,
      { conflict: toApi(clash) }
    );
  }
}
