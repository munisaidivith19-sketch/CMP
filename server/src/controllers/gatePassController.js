import QRCode from 'qrcode';
import GatePass, { generateVerificationCode } from '../models/GatePass.js';
import User from '../models/User.js';
import { GATE_PASS_PENDING_STATUSES } from '../constants.js';
import { ApiError, asyncHandler, paginate, pageMeta, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { timestampFilter, resolveRange, toDay } from '../utils/dates.js';

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
const STUDENT_FIELDS = 'name email rollNo avatar department year section phone';
const REVIEWER_FIELDS = 'name role';

const isAdmin = (user) => user.role === 'admin';

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
    .populate('facultyReview.by', REVIEWER_FIELDS)
    .populate('hodReview.by', REVIEWER_FIELDS)
    .populate('principalReview.by', REVIEWER_FIELDS)
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
    filter = { $or: [{ 'facultyReview.by': req.user._id }, { status: 'pending_faculty', department: req.user.department, section: req.user.section }] };
  } else if (role === 'hod') {
    filter = { $or: [{ 'hodReview.by': req.user._id }, { status: 'pending_hod', department: req.user.department }] };
  } else if (role === 'principal') {
    filter = { $or: [{ 'principalReview.by': req.user._id }, { status: 'pending_principal' }] };
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

  res.json({ passes: passes.map(withFlags), pagination: pageMeta(total, page, limit) });
});

// ── Get single gate pass ───────────────────────────────────────────

function canView(pass, user) {
  if (sameId(pass.student, user)) return true;
  if (['admin', 'security'].includes(user.role)) return true;
  if (user.role === 'faculty') return pass.department === user.department && pass.section === user.section;
  if (user.role === 'hod') return pass.department === user.department;
  if (user.role === 'principal') return true;
  return false;
}

export const getGatePass = asyncHandler(async (req, res) => {
  const pass = await populateAll(GatePass.findById(req.params.id));
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!canView(pass, req.user)) throw new ApiError(403, 'Not authorized');
  res.json(withFlags(pass));
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

async function reviewStage(req, res, { stage, from, to, reviewField, canAct, forwardNotify, forwardTitle }) {
  const pass = await loadPass(req.params.id);
  if (pass.status !== from) throw new ApiError(422, `This pass is no longer waiting on ${stage} review`);
  if (!canAct(pass, req.user)) throw new ApiError(403, `You are not the assigned ${stage} reviewer for this pass`);

  const { action, reason } = req.body; // 'forward' | 'reject' (principal sends 'approve' | 'reject')
  const forwarding = action === 'forward' || action === 'approve';
  const review = { by: req.user._id, at: new Date(), action: forwarding ? (to === null ? 'approved' : 'forwarded') : 'rejected', reason: reason || '' };

  const set = { [reviewField]: review };
  if (forwarding) {
    set.status = to === null ? 'approved' : to;
    if (to === null) {
      set.verificationCode = generateVerificationCode();
      // toDate is stored as the start (UTC midnight) of the return day, so the code
      // must stay valid through the END of that day, plus a grace period after.
      set.verificationExpiry = new Date(new Date(pass.toDate).getTime() + DAY + GRACE_AFTER_RETURN_MS);
    }
  } else {
    set.status = 'rejected';
    set.rejectedStage = stage;
    set.rejectedReason = reason || '';
  }

  const updated = await GatePass.findOneAndUpdate({ _id: pass._id, status: from }, { $set: set }, { new: true });
  if (!updated) throw new ApiError(422, 'This pass was just reviewed by someone else');

  logActivity(req, `gate_pass.${stage}_${forwarding ? (to === null ? 'approve' : 'forward') : 'reject'}`, { entityType: 'gate_pass', entityId: pass._id });

  if (forwarding && to === null) {
    await notifyUsers([pass.student], {
      type: 'gate_pass',
      title: 'Gate pass approved',
      message: `Your gate pass was approved. Your code is ${set.verificationCode} — tell it to security at the gate.`,
      link: `/gate-pass/${pass._id}`,
    });
  } else if (forwarding) {
    await notifyUsers([pass.student], { type: 'gate_pass', title: forwardTitle, message: `Forwarded to ${stage === 'faculty' ? 'HOD' : 'the principal'} for review.`, link: `/gate-pass/${pass._id}` }, { push: false });
    await forwardNotify(pass);
  } else {
    await notifyUsers([pass.student], {
      type: 'gate_pass',
      title: 'Gate pass rejected',
      message: `Rejected by ${stage}${reason ? `: ${reason}` : ''}`,
      link: `/gate-pass/${pass._id}`,
    });
  }
  publish(updated);
  res.json(withFlags(await populateAll(GatePass.findById(updated._id))));
}

export const facultyReview = asyncHandler((req, res) =>
  reviewStage(req, res, {
    stage: 'faculty',
    from: 'pending_faculty',
    to: 'pending_hod',
    reviewField: 'facultyReview',
    canAct: (pass, user) => isAdmin(user) || (user.role === 'faculty' && pass.department === user.department && pass.section === user.section),
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
    pending_hod: 'This pass has not been approved yet',
    pending_principal: 'This pass has not been approved yet',
  };
  if (messages[pass.status]) problems.push(messages[pass.status]);
  if (pass.verificationExpiry && now > pass.verificationExpiry) problems.push('The verification window has closed');
  if (pass.status === 'approved' && now < new Date(new Date(pass.fromDate).getTime() - EARLY_EXIT_MS)) {
    problems.push(`Exit is allowed from ${new Date(new Date(pass.fromDate).getTime() - EARLY_EXIT_MS).toLocaleString('en-IN')}`);
  }
  return problems;
}

export const verifyGatePass = asyncHandler(async (req, res) => {
  const code = String(req.body.code).trim().toUpperCase().replace(QR_PREFIX, '').replace(/[\s-]/g, '');
  if (!/^[A-Z]{2}[0-9]{2}$/.test(code)) throw new ApiError(422, 'Enter a valid 4-character code (2 letters + 2 numbers)');

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
  const nextAction = problems.length ? null : pass.status === 'approved' ? 'out' : pass.status === 'active' ? 'in' : null;
  const plain = withFlags(pass);
  delete plain.verificationCode;
  res.json({ valid: problems.length === 0, pass: plain, problems, nextAction });
});

// ── Security: record OUT / IN ───────────────────────────────────────

export const recordOut = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('+verificationCode');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (pass.status !== 'approved') throw new ApiError(422, 'Only an approved, unused pass can be used to exit');
  const problems = problemsFor(pass);
  if (problems.length) throw new ApiError(422, problems[0]);

  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'approved', actualExit: null },
    { $set: { status: 'active', actualExit: new Date(), exitVerifiedBy: req.user._id } },
    { new: true }
  ).populate('student', STUDENT_FIELDS);
  if (!updated) throw new ApiError(409, 'Exit has already been recorded');

  logActivity(req, 'gate_pass.out', { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers([pass.student], { type: 'gate_pass', title: 'Exit recorded', message: 'Have a safe trip. Remember to check in when you return.', link: `/gate-pass/${pass._id}` }, { push: false });
  publish(updated);
  res.json(withFlags(updated));
});

export const recordIn = asyncHandler(async (req, res) => {
  const updated = await GatePass.findOneAndUpdate(
    { _id: req.params.id, status: 'active' },
    // The code is consumed: it can never be verified again.
    { $set: { status: 'completed', actualReturn: new Date(), returnVerifiedBy: req.user._id, verificationExpiry: new Date() }, $unset: { verificationCode: 1 } },
    { new: true }
  ).populate('student', STUDENT_FIELDS);
  if (!updated) {
    await loadPass(req.params.id);
    throw new ApiError(422, 'The student has not exited on this pass');
  }

  logActivity(req, 'gate_pass.in', { entityType: 'gate_pass', entityId: updated._id });
  // Let the student's class faculty know they're back on campus.
  if (updated.department && updated.section) {
    await notifyStage(facultyFilter(updated.department, updated.section), {
      type: 'gate_pass',
      title: 'Student back on campus',
      message: `${updated.student.name}${updated.student.rollNo ? ` (${updated.student.rollNo})` : ''} has entered the college.`,
      link: `/gate-pass/${updated._id}`,
    });
  }
  publish(updated);
  res.json(withFlags(updated));
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
    outsideStudents: outsideStudents.map(withFlags),
  });
});

// ── Security dashboard: 3 cards ──────────────────────────────────────

export const securityDashboard = asyncHandler(async (_req, res) => {
  await expireGatePasses();
  const day = toDay(new Date());
  const todayTs = timestampFilter({ from: day, to: day });

  const [totalStudents, outside, leftToday] = await Promise.all([
    User.countDocuments({ role: { $in: STUDENT_ROLES }, isActive: true }),
    GatePass.countDocuments({ status: 'active' }),
    GatePass.countDocuments({ actualExit: todayTs }),
  ]);

  res.json({ inside: Math.max(0, totalStudents - outside), outside, leftToday });
});
