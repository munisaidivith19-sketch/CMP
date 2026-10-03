import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToRoles } from '../config/socket.js';
import { campusParts } from '../utils/dates.js';
import { COLLEGE_WIDE_ROLES, TIMETABLE_VIEW_ROLES, yearOfSemester } from '../constants.js';
import { STUDENT_ROLES, classInChargeFilter, facultyClassInChargeScope, ownDepartment } from '../utils/academicScope.js';

// Warden/Security must never receive a timetable event, even a bare
// department/section identifier — emit only to the roles that can see timetables.
const broadcastTimetable = (payload) => emitToRoles(TIMETABLE_VIEW_ROLES, 'timetable:updated', payload);

/** HOD writes are confined to their own department — never trust the client. */
function assertOwnDepartment(user, department) {
  if (user.role === 'hod' && department !== user.department) {
    throw new ApiError(403, 'You can only manage your own department’s timetable');
  }
}

/**
 * The Mongo filter a role's timetable *reads* are confined to. The academic
 * scope is derived from the authenticated account and its teaching
 * assignments; a client may only narrow it (semester, and for an HOD year /
 * section), never widen it.
 *
 * - Student: their own class, from the account.
 * - Faculty, `scope=handling` (default): their own periods only. Department,
 *   year and section come from their teaching assignments, so a sent
 *   department/year/section/faculty is ignored outright rather than trusted.
 * - Faculty, `scope=class`: the COMPLETE timetable of their Class In-Charge
 *   class (every subject and faculty), from facultyClassInChargeScope — the
 *   exact department + year + section + semester on their account. Not
 *   filtered by faculty. No in-charge class → nothing.
 * - HOD: their own department, optionally narrowed to a year/section/faculty.
 *   `view=mine` narrows it further to the HOD's own teaching periods.
 * - Admin, Principal, Chairman, Dean, AO (COLLEGE_WIDE_ROLES): any class in
 *   any department; `view=mine` narrows to their own periods.
 * - Anything else (Security, Warden): no timetable scope at all.
 */
async function timetableReadScope(user, query = {}) {
  const filter = { isActive: true };
  const semester = query.semester ? Number(query.semester) : undefined;

  if (STUDENT_ROLES.includes(user.role)) {
    // Class identity comes only from the account, never from the query string.
    if (!user.section || !user.department || !user.year) return null;
    filter.section = user.section;
    filter.department = user.department;
    filter.year = user.year;
    if (user.semester) filter.semester = user.semester;
    return filter;
  }

  if (user.role === 'faculty') {
    if (query.scope === 'class') {
      const ourClass = await facultyClassInChargeScope(user);
      if (!ourClass.length) return { _id: null };
      // The class decides department/year/section/semester; a sent semester
      // can only narrow it, and one that differs simply matches nothing.
      Object.assign(filter, classInChargeFilter(ourClass));
      if (semester && !ourClass.some((c) => c.semester === semester)) return { _id: null };
      return filter;
    }
    filter.faculty = user._id;
    if (semester) filter.semester = semester;
    return filter;
  }

  if (user.role === 'hod') {
    filter.department = ownDepartment(user);
    if (query.view === 'mine') filter.faculty = user._id;
    else if (query.faculty) filter.faculty = query.faculty;
    if (query.section) filter.section = String(query.section).toUpperCase();
    if (query.year) filter.year = Number(query.year);
    if (semester) filter.semester = semester;
    return filter;
  }

  if (!COLLEGE_WIDE_ROLES.includes(user.role)) return { _id: null };

  // College-wide authorities: a free lookup across every department.
  if (query.view === 'mine') filter.faculty = user._id;
  else if (query.faculty) filter.faculty = query.faculty;
  if (query.section) filter.section = String(query.section).toUpperCase();
  if (query.department) filter.department = String(query.department);
  if (query.year) filter.year = Number(query.year);
  if (semester) filter.semester = semester;
  return filter;
}

const SLOT_FIELDS = [
  'subject', 'faculty', 'section', 'department', 'room',
  'dayOfWeek', 'period', 'startTime', 'endTime',
  'semester', 'year', 'academicYear', 'isBreak', 'breakLabel',
];
const SUBJECT_FIELDS = ['name', 'code', 'department', 'semester', 'year', 'credits', 'type', 'faculty', 'sections'];
const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const populateSlot = (q) => q.populate('subject', 'name code type credits').populate('faculty', 'name email avatar designation');
const sortSlots = (slots) =>
  slots.sort((a, b) => (DAY_ORDER[a.dayOfWeek] || 9) - (DAY_ORDER[b.dayOfWeek] || 9) || a.period - b.period);

// ── Subjects CRUD ──────────────────────────────────────────────────

export const listSubjects = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.department) filter.department = String(req.query.department);
  if (req.query.semester) filter.semester = Number(req.query.semester);
  if (req.query.faculty) filter.faculty = req.query.faculty;
  // Faculty picking a class to mark: only subjects they teach.
  if (req.query.mine === 'true') filter.faculty = req.user._id;
  // Scope the catalogue to the account, after the query filters so a sent
  // department or faculty id can only narrow the result, never widen it. A
  // faculty member's own subjects are the ones they are listed on plus the
  // ones the timetable actually schedules them for (the authoritative source).
  if (req.user.role === 'faculty') {
    const scheduled = await TimetableSlot.find({ faculty: req.user._id, isActive: true, isBreak: { $ne: true } }).distinct('subject');
    filter.$and = [{ $or: [{ faculty: req.user._id }, { _id: { $in: scheduled } }] }];
  } else if (req.user.role === 'hod') {
    filter.department = ownDepartment(req.user);
  } else if (!COLLEGE_WIDE_ROLES.includes(req.user.role)) {
    return res.json([]);
  }

  const subjects = await Subject.find(filter)
    .populate('faculty', 'name email avatar department')
    .sort('code')
    .lean();
  res.json(subjects);
});

async function assertFaculty(ids = []) {
  if (!ids.length) return;
  const n = await User.countDocuments({ _id: { $in: ids }, role: { $in: ['faculty', 'hod', 'admin'] }, isActive: true });
  if (n !== new Set(ids.map(String)).size) throw new ApiError(422, 'Every assigned faculty member must be an active faculty account');
}

const normaliseSections = (sections) =>
  Array.isArray(sections) ? [...new Set(sections.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : sections;

export const createSubject = asyncHandler(async (req, res) => {
  const data = pick(req.body, SUBJECT_FIELDS);
  // HOD's subjects always belong to their own department, regardless of what was submitted.
  if (req.user.role === 'hod') data.department = req.user.department;
  data.sections = normaliseSections(data.sections);
  await assertFaculty(data.faculty);
  const dup = await Subject.exists({ code: String(data.code).toUpperCase(), department: data.department, semester: data.semester, isActive: true });
  if (dup) throw new ApiError(409, `${String(data.code).toUpperCase()} already exists for this department and semester`);
  const subject = await Subject.create(data);
  logActivity(req, 'subject.create', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  res.status(201).json(await Subject.findById(subject._id).populate('faculty', 'name email avatar department'));
});

export const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);
  if (!subject) throw new ApiError(404, 'Subject not found');
  assertOwnDepartment(req.user, subject.department);
  const data = pick(req.body, [...SUBJECT_FIELDS, 'isActive']);
  // An HOD can never move a subject into another department.
  if (req.user.role === 'hod') data.department = req.user.department;
  if (data.sections) data.sections = normaliseSections(data.sections);
  if (data.faculty) await assertFaculty(data.faculty);
  Object.assign(subject, data);
  await subject.save();
  logActivity(req, 'subject.update', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  res.json(await Subject.findById(subject._id).populate('faculty', 'name email avatar department'));
});

export const deleteSubject = asyncHandler(async (req, res) => {
  const existing = await Subject.findById(req.params.id).select('department').lean();
  if (!existing) throw new ApiError(404, 'Subject not found');
  assertOwnDepartment(req.user, existing.department);
  const subject = await Subject.findByIdAndUpdate(req.params.id, { isActive: false });
  // Its timetable slots go too, so nobody is scheduled for a retired subject.
  await TimetableSlot.updateMany({ subject: subject._id, isActive: true }, { isActive: false });
  logActivity(req, 'subject.delete', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  broadcastTimetable({ department: subject.department });
  res.json({ message: 'Subject deactivated' });
});

// ── Timetable reads ────────────────────────────────────────────────

/**
 * Timetable for the current user. Every academic-scope decision is made by
 * timetableReadScope from the authenticated account — a faculty account can
 * never reach another department, year or section by sending parameters.
 */
export const getMyTimetable = asyncHandler(async (req, res) => {
  const filter = await timetableReadScope(req.user, req.query);
  if (!filter) return res.json({ slots: [], needsSection: true });
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  const body = { slots: sortSlots(slots), needsSection: false };
  // Our Class view: say which class it is (or that there is none), so the UI
  // never has to work it out — or guess — on its own.
  if (req.user.role === 'faculty' && req.query.scope === 'class') {
    body.classInCharge = (await facultyClassInChargeScope(req.user))[0] || null;
  }
  res.json(body);
});

/**
 * "My Schedule": the classes the authenticated user personally teaches,
 * across the week, with their full academic context. Always the caller's own
 * assignments — there is no way to ask for another faculty member's.
 */
export const getMySchedule = asyncHandler(async (req, res) => {
  const filter = { faculty: req.user._id, isActive: true, isBreak: { $ne: true } };
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  const semesters = await TimetableSlot.find({ faculty: req.user._id, isActive: true, isBreak: { $ne: true } }).distinct('semester');
  res.json({ slots: sortSlots(slots), semesters: semesters.sort((a, b) => a - b) });
});

export const getSectionTimetable = asyncHandler(async (req, res) => {
  // The role's scope is applied first, then the requested section — so a
  // section outside the caller's authorization simply matches nothing.
  const scope = await timetableReadScope(req.user, req.query);
  if (!scope) return res.json([]);
  const section = String(req.params.section).toUpperCase();
  // A student's scope is their own class, and a sibling section of the same
  // year is still somebody else's timetable.
  if (STUDENT_ROLES.includes(req.user.role) && scope.section !== section) return res.json([]);
  const filter = { ...scope, section };
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  res.json(sortSlots(slots));
});

export const getFacultyTimetable = asyncHandler(async (req, res) => {
  const { user } = req;
  const self = String(req.params.id) === String(user._id);
  // Faculty (and students) may only ever read their own schedule; an HOD may
  // read one of their own department's, within that department.
  if (!self && (STUDENT_ROLES.includes(user.role) || user.role === 'faculty')) {
    throw new ApiError(403, 'You can only view your own teaching schedule');
  }
  const filter = { faculty: req.params.id, isActive: true };
  if (!self && user.role === 'hod') filter.department = ownDepartment(user);
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  res.json(sortSlots(slots));
});

/** Current and next class for the user, on the campus clock (APP_TIMEZONE). */
export const getCurrentClass = asyncHandler(async (req, res) => {
  const user = req.user;
  const { weekday, time } = campusParts(new Date());

  const filter = { dayOfWeek: weekday, isActive: true };
  if (['student', 'club_admin'].includes(user.role) && user.section && user.department && user.year) {
    filter.section = user.section;
    filter.department = user.department;
    filter.year = user.year;
    if (user.semester) filter.semester = user.semester;
  } else if (user.role === 'faculty') {
    filter.faculty = user._id;
  } else {
    return res.json({ current: null, next: null, today: [], weekday, time });
  }

  const slots = await populateSlot(TimetableSlot.find(filter)).sort({ period: 1 }).lean();
  let current = null;
  let next = null;
  for (const slot of slots) {
    if (slot.startTime <= time && slot.endTime > time) current = slot;
    else if (slot.startTime > time && !slot.isBreak && !next) next = slot;
  }
  res.json({ current, next, today: slots, weekday, time });
});

// ── Timetable writes (admin) ───────────────────────────────────────

const overlaps = (startTime, endTime) => ({ startTime: { $lt: endTime }, endTime: { $gt: startTime } });

/** Reject obvious clashes: same section, same faculty or same room at overlapping times. */
async function assertNoConflict(slot, excludeId) {
  const base = { isActive: true, dayOfWeek: slot.dayOfWeek, ...overlaps(slot.startTime, slot.endTime) };
  if (excludeId) base._id = { $ne: excludeId };

  const [sectionClash, facultyClash, roomClash] = await Promise.all([
    TimetableSlot.findOne({ ...base, section: slot.section, department: slot.department, year: slot.year, semester: slot.semester }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.faculty ? null : TimetableSlot.findOne({ ...base, faculty: slot.faculty, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.room ? null : TimetableSlot.findOne({ ...base, room: slot.room, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
  ]);
  const at = (c) => `${c.dayOfWeek} ${c.startTime}–${c.endTime}`;
  if (sectionClash) throw new ApiError(409, `Section ${slot.section} already has ${sectionClash.subject?.code || sectionClash.breakLabel || 'a slot'} on ${at(sectionClash)}`);
  if (facultyClash) throw new ApiError(409, `This faculty is already assigned during this time — ${facultyClash.subject?.code}, ${facultyClash.department} section ${facultyClash.section}, ${at(facultyClash)}`);
  if (roomClash) throw new ApiError(409, `Room ${slot.room} is already booked for ${roomClash.subject?.code} (section ${roomClash.section}) on ${at(roomClash)}`);
}

// Who can be scheduled to teach a period — any department, college-wide.
const TEACHING_ROLES = ['faculty', 'hod'];

async function assertSubjectFaculty(slot) {
  if (slot.isBreak) return;
  // The subject and faculty lookups are independent, so fetch them in one
  // parallel round trip rather than two sequential ones (matters on Atlas).
  const [subject, faculty] = await Promise.all([
    Subject.findOne({ _id: slot.subject, isActive: true }).lean(),
    // Cross-department teaching is allowed, and any active faculty/HOD account can
    // be scheduled for any year/section college-wide — a faculty member's declared
    // teachingYears/teachingSections (used elsewhere as a class-in-charge fallback)
    // do not restrict who can be assigned a period here.
    User.findOne({ _id: slot.faculty, role: { $in: TEACHING_ROLES }, isActive: true }).select('name').lean(),
  ]);
  if (!subject) throw new ApiError(404, 'Subject not found');
  if (subject.department !== slot.department) throw new ApiError(422, `${subject.code} belongs to ${subject.department}, not ${slot.department}`);
  if (Number(subject.semester) !== Number(slot.semester)) {
    throw new ApiError(422, `${subject.code} is a semester ${subject.semester} subject, not semester ${slot.semester}`);
  }
  if (subject.sections?.length && !subject.sections.map((s) => s.toUpperCase()).includes(slot.section)) {
    throw new ApiError(422, `${subject.code} is not taught to section ${slot.section}`);
  }
  if (!faculty) throw new ApiError(422, 'Choose an active faculty member');
}

/**
 * Attendance marking is gated on Subject.faculty, so a faculty member scheduled
 * for a period (possibly from another department) is added to that subject.
 */
async function linkFacultyToSubject(slot) {
  if (slot.isBreak || !slot.subject || !slot.faculty) return;
  await Subject.updateOne({ _id: slot.subject }, { $addToSet: { faculty: slot.faculty } });
}

/** Every active teaching account in the college, for the "Add period" picker. */
export const listFacultyOptions = asyncHandler(async (_req, res) => {
  const faculty = await User.find({ role: { $in: TEACHING_ROLES }, isActive: true })
    .select('name department')
    .sort({ name: 1 })
    .lean();
  res.json(faculty.map((f) => ({ _id: f._id, name: f.name, department: f.department || '' })));
});

export const createSlot = asyncHandler(async (req, res) => {
  const data = pick(req.body, SLOT_FIELDS);
  data.section = String(data.section).trim().toUpperCase();
  // HOD's slots always belong to their own department, regardless of what was submitted.
  if (req.user.role === 'hod') data.department = req.user.department;
  if (data.semester && data.year == null) data.year = yearOfSemester(data.semester);
  if (data.isBreak) {
    delete data.subject;
    delete data.faculty;
  }
  await assertSubjectFaculty(data);
  await assertNoConflict(data);
  const slot = await TimetableSlot.create(data);
  // The faculty→subject link write and the populated re-read don't depend on
  // each other, so run them together instead of back to back.
  const [, populated] = await Promise.all([linkFacultyToSubject(slot), populateSlot(TimetableSlot.findById(slot._id))]);
  logActivity(req, 'timetable.create', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcastTimetable({ section: slot.section, department: slot.department });
  res.status(201).json(populated);
});

export const updateSlot = asyncHandler(async (req, res) => {
  const slot = await TimetableSlot.findById(req.params.id);
  if (!slot || !slot.isActive) throw new ApiError(404, 'Timetable slot not found');
  assertOwnDepartment(req.user, slot.department);
  const data = pick(req.body, SLOT_FIELDS);
  if (data.section) data.section = String(data.section).trim().toUpperCase();
  // An HOD can never move a slot into another department.
  if (req.user.role === 'hod') data.department = req.user.department;
  if (data.semester !== undefined && data.year === undefined) data.year = yearOfSemester(data.semester);
  const before = { section: slot.section, department: slot.department };
  const AUDITED = ['subject', 'faculty', 'dayOfWeek', 'period', 'startTime', 'endTime', 'room', 'section', 'department', 'semester', 'year'];
  const prior = Object.fromEntries(AUDITED.map((k) => [k, slot[k] == null ? '' : String(slot[k])]));
  Object.assign(slot, data);
  if (slot.isBreak) {
    slot.subject = undefined;
    slot.faculty = undefined;
  }
  await assertSubjectFaculty(slot);
  await assertNoConflict(slot, slot._id);
  await slot.save();
  const linked = linkFacultyToSubject(slot);
  // Past attendance keeps its own session snapshot; only future sessions pick this up.
  const diff = AUDITED.filter((k) => prior[k] !== (slot[k] == null ? '' : String(slot[k]))).map((k) => `${k}: ${prior[k] || '—'}→${slot[k] ?? '—'}`);
  logActivity(req, 'timetable.changed', {
    entityType: 'timetable',
    entityId: slot._id,
    summary: `[${req.user.role}] ${slot.department}-${slot.section} ${slot.dayOfWeek} P${slot.period}${diff.length ? ` · ${diff.join('; ')}` : ' · no changes'}`,
  });
  broadcastTimetable(before);
  if (before.section !== slot.section) broadcastTimetable({ section: slot.section, department: slot.department });
  const [, populated] = await Promise.all([linked, populateSlot(TimetableSlot.findById(slot._id))]);
  res.json(populated);
});

export const deleteSlot = asyncHandler(async (req, res) => {
  const existing = await TimetableSlot.findOne({ _id: req.params.id, isActive: true }).select('department').lean();
  if (!existing) throw new ApiError(404, 'Timetable slot not found');
  assertOwnDepartment(req.user, existing.department);
  const slot = await TimetableSlot.findOneAndUpdate({ _id: req.params.id, isActive: true }, { isActive: false });
  logActivity(req, 'timetable.delete', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcastTimetable({ section: slot.section, department: slot.department });
  res.json({ message: 'Slot removed' });
});
