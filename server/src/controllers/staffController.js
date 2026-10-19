/**
 * Faculty early exits and period cover (substitutes / not conducted).
 *
 * Authority (always derived from the account, never from the request):
 *   - Branch HOD: faculty of their own department, and the classes of their
 *     department in years 2–4.
 *   - Science & Humanities HOD: their own faculty and every 1st-year class.
 *   - Principal and Admin: college-wide.
 *   - Faculty: request / cancel their OWN early exit and record their own
 *     departure — never approve, never assign.
 * Every step is audited (history on the record + the activity log).
 */
import FacultyAttendance from '../models/FacultyAttendance.js';
import FacultyEarlyExit from '../models/FacultyEarlyExit.js';
import PeriodCover from '../models/PeriodCover.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { addDays, campusParts, dayKey, toDay, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { FIRST_YEAR_HOD_DEPT, isFirstYearHod } from '../constants.js';
import { timesOverlap, to12h } from '../services/exams.js';

const TEACHING = ['faculty', 'hod'];
const COLLEGE = ['principal', 'admin'];

const today = () => toDay(clock.now());
const nowTime = () => campusParts(clock.now()).time;

// ── Authority ──────────────────────────────────────────────────────

/** May `user` manage this staff member (approve their early exit, see their periods)? */
function managesFaculty(user, faculty) {
  if (COLLEGE.includes(user.role)) return true;
  if (user.role !== 'hod' || !faculty || sameId(faculty, user)) return false;
  return Boolean(user.department) && faculty.department === user.department;
}

/** May `user` arrange cover for this class period? */
function managesSlot(user, slot, originalFaculty) {
  if (COLLEGE.includes(user.role)) return true;
  if (user.role !== 'hod') return false;
  const classInScope = isFirstYearHod(user) ? Number(slot.year) === 1 : slot.department === user.department && Number(slot.year) !== 1;
  return classInScope || (originalFaculty && originalFaculty.department === user.department);
}

/** Mongo filter for the HOD's own staff (department), or everyone for college roles. */
const staffScope = (user) => (COLLEGE.includes(user.role) ? {} : { department: user.department || '__none__' });

async function hodsOf(department) {
  const ids = await User.find({ role: 'hod', isActive: true, department }).distinct('_id');
  return ids;
}

const brief = (s) => ({
  timetableSlot: s._id,
  period: s.period,
  startTime: s.startTime,
  endTime: s.endTime,
  subjectCode: s.subject?.code,
  department: s.department,
  year: s.year,
  section: s.section,
});

/** The periods a faculty member is scheduled for on `day` from `fromTime` on. */
async function periodsFrom(facultyId, day, fromTime) {
  const slots = await TimetableSlot.find({ faculty: facultyId, dayOfWeek: weekdayOf(day), isActive: true, isBreak: { $ne: true }, startTime: { $gte: fromTime } })
    .populate('subject', 'code')
    .sort({ startTime: 1 })
    .lean();
  return slots.map(brief);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Early exit ─────────────────────────────────────────────────────

/**
 * Faculty request an emergency early exit for today; an HOD / Principal /
 * Admin may also record one on a staff member's behalf (approved at once).
 * Daily attendance is never changed by this.
 */
export const requestEarlyExit = asyncHandler(async (req, res) => {
  const user = req.user;
  const departureTime = req.body.departureTime || nowTime();
  if (!HHMM.test(departureTime)) throw new ApiError(422, 'Departure time must be HH:mm');
  const onBehalf = req.body.faculty && !sameId(req.body.faculty, user);
  const faculty = onBehalf ? await User.findById(req.body.faculty).select('name role department isActive').lean() : user;
  if (!faculty || !faculty.isActive || !TEACHING.includes(faculty.role)) throw new ApiError(404, 'Staff member not found');
  if (onBehalf && !managesFaculty(user, faculty)) throw new ApiError(403, 'You can only record early exits for your own department’s staff');
  if (!onBehalf && !TEACHING.includes(user.role)) throw new ApiError(403, 'Only teaching staff request an early exit');

  const day = today();
  const now = new Date();
  const affectedPeriods = await periodsFrom(faculty._id, day, departureTime);
  try {
    const exit = await FacultyEarlyExit.create({
      faculty: faculty._id,
      department: faculty.department,
      date: day,
      reason: req.body.reason,
      departureTime,
      requestedBy: user._id,
      requestedAt: now,
      status: onBehalf ? 'approved' : 'pending',
      ...(onBehalf ? { decidedBy: user._id, decidedAt: now, decisionNote: 'Recorded by an authorized person' } : {}),
      affectedPeriods,
      history: [{ action: onBehalf ? 'recorded_approved' : 'requested', by: user._id, role: user.role, at: now, note: req.body.reason }],
    });
    logActivity(req, onBehalf ? 'staff.early_exit_recorded' : 'staff.early_exit_requested', {
      entityType: 'early_exit', entityId: exit._id, summary: `${faculty.name} ${dayKey(day)} from ${departureTime} (${affectedPeriods.length} period(s))`,
    });
    if (onBehalf) {
      notifyUsers([faculty._id], { type: 'attendance', title: 'Early exit recorded', message: `Your early exit from ${to12h(departureTime)} today was recorded.`, link: '/attendance' }, { category: 'staff', eventKey: `early_exit:${exit._id}:recorded` });
    } else {
      const approvers = faculty.role === 'hod' ? await User.find({ role: 'principal', isActive: true }).distinct('_id') : await hodsOf(faculty.department);
      notifyUsers(approvers, {
        type: 'attendance',
        title: 'Early exit request',
        message: `${faculty.name} needs to leave from ${to12h(departureTime)} today — ${affectedPeriods.length} period(s) affected.`,
        link: '/attendance?tab=staff',
      }, { category: 'staff', eventKey: `early_exit:${exit._id}:requested`, exclude: user._id });
    }
    res.status(201).json(exit);
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'An early exit for today is already pending or approved');
    throw err;
  }
});

async function loadExit(id) {
  const exit = await FacultyEarlyExit.findById(id);
  if (!exit) throw new ApiError(404, 'Early exit not found');
  const faculty = await User.findById(exit.faculty).select('name role department').lean();
  return { exit, faculty };
}

/** Approve or reject — HOD of the department (never their own), Principal, Admin. */
export const decideEarlyExit = asyncHandler(async (req, res) => {
  const { exit, faculty } = await loadExit(req.params.id);
  if (!managesFaculty(req.user, faculty) || sameId(exit.faculty, req.user)) throw new ApiError(403, 'You cannot decide this early exit');
  const approve = req.body.action === 'approve';
  const now = new Date();
  const affectedPeriods = approve ? await periodsFrom(exit.faculty, exit.date, exit.departureTime) : exit.affectedPeriods;
  const updated = await FacultyEarlyExit.findOneAndUpdate(
    { _id: exit._id, status: 'pending' },
    {
      $set: { status: approve ? 'approved' : 'rejected', decidedBy: req.user._id, decidedAt: now, decisionNote: req.body.note, affectedPeriods },
      $push: { history: { action: approve ? 'approved' : 'rejected', by: req.user._id, role: req.user.role, at: now, note: req.body.note } },
    },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This request has already been decided');
  logActivity(req, `staff.early_exit_${approve ? 'approved' : 'rejected'}`, { entityType: 'early_exit', entityId: exit._id, summary: `${faculty?.name} ${dayKey(exit.date)}` });
  notifyUsers([exit.faculty], {
    type: 'attendance',
    title: `Early exit ${approve ? 'approved' : 'rejected'}`,
    message: approve ? `You may leave from ${to12h(exit.departureTime)}. Your remaining periods will be arranged by your HOD.` : req.body.note || 'Your early exit request was not approved.',
    link: '/attendance',
  }, { category: 'staff', eventKey: `early_exit:${exit._id}:decided` });
  if (approve && affectedPeriods.length) {
    notifyUsers(await hodsOf(faculty.department), {
      type: 'attendance',
      title: 'Periods need cover',
      message: `${faculty.name} leaves at ${to12h(exit.departureTime)} — ${affectedPeriods.length} period(s) today need a substitute.`,
      link: '/attendance?tab=staff',
    }, { category: 'staff', eventKey: `early_exit:${exit._id}:cover` });
  }
  res.json(updated);
});

/** Record the actual departure (server time) — the staff member themself or an approver. */
export const recordDeparture = asyncHandler(async (req, res) => {
  const { exit, faculty } = await loadExit(req.params.id);
  if (!sameId(exit.faculty, req.user) && !managesFaculty(req.user, faculty)) throw new ApiError(403, 'You cannot update this early exit');
  if (exit.status !== 'approved') throw new ApiError(422, 'Only an approved early exit can record a departure');
  if (exit.actualDepartureAt) throw new ApiError(409, 'The departure is already recorded');
  const now = new Date();
  exit.actualDepartureAt = now;
  exit.history.push({ action: 'departed', by: req.user._id, role: req.user.role, at: now });
  await exit.save();
  logActivity(req, 'staff.early_exit_departed', { entityType: 'early_exit', entityId: exit._id, summary: `${faculty?.name} left ${dayKey(exit.date)}` });
  res.json(exit);
});

/** The requester withdraws a pending request. */
export const cancelEarlyExit = asyncHandler(async (req, res) => {
  const { exit } = await loadExit(req.params.id);
  if (!sameId(exit.requestedBy, req.user)) throw new ApiError(403, 'Only the requester can withdraw this request');
  const updated = await FacultyEarlyExit.findOneAndUpdate(
    { _id: exit._id, status: 'pending' },
    { $set: { status: 'cancelled' }, $push: { history: { action: 'cancelled', by: req.user._id, role: req.user.role, at: new Date() } } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'Only a pending request can be withdrawn');
  res.json(updated);
});

/** Early exits this account may see: own (faculty), department (HOD), all (college roles / Office). */
export const listEarlyExits = asyncHandler(async (req, res) => {
  const user = req.user;
  const filter = {};
  if (user.role === 'faculty') filter.faculty = user._id;
  else if (user.role === 'hod') filter.$or = [{ department: user.department || '__none__' }, { faculty: user._id }];
  const from = req.query.from ? toDay(req.query.from) : req.query.date ? toDay(req.query.date) : addDays(today(), -30);
  const to = req.query.to ? toDay(req.query.to) : req.query.date ? toDay(req.query.date) : today();
  filter.date = { $gte: from, $lte: to };
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  const list = await FacultyEarlyExit.find(filter)
    .populate('faculty', 'name department employeeId')
    .populate('decidedBy', 'name')
    .sort({ date: -1, requestedAt: -1 })
    .limit(300)
    .lean();
  res.json(list);
});

// ── Period cover (substitutes) ─────────────────────────────────────

/** Faculty who could take `slot` on `day`: not teaching, not covering, not away at that time. */
async function freeFaculty(slot, day, candidates) {
  const ids = candidates.map((c) => c._id);
  const wd = weekdayOf(day);
  const [teaching, covering, away, exits] = await Promise.all([
    TimetableSlot.find({ faculty: { $in: ids }, dayOfWeek: wd, isActive: true, isBreak: { $ne: true } }).select('faculty startTime endTime').lean(),
    PeriodCover.find({ substitute: { $in: ids }, date: day, status: 'active', kind: 'substitute' }).select('substitute startTime endTime').lean(),
    FacultyAttendance.find({ faculty: { $in: ids }, date: day, status: { $in: ['absent', 'leave'] } }).distinct('faculty'),
    FacultyEarlyExit.find({ faculty: { $in: ids }, date: day, status: 'approved' }).select('faculty departureTime').lean(),
  ]);
  const awaySet = new Set(away.map(String));
  return candidates.filter((c) => {
    const id = String(c._id);
    if (sameId(c._id, slot.faculty) || awaySet.has(id)) return false;
    if (teaching.some((t) => String(t.faculty) === id && timesOverlap(t, slot))) return false;
    if (covering.some((t) => String(t.substitute) === id && timesOverlap(t, slot))) return false;
    if (exits.some((e) => String(e.faculty) === id && e.departureTime <= slot.startTime)) return false;
    return true;
  });
}

async function loadSlot(slotId) {
  const slot = await TimetableSlot.findOne({ _id: slotId, isActive: true, isBreak: { $ne: true } }).populate('subject', 'code name').lean();
  if (!slot) throw new ApiError(404, 'Timetable period not found');
  const original = await User.findById(slot.faculty).select('name department role').lean();
  return { slot, original };
}

function parseDay(value, slot) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new ApiError(422, 'Choose a valid date');
  const day = toDay(value);
  if (slot && weekdayOf(day) !== slot.dayOfWeek) throw new ApiError(422, `This period is held on ${slot.dayOfWeek}s, not on ${weekdayOf(day)}`);
  return day;
}

/**
 * The periods that need cover on a date: those of staff marked absent / on
 * leave, those after an approved early exit, and any already arranged — or,
 * with `faculty`, every period of that one staff member. Scoped to the
 * viewer's authority.
 */
export const listCover = asyncHandler(async (req, res) => {
  const user = req.user;
  const day = parseDay(req.query.date || dayKey(today()));
  const wd = weekdayOf(day);
  let reasonOf = new Map();
  let facultyIds;
  if (req.query.faculty) {
    const f = await User.findById(req.query.faculty).select('name department role').lean();
    if (!f || !managesFaculty(user, f)) throw new ApiError(403, 'You can only view your own department’s staff');
    facultyIds = [f._id];
    reasonOf.set(String(f._id), 'selected');
  } else {
    const staff = await User.find({ role: { $in: TEACHING }, isActive: true, ...staffScope(user) }).distinct('_id');
    const [absent, exits] = await Promise.all([
      FacultyAttendance.find({ faculty: { $in: staff }, date: day, status: { $in: ['absent', 'leave'] } }).select('faculty status').lean(),
      FacultyEarlyExit.find({ faculty: { $in: staff }, date: day, status: 'approved' }).select('faculty departureTime').lean(),
    ]);
    absent.forEach((a) => reasonOf.set(String(a.faculty), a.status));
    exits.forEach((e) => reasonOf.set(String(e.faculty), `early_exit:${e.departureTime}`));
    facultyIds = [...reasonOf.keys()];
  }
  const existing = await PeriodCover.find({ date: day, status: 'active' }).lean();
  const slots = await TimetableSlot.find({
    isActive: true,
    isBreak: { $ne: true },
    dayOfWeek: wd,
    $or: [{ faculty: { $in: facultyIds } }, { _id: { $in: existing.map((c) => c.timetableSlot) } }],
  })
    .populate('subject', 'code name')
    .populate('faculty', 'name department')
    .sort({ startTime: 1 })
    .lean();
  const sessions = await AttendanceSession.find({ timetableSlot: { $in: slots.map((s) => s._id) }, date: day }).populate('takenBy', 'name').lean();
  const coverBySlot = new Map(existing.map((c) => [String(c.timetableSlot), c]));
  const subIds = existing.map((c) => c.substitute).filter(Boolean);
  const subs = new Map((await User.find({ _id: { $in: subIds } }).select('name').lean()).map((u) => [String(u._id), u]));
  const sessionBySlot = new Map(sessions.map((s) => [String(s.timetableSlot), s]));

  const periods = slots
    .filter((s) => managesSlot(user, s, s.faculty))
    .filter((s) => {
      const reason = reasonOf.get(String(s.faculty?._id));
      return !reason?.startsWith('early_exit:') || s.startTime >= reason.split(':').slice(1).join(':');
    })
    .map((s) => {
      const c = coverBySlot.get(String(s._id));
      const sess = sessionBySlot.get(String(s._id));
      const reason = reasonOf.get(String(s.faculty?._id)) || null;
      return {
        slotId: s._id,
        period: s.period,
        startTime: s.startTime,
        endTime: s.endTime,
        subject: s.subject,
        department: s.department,
        year: s.year,
        section: s.section,
        room: s.room || null,
        faculty: s.faculty ? { _id: s.faculty._id, name: s.faculty.name, department: s.faculty.department } : null,
        reason: reason?.startsWith('early_exit:') ? 'early_exit' : reason,
        cover: c ? { _id: c._id, kind: c.kind, substitute: c.substitute ? { _id: c.substitute, name: subs.get(String(c.substitute))?.name } : null, reason: c.reason || null } : null,
        attendanceTakenBy: sess?.takenBy ? { _id: sess.takenBy._id, name: sess.takenBy.name } : null,
      };
    });
  res.json({ date: dayKey(day), periods });
});

/** Staff free to take a period on a date (no overlap, not away), from the relevant departments. */
export const availableSubstitutes = asyncHandler(async (req, res) => {
  const { slot, original } = await loadSlot(req.query.slotId);
  if (!managesSlot(req.user, slot, original)) throw new ApiError(403, 'You cannot arrange cover for this period');
  const day = parseDay(req.query.date, slot);
  const departments = [...new Set([slot.department, original?.department, req.user.department, Number(slot.year) === 1 ? FIRST_YEAR_HOD_DEPT : null].filter(Boolean))];
  const candidates = await User.find({ role: { $in: TEACHING }, isActive: true, department: { $in: departments } }).select('name department role employeeId').sort({ name: 1 }).lean();
  const free = await freeFaculty(slot, day, candidates);
  res.json({ date: dayKey(day), slot: { _id: slot._id, period: slot.period, startTime: slot.startTime, endTime: slot.endTime }, faculty: free });
});

/** Assign a substitute, or record the period as not conducted / pending verification. */
export const assignCover = asyncHandler(async (req, res) => {
  const user = req.user;
  const { slot, original } = await loadSlot(req.body.slotId);
  if (!managesSlot(user, slot, original)) throw new ApiError(403, 'You cannot arrange cover for this period');
  const day = parseDay(req.body.date, slot);
  const { kind } = req.body;
  if (kind === 'substitute' && day < today()) throw new ApiError(422, 'A substitute can only be assigned for today or a later date');
  if (day < addDays(today(), -7)) throw new ApiError(422, 'Only the last 7 days can be updated');

  const taken = await AttendanceSession.findOne({ timetableSlot: slot._id, date: day }).select('_id').lean();
  if (taken && (await AttendanceRecord.exists({ session: taken._id })) && kind !== 'pending_verification') {
    throw new ApiError(409, 'Attendance was already taken for this period');
  }

  let substitute = null;
  if (kind === 'substitute') {
    substitute = await User.findOne({ _id: req.body.substitute, role: { $in: TEACHING }, isActive: true }).select('name department role').lean();
    if (!substitute) throw new ApiError(422, 'Choose an active faculty member as the substitute');
    const [ok] = await freeFaculty(slot, day, [substitute]);
    if (!ok) throw new ApiError(409, `${substitute.name} is not free at ${to12h(slot.startTime)}–${to12h(slot.endTime)} on ${dayKey(day)}`);
  }

  const now = new Date();
  let cover;
  try {
    cover = await PeriodCover.create({
      date: day,
      timetableSlot: slot._id,
      period: slot.period,
      startTime: slot.startTime,
      endTime: slot.endTime,
      department: slot.department,
      year: slot.year,
      section: slot.section,
      semester: slot.semester,
      room: slot.room,
      subject: slot.subject?._id,
      subjectCode: slot.subject?.code,
      originalFaculty: slot.faculty,
      kind,
      substitute: substitute?._id,
      reason: req.body.reason,
      assignedBy: user._id,
      assignedAt: now,
      history: [{ action: `assigned_${kind}`, by: user._id, role: user.role, at: now, note: req.body.reason }],
    });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'This period already has an arrangement — cancel it first');
    throw err;
  }
  const what = `P${slot.period} ${slot.subject?.code || ''} ${slot.department}-${slot.year}${slot.section ? `-${slot.section}` : ''} ${dayKey(day)} ${slot.startTime}`;
  logActivity(req, `staff.cover_${kind}`, { entityType: 'period_cover', entityId: cover._id, summary: `${what}${substitute ? ` → ${substitute.name}` : ''}` });
  if (substitute) {
    notifyUsers([substitute._id], {
      type: 'timetable',
      title: 'Substitute class assigned',
      message: `${slot.subject?.code || 'Class'} · ${slot.department} Year ${slot.year}${slot.section ? ` Sec ${slot.section}` : ''} · ${to12h(slot.startTime)}${slot.room ? ` · ${slot.room}` : ''} on ${dayKey(day)}.`,
      link: '/attendance',
    }, { category: 'substitute', eventKey: `cover:${cover._id}:assigned` });
  }
  notifyUsers([slot.faculty], {
    type: 'timetable',
    title: kind === 'substitute' ? 'Your period is covered' : kind === 'not_conducted' ? 'Period marked not conducted' : 'Period pending verification',
    message: `${slot.subject?.code || 'Class'} at ${to12h(slot.startTime)} on ${dayKey(day)}${substitute ? ` — taken by ${substitute.name}` : ''}.`,
    link: '/attendance',
  }, { category: 'substitute', eventKey: `cover:${cover._id}:original`, exclude: user._id });
  res.status(201).json(cover);
});

/** Cancel an arrangement (kept, as cancelled, for the audit trail). */
export const cancelCover = asyncHandler(async (req, res) => {
  const cover = await PeriodCover.findById(req.params.id);
  if (!cover || cover.status !== 'active') throw new ApiError(404, 'Arrangement not found');
  const { slot, original } = await loadSlot(cover.timetableSlot).catch(() => ({ slot: cover, original: null }));
  if (!managesSlot(req.user, slot, original)) throw new ApiError(403, 'You cannot change this arrangement');
  const now = new Date();
  cover.status = 'cancelled';
  cover.cancelledBy = req.user._id;
  cover.cancelledAt = now;
  cover.history.push({ action: 'cancelled', by: req.user._id, role: req.user.role, at: now, note: req.body?.reason });
  await cover.save();
  logActivity(req, 'staff.cover_cancelled', { entityType: 'period_cover', entityId: cover._id, summary: `P${cover.period} ${cover.subjectCode} ${dayKey(cover.date)}` });
  if (cover.substitute) {
    notifyUsers([cover.substitute], { type: 'timetable', title: 'Substitute class cancelled', message: `${cover.subjectCode || 'Class'} at ${to12h(cover.startTime)} on ${dayKey(cover.date)} no longer needs you.`, link: '/attendance' }, { category: 'substitute', eventKey: `cover:${cover._id}:cancelled` });
  }
  res.json(cover);
});
