import Holiday from '../models/Holiday.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToRoles } from '../config/socket.js';
import { addDays, dayKey, toDay } from '../utils/dates.js';
import { ACADEMIC_YEARS, DEPARTMENTS, HOLIDAY_MANAGE_ROLES, HOLIDAY_MAX_DAYS, SECTIONS, TIMETABLE_VIEW_ROLES } from '../constants.js';
import { ALL, assertNoOverlap, rangeFilter, scopeLabel, toApi, viewerClause } from '../services/holidays.js';

const DAY_MS = 86400000;

// Only an id and an action go out; every client re-reads through the API,
// which applies its own visibility rules. Warden/Security/Alumni never get it.
const broadcastHoliday = (id, action) => emitToRoles(TIMETABLE_VIEW_ROLES, 'holiday:changed', { id: String(id), action });

/** Defence in depth: the routes already authorize, the controller re-checks. */
function assertPrincipal(user) {
  if (!HOLIDAY_MANAGE_ROLES.includes(user.role)) throw new ApiError(403, 'Only the Principal can manage holidays');
}

/**
 * Normalise a create / edit body into a Holiday document's fields. Every
 * value is checked against the project's own academic structure; "ALL" (or
 * an empty value) becomes null, meaning "every".
 */
function holidayFields(body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 3 || reason.length > 200) throw new ApiError(422, 'Reason must be 3–200 characters');

  const type = String(body.type || '').toUpperCase();
  if (!['SINGLE', 'CUSTOM'].includes(type)) throw new ApiError(422, 'Choose Single Day or Custom');

  const startDate = toDay(body.startDate);
  const endDate = type === 'SINGLE' ? startDate : toDay(body.endDate);
  if (endDate < startDate) throw new ApiError(422, 'The "To" date cannot be before the "From" date');
  if ((endDate - startDate) / DAY_MS + 1 > HOLIDAY_MAX_DAYS) throw new ApiError(422, `A holiday can cover at most ${HOLIDAY_MAX_DAYS} days`);

  const isAll = (v) => v == null || v === '' || String(v).toUpperCase() === ALL;
  const department = isAll(body.department) ? null : String(body.department).trim();
  if (department && !DEPARTMENTS.includes(department)) throw new ApiError(422, 'Choose a valid department');
  const year = isAll(body.year) ? null : Number(body.year);
  if (year != null && !ACADEMIC_YEARS.includes(year)) throw new ApiError(422, 'Year must be 1–4 or ALL');
  const section = isAll(body.section) ? null : String(body.section).trim().toUpperCase();
  if (section && !SECTIONS.includes(section)) throw new ApiError(422, `Section must be one of ${SECTIONS.join(', ')} or ALL`);
  if (year != null && !department) throw new ApiError(422, 'Choose a department before choosing a year');
  if (section && year == null) throw new ApiError(422, 'Choose a year before choosing a section');

  return { reason, type, startDate, endDate, department, year, section };
}

const summary = (h) => `${h.reason} · ${dayKey(h.startDate)}${h.type === 'CUSTOM' ? `→${dayKey(h.endDate)}` : ''} · ${scopeLabel(h)}`;

// ── Reads ──────────────────────────────────────────────────────────

/**
 * Active holidays touching an optional from…to window, limited to what the
 * viewer may see (a student: only their own class's). Used by the calendar,
 * the Attendance "Holidays" panel and the mobile app.
 */
export const listHolidays = asyncHandler(async (req, res) => {
  const from = req.query.from ? toDay(req.query.from) : null;
  const to = req.query.to ? toDay(req.query.to) : null;
  if (from && to && from > to) throw new ApiError(422, '"From" must be before "to"');
  const filter = from || to ? rangeFilter(from || new Date(0), to || addDays(from, 3660)) : { status: 'ACTIVE' };
  const holidays = await Holiday.find({ ...filter, ...viewerClause(req.user) })
    .populate('createdBy', 'name')
    .sort({ startDate: 1 })
    .limit(500)
    .lean();
  res.json({
    holidays: holidays.map(toApi),
    canManage: HOLIDAY_MANAGE_ROLES.includes(req.user.role),
  });
});

/** The form's dropdowns, from the project's own academic structure. */
export const holidayOptions = asyncHandler(async (_req, res) => {
  res.json({ departments: DEPARTMENTS, years: ACADEMIC_YEARS, sections: SECTIONS, maxDays: HOLIDAY_MAX_DAYS });
});

// ── Writes (Principal only) ────────────────────────────────────────

export const createHoliday = asyncHandler(async (req, res) => {
  assertPrincipal(req.user);
  const fields = holidayFields(req.body);
  await assertNoOverlap(fields);
  const holiday = await Holiday.create({ ...fields, createdBy: req.user._id });
  logActivity(req, 'holiday.create', { entityType: 'holiday', entityId: holiday._id, summary: summary(holiday) });
  broadcastHoliday(holiday._id, 'created');
  res.status(201).json(toApi(holiday.toObject()));
});

/**
 * Edit any part of a holiday. Attendance already recorded is never touched —
 * the new dates / scope only change which days are blocked from now on.
 */
export const updateHoliday = asyncHandler(async (req, res) => {
  assertPrincipal(req.user);
  const holiday = await Holiday.findById(req.params.id);
  if (!holiday || holiday.status !== 'ACTIVE') throw new ApiError(404, 'Holiday not found');
  const before = summary(holiday);
  const fields = holidayFields(req.body);
  await assertNoOverlap(fields, holiday._id);
  Object.assign(holiday, fields, { updatedBy: req.user._id });
  await holiday.save();
  logActivity(req, 'holiday.update', { entityType: 'holiday', entityId: holiday._id, summary: `${before} ⇒ ${summary(holiday)}` });
  broadcastHoliday(holiday._id, 'updated');
  res.json(toApi(holiday.toObject()));
});

/**
 * Delete = cancel (soft delete, kept for the audit trail). The normal
 * timetable and attendance rules apply again for those dates at once; no
 * attendance record is created or deleted.
 */
export const cancelHoliday = asyncHandler(async (req, res) => {
  assertPrincipal(req.user);
  const holiday = await Holiday.findOneAndUpdate(
    { _id: req.params.id, status: 'ACTIVE' },
    { $set: { status: 'CANCELLED', cancelledBy: req.user._id, cancelledAt: new Date() } },
    { new: true }
  );
  if (!holiday) throw new ApiError(404, 'Holiday not found');
  logActivity(req, 'holiday.cancel', { entityType: 'holiday', entityId: holiday._id, summary: summary(holiday) });
  broadcastHoliday(holiday._id, 'deleted');
  res.json({ message: 'Holiday deleted — normal timetable and attendance rules restored', holiday: toApi(holiday.toObject()) });
});
