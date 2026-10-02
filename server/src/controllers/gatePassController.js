import QRCode from 'qrcode';
import GatePass, { generateGatePassSecurityCode, normalizeGateCode } from '../models/GatePass.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import { EMERGENCY_AUTHORITIES, GATE_PASS_PENDING_STATUSES } from '../constants.js';
import { ApiError, asyncHandler, paginate, pageMeta, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { timestampFilter, resolveRange, toDay } from '../utils/dates.js';
import { facultyClasses, inClasses } from '../utils/academicScope.js';
import * as otpService from '../services/otp/otpService.js';
import * as returnSvc from '../services/gatePassReturn.js';
import ReturnLocationCheck from '../models/ReturnLocationCheck.js';

// Everyone whose queue a gate pass can sit in, for the live "updated" event.
export const GATE_STAFF = ['admin', 'faculty', 'hod', 'principal', 'security'];
const STUDENT_ROLES = ['student', 'club_admin'];
const HOUR = 3600000;
const DAY = 24 * HOUR;
// A pass can be used from 1 h before the requested departure until 2 h after the return day ends.
const EARLY_EXIT_MS = HOUR;
const GRACE_AFTER_RETURN_MS = 2 * HOUR;
const MAX_DURATION_MS = 30 * DAY;
const QR_PREFIX = 'CCGP:';
const STUDENT_FIELDS = 'name email rollNo avatar department year section semester phone';
const REVIEWER_FIELDS = 'name role';

const isAdmin = (user) => user.role === 'admin';
// The faculty stage: waiting for the parent OTP, then ready to forward to the HOD.
const FACULTY_STAGE = ['pending_faculty', 'parent_verified'];

/**
 * Admin, or a faculty member who teaches the student's class (department +
 * year + section + semester from the timetable / class in-charge assignment).
 * Read from the database only — nothing about the class comes from the request.
 */
async function isClassFaculty(pass, user) {
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
function publish(pass, extra = {}) {
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
const principalFilter = () => ({ role: 'principal', isActive: true });

async function notifyStage(filter, payload) {
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
    .populate('revokedBy', 'name');
}

// ── Student creates a gate pass request ────────────────────────────

export const createGatePass = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['regarding', 'description', 'fromDate', 'toDate', 'parentPhone']);
  const destination = pick(req.body.destination || {}, ['state', 'district', 'area']);
  const from = new Date(data.fromDate);
  const to = new Date(data.toDate);

  if (to < from) throw new ApiError(422, 'Return date cannot be before the departure date');
  if (to.getTime() - from.getTime() > MAX_DURATION_MS) throw new ApiError(422, 'A gate pass can cover at most 30 days');
  if (!req.user.department || !req.user.section) {
    throw new ApiError(422, 'Your account has no department/section on file — ask an admin to set it');
  }

  const existing = await GatePass.exists({
    student: req.user._id,
    status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved', 'active'] },
  });
  if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');

  const pass = await GatePass.create({
    ...data,
    destination,
    fromDate: from,
    toDate: to,
    student: req.user._id,
    department: req.user.department,
    section: req.user.section,
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

// ── List gate passes (role-filtered queue) ─────────────────────────

export const listGatePasses = asyncHandler(async (req, res) => {
  const { role } = req.user;
  let filter = {};

  if (STUDENT_ROLES.includes(role)) {
    filter.student = req.user._id;
  } else if (role === 'admin') {
    if (req.query.student) filter.student = req.query.student;
  } else if (role === 'faculty') {
    // A class in-charge (section set) only sees their own class. A faculty member
    // with no section assigned isn't tied to one class, so — matching the fallback
    // notification sent when a request has no in-charge to reach — they see every
    // pending request in their department instead of matching nothing at all.
    const scope = req.user.section ? { department: req.user.department, section: req.user.section } : { department: req.user.department };
    filter = { $or: [{ 'facultyReview.by': req.user._id }, { status: { $in: FACULTY_STAGE }, ...scope }] };
  } else if (role === 'hod') {
    filter = { $or: [{ 'hodReview.by': req.user._id }, { status: 'pending_hod', department: req.user.department }] };
  } else if (role === 'principal') {
    filter = { $or: [{ 'principalReview.by': req.user._id }, { status: 'pending_principal' }, { passType: 'emergency', emergencyAuthority: 'principal' }] };
  } else if (EMERGENCY_AUTHORITIES.includes(role)) {
    // AO / Dean / Chairman: only the emergency requests sent to them.
    filter = { passType: 'emergency', emergencyAuthority: role };
  } else if (role === 'security') {
    filter.status = { $in: ['approved', 'active', 'completed'] };
  }

  if (req.query.status === 'overdue') {
    filter.status = 'active';
    filter.toDate = { $lt: new Date(Date.now() - DAY - GRACE_AFTER_RETURN_MS) };
  } else if (req.query.status) {
    const statuses = String(req.query.status).split(',');
    filter = filter.$or ? { $and: [filter, { status: { $in: statuses } }] } : { ...filter, status: { $in: statuses } };
  }
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
  res.json({ passes: passes.map((p) => guard(withFlags(p))), pagination: pageMeta(total, page, limit) });
});

// ── Get single gate pass ───────────────────────────────────────────

function canView(pass, user) {
  if (sameId(pass.student, user)) return true;
  if (['admin', 'security'].includes(user.role)) return true;
  // Emergency passes bypass faculty and HOD; they see one only once the student
  // has actually left (for "outside now" and the return notice).
  if (pass.passType === 'emergency' && ['faculty', 'hod'].includes(user.role) && !pass.actualExit) return false;
  if (user.role === 'faculty') return pass.department === user.department && (!user.section || pass.section === user.section);
  if (user.role === 'hod') return pass.department === user.department;
  if (user.role === 'principal') return true;
  if (EMERGENCY_AUTHORITIES.includes(user.role)) return pass.passType === 'emergency' && pass.emergencyAuthority === user.role;
  return false;
}

export const getGatePass = asyncHandler(async (req, res) => {
  const pass = await populateAll(GatePass.findById(req.params.id));
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!canView(pass, req.user)) throw new ApiError(403, 'Not authorized');
  await logEmergencyViewed(req, [pass]);
  res.json((await parentPhoneGuard(req.user))(withFlags(pass)));
});

/**
 * The code the student reads aloud at the gate. Only the pass owner can fetch
 * it — the QR is a convenience wrapper around the same 4-character code.
 */
export const getGatePassQr = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('+verificationCode');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!sameId(pass.student, req.user)) throw new ApiError(403, 'Only the pass holder can view its code');
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
    forwardNotify: (pass) => notifyStage(hodFilter(pass.department), { type: 'gate_pass', title: 'Gate pass needs your review', message: `Forwarded by class faculty · ${pass.department}`, link: '/gate-pass?tab=review' }),
  })
);

export const hodReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'hod',
    from: 'pending_hod',
    to: 'pending_principal',
    reviewField: 'hodReview',
    canAct: (pass, user) => isAdmin(user) || (user.role === 'hod' && pass.department === user.department),
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

  const existing = await GatePass.exists({ student: req.user._id, status: { $in: [...GATE_PASS_PENDING_STATUSES, 'approved', 'active'] } });
  if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');

  const authorityIds = await User.find({ role: authority, isActive: true }).distinct('_id');
  if (!authorityIds.length) throw new ApiError(422, `No ${AUTHORITY_LABELS[authority]} account is available right now — choose another authority`);

  const doc = pick(req.body.supportingDocument || {}, ['url', 'name', 'mimeType']);
  // Student identity, class and parent number come from the signed-in account, never the request.
  const pass = await GatePass.create({
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

export const getParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  res.set('Cache-Control', 'no-store');
  res.json({ passStatus: pass.status, ...(await otpService.getOtpState(pass._id)), parentMobile: pass.parentPhone });
});

export const requestParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  if (pass.status !== 'pending_faculty') throw new ApiError(422, 'This request is not waiting for parent verification');
  const state = await otpService.requestOtp({ pass, studentName: pass.student?.name || 'Your ward', faculty: req.user });
  otpAudit(req, pass, state.resent ? 'resent' : 'requested', `OTP sent to ${state.maskedMobile}`);
  res.set('Cache-Control', 'no-store');
  res.json({ message: 'OTP sent to the registered parent mobile number', passStatus: pass.status, ...state, parentMobile: pass.parentPhone });
});

export const verifyParentOtp = asyncHandler(async (req, res) => {
  const pass = await loadForParentOtp(req);
  if (pass.status !== 'pending_faculty') throw new ApiError(422, 'This request is not waiting for parent verification');
  try {
    await otpService.verifyOtp({ gatePassId: pass._id, otp: req.body.otp });
  } catch (err) {
    if (err.otpEvent) otpAudit(req, pass, err.otpEvent === 'expired' ? 'expired' : 'verify_failed', err.otpEvent);
    throw err;
  }
  otpAudit(req, pass, 'verified');

  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'pending_faculty' },
    { $set: { status: 'parent_verified', parentVerifiedAt: new Date(), parentVerifiedBy: req.user._id } },
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

export const listDevOtps = asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const provider = otpService.getOtpProvider();
  res.json({ provider: provider.name, otps: await otpService.listDevOtps(), messages: provider.sentMessages?.() || [] });
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
  publish(pass);
  res.json(withFlags(pass));
});

// ── Security: verify a presented code ───────────────────────────────

function problemsFor(pass) {
  const now = new Date();
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
  if (pass.status === 'approved' && now < new Date(new Date(pass.fromDate).getTime() - EARLY_EXIT_MS)) {
    problems.push(`Exit is allowed from ${new Date(new Date(pass.fromDate).getTime() - EARLY_EXIT_MS).toLocaleString('en-IN')}`);
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
    throw new ApiError(404, 'Invalid or already-used verification code');
  }

  pass.lastVerifiedAt = new Date();
  pass.lastVerifiedBy = req.user._id;
  await pass.save();
  logActivity(req, 'gate_pass.verify', { entityType: 'gate_pass', entityId: pass._id });

  const problems = problemsFor(pass);
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

  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'approved', actualExit: null, verificationCode: code },
    { $set: { status: 'active', actualExit: new Date(), exitVerifiedBy: req.user._id }, $unset: { verificationCode: 1 } },
    { new: true }
  ).populate('student', STUDENT_FIELDS);
  if (!updated) throw new ApiError(409, 'Exit has already been recorded');

  logActivity(req, 'gate_pass.out', { entityType: 'gate_pass', entityId: pass._id });
  logActivity(req, 'gate_pass.code_consumed', { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers([pass.student], { type: 'gate_pass', title: 'Exit recorded', message: 'Have a safe trip. Remember to check in when you return.', link: `/gate-pass/${pass._id}` }, { push: false });
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
    throw new ApiError(422, 'Invalid or expired return code — ask the student to verify their location again');
  }

  logActivity(req, 'gate_pass.in', { entityType: 'gate_pass', entityId: updated._id });
  publish(updated);
  const notified = await returnSvc.notifyReturned({ pass: updated, student: updated.student, returnedAt: now });
  logActivity(req, notified.parentSent ? 'gate_pass.parent_return_notified' : 'gate_pass.parent_return_notice_failed', { entityType: 'gate_pass', entityId: updated._id });
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

  const reading = pick(req.body, ['latitude', 'longitude', 'accuracy', 'timestamp']);
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
  res.json({ verifiedAt: pass.returnLocationVerifiedAt, ...(await returnCredentialBody({ token: pass.returnToken, code: pass.returnCode, expiresAt: pass.returnCredentialExpiresAt })) });
});

/** Security scans the Return QR or types the Return Code. Read-only: it never completes the pass. */
export const verifyReturnCredential = asyncHandler(async (req, res) => {
  const credential = returnSvc.parseReturnCredential(req.body.code);
  const pass = await GatePass.findOne(credential).populate('student', STUDENT_FIELDS);
  if (!pass) {
    logActivity(req, 'gate_pass.return_verify_failed', { summary: 'Unknown return credential' });
    throw new ApiError(404, 'Invalid or already-used return code');
  }
  if (pass.status !== 'active' || !pass.actualExit) throw new ApiError(422, 'This pass is not waiting for a return');
  if (pass.returnCredentialExpiresAt <= new Date()) {
    logActivity(req, 'gate_pass.return_verify_failed', { entityType: 'gate_pass', entityId: pass._id, summary: 'Expired return credential' });
    throw new ApiError(410, 'This return code has expired — ask the student to verify their location again');
  }
  logActivity(req, 'gate_pass.return_verify', { entityType: 'gate_pass', entityId: pass._id });
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
  notifyUsers([updated.student], {
    type: 'gate_pass',
    title: 'Gate pass revoked',
    message: updated.revokeReason || 'Your gate pass has been revoked',
    link: `/gate-pass/${updated._id}`,
  });
  publish(updated);
  res.json(withFlags(updated));
});

// ── Staff overview dashboard (admin / faculty / hod / principal) ────

export const gateDashboard = asyncHandler(async (req, res) => {
  await expireGatePasses();
  const day = toDay(new Date());
  const todayTs = timestampFilter({ from: day, to: day });
  const now = new Date();
  const guard = await parentPhoneGuard(req.user);

  const [studentsOutside, overdue, todayExits, todayReturns, pending, approvedToday, rejectedToday, outsideStudents] = await Promise.all([
    GatePass.countDocuments({ status: 'active' }),
    GatePass.countDocuments({ status: 'active', toDate: { $lt: new Date(now.getTime() - DAY - GRACE_AFTER_RETURN_MS) } }),
    GatePass.countDocuments({ actualExit: todayTs }),
    GatePass.countDocuments({ actualReturn: todayTs }),
    GatePass.countDocuments({ status: { $in: GATE_PASS_PENDING_STATUSES } }),
    GatePass.countDocuments({ status: 'approved', updatedAt: todayTs }),
    GatePass.countDocuments({ status: 'rejected', updatedAt: todayTs }),
    GatePass.find({ status: 'active' }).populate('student', STUDENT_FIELDS).sort({ toDate: 1 }).lean(),
  ]);

  res.json({
    studentsOutside,
    overdue,
    todayExits,
    todayReturns,
    pending,
    approvedToday,
    rejectedToday,
    outsideStudents: outsideStudents.map((p) => guard(withFlags(p))),
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
