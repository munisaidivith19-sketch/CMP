/**
 * Exam timetable — part of the Timetable dashboard.
 *
 * Managing (create / edit / publish / cancel) belongs to the HOD and the COE
 * only, and every write is checked against the exam's scope here, never just
 * by role:
 *   - Branch HOD: their own department, years 2–4 (1st year belongs to the
 *     Science & Humanities HOD, exactly as for class timetables). The
 *     department always comes from the account; a different one is refused.
 *   - Science & Humanities (1st-year) HOD: 1st year, any department.
 *   - COE: campus-wide.
 * Everyone else with timetable access reads published (and cancelled) exams
 * of the classes that concern them; drafts are visible only to the people who
 * may manage them.
 *
 * "All" selections are stored as a scope (empty list = All), never fanned out
 * into one record per class — see models/Exam.js.
 */
import Exam from '../models/Exam.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, escapeRegex } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { emitToRoles } from '../config/socket.js';
import { addDays, campusParts, dayKey, toDay } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { withTransaction } from '../utils/transaction.js';
import { ACADEMIC_OVERSIGHT_ROLES, COE_ROLE, DEPARTMENTS, EXAM_STATUSES, EXAM_VIEW_ROLES, FIRST_YEAR_HOD_DEPT, isFirstYearHod } from '../constants.js';
import { notifyUsers } from '../utils/notify.js';
import { STUDENT_ROLES, facultyClasses, ownDepartment } from '../utils/academicScope.js';
import { classExamClause, scopeLabel, scopesOverlap, timesOverlap, to12h } from '../services/exams.js';

const ALL = 'ALL';
const BRANCH_HOD_YEARS = [2, 3, 4];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const READER_STATUSES = ['published', 'cancelled'];

// ── Authority ──────────────────────────────────────────────────────

/** What a manager may target: `null` = anything on that axis. Null when the user manages nothing. */
function authority(user) {
  if (user.role === COE_ROLE) return { departments: null, years: null };
  if (user.role === 'hod') {
    if (isFirstYearHod(user)) return { departments: null, years: [1] };
    return { departments: [ownDepartment(user)], years: BRANCH_HOD_YEARS };
  }
  return null;
}

/** May `user` change an exam with this scope? Its whole scope must lie inside their authority. */
export function canManageExam(user, exam) {
  const a = authority(user);
  if (!a) return false;
  const within = (list, allowed) => !allowed || (list.length > 0 && list.every((v) => allowed.includes(v)));
  return within(exam.departments || [], a.departments) && within((exam.years || []).map(Number), a.years);
}

function assertCanManage(user, exam) {
  if (!canManageExam(user, exam)) throw new ApiError(403, 'You can only manage exams within your own scope');
}

// ── College configuration (departments / sections that actually exist) ──

async function configuredDepartments() {
  const fromTimetable = await TimetableSlot.distinct('department', { isActive: true });
  return [...new Set([...DEPARTMENTS, ...fromTimetable].filter(Boolean))].sort();
}

/**
 * The sections that actually exist for the given departments / years (empty =
 * any): those in the active class timetable plus those students are placed
 * in. Departments differ, so this is never a fixed A–D list.
 */
async function configuredSections({ departments = [], years = [] } = {}) {
  const where = {
    ...(departments.length ? { department: { $in: departments } } : {}),
    ...(years.length ? { year: { $in: years } } : {}),
  };
  const [slots, students] = await Promise.all([
    TimetableSlot.distinct('section', { isActive: true, ...where }),
    User.distinct('section', { role: { $in: STUDENT_ROLES }, isActive: true, ...where }),
  ]);
  return [...new Set([...slots, ...students].filter(Boolean).map((s) => String(s).toUpperCase()))].sort();
}

/**
 * Turn the Department / Year / Section selections ("ALL" or a value) into
 * the stored scope, confined to the user's authority. A branch HOD's
 * department is always their own; their "All Years" means years 2–4.
 */
async function resolveScope(user, { department, year, section } = {}) {
  const a = authority(user);
  if (!a) throw new ApiError(403, 'Only the HOD and the Controller of Examinations manage exams');
  const chosen = (v) => (v == null || v === '' || String(v).toUpperCase() === ALL ? null : String(v).trim());
  const dep = chosen(department);
  const yr = chosen(year);
  const sec = chosen(section);

  let departments;
  if (a.departments) {
    if (dep && dep !== a.departments[0]) throw new ApiError(403, 'You can only manage exams for your own department');
    departments = [...a.departments];
  } else {
    if (dep && !(await configuredDepartments()).includes(dep)) throw new ApiError(422, `Unknown department "${dep}"`);
    departments = dep ? [dep] : [];
  }

  let years;
  if (yr) {
    const y = Number(yr);
    if (![1, 2, 3, 4].includes(y)) throw new ApiError(422, 'Year must be 1st–4th or All Years');
    if (a.years && !a.years.includes(y)) {
      throw new ApiError(403, a.years.includes(1) ? 'You manage 1st year exams only' : '1st year exams are managed by the Science & Humanities HOD');
    }
    years = [y];
  } else {
    years = a.years ? [...a.years] : [];
  }

  const sections = sec ? [sec.toUpperCase()] : [];
  if (sections.length && !(await configuredSections({ departments, years })).includes(sections[0])) {
    throw new ApiError(422, `Section ${sections[0]} is not configured for ${scopeLabel({ departments, years, sections: [] })}`);
  }
  return { departments, years, sections };
}

// ── Validation ─────────────────────────────────────────────────────

const campusToday = () => toDay(clock.now());

function parseEntry(e = {}, label = 'Exam') {
  const subjectCode = String(e.subjectCode ?? '').trim().toUpperCase();
  const subjectName = String(e.subjectName ?? '').trim();
  if (subjectCode.length < 2 || subjectCode.length > 20) throw new ApiError(422, `${label}: subject code must be 2–20 characters`);
  if (subjectName.length < 2 || subjectName.length > 120) throw new ApiError(422, `${label}: subject name must be 2–120 characters`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) throw new ApiError(422, `${label}: choose a valid exam date`);
  const date = toDay(e.date);
  if (dayKey(date) !== e.date) throw new ApiError(422, `${label}: ${e.date} is not a real date`);
  if (!HHMM.test(String(e.startTime || '')) || !HHMM.test(String(e.endTime || ''))) throw new ApiError(422, `${label}: start and end time are required`);
  if (e.endTime <= e.startTime) throw new ApiError(422, `${label}: end time must be after start time`);
  const notes = e.notes == null ? undefined : String(e.notes).trim().slice(0, 300) || undefined;
  return { subjectCode, subjectName, date, startTime: e.startTime, endTime: e.endTime, notes };
}

function assertNotPast(date, label = 'Exam') {
  if (date < campusToday()) throw new ApiError(422, `${label}: the exam date cannot be in the past`);
}

/** Started (or over) on the campus clock: no more editing or rescheduling. */
function hasStarted(exam) {
  const today = campusToday().getTime();
  const day = new Date(exam.date).getTime();
  return day < today || (day === today && campusParts(clock.now()).time >= exam.startTime);
}

const describe = (e) => `${e.subjectCode} on ${dayKey(new Date(e.date))}, ${to12h(e.startTime)}–${to12h(e.endTime)} (${scopeLabel(e)})`;

/**
 * Refuse overlapping exams for the same student group: two non-cancelled
 * exams on the same date whose times overlap and whose scopes share a class.
 * Checked across the request itself and against the stored timetable.
 */
async function assertNoOverlap(candidates, excludeIds = []) {
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const [a, b] = [candidates[i], candidates[j]];
      if (a.date.getTime() === b.date.getTime() && timesOverlap(a, b) && scopesOverlap(a, b)) {
        throw new ApiError(409, `These exams overlap for the same students: ${describe(a)} and ${describe(b)}`);
      }
    }
  }
  const dates = [...new Set(candidates.map((c) => c.date.getTime()))].map((t) => new Date(t));
  const others = await Exam.find({ date: { $in: dates }, status: { $ne: 'cancelled' }, _id: { $nin: excludeIds } }).lean();
  for (const c of candidates) {
    const clash = others.find((o) => new Date(o.date).getTime() === c.date.getTime() && timesOverlap(o, c) && scopesOverlap(o, c));
    if (clash) {
      throw new ApiError(409, `${describe(c)} overlaps the ${clash.status} exam ${describe(clash)} for the same students`, undefined, {
        conflict: { _id: clash._id, subjectCode: clash.subjectCode, date: dayKey(new Date(clash.date)), startTime: clash.startTime, endTime: clash.endTime, status: clash.status },
      });
    }
  }
}

// ── API shape ──────────────────────────────────────────────────────

const person = (p) => (p && typeof p === 'object' && p.name ? { _id: p._id, name: p.name } : null);

function toApi(e, user) {
  const manage = canManageExam(user, e);
  return {
    _id: e._id,
    subjectCode: e.subjectCode,
    subjectName: e.subjectName,
    date: dayKey(new Date(e.date)),
    startTime: e.startTime,
    endTime: e.endTime,
    departments: e.departments || [],
    years: e.years || [],
    sections: e.sections || [],
    scope: scopeLabel(e),
    status: e.status,
    notes: e.notes || null,
    cancelReason: e.cancelReason || null,
    createdBy: person(e.createdBy),
    updatedBy: person(e.updatedBy),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    publishedAt: e.publishedAt || null,
    cancelledAt: e.cancelledAt || null,
    canEdit: manage && e.status !== 'cancelled' && !hasStarted(e),
    canPublish: manage && e.status === 'draft' && new Date(e.date) >= campusToday(),
    canCancel: manage && e.status !== 'cancelled' && new Date(e.date) >= campusToday(),
    ...(manage ? { history: (e.history || []).map((h) => ({ action: h.action, role: h.role, at: h.at, summary: h.summary, by: person(h.by) || h.by })) } : {}),
  };
}

const POPULATE = [
  { path: 'createdBy', select: 'name' },
  { path: 'updatedBy', select: 'name' },
  { path: 'history.by', select: 'name' },
];

const announce = (payload) => emitToRoles(EXAM_VIEW_ROLES, 'exam:updated', payload);

/**
 * Tell the people responsible when a published exam appears, changes or is
 * cancelled: every COE, and the HODs whose students it concerns (the
 * Science & Humanities HOD for 1st year). The one who made the change is not
 * told about their own action.
 */
async function notifyExamChange(exam, action, actor) {
  const years = (exam.years || []).map(Number);
  const deps = exam.departments || [];
  const hodFilter = [];
  if (!years.length || years.some((y) => y !== 1)) hodFilter.push(deps.length ? { department: { $in: deps } } : { department: { $ne: FIRST_YEAR_HOD_DEPT } });
  if (!years.length || years.includes(1)) hodFilter.push({ department: FIRST_YEAR_HOD_DEPT });
  const ids = await User.find({ isActive: true, $or: [{ role: COE_ROLE }, ...(hodFilter.length ? [{ role: 'hod', $or: hodFilter }] : [])] }).distinct('_id');
  const label = { published: 'Exam published', updated: 'Exam rescheduled', cancelled: 'Exam cancelled' }[action];
  return notifyUsers(ids, {
    type: 'timetable',
    title: `${label}: ${exam.subjectCode}`,
    message: `${exam.subjectName} · ${dayKey(new Date(exam.date))}, ${to12h(exam.startTime)}–${to12h(exam.endTime)} · ${scopeLabel(exam)}`,
    link: '/timetable',
  }, { category: 'exam', eventKey: `exam:${exam._id}:${action}:${new Date(exam.updatedAt || Date.now()).getTime()}`, exclude: actor._id });
}

// ── Reads ──────────────────────────────────────────────────────────

/**
 * The exam timetable this account may see, optionally narrowed by department,
 * year, section, date range, subject and (for managers) status. Narrowing
 * only ever intersects the role's scope. One query, populated in batch — no
 * per-exam lookups.
 */
export const listExams = asyncHandler(async (req, res) => {
  const user = req.user;
  const manager = Boolean(authority(user));
  const and = [];

  if (STUDENT_ROLES.includes(user.role)) {
    if (!user.department || !user.year || !user.section) return res.json({ exams: [], canManage: false, needsSection: true });
    and.push(classExamClause({ department: user.department, year: user.year, section: user.section }));
  } else if (user.role === 'faculty') {
    // The classes they teach plus their Class In-Charge class.
    const classes = await facultyClasses(user);
    if (!classes.length) return res.json({ exams: [], canManage: false });
    and.push({ $or: classes.map((c) => classExamClause(c)) });
  } else if (user.role === 'hod') {
    if (isFirstYearHod(user)) and.push({ $or: [{ years: { $size: 0 } }, { years: 1 }] });
    else {
      and.push(classExamClause({ department: ownDepartment(user) }));
      and.push({ $or: [{ years: { $size: 0 } }, { years: { $in: BRANCH_HOD_YEARS } }] });
    }
  } else if (!ACADEMIC_OVERSIGHT_ROLES.includes(user.role)) {
    throw new ApiError(403, 'You cannot view the exam timetable');
  }

  const { status } = req.query;
  if (manager) {
    if (EXAM_STATUSES.includes(status)) and.push({ status });
  } else {
    and.push({ status: READER_STATUSES.includes(status) ? status : { $in: READER_STATUSES } });
  }

  const narrow = classExamClause({
    department: req.query.department || undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
    section: req.query.section || undefined,
  });
  if (Object.keys(narrow).length) and.push(narrow);

  const from = req.query.from ? toDay(req.query.from) : addDays(campusToday(), -30);
  const to = req.query.to ? toDay(req.query.to) : undefined;
  if (to && to < from) throw new ApiError(422, '"From" must be before "to"');
  and.push({ date: { $gte: from, ...(to ? { $lte: to } : {}) } });

  if (req.query.subject) {
    const re = new RegExp(escapeRegex(String(req.query.subject).trim()), 'i');
    and.push({ $or: [{ subjectCode: re }, { subjectName: re }] });
  }

  const exams = await Exam.find({ $and: and }).sort({ date: 1, startTime: 1 }).limit(500).populate(POPULATE).lean();
  // A draft is visible only to someone who could manage it (an HOD never sees a COE draft for other departments).
  const visible = exams.filter((e) => e.status !== 'draft' || canManageExam(user, e));
  res.set('Cache-Control', 'no-store');
  res.json({ exams: visible.map((e) => toApi(e, user)), canManage: manager });
});

/**
 * The Department / Year / Section choices this account may use. Managers get
 * their authority (an HOD's department is fixed); campus-wide readers get the
 * whole college for filtering. Sections come from the real configuration of
 * the selected department / year.
 */
export const examOptions = asyncHandler(async (req, res) => {
  const user = req.user;
  const a = authority(user);
  const campusReader = ACADEMIC_OVERSIGHT_ROLES.includes(user.role);
  if (!a && !campusReader) return res.json({ canManage: false, departments: [], years: [], sections: [], fixedDepartment: null });

  const departments = a?.departments || (await configuredDepartments());
  const years = a?.years || [1, 2, 3, 4];
  const dep = a?.departments ? a.departments[0] : departments.includes(req.query.department) ? req.query.department : null;
  const yr = years.includes(Number(req.query.year)) ? Number(req.query.year) : null;
  const sections = await configuredSections({ departments: dep ? [dep] : [], years: yr ? [yr] : a?.years || [] });

  res.json({
    canManage: Boolean(a),
    role: user.role,
    fixedDepartment: a?.departments ? a.departments[0] : null,
    departments,
    years,
    sections,
  });
});

// ── Writes ─────────────────────────────────────────────────────────

/**
 * Create one or more exam entries (e.g. a week of exams) for one target
 * scope, as Draft or Published. All entries are validated (fields, dates,
 * times, overlaps) before any is stored, and stored together.
 */
export const createExams = asyncHandler(async (req, res) => {
  const user = req.user;
  const scope = await resolveScope(user, req.body);
  const status = req.body.status === 'published' ? 'published' : 'draft';
  const entries = req.body.entries.map((e, i) => parseEntry(e, req.body.entries.length > 1 ? `Entry ${i + 1}` : 'Exam'));
  entries.forEach((e, i) => assertNotPast(e.date, entries.length > 1 ? `Entry ${i + 1}` : 'Exam'));

  const now = new Date();
  const docs = entries.map((e) => ({
    ...e,
    ...scope,
    status,
    createdBy: user._id,
    updatedBy: user._id,
    ...(status === 'published' ? { publishedBy: user._id, publishedAt: now } : {}),
    history: [
      { action: 'created', by: user._id, role: user.role, at: now, summary: `Created as ${status}: ${describe({ ...e, ...scope })}` },
      ...(status === 'published' ? [{ action: 'published', by: user._id, role: user.role, at: now, summary: 'Published on creation' }] : []),
    ],
  }));
  await assertNoOverlap(docs);

  const created = await withTransaction((txn) => Exam.insertMany(docs, txn ? { session: txn } : {}));
  for (const e of created) {
    logActivity(req, `exam.${status === 'published' ? 'published' : 'created'}`, { entityType: 'exam', entityId: e._id, summary: `[${user.role}] ${describe(e)}` });
    if (status === 'published') notifyExamChange(e, 'published', user);
  }
  announce({ dates: [...new Set(created.map((e) => dayKey(e.date)))] });
  const populated = await Exam.find({ _id: { $in: created.map((e) => e._id) } }).sort({ date: 1, startTime: 1 }).populate(POPULATE).lean();
  res.status(201).json({
    message: `${created.length} exam${created.length > 1 ? 's' : ''} ${status === 'published' ? 'published' : 'saved as draft'}`,
    exams: populated.map((e) => toApi(e, user)),
  });
});

async function loadForWrite(user, id) {
  const exam = await Exam.findById(id);
  if (!exam) throw new ApiError(404, 'Exam not found');
  assertCanManage(user, exam);
  return exam;
}

const respond = async (res, exam, user) => res.json(toApi(await Exam.findById(exam._id).populate(POPULATE).lean(), user));

/**
 * Edit an exam that has not started yet: subject, date, times, notes and
 * scope. The result is re-validated in full, including overlaps; the new
 * scope must still lie inside the editor's authority.
 */
export const updateExam = asyncHandler(async (req, res) => {
  const user = req.user;
  const exam = await loadForWrite(user, req.params.id);
  if (exam.status === 'cancelled') throw new ApiError(422, 'A cancelled exam cannot be edited');
  if (hasStarted(exam)) throw new ApiError(422, 'This exam has already started — it can no longer be edited');

  const b = req.body;
  const merged = parseEntry(
    {
      subjectCode: b.subjectCode ?? exam.subjectCode,
      subjectName: b.subjectName ?? exam.subjectName,
      date: b.date ?? dayKey(exam.date),
      startTime: b.startTime ?? exam.startTime,
      endTime: b.endTime ?? exam.endTime,
      notes: b.notes !== undefined ? b.notes : exam.notes,
    },
    'Exam'
  );
  assertNotPast(merged.date);
  const one = (list) => (list.length === 1 ? list[0] : ALL);
  const scope = ['department', 'year', 'section'].some((k) => b[k] !== undefined)
    ? await resolveScope(user, {
        department: b.department !== undefined ? b.department : one(exam.departments),
        year: b.year !== undefined ? b.year : one(exam.years),
        section: b.section !== undefined ? b.section : one(exam.sections),
      })
    : { departments: exam.departments, years: exam.years, sections: exam.sections };

  const next = { ...merged, ...scope };
  await assertNoOverlap([next], [exam._id]);

  const before = describe(exam);
  Object.assign(exam, next, { updatedBy: user._id });
  const after = describe(exam);
  exam.history.push({ action: 'updated', by: user._id, role: user.role, at: new Date(), summary: before === after ? 'Details updated' : `${before} → ${after}`.slice(0, 400) });
  await exam.save();
  logActivity(req, 'exam.updated', { entityType: 'exam', entityId: exam._id, summary: `[${user.role}] ${after}` });
  if (exam.status === 'published' && before !== after) notifyExamChange(exam, 'updated', user);
  announce({ dates: [...new Set([before.match(/\d{4}-\d{2}-\d{2}/)?.[0], dayKey(exam.date)].filter(Boolean))] });
  return respond(res, exam, user);
});

/** Draft → Published. Re-checks overlaps, since the timetable may have changed meanwhile. */
export const publishExam = asyncHandler(async (req, res) => {
  const user = req.user;
  const exam = await loadForWrite(user, req.params.id);
  if (exam.status !== 'draft') throw new ApiError(422, `Only a draft can be published (this exam is ${exam.status})`);
  assertNotPast(exam.date);
  await assertNoOverlap([exam.toObject()], [exam._id]);
  const claimed = await Exam.findOneAndUpdate(
    { _id: exam._id, status: 'draft' },
    {
      $set: { status: 'published', publishedBy: user._id, publishedAt: new Date(), updatedBy: user._id },
      $push: { history: { action: 'published', by: user._id, role: user.role, at: new Date(), summary: 'Published' } },
    },
    { new: true }
  );
  if (!claimed) throw new ApiError(409, 'This exam was just changed by someone else — reload and try again');
  logActivity(req, 'exam.published', { entityType: 'exam', entityId: exam._id, summary: `[${user.role}] ${describe(claimed)}` });
  notifyExamChange(claimed, 'published', user);
  announce({ dates: [dayKey(claimed.date)] });
  return respond(res, claimed, user);
});

/**
 * Cancel a draft or published exam (up to the end of its day). Regular
 * attendance for its periods is unblocked at once, since blocking is always
 * derived from published exams. Attendance already recorded is untouched.
 */
export const cancelExam = asyncHandler(async (req, res) => {
  const user = req.user;
  const exam = await loadForWrite(user, req.params.id);
  if (exam.status === 'cancelled') throw new ApiError(422, 'This exam is already cancelled');
  if (exam.date < campusToday()) throw new ApiError(422, 'A past exam cannot be cancelled');
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : undefined;
  const claimed = await Exam.findOneAndUpdate(
    { _id: exam._id, status: exam.status },
    {
      $set: { status: 'cancelled', cancelledBy: user._id, cancelledAt: new Date(), cancelReason: reason, updatedBy: user._id },
      $push: { history: { action: 'cancelled', by: user._id, role: user.role, at: new Date(), summary: reason ? `Cancelled: ${reason}` : 'Cancelled' } },
    },
    { new: true }
  );
  if (!claimed) throw new ApiError(409, 'This exam was just changed by someone else — reload and try again');
  logActivity(req, 'exam.cancelled', { entityType: 'exam', entityId: exam._id, summary: `[${user.role}] ${describe(claimed)}${reason ? ` — ${reason}` : ''}` });
  if (exam.status === 'published') notifyExamChange(claimed, 'cancelled', user);
  announce({ dates: [dayKey(claimed.date)] });
  return respond(res, claimed, user);
});
