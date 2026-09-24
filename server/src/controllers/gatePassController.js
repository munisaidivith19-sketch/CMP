import QRCode from 'qrcode';
import GatePass, { generateVerificationCode } from '../models/GatePass.js';
import { ApiError, asyncHandler, paginate, pageMeta, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers, notifyRoles } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { timestampFilter, resolveRange, toDay } from '../utils/dates.js';

export const GATE_STAFF = ['admin', 'faculty', 'hod'];
const HOUR = 3600000;
// A pass can be used from 1 h before the requested exit until 2 h after the expected return.
const EARLY_EXIT_MS = HOUR;
const GRACE_AFTER_RETURN_MS = 2 * HOUR;
const MAX_DURATION_MS = 7 * 24 * HOUR;
const QR_PREFIX = 'CCGP:';
const STUDENT_FIELDS = 'name email rollNo avatar department year section';

const isStaff = (user) => GATE_STAFF.includes(user.role);

/** Live update to the student and to every gate staff member. */
function publish(pass, extra = {}) {
  const payload = { passId: String(pass._id), status: pass.status, studentId: String(pass.student?._id || pass.student), ...extra };
  emitToUsers([pass.student?._id || pass.student], 'gatepass:updated', payload);
  emitToRoles(GATE_STAFF, 'gatepass:updated', payload);
}

const withFlags = (p) => {
  const plain = typeof p.toObject === 'function' ? p.toObject() : p;
  return {
    ...plain,
    overdue: plain.status === 'active' && new Date(plain.expectedReturn) < new Date(),
  };
};

/** Mark passes whose window has closed as expired. Runs on a timer and lazily on verify. */
export async function expireGatePasses() {
  const now = new Date();
  const stale = await GatePass.find({
    $or: [
      { status: 'approved', verificationExpiry: { $lt: now } },
      { status: 'pending', expectedReturn: { $lt: now } },
    ],
  })
    .select('student status')
    .lean();
  if (!stale.length) return 0;
  await GatePass.updateMany(
    { _id: { $in: stale.map((p) => p._id) }, status: { $in: ['approved', 'pending'] } },
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

// ── Student creates a gate pass request ────────────────────────────

export const createGatePass = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['reason', 'description', 'destination', 'expectedExit', 'expectedReturn']);
  const exit = new Date(data.expectedExit);
  const ret = new Date(data.expectedReturn);

  if (ret <= exit) throw new ApiError(422, 'Expected return must be after expected exit');
  if (exit < new Date(Date.now() - 15 * 60000)) throw new ApiError(422, 'Exit time cannot be in the past');
  if (ret - exit > MAX_DURATION_MS) throw new ApiError(422, 'A gate pass can cover at most 7 days');

  const existing = await GatePass.exists({
    student: req.user._id,
    status: { $in: ['pending', 'approved', 'active'] },
  });
  if (existing) throw new ApiError(409, 'You already have a pending or active gate pass');

  const pass = await GatePass.create({ ...data, student: req.user._id });
  logActivity(req, 'gate_pass.create', { entityType: 'gate_pass', entityId: pass._id, summary: pass.reason });

  notifyRoles(GATE_STAFF, {
    type: 'gate_pass',
    title: 'New gate pass request',
    message: `${req.user.name}${req.user.rollNo ? ` (${req.user.rollNo})` : ''} · ${pass.reason.replace('_', ' ')}`,
    link: '/gate-pass?tab=review',
  });
  publish(pass);

  res.status(201).json(withFlags(pass));
});

// ── List gate passes (role-filtered) ───────────────────────────────

export const listGatePasses = asyncHandler(async (req, res) => {
  const filter = {};
  if (!isStaff(req.user)) {
    filter.student = req.user._id;
  } else if (req.query.student) {
    filter.student = req.query.student;
  }
  if (req.query.status === 'overdue') {
    filter.status = 'active';
    filter.expectedReturn = { $lt: new Date() };
  } else if (req.query.status) {
    filter.status = { $in: String(req.query.status).split(',') };
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
    GatePass.find(filter)
      .populate('student', STUDENT_FIELDS)
      .populate('approvedBy', 'name')
      .populate('reviewedBy', 'name')
      .populate('exitVerifiedBy', 'name')
      .populate('returnVerifiedBy', 'name')
      .sort({ status: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    GatePass.countDocuments(filter),
  ]);

  res.json({ passes: passes.map(withFlags), pagination: pageMeta(total, page, limit) });
});

// ── Get single gate pass ───────────────────────────────────────────

export const getGatePass = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id)
    .populate('student', STUDENT_FIELDS)
    .populate('approvedBy', 'name')
    .populate('reviewedBy', 'name')
    .populate('exitVerifiedBy', 'name')
    .populate('returnVerifiedBy', 'name')
    .populate('revokedBy', 'name');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!isStaff(req.user) && !sameId(pass.student, req.user)) throw new ApiError(403, 'Not authorized');
  res.json(withFlags(pass));
});

/**
 * The QR code the student shows at the gate. Only the pass owner can fetch it,
 * and only while the pass is usable. It encodes an opaque random code — no
 * name, roll number or other student data.
 */
export const getGatePassQr = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('+verificationCode');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!sameId(pass.student, req.user)) throw new ApiError(403, 'Only the pass holder can view its QR code');
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

// ── Approve / Reject ───────────────────────────────────────────────

export const reviewGatePass = asyncHandler(async (req, res) => {
  const pass = await loadPass(req.params.id);
  if (sameId(pass.student, req.user)) throw new ApiError(403, 'You cannot review your own gate pass');
  const { action, rejectedReason } = req.body;

  const update =
    action === 'approved'
      ? {
          status: 'approved',
          approvedBy: req.user._id,
          approvedAt: new Date(),
          verificationCode: generateVerificationCode(),
          verificationExpiry: new Date(new Date(pass.expectedReturn).getTime() + GRACE_AFTER_RETURN_MS),
        }
      : { status: 'rejected', rejectedReason: rejectedReason || '' };

  // Atomic pending → reviewed transition: two reviewers cannot both act.
  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'pending' },
    { $set: { ...update, reviewedBy: req.user._id, reviewedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new ApiError(422, 'This pass has already been reviewed or withdrawn');

  logActivity(req, `gate_pass.${action}`, { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers([pass.student], {
    type: 'gate_pass',
    title: `Gate pass ${action}`,
    message:
      action === 'approved'
        ? 'Your gate pass was approved. Show its QR code at the gate.'
        : `Your gate pass was rejected${rejectedReason ? `: ${rejectedReason}` : ''}`,
    link: `/gate-pass/${pass._id}`,
  });
  publish(updated);
  res.json(withFlags(updated));
});

// ── Student withdraws a request ────────────────────────────────────

export const cancelGatePass = asyncHandler(async (req, res) => {
  const pass = await GatePass.findOneAndUpdate(
    { _id: req.params.id, student: req.user._id, status: { $in: ['pending', 'approved'] } },
    { $set: { status: 'cancelled', cancelledAt: new Date() }, $unset: { verificationCode: 1 } },
    { new: true }
  );
  if (!pass) {
    const exists = await GatePass.findById(req.params.id).select('student status').lean();
    if (!exists || !sameId(exists.student, req.user)) throw new ApiError(404, 'Gate pass not found');
    throw new ApiError(422, `A ${exists.status} pass cannot be cancelled`);
  }
  logActivity(req, 'gate_pass.cancel', { entityType: 'gate_pass', entityId: pass._id });
  publish(pass);
  res.json(withFlags(pass));
});

// ── Gate staff: verify a presented code / QR ───────────────────────

function problemsFor(pass) {
  const now = new Date();
  const problems = [];
  const messages = {
    completed: 'This pass has already been used and completed',
    expired: 'This pass has expired',
    revoked: 'This pass has been revoked',
    rejected: 'This pass was rejected',
    cancelled: 'This pass was cancelled by the student',
    pending: 'This pass has not been approved yet',
  };
  if (messages[pass.status]) problems.push(messages[pass.status]);
  if (pass.verificationExpiry && now > pass.verificationExpiry) problems.push('The verification window has closed');
  if (pass.status === 'approved' && now < new Date(new Date(pass.expectedExit).getTime() - EARLY_EXIT_MS)) {
    problems.push(`Exit is allowed from ${new Date(new Date(pass.expectedExit).getTime() - EARLY_EXIT_MS).toLocaleString('en-IN')}`);
  }
  return problems;
}

export const verifyGatePass = asyncHandler(async (req, res) => {
  const code = String(req.body.code).trim().toUpperCase().replace(QR_PREFIX, '').replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{8,20}$/.test(code)) throw new ApiError(422, 'Enter a valid verification code');

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
  const nextAction = problems.length ? null : pass.status === 'approved' ? 'exit' : pass.status === 'active' ? 'return' : null;
  const plain = withFlags(pass);
  delete plain.verificationCode;
  res.json({ valid: problems.length === 0, pass: plain, problems, nextAction });
});

// ── Record exit / return (single-use transitions) ──────────────────

export const recordExit = asyncHandler(async (req, res) => {
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

  logActivity(req, 'gate_pass.exit', { entityType: 'gate_pass', entityId: pass._id });
  notifyUsers([pass.student], { type: 'gate_pass', title: 'Exit recorded', message: 'Have a safe trip. Remember to check in when you return.', link: `/gate-pass/${pass._id}` }, { push: false });
  publish(updated);
  res.json(withFlags(updated));
});

export const recordReturn = asyncHandler(async (req, res) => {
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

  logActivity(req, 'gate_pass.return', { entityType: 'gate_pass', entityId: updated._id });
  publish(updated);
  res.json(withFlags(updated));
});

// ── Revoke ─────────────────────────────────────────────────────────

export const revokeGatePass = asyncHandler(async (req, res) => {
  const updated = await GatePass.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['pending', 'approved'] } },
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

// ── Gate dashboard stats ───────────────────────────────────────────

export const gateDashboard = asyncHandler(async (req, res) => {
  await expireGatePasses();
  const day = toDay(new Date());
  const todayTs = timestampFilter({ from: day, to: day });
  const now = new Date();

  const [studentsOutside, overdue, todayExits, todayReturns, pending, approvedToday, rejectedToday, outsideStudents] = await Promise.all([
    GatePass.countDocuments({ status: 'active' }),
    GatePass.countDocuments({ status: 'active', expectedReturn: { $lt: now } }),
    GatePass.countDocuments({ actualExit: todayTs }),
    GatePass.countDocuments({ actualReturn: todayTs }),
    GatePass.countDocuments({ status: 'pending' }),
    GatePass.countDocuments({ approvedAt: todayTs }),
    GatePass.countDocuments({ status: 'rejected', reviewedAt: todayTs }),
    GatePass.find({ status: 'active' }).populate('student', STUDENT_FIELDS).sort({ expectedReturn: 1 }).lean(),
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
