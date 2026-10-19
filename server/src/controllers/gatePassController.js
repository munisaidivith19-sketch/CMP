import QRCode from 'qrcode';
import GatePass, { generateGatePassSecurityCode, normalizeGateCode } from '../models/GatePass.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import { EMERGENCY_AUTHORITIES, FIRST_YEAR_HOD_DEPT, GATE_PASS_PENDING_STATUSES, isBranchHod, isFirstYearHod } from '../constants.js';
import { ApiError, asyncHandler, escapeRegex, paginate, pageMeta, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { logSecurity } from '../utils/securityLog.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { campusDayStart, campusTimezone, timestampFilter, resolveRange, toDay } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { facultyClasses, inClasses } from '../utils/academicScope.js';
import * as otpService from '../services/otp/otpService.js';
import * as returnSvc from '../services/gatePassReturn.js';
import ReturnLocationCheck from '../models/ReturnLocationCheck.js';
import { env } from '../config/env.js';

// Everyone whose queue a gate pass can sit in, for the live "updated" event.
export const GATE_STAFF = ['admin', 'faculty', 'hod', 'principal', 'ao', 'dean', 'chairman', 'security', 'super_admin'];
const STUDENT_ROLES = ['student', 'club_admin'];
const HOUR = 3600000;
const DAY = 24 * HOUR;
//in this we insterted the data of the code in ap still error
// A pass can be used from 1 h before the requested departure until 2 h after the return day ends.
const EARLY_EXIT_MS = HOUR;
const GRACE_AFTER_RETURN_MS = 2 * HOUR;
const MAX_DURATION_MS = 30 * DAY;
export const QR_PREFIX = 'CCGP:';
export const STUDENT_FIELDS = 'name email rollNo avatar department year section semester phone';
/** When an approved pass's code stops working: the end of its return day, plus the grace period. */
export const verificationExpiryFor = (toDate) => new Date(new Date(toDate).getTime() + DAY + GRACE_AFTER_RETURN_MS);
const REVIEWER_FIELDS = 'name role';

const isAdmin = (user) => user.role === 'admin';

/** Security & Logs record for a gate pass; the target is always the pass holder. */
export const passSecurity = (req, event, pass, extra = {}) =>
  logSecurity(req, event, {
    target: pass?.student?._id ? { _id: pass.student._id, role: pass.student.role || 'student' } : pass?.student ? { _id: pass.student, role: 'student' } : undefined,
    entityType: 'gate_pass',
    entityId: pass?._id,
    ...extra,
    details: { passRef: pass?._id ? `GP-${String(pass._id).slice(-6).toUpperCase()}` : undefined, ...(extra.details || {}) },
  });
// The faculty stage: waiting for the parent OTP, then ready to forward to the HOD.
const FACULTY_STAGE = ['pending_faculty', 'parent_verified'];

/**
 * Admin, or a faculty member who teaches the student's class (department +
 * year + section + semester from the timetable / class in-charge assignment).
 * Read from the database only — nothing about the class comes from the request.
 */
export async function isClassFaculty(pass, user) {
  if (isAdmin(user)) return true;
  if (user.role !== 'faculty') return false;
  const student = await User.findById(pass.student?._id || pass.student).select('department year section semester').lean();
  if (!student || student.department !== pass.department) return false;
  return inClasses(await facultyClasses(user), student);
}

/**
 * The parent's number is shown in full to those who handle the request. Faculty
 * who are not assigned to the student's class (department + year + section +
 * semester) get it masked; the other roles are unchanged.
 */
async function parentPhoneGuard(user) {
  if (user.role !== 'faculty') return (pass) => pass;
  const classes = await facultyClasses(user);
  return (pass) =>
    pass.student?.department === pass.department && inClasses(classes, pass.student)
      ? pass
      : { ...pass, parentPhone: otpService.maskMobile(pass.parentPhone) };
}

/** Live update to the student and to every role that can see gate passes. */
export function publish(pass, extra = {}) {
  const payload = { passId: String(pass._id), status: pass.status, studentId: String(pass.student?._id || pass.student), ...extra };
  emitToUsers([pass.student?._id || pass.student], 'gatepass:updated', payload);
  emitToRoles(GATE_STAFF, 'gatepass:updated', payload);
}

// toDate is stored as the start (UTC midnight) of the return day, so "due back
// by" is the end of that day, plus a grace period — not the start of it.
const dueByMs = (toDate) => new Date(toDate).getTime() + DAY + GRACE_AFTER_RETURN_MS;

const withFlags = (p) => {
  const plain = typeof p.toObject === 'function' ? p.toObject() : p;
  return {
    ...plain,
    overdue: plain.status === 'active' && dueByMs(plain.toDate) < Date.now(),
  };
};

/** Faculty assigned as class in-charge for this student's department + section. */
const facultyFilter = (dept, section) => ({ role: 'faculty', department: dept, section, isActive: true });
const hodFilter = (dept) => ({ role: 'hod', department: dept, isActive: true });
export const principalFilter = () => ({ role: 'principal', isActive: true });
/** The HOD(s) who decide a class's requests: the first-year HOD for year 1, else the branch HOD. */
export const hodFilterFor = (department, year) =>
  year === 1 ? { role: 'hod', department: FIRST_YEAR_HOD_DEPT, isActive: true } : hodFilter(department);

export async function notifyStage(filter, payload) {
  const ids = await User.find(filter).distinct('_id');
  if (ids.length) await notifyUsers(ids, payload);
  return ids;
}

/** Mark passes whose window has closed as expired. Runs on a timer and lazily on verify. */
export async function expireGatePasses() {
  const now = new Date();
  const stale = await GatePass.find({
    $or: [
      { status: 'approved', verificationExpiry: { $lt: now } },
      { status: { $in: GATE_PASS_PENDING_STATUSES }, toDate: { $lt: new Date(now.getTime() - DAY) } },
    ],
  })
    .select('student status')
    .lean();
  if (!stale.length) return 0;
  await GatePass.updateMany(
    { _id: { $in: stale.map((p) => p._id) }, status: { $in: ['approved', ...GATE_PASS_PENDING_STATUSES] } },
    { $set: { status: 'expired' }, $unset: { verificationCode: 1 } }
  );
  stale.forEach((p) => publish({ ...p, status: 'expired' }));
  return stale.length;
}

async function loadPass(id) {
  const pass = await GatePass.findById(id);
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  return pass;
}

function populateAll(query) {
  return query
    .populate('student', STUDENT_FIELDS)
    .populate('parentVerifiedBy', 'name')
    .populate('facultyReview.by', REVIEWER_FIELDS)
    .populate('hodReview.by', REVIEWER_FIELDS)
    .populate('principalReview.by', REVIEWER_FIELDS)
    .populate('emergencyReview.by', REVIEWER_FIELDS)
    .populate('exitVerifiedBy', 'name')
    .populate('returnVerifiedBy', 'name')
    .populate('returnOverride.by', 'name role')
    .populate('revokedBy', 'name')
    .populate('bindGroup', 'name title status');
}

// ── Student creates a gate pass request ────────────────────────────

export const createGatePass = asyncHandler(async (req, res) => {
  // parentPhone is deliberately NOT taken from the request: the parent OTP must
  // reach the number the administrator registered for this student, or a
  // student could enter their own phone and confirm their own "parent" OTP.
  const data = pick(req.body, ['regarding', 'description', 'fromDate', 'toDate']);
  const destination = pick(req.body.destination || {}, ['state', 'district', 'area']);
  const from = new Date(data.fromDate);
  const to = new Date(data.toDate);

  // Day scholars request a same-day Outing instead (createDayScholarOuting);
  // the stay type comes from their account, never from the request.
  if (req.user.stayType === 'day_scholar') throw new ApiError(403, 'Day scholars request an Outing pass instead');
  if (to < from) throw new ApiError(422, 'Return date cannot be before the departure date');
  if (to.getTime() - from.getTime() > MAX_DURATION_MS) throw new ApiError(422, 'A gate pass can cover at most 30 days');
  if (!req.user.department || !req.user.section) {
    throw new ApiError(422, 'Your account has no department/section on file — ask an admin to set it');
  }
  if (!req.user.parentPhone) {
    throw new ApiError(422, 'Your parent’s mobile number is not on file — ask the administrator to add it before requesting a gate pass');
  }
  data.parentPhone = req.user.parentPhone;

  // "No open pass yet, so create one" runs under the per-student lock, so a
  // double-tap or two parallel requests can never create two passes.
  const pass = await withGatePassLock(req.user._id, async () => {
    const existing = await GatePass.exists({
      student: req.user._id,
      status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved', 'active'] },
    });
    if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');

    return GatePass.create({
      ...data,
      destination,
      fromDate: from,
      toDate: to,
      student: req.user._id,
      department: req.user.department,
      section: req.user.section,
    });
  });
  logActivity(req, 'gate_pass.create', { entityType: 'gate_pass', entityId: pass._id, summary: pass.regarding });

  const notified = await notifyStage(facultyFilter(req.user.department, req.user.section), {
    type: 'gate_pass',
    title: 'New gate pass request',
    message: `${req.user.name}${req.user.rollNo ? ` (${req.user.rollNo})` : ''} · ${pass.regarding}`,
    link: '/gate-pass?tab=review',
  });
  // No class in-charge on file for this section — fall back to the whole department so it isn't stuck unseen.
  if (!notified.length) {
    await notifyStage({ role: 'faculty', department: req.user.department, isActive: true }, {
      type: 'gate_pass',
      title: 'New gate pass request (no class in-charge set)',
      message: `${req.user.name}${req.user.rollNo ? ` (${req.user.rollNo})` : ''} · ${pass.regarding}`,
      link: '/gate-pass?tab=review',
    });
  }
  publish(pass);

  res.status(201).json(withFlags(pass));
});

// ── Day scholar: same-day Outing ───────────────────────────────────

/**
 * A day scholar's Outing: subject, description and an optional attachment.
 * The parent OTP goes to the parent number the administrator registered on
 * the student's account — never to a number typed on the request, which would
 * let a student send the "parent" OTP to their own or a friend's phone. It is for today only (the server's day — no
 * date is read from the request) and follows the normal approval chain:
 * Class In-Charge (parent OTP) → HOD → Principal. There is no return step:
 * the pass completes when security records the exit.
 */
export const createDayScholarOuting = asyncHandler(async (req, res) => {
  if (req.user.stayType !== 'day_scholar') throw new ApiError(403, 'Outing passes are for day scholars only');
  if (!req.user.department || !req.user.section) {
    throw new ApiError(422, 'Your account has no department/section on file — ask an admin to set it');
  }
  if (!req.user.parentPhone) {
    throw new ApiError(422, 'Your parent’s mobile number is not on file — ask the administrator to add it before requesting an outing');
  }
  const pass = await withGatePassLock(req.user._id, async () => {
    const existing = await GatePass.exists({
      student: req.user._id,
      status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved', 'active'] },
    });
    if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');
    return createOutingPass(req);
  });
  logActivity(req, 'gate_pass.create', { entityType: 'gate_pass', entityId: pass._id, summary: `outing: ${pass.subject}` });
  await notifyOutingFaculty(req, pass);
  publish(pass);
  res.status(201).json(withFlags(pass));
});

/**
 * Run `fn` holding a per-student lock taken atomically on the student's own
 * record, so "check for an open pass, then create one" cannot interleave with
 * a parallel request. The lock expires on its own after a few seconds if the
 * process dies mid-way.
 */
const GATE_LOCK_MS = 10000;
async function withGatePassLock(studentId, fn) {
  const now = new Date();
  const locked = await User.findOneAndUpdate(
    { _id: studentId, $or: [{ gatePassLockUntil: null }, { gatePassLockUntil: { $lte: now } }] },
    { $set: { gatePassLockUntil: new Date(now.getTime() + GATE_LOCK_MS) } },
    { new: true, projection: { _id: 1 } }
  );
  if (!locked) throw new ApiError(409, 'Your gate pass request is already being processed');
  try {
    return await fn();
  } finally {
    await User.updateOne({ _id: studentId }, { $unset: { gatePassLockUntil: 1 } });
  }
}

function createOutingPass(req) {
  const day = toDay(new Date());
  const doc = pick(req.body.supportingDocument || {}, ['url', 'name', 'mimeType']);
  return GatePass.create({
    student: req.user._id,
    department: req.user.department,
    section: req.user.section,
    passType: 'normal',
    dayScholarOuting: true,
    regarding: 'outing',
    subject: req.body.subject,
    description: req.body.description,
    // Always the registered number; anything sent on the request is ignored.
    parentPhone: req.user.parentPhone,
    fromDate: day,
    toDate: day,
    ...(doc.url ? { supportingDocument: doc } : {}),
  });
}

/** Tell the class in-charge (or, with none set, the department's faculty). */
async function notifyOutingFaculty(req, pass) {
  const message = `${req.user.name}${req.user.rollNo ? ` (${req.user.rollNo})` : ''} · Outing: ${pass.subject}`;
  const notified = await notifyStage(facultyFilter(req.user.department, req.user.section), {
    type: 'gate_pass',
    title: 'New outing request',
    message,
    link: '/gate-pass?tab=review',
  });
  if (!notified.length) {
    await notifyStage({ role: 'faculty', department: req.user.department, isActive: true }, {
      type: 'gate_pass',
      title: 'New outing request (no class in-charge set)',
      message,
      link: '/gate-pass?tab=review',
    });
  }
}

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

/**
 * Older Outings carried a parent number the student typed, so reviewers are
 * told when a pass's number is not the one registered on the account (a flag
 * only — the registered number itself is not sent). New Outings always use
 * the registered number, so the flag is false for them.
 */
async function flagOutingParent(passes, user) {
  if (STUDENT_ROLES.includes(user.role) || user.role === 'security') return passes;
  const ids = passes.filter((p) => p.dayScholarOuting).map((p) => p.student?._id || p.student);
  if (!ids.length) return passes;
  const registered = new Map(
    (await User.find({ _id: { $in: ids } }).select('parentPhone').lean()).map((u) => [String(u._id), digitsOf(u.parentPhone)])
  );
  return passes.map((p) =>
    p.dayScholarOuting
      ? { ...p, parentPhoneDiffers: digitsOf(p.parentPhone) !== (registered.get(String(p.student?._id || p.student)) || '') }
      : p
  );
}

// ── List gate passes (role-filtered queue) ─────────────────────────

export const listGatePasses = asyncHandler(async (req, res) => {
  const { role } = req.user;
  // Alumni are not part of the campus gate-pass workflow; without this they
  // would match no branch below and the empty filter would list every pass.
  if (role === 'alumni') throw new ApiError(403, 'Not authorized');
  let filter = {};

  if (STUDENT_ROLES.includes(role)) {
    filter.student = req.user._id;
  } else if (role === 'admin' || role === 'super_admin') {
    if (req.query.student) filter.student = req.query.student;
  } else if (role === 'faculty') {
    // A class in-charge (section set) only sees their own class. A faculty member
    // with no section assigned isn't tied to one class, so — matching the fallback
    // notification sent when a request has no in-charge to reach — they see every
    // pending request in their department instead of matching nothing at all.
    const scope = req.user.section ? { department: req.user.department, section: req.user.section } : { department: req.user.department };
    // The section letter repeats in every year: with the in-charge year on
    // file, only that year's class is theirs (3rd Year A never sees 1st Year A).
    if (req.user.section && req.user.inChargeYear) {
      scope.student = {
        $in: await User.find({ role: { $in: STUDENT_ROLES }, department: req.user.department, section: req.user.section, year: req.user.inChargeYear }).distinct('_id'),
      };
    }
    filter = { $or: [{ 'facultyReview.by': req.user._id }, { status: { $in: FACULTY_STAGE }, ...scope }] };
  } else if (role === 'hod') {
    const firstYearStudents = await User.find({ year: 1, role: { $in: STUDENT_ROLES } }).distinct('_id');
    if (isFirstYearHod(req.user)) {
      filter = {
        $or: [
          { 'hodReview.by': req.user._id },
          { status: 'pending_hod', student: { $in: firstYearStudents } },
        ],
      };
    } else {
      filter = {
        $or: [
          { 'hodReview.by': req.user._id },
          { status: 'pending_hod', department: req.user.department, student: { $nin: firstYearStudents } },
        ],
      };
    }
  } else if (role === 'principal') {
    filter = { $or: [{ 'principalReview.by': req.user._id }, { status: 'pending_principal' }, { passType: 'emergency', emergencyAuthority: 'principal' }] };
  } else if (EMERGENCY_AUTHORITIES.includes(role)) {
    // AO / Dean / Chairman: only the emergency requests sent to them.
    filter = { passType: 'emergency', emergencyAuthority: role };
  } else if (role === 'security') {
    filter.status = { $in: ['approved', 'active', 'completed'] };
  } else {
    // Fail closed: a role with no gate-pass scope (e.g. warden) sees nothing,
    // never the empty filter that would match every pass in the college.
    throw new ApiError(403, 'Not authorized');
  }

  // A requested status only ever NARROWS the role's scope ($and), so it can
  // never replace a constraint the role already has (e.g. security's statuses).
  if (req.query.status === 'overdue') {
    filter = { $and: [filter, { status: 'active', toDate: { $lt: new Date(Date.now() - DAY - GRACE_AFTER_RETURN_MS) } }] };
  } else if (req.query.status) {
    const statuses = String(req.query.status).split(',');
    filter = { $and: [filter, { status: { $in: statuses } }] };
  }
  // Individual review queues leave out requests that are decided as part of a bind group.
  if (req.query.bind === 'none') filter = { $and: [filter, { bindGroup: null }] };
  if (req.query.date) {
    const day = toDay(req.query.date);
    filter.createdAt = timestampFilter({ from: day, to: day });
  } else if (req.query.range || req.query.from || req.query.to) {
    const tf = timestampFilter(resolveRange(req.query, 'all'));
    if (tf) filter.createdAt = tf;
  }

  const { page, limit, skip } = paginate(req, 20);
  const [passes, total] = await Promise.all([
    populateAll(GatePass.find(filter)).sort({ status: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    GatePass.countDocuments(filter),
  ]);

  const guard = await parentPhoneGuard(req.user);
  await logEmergencyViewed(req, passes);
  const flagged = await flagOutingParent(passes, req.user);
  res.json({ passes: flagged.map((p) => guard(withFlags(p))), pagination: pageMeta(total, page, limit) });
});

// ── Get single gate pass ───────────────────────────────────────────

async function canView(pass, user) {
  if (sameId(pass.student, user)) return true;
  if (['admin', 'security', 'super_admin'].includes(user.role)) return true;
  // Emergency passes bypass faculty and HOD; they see one only once the student
  // has actually left (for "outside now" and the return notice).
  if (pass.passType === 'emergency' && ['faculty', 'hod'].includes(user.role) && !pass.actualExit) return false;
  if (user.role === 'faculty') {
    if (sameId(pass.facultyReview?.by, user)) return true;
    if (pass.department !== user.department) return false;
    // No class assigned: the department-wide fallback queue (see listGatePasses).
    if (!user.section) return true;
    // A class they actually handle (department + year + section + semester —
    // the check that gates the review actions) is always theirs to open.
    if (await isClassFaculty(pass, user)) return true;
    // Otherwise exactly what their queue lists: their section letter, and
    // with an in-charge year on file only that year's class (a 3rd Year A
    // in-charge never opens a 1st Year A pass). The parent number stays
    // masked for anyone not assigned to the class (parentPhoneGuard).
    if (pass.section !== user.section) return false;
    return !user.inChargeYear || pass.student?.year === user.inChargeYear;
  }
  if (user.role === 'hod') {
    const isFirstYear = pass.student?.year === 1;
    if (isFirstYearHod(user)) return Boolean(isFirstYear);
    return Boolean(isBranchHod(user) && pass.department === user.department && !isFirstYear);
  }
  if (user.role === 'principal') return true;
  if (EMERGENCY_AUTHORITIES.includes(user.role)) return pass.passType === 'emergency' && pass.emergencyAuthority === user.role;
  return false;
}

export const getGatePass = asyncHandler(async (req, res) => {
  const pass = await populateAll(GatePass.findById(req.params.id));
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!(await canView(pass, req.user))) throw new ApiError(403, 'Not authorized');
  await logEmergencyViewed(req, [pass]);
  const [flagged] = await flagOutingParent([withFlags(pass)], req.user);
  res.json((await parentPhoneGuard(req.user))(flagged));
});

/**
 * The code the student reads aloud at the gate. Only the pass owner can fetch
 * it — the QR is a convenience wrapper around the same 4-character code.
 */
export const getGatePassQr = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('+verificationCode');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!sameId(pass.student, req.user)) throw new ApiError(403, 'Only the pass holder can view its code');
  // Bulk-approved: approved, but its code is still waiting in the generation queue.
  if (pass.status === 'approved' && !pass.verificationCode && ['queued', 'processing'].includes(pass.codeIssue?.state)) {
    const at = pass.codeIssue.scheduledAt && pass.codeIssue.scheduledAt > new Date() ? pass.codeIssue.scheduledAt : new Date();
    const time = new Intl.DateTimeFormat('en-IN', { timeZone: env.timezone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(at);
    res.set('Cache-Control', 'no-store');
    throw new ApiError(409, `Your QR code and code will be generated at ${time}`, undefined, { codeQueued: true, generateAt: at });
  }
  if (!['approved', 'active'].includes(pass.status) || !pass.verificationCode) {
    throw new ApiError(422, 'This pass has no active verification code');
  }
  if (pass.verificationExpiry && pass.verificationExpiry < new Date()) {
    await expireGatePasses();
    throw new ApiError(410, 'This pass has expired');
  }
  const payload = `${QR_PREFIX}${pass.verificationCode}`;
  const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  res.set('Cache-Control', 'no-store');
  res.json({ code: pass.verificationCode, qr, payload, expiresAt: pass.verificationExpiry, status: pass.status });
});

// ── Approval chain: faculty → HOD → principal ───────────────────────

/**
 * Apply an approval update that issues the pass's one security code. The code
 * is drawn once here and stored; it is never regenerated afterwards. A clash
 * with another live pass's code (unique index) just draws again.
 */
async function approveWithSecurityCode(filter, set) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await GatePass.findOneAndUpdate(filter, { $set: { ...set, verificationCode: generateGatePassSecurityCode() } }, { new: true });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  throw new ApiError(503, 'Could not issue a gate code. Please try again.');
}

const AUTHORITY_LABELS = { principal: 'Principal', ao: 'AO', dean: 'Dean', chairman: 'Chairman' };

async function reviewStage(req, res, { stage, from, forwardFrom = from, forwardBlocked, to, reviewField, canAct, forwardNotify, forwardTitle, approvedMessage, rejectedBy }) {
  const pass = await loadPass(req.params.id);
  if (![].concat(from).includes(pass.status)) throw new ApiError(422, `This pass is no longer waiting on ${stage} review`);
  if (!(await canAct(pass, req.user))) throw new ApiError(403, `You are not the assigned ${stage} reviewer for this pass`);

  const { action, reason } = req.body; // 'forward' | 'reject' (principal sends 'approve' | 'reject')
  const forwarding = action === 'forward' || action === 'approve';
  // A bound request moves only with its group; the class in-charge may still reject it.
  if (pass.bindGroup && (stage !== 'faculty' || forwarding)) {
    throw new ApiError(422, stage === 'faculty' ? 'This request is in a bind group — unbind it first to forward it on its own' : 'This request is part of a bind group — decide it from the Bind groups tab');
  }
  if (forwarding && pass.status !== forwardFrom) throw new ApiError(422, forwardBlocked || 'This pass is not ready to forward');
  const review = { by: req.user._id, at: new Date(), action: forwarding ? (to === null ? 'approved' : 'forwarded') : 'rejected', reason: reason || '' };

  const set = { [reviewField]: review };
  const approving = forwarding && to === null;
  if (forwarding) {
    set.status = approving ? 'approved' : to;
    if (approving) {
      // toDate is stored as the start (UTC midnight) of the return day, so the code
      // must stay valid through the END of that day, plus a grace period after.
      set.verificationExpiry = new Date(new Date(pass.toDate).getTime() + DAY + GRACE_AFTER_RETURN_MS);
    }
  } else {
    set.status = 'rejected';
    set.rejectedStage = stage;
    set.rejectedReason = reason || '';
  }

  const filter = { _id: pass._id, status: pass.status };
  const updated = approving ? await approveWithSecurityCode(filter, set) : await GatePass.findOneAndUpdate(filter, { $set: set }, { new: true });
  if (!updated) throw new ApiError(422, 'This pass was just reviewed by someone else');

  logActivity(req, `gate_pass.${stage}_${forwarding ? (approving ? 'approve' : 'forward') : 'reject'}`, { entityType: 'gate_pass', entityId: pass._id });
  passSecurity(req, forwarding ? 'GATE_PASS_APPROVED' : 'GATE_PASS_REJECTED', pass, {
    reason: forwarding ? undefined : reason || undefined,
    details: { stage, final: approving || !forwarding },
  });
  if (approving) logActivity(req, 'gate_pass.code_issued', { entityType: 'gate_pass', entityId: pass._id });

  if (approving) {
    const code = (await GatePass.findById(updated._id).select('+verificationCode').lean()).verificationCode;
    await notifyUsers([pass.student], {
      type: 'gate_pass',
      title: 'Gate pass approved',
      message: approvedMessage || `Your gate pass was approved. Your code is ${code} — tell it to security at the gate.`,
      link: `/gate-pass/${pass._id}`,
    });
  } else if (forwarding) {
    await notifyUsers([pass.student], { type: 'gate_pass', title: forwardTitle, message: `Forwarded to ${stage === 'faculty' ? 'HOD' : 'the principal'} for review.`, link: `/gate-pass/${pass._id}` }, { push: false });
    await forwardNotify(pass);
  } else {
    await notifyUsers([pass.student], {
      type: 'gate_pass',
      title: 'Gate pass rejected',
      message: `Rejected by ${rejectedBy || stage}${reason ? `: ${reason}` : ''}`,
      link: `/gate-pass/${pass._id}`,
    });
  }
  publish(updated);
  res.json(withFlags(await populateAll(GatePass.findById(updated._id))));
}

export const facultyReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'faculty',
    from: FACULTY_STAGE,
    // Forwarding needs a successful parent OTP check; rejecting does not.
    forwardFrom: 'parent_verified',
    forwardBlocked: "Verify the parent's OTP before forwarding to the HOD",
    to: 'pending_hod',
    reviewField: 'facultyReview',
    canAct: isClassFaculty,
    forwardTitle: 'Gate pass forwarded to HOD',
    forwardNotify: async (pass) => {
      const student = await User.findById(pass.student?._id || pass.student).select('year department').lean();
      const isFirstYear = student?.year === 1;
      const filter = isFirstYear
        ? { role: 'hod', department: FIRST_YEAR_HOD_DEPT, isActive: true }
        : hodFilter(pass.department);
      return notifyStage(filter, {
        type: 'gate_pass',
        title: 'Gate pass needs your review',
        message: `Forwarded by class faculty · ${pass.department}${isFirstYear ? ' (1st Year)' : ''}`,
        link: '/gate-pass?tab=review',
      });
    },
  })
);

export const hodReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'hod',
    from: 'pending_hod',
    to: 'pending_principal',
    reviewField: 'hodReview',
    canAct: async (pass, user) => {
      if (isAdmin(user)) return true;
      if (user.role !== 'hod') return false;
      const student = await User.findById(pass.student?._id || pass.student).select('year department').lean();
      if (isFirstYearHod(user)) {
        return student?.year === 1;
      }
      return isBranchHod(user) && pass.department === user.department && student?.year !== 1;
    },
    forwardTitle: 'Gate pass forwarded to the principal',
    forwardNotify: (pass) => notifyStage(principalFilter(), { type: 'gate_pass', title: 'Gate pass needs your review', message: `Forwarded by HOD · ${pass.department}`, link: '/gate-pass?tab=review' }),
  })
);

export const principalReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'principal',
    from: 'pending_principal',
    to: null,
    reviewField: 'principalReview',
    canAct: (pass, user) => isAdmin(user) || user.role === 'principal',
    forwardTitle: '',
    forwardNotify: async () => {},
  })
);

/**
 * Emergency pass: only the authority the student chose may decide, and only
 * while it waits on them. No faculty, HOD or parent-OTP stage is involved.
 */
export const emergencyReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'authority',
    from: 'pending_authority',
    to: null,
    reviewField: 'emergencyReview',
    canAct: (pass, user) => pass.passType === 'emergency' && pass.emergencyAuthority === user.role,
    forwardTitle: '',
    forwardNotify: async () => {},
    approvedMessage: 'Your emergency gate pass was approved. Show its code or QR to Security at the gate.',
    rejectedBy: 'the authority',
  })
);

// ── Emergency gate pass: straight to one chosen authority ───────────

export const createEmergencyGatePass = asyncHandler(async (req, res) => {
  const authority = req.body.authority;
  const leaveAt = new Date(req.body.leaveAt);
  const expectedReturnAt = new Date(req.body.expectedReturnAt);
  if (leaveAt.getTime() < Date.now() - HOUR) throw new ApiError(422, 'Leaving time cannot be in the past');
  if (expectedReturnAt <= leaveAt) throw new ApiError(422, 'Expected return must be after the leaving time');
  if (expectedReturnAt - leaveAt > MAX_DURATION_MS) throw new ApiError(422, 'A gate pass can cover at most 30 days');
  if (!req.user.department || !req.user.section) {
    throw new ApiError(422, 'Your account has no department/section on file — ask an admin to set it');
  }

  const authorityIds = await User.find({ role: authority, isActive: true }).distinct('_id');
  if (!authorityIds.length) throw new ApiError(422, `No ${AUTHORITY_LABELS[authority]} account is available right now — choose another authority`);

  const doc = pick(req.body.supportingDocument || {}, ['url', 'name', 'mimeType']);
  // Student identity, class and parent number come from the signed-in account, never the request.
  // Checked and created under the per-student lock (no duplicate on a double submit).
  const pass = await withGatePassLock(req.user._id, async () => {
    const existing = await GatePass.exists({ student: req.user._id, status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved', 'active'] } });
    if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');
    return GatePass.create({
      passType: 'emergency',
      status: 'pending_authority',
      emergencyAuthority: authority,
      student: req.user._id,
      department: req.user.department,
      section: req.user.section,
      parentPhone: req.user.parentPhone || undefined,
      description: req.body.reason,
      destination: { area: req.body.destination },
      leaveAt,
      expectedReturnAt,
      fromDate: toDay(leaveAt),
      toDate: toDay(expectedReturnAt),
      ...(doc.url ? { supportingDocument: doc } : {}),
    });
  });
  logActivity(req, 'gate_pass.emergency_create', { entityType: 'gate_pass', entityId: pass._id, summary: `Sent to ${AUTHORITY_LABELS[authority]}` });

  await notifyUsers(authorityIds, {
    type: 'gate_pass',
    title: 'Emergency gate pass request',
    message: `${req.user.name}${req.user.rollNo ? ` (${req.user.rollNo})` : ''} · ${req.user.department} — needs your approval`,
    link: `/gate-pass/${pass._id}`,
  });
  publish(pass);
  res.status(201).json(withFlags(pass));
});

/** Audit that the chosen authority has seen a waiting emergency request — once per authority and pass. */
async function logEmergencyViewed(req, passes) {
  const waiting = passes.filter((p) => p.passType === 'emergency' && p.status === 'pending_authority' && p.emergencyAuthority === req.user.role);
  if (!waiting.length) return;
  const seen = new Set(
    (await Activity.find({ user: req.user._id, action: 'gate_pass.emergency_viewed', entityId: { $in: waiting.map((p) => p._id) } }).distinct('entityId')).map(String)
  );
  waiting.filter((p) => !seen.has(String(p._id))).forEach((p) => logActivity(req, 'gate_pass.emergency_viewed', { entityType: 'gate_pass', entityId: p._id }));
}

// ── Parent OTP verification (faculty stage) ─────────────────────────

async function loadForParentOtp(req) {
  const pass = await GatePass.findById(req.params.id).populate('student', 'name');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!(await isClassFaculty(pass, req.user))) throw new ApiError(403, "Only the student's class faculty can verify this request");
  return pass;
}

const otpAudit = (req, pass, event, summary) =>
  logActivity(req, `gate_pass.otp_${event}`, { entityType: 'gate_pass', entityId: pass._id, summary });

// OTP lifecycle in Security & Logs. The code itself is never recorded — it is
// shown only in the admin OTP dashboard.
const OTP_FAILURE_EVENTS = { expired: 'OTP_EXPIRED', locked: 'OTP_LOCKED', failed: 'OTP_FAILED' };
const otpSecurity = (req, pass, event, extra = {}) =>
  passSecurity(req, event, pass, { ...extra, success: extra.success ?? !['OTP_FAILED', 'OTP_EXPIRED', 'OTP_LOCKED'].includes(event) });

export const getParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  res.set('Cache-Control', 'no-store');
  // The number the OTP goes to by default; the faculty may edit it before sending.
  const registered = await otpService.registeredParentMobile(pass);
  res.json({ passStatus: pass.status, ...(await otpService.getOtpState(pass._id)), parentMobile: registered || pass.parentPhone || '' });
});

/**
 * The faculty's edited number, when it differs from the registered one:
 * a valid Indian mobile plus a reason, or a 422. Null means "use the registered number".
 */
async function alternateMobileFor(req, pass) {
  const typed = req.body?.mobile;
  if (typed === undefined || typed === null || (typeof typed === 'string' && !typed.trim())) return null;
  const mobile = otpService.normalizeIndianMobile(typed);
  if (!mobile) throw new ApiError(422, 'Enter a valid 10-digit mobile number');
  if (otpService.sameMobile(mobile, await otpService.registeredParentMobile(pass))) return null;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) throw new ApiError(422, 'Say why the OTP is going to a different number (e.g. parent not reachable)');
  return { mobile, reason };
}

export const requestParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  if (pass.status !== 'pending_faculty') throw new ApiError(422, 'This request is not waiting for parent verification');
  const alternate = await alternateMobileFor(req, pass);
  let otpState;
  try {
    otpState = await otpService.requestOtp({ pass, studentName: pass.student?.name || 'Your ward', faculty: req.user, alternate });
  } catch (err) {
    if (err.otpEvent) otpSecurity(req, pass, 'OTP_FAILED', { reason: err.otpReason, details: { otpId: err.otpId } });
    throw err;
  }
  const { otpId, smsSent, ...state } = otpState;
  otpAudit(req, pass, state.resent ? 'resent' : 'requested', `OTP sent to ${state.maskedMobile}`);
  const otpDetails = { otpId, parentMobile: state.maskedMobile, smsEnabled: smsSent };
  otpSecurity(req, pass, 'OTP_CREATED', { details: otpDetails });
  if (alternate) {
    otpAudit(req, pass, 'alternate_mobile', `OTP sent to a different number ${state.maskedMobile}: ${alternate.reason}`);
    otpSecurity(req, pass, 'OTP_ALTERNATE_MOBILE', { reason: alternate.reason, details: otpDetails });
  }
  if (state.resent) otpSecurity(req, pass, 'OTP_RESEND', { details: otpDetails });
  if (smsSent) otpSecurity(req, pass, 'OTP_SENT', { details: otpDetails });
  res.set('Cache-Control', 'no-store');
  res.json({
    message: alternate
      ? `OTP ${smsSent ? 'sent' : 'generated'} for the alternate number ${state.maskedMobile}`
      : smsSent ? 'OTP sent to the registered parent mobile number' : 'OTP generated for the registered parent mobile number',
    passStatus: pass.status,
    ...state,
    parentMobile: (await otpService.registeredParentMobile(pass)) || pass.parentPhone || '',
  });
});

export const verifyParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  if (pass.status !== 'pending_faculty') throw new ApiError(422, 'This request is not waiting for parent verification');
  let used;
  try {
    used = await otpService.verifyOtp({ gatePassId: pass._id, otp: req.body.otp });
  } catch (err) {
    if (err.otpEvent) {
      otpAudit(req, pass, err.otpEvent === 'expired' ? 'expired' : 'verify_failed', err.otpEvent);
      otpSecurity(req, pass, OTP_FAILURE_EVENTS[err.otpEvent] || 'OTP_FAILED', { reason: err.otpReason || err.otpEvent });
    }
    throw err;
  }
  otpAudit(req, pass, 'verified');
  otpSecurity(req, pass, 'OTP_VERIFIED');

  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'pending_faculty' },
    {
      $set: {
        status: 'parent_verified',
        parentVerifiedAt: new Date(),
        parentVerifiedBy: req.user._id,
        // HOD / principal see that a number other than the registered one confirmed it.
        ...(used?.alternateMobile ? { parentVerifiedAlternate: { mobileMasked: used.parentMobileMasked, reason: used.alternateReason } } : {}),
      },
    },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This request changed while verifying — refresh and try again');
  logActivity(req, 'gate_pass.parent_verified', { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers(
    [pass.student._id],
    { type: 'gate_pass', title: 'Parent verified', message: 'Your parent confirmed the request. Your class faculty can now forward it to the HOD.', link: `/gate-pass/${pass._id}` },
    { push: false }
  );
  publish(updated);
  res.json(withFlags(await populateAll(GatePass.findById(updated._id))));
});

// ── Development OTP portal (admin only; the route is absent in production) ──

export const listDevOtps = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const provider = otpService.getOtpProvider();
  const otps = await otpService.listDevOtps();
  // In production this page shows admins parent OTPs that would otherwise go
  // out by SMS — leave a record of who looked and when, even though the OTP
  // values themselves are never written to the log.
  logActivity(req, 'gate_pass.dev_otp_viewed', { summary: `Viewed ${otps.length} OTP record(s) via /dev/otp` });
  res.json({ provider: provider.name, otps, messages: provider.sentMessages?.() || [] });
});

// ── Student withdraws a request ────────────────────────────────────

export const cancelGatePass = asyncHandler(async (req, res) => {
  const pass = await GatePass.findOneAndUpdate(
    { _id: req.params.id, student: req.user._id, status: { $in: GATE_PASS_PENDING_STATUSES } },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { new: true }
  );
  if (!pass) {
    const exists = await GatePass.findById(req.params.id).select('student status').lean();
    if (!exists || !sameId(exists.student, req.user)) throw new ApiError(404, 'Gate pass not found');
    throw new ApiError(422, `A ${exists.status.replace('pending_', '')} pass cannot be cancelled`);
  }
  logActivity(req, 'gate_pass.cancel', { entityType: 'gate_pass', entityId: pass._id });
  passSecurity(req, 'GATE_PASS_CANCELLED', pass, { reason: 'cancelled_by_student' });
  publish(pass);
  res.json(withFlags(pass));
});

// ── Security: verify a presented code ───────────────────────────────

function problemsFor(pass) {
  const now = clock.now();
  const problems = [];
  const messages = {
    completed: 'This pass has already been used and completed',
    expired: 'This pass has expired',
    revoked: 'This pass has been revoked',
    rejected: 'This pass was rejected',
    cancelled: 'This pass was cancelled by the student',
    pending_faculty: 'This pass has not been approved yet',
    parent_verified: 'This pass has not been approved yet',
    pending_hod: 'This pass has not been approved yet',
    pending_principal: 'This pass has not been approved yet',
    pending_authority: 'This pass has not been approved yet',
  };
  if (messages[pass.status]) problems.push(messages[pass.status]);
  if (pass.verificationExpiry && now > pass.verificationExpiry) problems.push('The verification window has closed');
  // An emergency pass has an exact leaving time (exit opens an hour before it).
  // Every other pass has a "from" calendar day, stored as UTC midnight: it opens
  // when that campus day begins (00:00 campus time), never on the day before.
  const opensAt = pass.leaveAt
    ? new Date(new Date(pass.leaveAt).getTime() - EARLY_EXIT_MS)
    : pass.fromDate
      ? campusDayStart(new Date(pass.fromDate))
      : null;
  if (pass.status === 'approved' && opensAt && now < opensAt) {
    problems.push(`Exit is allowed from ${opensAt.toLocaleString('en-IN', { timeZone: campusTimezone() })}`);
  }
  return problems;
}

export const verifyGatePass = asyncHandler(async (req, res) => {
  const code = normalizeGateCode(req.body.code, QR_PREFIX);
  if (!code) throw new ApiError(422, 'Enter a valid 4-character gate pass code (letters and numbers)');

  await expireGatePasses();
  const pass = await GatePass.findOne({ verificationCode: code }).populate('student', STUDENT_FIELDS);
  if (!pass) {
    logActivity(req, 'gate_pass.verify_failed', { summary: 'Unknown code' });
    logSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', { success: false, reason: 'unknown_code', entityType: 'gate_pass' });
    throw new ApiError(404, 'Invalid or already-used verification code');
  }

  pass.lastVerifiedAt = new Date();
  pass.lastVerifiedBy = req.user._id;
  await pass.save();
  logActivity(req, 'gate_pass.verify', { entityType: 'gate_pass', entityId: pass._id });

  const problems = problemsFor(pass);
  if (problems.length) passSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', pass, { success: false, reason: problems[0] });
  else passSecurity(req, 'GATE_PASS_QR_VERIFIED', pass, { details: { direction: 'out' } });
  // The exit code only lets a student out. Coming back needs the return
  // credential the student gets after the location check.
  const nextAction = problems.length ? null : pass.status === 'approved' ? 'out' : null;
  const plain = withFlags(pass);
  delete plain.verificationCode;
  res.json({ valid: problems.length === 0, pass: plain, problems, nextAction, returnRequired: pass.status === 'active' });
});

// ── Security: record OUT / IN ───────────────────────────────────────

/**
 * Security's final exit action. Re-checks the code and consumes it in one
 * atomic update, so it works exactly once — a second guard, a replayed
 * request or a re-scan all fail.
 */
export const recordOut = asyncHandler(async (req, res) => {
  const code = normalizeGateCode(req.body.code, QR_PREFIX);
  if (!code) throw new ApiError(422, 'Enter the 4-character gate pass code');
  const pass = await GatePass.findById(req.params.id).select('+verificationCode');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (pass.status !== 'approved') throw new ApiError(pass.actualExit ? 409 : 422, pass.actualExit ? 'Exit has already been recorded' : 'Only an approved, unused pass can be used to exit');
  if (pass.verificationCode !== code) throw new ApiError(422, 'This code does not belong to this gate pass');
  const problems = problemsFor(pass);
  if (problems.length) throw new ApiError(422, problems[0]);

  // A day scholar's Outing has no return step: the exit completes it.
  const now = new Date();
  const set = pass.dayScholarOuting
    ? { status: 'completed', actualExit: now, exitVerifiedBy: req.user._id, verificationExpiry: now }
    : { status: 'active', actualExit: now, exitVerifiedBy: req.user._id };
  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'approved', actualExit: null, verificationCode: code },
    { $set: set, $unset: { verificationCode: 1 } },
    { new: true }
  ).populate('student', STUDENT_FIELDS);
  if (!updated) throw new ApiError(409, 'Exit has already been recorded');

  logActivity(req, 'gate_pass.out', { entityType: 'gate_pass', entityId: pass._id });
  passSecurity(req, 'GATE_PASS_EXIT_CONFIRMED', updated);
  const exitNotice = await returnSvc.notifyExited({ pass: updated, student: updated.student, exitedAt: updated.actualExit });
  logActivity(req, exitNotice.parentSent ? 'gate_pass.parent_exit_notified' : 'gate_pass.parent_exit_notice_failed', { entityType: 'gate_pass', entityId: updated._id });
  logActivity(req, 'gate_pass.code_consumed', { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers(
    [pass.student],
    {
      type: 'gate_pass',
      title: 'Exit recorded',
      message: pass.dayScholarOuting ? 'Have a safe trip. Your outing pass is now complete.' : 'Have a safe trip. Remember to check in when you return.',
      link: `/gate-pass/${pass._id}`,
    },
    { push: false }
  );
  publish(updated);
  res.json(withFlags(updated));
});

/**
 * Security: "Student is inside". Re-checks the return credential and completes
 * the pass in one atomic update, so two guards (or a replayed request) can
 * never complete it twice. Parent and faculty are told only after it commits.
 */
export const recordIn = asyncHandler(async (req, res) => {
  const credential = returnSvc.parseReturnCredential(req.body.code);
  const now = new Date();
  const updated = await GatePass.findOneAndUpdate(
    { _id: req.params.id, status: 'active', actualExit: { $ne: null }, ...credential, returnCredentialExpiresAt: { $gt: now } },
    {
      $set: { status: 'completed', actualReturn: now, returnVerifiedBy: req.user._id, verificationExpiry: now },
      // Every credential is consumed: none of them can be verified again.
      $unset: { verificationCode: 1, returnToken: 1, returnCode: 1 },
    },
    { new: true }
  ).populate('student', STUDENT_FIELDS);
  if (!updated) {
    const pass = await loadPass(req.params.id);
    if (pass.status === 'completed') throw new ApiError(409, 'This student’s return has already been recorded');
    if (pass.status !== 'active') throw new ApiError(422, 'The student has not exited on this pass');
    logActivity(req, 'gate_pass.return_failed', { entityType: 'gate_pass', entityId: pass._id, summary: 'Invalid or expired return credential' });
    passSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', pass, { success: false, reason: 'invalid_or_expired_return_credential' });
    throw new ApiError(422, 'Invalid or expired return code — ask the student to verify their location again');
  }

  logActivity(req, 'gate_pass.in', { entityType: 'gate_pass', entityId: updated._id });
  passSecurity(req, 'GATE_PASS_RETURN_CONFIRMED', updated);
  publish(updated);
  await returnSvc.notifyReturned({ pass: updated, student: updated.student, returnedAt: now });
  res.json(withFlags(updated));
});

// ── Return to campus: student location check → return credential ────

const NOT_OUTSIDE = {
  approved: 'Security has not recorded your exit on this pass yet',
  completed: 'Your return has already been recorded',
};

/**
 * Student (mobile app) sends one GPS reading. The server checks ownership and
 * state, then decides the reading itself; a pass gets a return credential only
 * when the reading is fresh, accurate enough and inside the campus radius.
 */
export const verifyReturnLocation = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('student status actualExit');
  if (!pass || !sameId(pass.student, req.user)) throw new ApiError(404, 'Gate pass not found');
  if (pass.status !== 'active' || !pass.actualExit) {
    throw new ApiError(422, NOT_OUTSIDE[pass.status] || (pass.status.startsWith('pending') || pass.status === 'parent_verified' ? 'This gate pass has not been approved yet' : `This gate pass is ${pass.status}`));
  }

  const reading = pick(req.body, ['latitude', 'longitude', 'accuracy', 'timestamp', 'sentAt']);
  const { distance, reason } = returnSvc.evaluateLocation(reading);
  const now = new Date();
  await ReturnLocationCheck.create({
    gatePass: pass._id,
    student: req.user._id,
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracy: reading.accuracy,
    distanceMeters: Math.round(distance * 100) / 100,
    locationTimestamp: new Date(reading.timestamp),
    result: reason ? 'rejected' : 'verified',
    rejectionReason: reason || undefined,
    verifiedAt: reason ? undefined : now,
  });

  if (reason) {
    logActivity(req, 'gate_pass.return_location_rejected', { entityType: 'gate_pass', entityId: pass._id, summary: reason });
    throw new ApiError(422, returnSvc.LOCATION_MESSAGES[reason], [{ field: 'location', code: reason, message: returnSvc.LOCATION_MESSAGES[reason] }]);
  }

  const credential = await returnSvc.issueReturnCredential(pass._id, req.user._id, now);
  logActivity(req, 'gate_pass.return_location_verified', { entityType: 'gate_pass', entityId: pass._id });
  publish({ _id: pass._id, student: pass.student, status: pass.status }, { returnReady: true });
  res.set('Cache-Control', 'no-store');
  res.json({ verified: true, verifiedAt: now, ...(await returnCredentialBody(credential)) });
});

async function returnCredentialBody({ token, code, expiresAt }) {
  const payload = `${returnSvc.RETURN_QR_PREFIX}${token}`;
  const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  return { code, qr, payload, expiresAt };
}

/** The student's current return QR/code (owner only) — e.g. after reopening the app. */
export const getReturnCredential = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('+returnToken +returnCode');
  if (!pass || !sameId(pass.student, req.user)) throw new ApiError(404, 'Gate pass not found');
  if (pass.status !== 'active' || !pass.returnToken) throw new ApiError(404, 'No return code yet — verify your location first');
  if (pass.returnCredentialExpiresAt <= new Date()) throw new ApiError(410, 'Your return code has expired. Verify your location again.');
  res.set('Cache-Control', 'no-store');
  res.json({
    verifiedAt: pass.returnLocationVerifiedAt,
    // The latest credential came from an Admin, not a location check.
    override: Boolean(pass.returnOverride?.at && (!pass.returnLocationVerifiedAt || pass.returnOverride.at >= pass.returnLocationVerifiedAt)),
    ...(await returnCredentialBody({ token: pass.returnToken, code: pass.returnCode, expiresAt: pass.returnCredentialExpiresAt })),
  });
});

/**
 * Admin marks a student's return when their device cannot pass the location
 * check. Issues the same one-time Return QR / code the location check would
 * (so Security still scans it and records IN at the gate) — it does NOT mark
 * the student as returned. Recorded with who, when and why.
 */
export const adminReturnOverride = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).populate('student', STUDENT_FIELDS);
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (pass.status !== 'active' || !pass.actualExit || pass.dayScholarOuting) {
    throw new ApiError(422, NOT_OUTSIDE[pass.status] || 'This pass is not waiting for a return');
  }
  const reason = String(req.body.reason).trim();
  const now = new Date();
  await returnSvc.issueReturnCredential(pass._id, pass.student._id, now, { by: req.user._id, reason });

  logActivity(req, 'gate_pass.return_override', { entityType: 'gate_pass', entityId: pass._id, summary: reason });
  passSecurity(req, 'GATE_PASS_RETURN_OVERRIDE', pass, { details: { reason } });
  notifyUsers([pass.student._id], {
    type: 'gate_pass',
    title: 'Return approved by Admin',
    message: 'Open your gate pass and show the Return QR / code to Security at the gate.',
    link: `/gate-pass/${pass._id}`,
  });
  publish({ _id: pass._id, student: pass.student._id, status: pass.status }, { returnReady: true });

  // The admin sees that it was issued, never the student's credential itself.
  const updated = await populateAll(GatePass.findById(pass._id));
  res.json(withFlags(updated));
});

/** Security scans the Return QR or types the Return Code. Read-only: it never completes the pass. */
export const verifyReturnCredential = asyncHandler(async (req, res) => {
  const credential = returnSvc.parseReturnCredential(req.body.code);
  const pass = await GatePass.findOne(credential).populate('student', STUDENT_FIELDS);
  if (!pass) {
    logActivity(req, 'gate_pass.return_verify_failed', { summary: 'Unknown return credential' });
    logSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', { success: false, reason: 'unknown_return_credential', entityType: 'gate_pass' });
    throw new ApiError(404, 'Invalid or already-used return code');
  }
  if (pass.status !== 'active' || !pass.actualExit) throw new ApiError(422, 'This pass is not waiting for a return');
  if (pass.returnCredentialExpiresAt <= new Date()) {
    logActivity(req, 'gate_pass.return_verify_failed', { entityType: 'gate_pass', entityId: pass._id, summary: 'Expired return credential' });
    passSecurity(req, 'GATE_PASS_VERIFICATION_FAILED', pass, { success: false, reason: 'expired_return_credential' });
    throw new ApiError(410, 'This return code has expired — ask the student to verify their location again');
  }
  logActivity(req, 'gate_pass.return_verify', { entityType: 'gate_pass', entityId: pass._id });
  passSecurity(req, 'GATE_PASS_QR_VERIFIED', pass, { details: { direction: 'in' } });
  res.json({
    valid: true,
    nextAction: 'inside',
    status: 'return_verification_ready',
    passRef: `GP-${String(pass._id).slice(-6).toUpperCase()}`,
    expiresAt: pass.returnCredentialExpiresAt,
    pass: withFlags(pass),
  });
});

// ── Revoke ─────────────────────────────────────────────────────────

export const revokeGatePass = asyncHandler(async (req, res) => {
  const updated = await GatePass.findOneAndUpdate(
    { _id: req.params.id, status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved'] } },
    {
      $set: { status: 'revoked', revokedBy: req.user._id, revokedAt: new Date(), revokeReason: req.body?.reason || '' },
      $unset: { verificationCode: 1 },
    },
    { new: true }
  );
  if (!updated) {
    const pass = await loadPass(req.params.id);
    throw new ApiError(422, pass.status === 'active' ? 'The student is already outside — record their return instead' : `A ${pass.status} pass cannot be revoked`);
  }

  logActivity(req, 'gate_pass.revoke', { entityType: 'gate_pass', entityId: updated._id });
  passSecurity(req, 'GATE_PASS_REVOKED', updated, { reason: updated.revokeReason || undefined });
  notifyUsers([updated.student], {
    type: 'gate_pass',
    title: 'Gate pass revoked',
    message: updated.revokeReason || 'Your gate pass has been revoked',
    link: `/gate-pass/${updated._id}`,
  });
  publish(updated);
  res.json(withFlags(updated));
});

// ── Staff overview dashboard (admin / faculty / hod / principal / ao / dean / chairman) ────

// College-wide roles that may look back at a past day's gate movements.
const GATE_HISTORY_ROLES = ['admin', 'principal', 'super_admin', ...EMERGENCY_AUTHORITIES];

/**
 * The dashboard guard: faculty keep their class-based masking, and AO / Dean /
 * Chairman — who are not in the normal approval chain — never see a parent's
 * full number for passes that were not sent to them.
 */
async function dashboardGuard(user) {
  const guard = await parentPhoneGuard(user);
  if (!['ao', 'dean', 'chairman'].includes(user.role)) return guard;
  return (pass) => {
    const p = guard(pass);
    return p.passType === 'emergency' && p.emergencyAuthority === user.role ? p : { ...p, parentPhone: otpService.maskMobile(p.parentPhone) };
  };
}

export async function getGatePassUserScopeFilter(user) {
  const { role } = user;
  if (['admin', 'principal', 'dean', 'ao', 'chairman', 'super_admin'].includes(role)) {
    return {};
  }
  if (role === 'hod') {
    const firstYearStudents = await User.find({ year: 1, role: { $in: STUDENT_ROLES } }).distinct('_id');
    if (isFirstYearHod(user)) {
      return {
        $or: [
          { student: { $in: firstYearStudents } },
          { department: FIRST_YEAR_HOD_DEPT },
        ],
      };
    }
    return {
      department: user.department,
      student: { $nin: firstYearStudents },
    };
  }
  if (role === 'faculty') {
    if (user.section) {
      if (user.inChargeYear) {
        const classStudents = await User.find({
          role: { $in: STUDENT_ROLES },
          department: user.department,
          section: user.section,
          year: user.inChargeYear,
        }).distinct('_id');
        return { student: { $in: classStudents } };
      }
      return { department: user.department, section: user.section };
    }
    return { department: user.department };
  }
  if (STUDENT_ROLES.includes(role)) {
    return { student: user._id };
  }
  return {};
}

const stageTitle = (s) => (s ? String(s).replace(/^pending_/, 'Waiting on ').replace(/_/g, ' ') : 'Pending');

export function getPendingStageLabel(pass) {
  if (!pass) return 'Pending';
  if (pass.status === 'pending_faculty') return 'Waiting for Class In-Charge review';
  if (pass.status === 'parent_verified') return 'Parent verified · Waiting for Class In-Charge to forward';
  if (pass.status === 'pending_hod') return 'Waiting for HOD approval';
  if (pass.status === 'pending_principal') return 'Waiting for Principal approval';
  if (pass.status === 'pending_authority') {
    return `Waiting for ${AUTHORITY_LABELS[pass.emergencyAuthority] || 'Authority'} approval`;
  }
  return stageTitle(pass.status);
}

/**
 * One past campus day: exits and returns recorded that day, requests raised
 * that day, and who was still outside when the day ended - all read from the
 * recorded exit / return timestamps, never recomputed from anything the
 * client sends beyond the day itself.
 */
async function gateHistory(req, res, day) {
  if (day > toDay(new Date())) throw new ApiError(422, 'That date is in the future');
  const dayTs = timestampFilter({ from: day, to: day });
  const endOfDay = dayTs.$lt;
  const guard = await dashboardGuard(req.user);
  // A day scholar's Outing ends at the exit, so it is never "outside".
  const outsideFilter = { dayScholarOuting: { $ne: true }, actualExit: { $lt: endOfDay }, $or: [{ actualReturn: null }, { actualReturn: { $gte: endOfDay } }] };

  const [exits, returns, requests, outside, pendingPasses] = await Promise.all([
    GatePass.find({ actualExit: dayTs }).populate('student', STUDENT_FIELDS).populate('exitVerifiedBy', 'name').sort({ actualExit: 1 }).lean(),
    GatePass.find({ actualReturn: dayTs }).populate('student', STUDENT_FIELDS).populate('returnVerifiedBy', 'name').sort({ actualReturn: 1 }).lean(),
    GatePass.countDocuments({ createdAt: dayTs }),
    GatePass.find(outsideFilter).populate('student', STUDENT_FIELDS).populate('exitVerifiedBy', 'name').sort({ toDate: 1 }).lean(),
    GatePass.find({ createdAt: dayTs, status: { $in: GATE_PASS_PENDING_STATUSES } })
      .populate('student', STUDENT_FIELDS)
      .populate('facultyReview.by', REVIEWER_FIELDS)
      .populate('hodReview.by', REVIEWER_FIELDS)
      .populate('principalReview.by', REVIEWER_FIELDS)
      .populate('emergencyReview.by', REVIEWER_FIELDS)
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const overdueAt = (p) => dueByMs(p.toDate) < endOfDay.getTime();
  const view = (p) => ({ ...guard(withFlags(p)), overdue: overdueAt(p) });

  res.json({
    date: day.toISOString().slice(0, 10),
    history: true,
    studentsOutside: outside.length,
    overdue: outside.filter(overdueAt).length,
    todayExits: exits.length,
    todayReturns: returns.length,
    requests,
    outsideStudents: outside.map(view),
    exits: exits.map(view),
    returns: returns.map(view),
    pendingStudents: pendingPasses.map((p) => ({ ...view(p), stageLabel: getPendingStageLabel(p) })),
    todayExitsList: exits.map(view),
    todayReturnsList: returns.map(view),
  });
}

export const gateDashboard = asyncHandler(async (req, res) => {
  await expireGatePasses();
  const day = toDay(new Date());
  if (req.query.date) {
    if (!GATE_HISTORY_ROLES.includes(req.user.role)) throw new ApiError(403, 'Gate history is available to college-wide roles only');
    const asked = toDay(req.query.date);
    if (asked.getTime() !== day.getTime()) return gateHistory(req, res, asked);
  }
  const todayTs = timestampFilter({ from: day, to: day });
  const now = new Date();
  const guard = await dashboardGuard(req.user);
  const scopeFilter = await getGatePassUserScopeFilter(req.user);

  const merge = (base) => {
    if (!scopeFilter || Object.keys(scopeFilter).length === 0) return base;
    return { $and: [scopeFilter, base] };
  };

  const [
    studentsOutside,
    overdue,
    todayExits,
    todayReturns,
    pending,
    approvedToday,
    rejectedToday,
    outsideStudents,
    pendingStudents,
    todayExitsList,
    todayReturnsList,
  ] = await Promise.all([
    GatePass.countDocuments(merge({ status: 'active' })),
    GatePass.countDocuments(merge({ status: 'active', toDate: { $lt: new Date(now.getTime() - DAY - GRACE_AFTER_RETURN_MS) } })),
    GatePass.countDocuments(merge({ actualExit: todayTs })),
    GatePass.countDocuments(merge({ actualReturn: todayTs })),
    GatePass.countDocuments(merge({ status: { $in: GATE_PASS_PENDING_STATUSES } })),
    GatePass.countDocuments(merge({ status: 'approved', updatedAt: todayTs })),
    GatePass.countDocuments(merge({ status: 'rejected', updatedAt: todayTs })),
    GatePass.find(merge({ status: 'active' })).populate('student', STUDENT_FIELDS).populate('exitVerifiedBy', 'name').sort({ toDate: 1 }).lean(),
    GatePass.find(merge({ status: { $in: GATE_PASS_PENDING_STATUSES } }))
      .populate('student', STUDENT_FIELDS)
      .populate('facultyReview.by', REVIEWER_FIELDS)
      .populate('hodReview.by', REVIEWER_FIELDS)
      .populate('principalReview.by', REVIEWER_FIELDS)
      .populate('emergencyReview.by', REVIEWER_FIELDS)
      .sort({ createdAt: -1 })
      .lean(),
    GatePass.find(merge({ actualExit: todayTs })).populate('student', STUDENT_FIELDS).populate('exitVerifiedBy', 'name').sort({ actualExit: -1 }).lean(),
    GatePass.find(merge({ actualReturn: todayTs })).populate('student', STUDENT_FIELDS).populate('returnVerifiedBy', 'name').sort({ actualReturn: -1 }).lean(),
  ]);

  let hostelSummary = null;
  if (['principal', 'admin'].includes(req.user.role)) {
    const totalHostelers = await User.countDocuments({ role: { $in: STUDENT_ROLES }, isActive: true, stayType: 'hosteler' });
    const outsideHostelers = (
      await GatePass.distinct('student', {
        status: 'active',
        actualExit: { $ne: null },
        dayScholarOuting: { $ne: true },
        student: { $in: await User.find({ role: { $in: STUDENT_ROLES }, isActive: true, stayType: 'hosteler' }).distinct('_id') },
      })
    ).length;
    hostelSummary = {
      total: totalHostelers,
      inside: Math.max(0, totalHostelers - outsideHostelers),
      outside: outsideHostelers,
    };
  }

  const formatPending = (p) => {
    const formatted = guard(withFlags(p));
    return {
      ...formatted,
      stageLabel: getPendingStageLabel(p),
    };
  };

  res.json({
    studentsOutside,
    overdue,
    todayExits,
    todayReturns,
    pending,
    approvedToday,
    rejectedToday,
    outsideStudents: outsideStudents.map((p) => guard(withFlags(p))),
    pendingStudents: pendingStudents.map(formatPending),
    todayExitsList: todayExitsList.map((p) => guard(withFlags(p))),
    todayReturnsList: todayReturnsList.map((p) => guard(withFlags(p))),
    hostelSummary,
  });
});

// ── Principal: Institutional Mass Outpass Authorization ─────────────

export const massApproveGatePass = asyncHandler(async (req, res) => {
  if (req.user.role !== 'principal' && req.user.role !== 'admin') {
    throw new ApiError(403, 'Only the principal can authorize institutional mass outpasses');
  }

  const { fromDate, toDate, description, regarding = 'home', destination: reqDest } = req.body;
  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new ApiError(422, 'Invalid departure or return date');
  }
  if (to < from) {
    throw new ApiError(422, 'Return date cannot be before the departure date');
  }
  if (to.getTime() - from.getTime() > MAX_DURATION_MS) {
    throw new ApiError(422, 'A gate pass can cover at most 30 days');
  }
  if (!description || description.trim().length < 3) {
    throw new ApiError(422, 'Description must be at least 3 characters');
  }

  const destination = {
    state: reqDest?.state?.trim() || 'Tamil Nadu',
    district: reqDest?.district?.trim() || 'Home District',
    area: reqDest?.area?.trim() || 'Native / Home Town',
  };

  // Find all active hostellers
  const hostellers = await User.find({
    role: { $in: STUDENT_ROLES },
    stayType: 'hosteler',
    isActive: true,
  })
    .select('name rollNo department year section parentPhone')
    .lean();

  if (!hostellers.length) {
    throw new ApiError(422, 'No active hostellers found in the institution');
  }

  // Find students who already have an active pass (currently outside) or an approved pass
  const activeOrApprovedStudentIds = await GatePass.find({
    status: { $in: ['active', 'approved'] },
  }).distinct('student');
  const excludedSet = new Set(activeOrApprovedStudentIds.map(String));

  // Eligible hostellers: active hostellers currently inside campus with no active/approved pass
  const withoutPass = hostellers.filter((h) => !excludedSet.has(String(h._id)));
  // A pass carries the registered parent number (exit / return SMS go to it).
  // Never invent one: a student with no parent number on file is skipped and
  // reported, so their exit notice can never reach a stranger's phone.
  const eligibleHostellers = withoutPass.filter((h) => String(h.parentPhone || '').trim());
  const missingParentPhone = withoutPass.length - eligibleHostellers.length;

  if (!eligibleHostellers.length) {
    return res.json({
      success: true,
      message: missingParentPhone
        ? `No passes issued: ${missingParentPhone} hosteller(s) have no parent mobile number on file`
        : 'All hostellers already have an active or approved gate pass',
      count: 0,
      totalHostelers: hostellers.length,
      skippedCount: hostellers.length,
      missingParentPhone,
    });
  }

  // Cancel any existing pending requests for these eligible hostellers so the mass outpass cleanly supersedes them
  const eligibleIds = eligibleHostellers.map((h) => h._id);
  await GatePass.updateMany(
    { student: { $in: eligibleIds }, status: { $in: GATE_PASS_PENDING_STATUSES } },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }
  );

  // Guarantee 100% collision-free, non-duplicated verification codes
  const activeCodesInDb = await GatePass.find({ verificationCode: { $ne: null } })
    .select('+verificationCode')
    .distinct('verificationCode');
  const usedCodes = new Set(activeCodesInDb.filter(Boolean));

  const generatedCodes = [];
  for (let i = 0; i < eligibleHostellers.length; i += 1) {
    let code;
    do {
      code = generateGatePassSecurityCode();
    } while (usedCodes.has(code));
    usedCodes.add(code);
    generatedCodes.push(code);
  }

  const now = new Date();
  const expiry = new Date(to.getTime() + DAY + GRACE_AFTER_RETURN_MS);
  const passesToInsert = eligibleHostellers.map((student, idx) => ({
    student: student._id,
    department: student.department,
    section: student.section,
    passType: 'normal',
    regarding,
    description: description.trim(),
    fromDate: from,
    toDate: to,
    parentPhone: student.parentPhone,
    destination,
    status: 'approved',
    principalReview: {
      by: req.user._id,
      at: now,
      action: 'approved',
      reason: description.trim() || 'Institutional Mass Outpass',
    },
    verificationCode: generatedCodes[idx],
    verificationExpiry: expiry,
  }));

  const inserted = await GatePass.insertMany(passesToInsert);

  logActivity(req, 'gate_pass.mass_approve', {
    entityType: 'gate_pass',
    summary: `Authorized institutional mass outpass for ${inserted.length} hosteller(s): ${description.trim()}`,
  });
  passSecurity(req, 'GATE_PASS_MASS_APPROVED', null, {
    details: { count: inserted.length, description: description.trim(), fromDate: from, toDate: to },
  });

  await notifyUsers(eligibleIds, {
    type: 'gate_pass',
    title: 'Institutional Mass Outpass Authorized',
    message: `${description.trim()} · Your gate pass has been approved. Show your QR / code at the gate.`,
    link: '/gate-pass',
  });

  emitToUsers(eligibleIds, 'gatepass:updated', { massOutpass: true, status: 'approved' });
  emitToRoles(GATE_STAFF, 'gatepass:updated', { massOutpass: true });

  res.status(201).json({
    success: true,
    message: `Successfully issued ${inserted.length} institutional mass outpass(es)${missingParentPhone ? ` · ${missingParentPhone} skipped (no parent mobile number on file)` : ''}`,
    count: inserted.length,
    totalHostelers: hostellers.length,
    skippedCount: hostellers.length - inserted.length,
    missingParentPhone,
  });
});

// ── Security dashboard: 3 cards ──────────────────────────────────────

export const securityDashboard = asyncHandler(async (_req, res) => {
  await expireGatePasses();
  const day = toDay(new Date());
  const todayTs = timestampFilter({ from: day, to: day });

  const [totalStudents, outsideStudents, leftToday] = await Promise.all([
    User.countDocuments({ role: { $in: STUDENT_ROLES }, isActive: true }),
    GatePass.find({ status: 'active' }).populate('student', STUDENT_FIELDS).sort({ actualExit: -1 }).lean(),
    GatePass.countDocuments({ actualExit: todayTs }),
  ]);
  const outside = outsideStudents.length;

  res.json({
    total: totalStudents,
    inside: Math.max(0, totalStudents - outside),
    outside,
    leftToday,
    outsideStudents: outsideStudents.map(withFlags),
  });
});

// ── Security dashboard card lists: who "Students in / out / Left today" counts ──

// The guard needs to recognise the student, not contact them: no email / phone.
const GUARD_STUDENT_FIELDS = 'name rollNo avatar department year section';
const GUARD_PASS_FIELDS = 'student passType dayScholarOuting fromDate toDate leaveAt expectedReturnAt actualExit actualReturn status';

const leavePeriod = (p) =>
  p && {
    _id: p._id,
    passType: p.passType,
    dayScholarOuting: !!p.dayScholarOuting,
    fromDate: p.fromDate,
    toDate: p.toDate,
    leaveAt: p.leaveAt,
    expectedReturnAt: p.expectedReturnAt,
    actualExit: p.actualExit,
    actualReturn: p.actualReturn,
    status: p.status,
    overdue: withFlags(p).overdue,
  };

const pickStudent = (s) => s && pick(s, ['_id', 'name', 'rollNo', 'avatar', 'department', 'year', 'section']);

export const securityStudentList = asyncHandler(async (req, res) => {
  await expireGatePasses();
  const { view } = req.query;
  const { page, limit, skip } = paginate(req, 30, 100);
  const search = String(req.query.search || '').trim();
  const studentMatch = { role: { $in: STUDENT_ROLES }, isActive: true };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    studentMatch.$or = [{ name: rx }, { rollNo: rx }];
  }

  if (view === 'in') {
    const outsideIds = await GatePass.distinct('student', { status: 'active' });
    const filter = { ...studentMatch, _id: { $nin: outsideIds } };
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select(GUARD_STUDENT_FIELDS).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    ]);
    // Each student's most recent leave that actually took them off campus.
    const last = await GatePass.aggregate([
      { $match: { student: { $in: users.map((u) => u._id) }, actualExit: { $ne: null } } },
      { $sort: { actualExit: -1 } },
      { $group: { _id: '$student', pass: { $first: '$$ROOT' } } },
    ]);
    const byStudent = new Map(last.map((l) => [String(l._id), l.pass]));
    return res.json({
      view,
      ...pageMeta(total, page, limit),
      items: users.map((u) => ({ student: pickStudent(u), pass: leavePeriod(byStudent.get(String(u._id))) || null })),
    });
  }

  const passFilter = view === 'out' ? { status: 'active' } : { actualExit: timestampFilter({ from: toDay(new Date()), to: toDay(new Date()) }) };
  if (search) passFilter.student = { $in: await User.find(studentMatch).distinct('_id') };
  const [total, passes] = await Promise.all([
    GatePass.countDocuments(passFilter),
    GatePass.find(passFilter)
      .select(GUARD_PASS_FIELDS)
      .populate('student', GUARD_STUDENT_FIELDS)
      .sort({ actualExit: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  res.json({
    view,
    ...pageMeta(total, page, limit),
    items: passes.map((p) => ({ student: pickStudent(p.student), pass: leavePeriod(p) })),
  });
});
