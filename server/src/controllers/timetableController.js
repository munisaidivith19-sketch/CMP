import Subject from '../models/Subject.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { broadcast } from '../config/socket.js';
import { campusParts } from '../utils/dates.js';

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

  const subjects = await Subject.find(filter)
    .populate('faculty', 'name email avatar department')
    .sort('code')
    .lean();
  res.json(subjects);
});

async function assertFaculty(ids = []) {
  if (!ids.length) return;
  const n = await User.countDocuments({ _id: { $in: ids }, role: { $in: ['faculty', 'admin'] }, isActive: true });
  if (n !== new Set(ids.map(String)).size) throw new ApiError(422, 'Every assigned faculty member must be an active faculty account');
}

const normaliseSections = (sections) =>
  Array.isArray(sections) ? [...new Set(sections.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : sections;

export const createSubject = asyncHandler(async (req, res) => {
  const data = pick(req.body, SUBJECT_FIELDS);
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
  const data = pick(req.body, [...SUBJECT_FIELDS, 'isActive']);
  if (data.sections) data.sections = normaliseSections(data.sections);
  if (data.faculty) await assertFaculty(data.faculty);
  Object.assign(subject, data);
  await subject.save();
  logActivity(req, 'subject.update', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  res.json(await Subject.findById(subject._id).populate('faculty', 'name email avatar department'));
});

export const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByIdAndUpdate(req.params.id, { isActive: false });
  if (!subject) throw new ApiError(404, 'Subject not found');
  // Its timetable slots go too, so nobody is scheduled for a retired subject.
  await TimetableSlot.updateMany({ subject: subject._id, isActive: true }, { isActive: false });
  logActivity(req, 'subject.delete', { entityType: 'subject', entityId: subject._id, summary: subject.code });
  broadcast('timetable:updated', { department: subject.department });
  res.json({ message: 'Subject deactivated' });
});

// ── Timetable reads ────────────────────────────────────────────────

/** Timetable for the current user: student → their section, faculty → their classes. */
export const getMyTimetable = asyncHandler(async (req, res) => {
  const user = req.user;
  const filter = { isActive: true };

  if (['student', 'club_admin'].includes(user.role)) {
    if (!user.section || !user.department) {
      return res.json({ slots: [], needsSection: true });
    }
    filter.section = user.section;
    filter.department = user.department;
    if (user.semester) filter.semester = user.semester;
  } else {
    if (user.role === 'faculty' && !req.query.section) filter.faculty = user._id;
    // Staff can look up any class's timetable.
    if (req.query.section) filter.section = String(req.query.section).toUpperCase();
    if (req.query.department) filter.department = String(req.query.department);
    if (req.query.semester) filter.semester = Number(req.query.semester);
    if (req.query.faculty) filter.faculty = req.query.faculty;
  }

  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  res.json({ slots: sortSlots(slots), needsSection: false });
});

export const getSectionTimetable = asyncHandler(async (req, res) => {
  const filter = { section: String(req.params.section).toUpperCase(), isActive: true };
  if (req.query.department) filter.department = String(req.query.department);
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  res.json(sortSlots(slots));
});

export const getFacultyTimetable = asyncHandler(async (req, res) => {
  const filter = { faculty: req.params.id, isActive: true };
  if (req.query.semester) filter.semester = Number(req.query.semester);
  const slots = await populateSlot(TimetableSlot.find(filter)).lean();
  res.json(sortSlots(slots));
});

/** Current and next class for the user, on the campus clock (APP_TIMEZONE). */
export const getCurrentClass = asyncHandler(async (req, res) => {
  const user = req.user;
  const { weekday, time } = campusParts(new Date());

  const filter = { dayOfWeek: weekday, isActive: true };
  if (['student', 'club_admin'].includes(user.role) && user.section && user.department) {
    filter.section = user.section;
    filter.department = user.department;
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
    TimetableSlot.findOne({ ...base, section: slot.section, department: slot.department, semester: slot.semester }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.faculty ? null : TimetableSlot.findOne({ ...base, faculty: slot.faculty, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
    slot.isBreak || !slot.room ? null : TimetableSlot.findOne({ ...base, room: slot.room, isBreak: { $ne: true } }).populate('subject', 'code').lean(),
  ]);
  const at = (c) => `${c.dayOfWeek} ${c.startTime}–${c.endTime}`;
  if (sectionClash) throw new ApiError(409, `Section ${slot.section} already has ${sectionClash.subject?.code || sectionClash.breakLabel || 'a slot'} on ${at(sectionClash)}`);
  if (facultyClash) throw new ApiError(409, `This faculty member already teaches ${facultyClash.subject?.code} (section ${facultyClash.section}) on ${at(facultyClash)}`);
  if (roomClash) throw new ApiError(409, `Room ${slot.room} is already booked for ${roomClash.subject?.code} (section ${roomClash.section}) on ${at(roomClash)}`);
}

async function assertSubjectFaculty(slot) {
  if (slot.isBreak) return;
  const subject = await Subject.findOne({ _id: slot.subject, isActive: true }).lean();
  if (!subject) throw new ApiError(404, 'Subject not found');
  if (subject.department !== slot.department) throw new ApiError(422, `${subject.code} belongs to ${subject.department}, not ${slot.department}`);
  if (subject.sections?.length && !subject.sections.map((s) => s.toUpperCase()).includes(slot.section)) {
    throw new ApiError(422, `${subject.code} is not taught to section ${slot.section}`);
  }
  if (!subject.faculty?.some((f) => String(f) === String(slot.faculty))) {
    throw new ApiError(422, `The selected faculty member is not assigned to ${subject.code}`);
  }
}

export const createSlot = asyncHandler(async (req, res) => {
  const data = pick(req.body, SLOT_FIELDS);
  data.section = String(data.section).trim().toUpperCase();
  if (data.isBreak) {
    delete data.subject;
    delete data.faculty;
  }
  await assertSubjectFaculty(data);
  await assertNoConflict(data);
  const slot = await TimetableSlot.create(data);
  logActivity(req, 'timetable.create', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcast('timetable:updated', { section: slot.section, department: slot.department });
  res.status(201).json(await populateSlot(TimetableSlot.findById(slot._id)));
});

export const updateSlot = asyncHandler(async (req, res) => {
  const slot = await TimetableSlot.findById(req.params.id);
  if (!slot || !slot.isActive) throw new ApiError(404, 'Timetable slot not found');
  const data = pick(req.body, SLOT_FIELDS);
  if (data.section) data.section = String(data.section).trim().toUpperCase();
  const before = { section: slot.section, department: slot.department };
  Object.assign(slot, data);
  if (slot.isBreak) {
    slot.subject = undefined;
    slot.faculty = undefined;
  }
  await assertSubjectFaculty(slot);
  await assertNoConflict(slot, slot._id);
  await slot.save();
  logActivity(req, 'timetable.update', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcast('timetable:updated', before);
  if (before.section !== slot.section) broadcast('timetable:updated', { section: slot.section, department: slot.department });
  res.json(await populateSlot(TimetableSlot.findById(slot._id)));
});

export const deleteSlot = asyncHandler(async (req, res) => {
  const slot = await TimetableSlot.findOneAndUpdate({ _id: req.params.id, isActive: true }, { isActive: false });
  if (!slot) throw new ApiError(404, 'Timetable slot not found');
  logActivity(req, 'timetable.delete', { entityType: 'timetable', entityId: slot._id, summary: `${slot.section} ${slot.dayOfWeek} P${slot.period}` });
  broadcast('timetable:updated', { section: slot.section, department: slot.department });
  res.json({ message: 'Slot removed' });
});
