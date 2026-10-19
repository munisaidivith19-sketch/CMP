import mongoose from 'mongoose';
import User from '../models/User.js';
import Session from '../models/Session.js';
import SecurityLog from '../models/SecurityLog.js';
import AuditLog from '../models/AuditLog.js';
import AttendanceSession from '../models/AttendanceSession.js';
import TimetableSlot from '../models/TimetableSlot.js';
import Event from '../models/Event.js';
import Club from '../models/Club.js';
import GatePass from '../models/GatePass.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { open as openCipher } from '../utils/cipher.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { logAudit } from '../utils/auditLog.js';
import { notifyUsers } from '../utils/notify.js';
import { emitToRoles, disconnectAllExcept } from '../config/socket.js';
import { revokeSessions } from './authController.js';
import { applyDelegation, applyPolicies } from '../services/adminPolicies.js';
import { DELEGATABLE_ROLES, POLICY_CATALOGUE, normalizePolicies } from '../policies.js';
import { GATE_PASS_PENDING_STATUSES, ROLES, SUPER_ADMIN_ROLE } from '../constants.js';
import {
  HEALTH_CHECK_VALID_MS,
  TRANSITIONS,
  TransitionError,
  backupStatus,
  getPlatformState,
  recordHealthCheck,
  runHealthChecks,
  transition,
} from '../services/platformState.js';

/**
 * Super Admin: platform-level administration. Every route is mounted behind
 * protect → authorize('super_admin') (routes/superAdminRoutes.js); sensitive
 * ones also need a recent password re-entry (requireRecentReauth).
 *
 * The Super Admin manages ordinary Admin accounts and their policies, reads
 * security information and runs emergency modes. It has NO direct write
 * access to academic data (attendance, timetables, exams, materials,
 * announcements, gate passes): campus monitoring is read-only aggregates.
 */

const ADMIN_FIELDS = 'name title gender email employeeId phone isActive policyManaged policies delegation mustChangePassword lastLogin createdAt createdBy';
const EDITABLE = ['name', 'title', 'gender', 'phone', 'employeeId'];
// Fields that must never arrive on an admin profile edit (mass assignment).
const PROTECTED = ['role', 'isActive', 'policies', 'policyManaged', 'delegation', 'password', 'mustChangePassword', 'tokenVersion', 'createdBy', 'email'];

const noStore = (res) => res.set('Cache-Control', 'no-store');

async function loadAdmin(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Admin account not found');
  const admin = await User.findOne({ _id: id, role: 'admin' }).select(`${ADMIN_FIELDS} +tokenVersion`);
  if (!admin) throw new ApiError(404, 'Admin account not found');
  return admin;
}

// ── Re-authentication ────────────────────────────────────────────────
export const reauth = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');
  const ok = user && typeof req.body.password === 'string' && (await user.comparePassword(req.body.password));
  if (!ok) {
    logAudit(req, 'SUPER_ADMIN_REAUTH', { outcome: 'denied', target: req.user });
    throw new ApiError(400, 'Password is incorrect');
  }
  await Session.updateOne({ _id: req.sessionId }, { $set: { reauthAt: new Date() } });
  logAudit(req, 'SUPER_ADMIN_REAUTH', { target: req.user });
  noStore(res);
  res.json({ ok: true, validForSec: 300 });
});

// ── Overview ─────────────────────────────────────────────────────────
// Bounded, index-backed counts only; no per-render scans of large collections.
let overviewCache = null; // { body, at } — aggregate numbers only, never authorization
export const overview = asyncHandler(async (_req, res) => {
  noStore(res);
  if (overviewCache && Date.now() - overviewCache.at < 30_000) return res.json(overviewCache.body);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [usersByRole, activeSessions, failed24h, denied24h, state, admins] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', total: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } }]),
    Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
    SecurityLog.countDocuments({ event: 'LOGIN_FAILED', createdAt: { $gte: since } }),
    SecurityLog.countDocuments({ event: 'POLICY_DENIED', createdAt: { $gte: since } }),
    getPlatformState(),
    User.countDocuments({ role: 'admin' }),
  ]);
  const roles = Object.fromEntries(ROLES.map((r) => [r, { total: 0, active: 0 }]));
  usersByRole.forEach((r) => {
    if (roles[r._id]) roles[r._id] = { total: r.total, active: r.active };
  });
  const body = {
    health: {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable',
      uptimeSec: Math.round(process.uptime()),
      platformMode: state.mode === 'normal' ? 'normal' : 'restricted',
    },
    users: { byRole: roles, admins },
    security: { activeSessions, failedLogins24h: failed24h, policyDenials24h: denied24h },
    generatedAt: new Date(),
  };
  overviewCache = { body, at: Date.now() };
  res.json(body);
});

// ── Admin account management ────────────────────────────────────────
export const listAdmins = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = { role: 'admin' };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }];
  }
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  const [items, total] = await Promise.all([
    User.find(filter).select(ADMIN_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  noStore(res);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const createAdmin = asyncHandler(async (req, res) => {
  // email, password and policies are legitimate on create (policies are catalogue-validated below).
  const tampered = PROTECTED.filter((k) => !['email', 'password', 'policies'].includes(k) && req.body[k] !== undefined);
  if (tampered.length) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', reason: 'protected_fields_on_create', details: { fields: tampered } });
    throw new ApiError(422, `These fields cannot be set here: ${tampered.join(', ')}`);
  }
  const email = String(req.body.email).toLowerCase().trim();
  if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists');
  if (req.body.employeeId && (await User.exists({ employeeId: String(req.body.employeeId).trim() }))) {
    throw new ApiError(409, 'That employee ID is already in use');
  }

  // Validated against the catalogue before anything is written.
  let policies;
  try {
    policies = normalizePolicies(req.body.policies ?? []);
  } catch (err) {
    throw new ApiError(422, err.message);
  }

  // The role is fixed by the server: this endpoint only ever creates an ordinary Admin.
  const saved = await User.create({
    ...pick(req.body, EDITABLE),
    email,
    password: req.body.password,
    role: 'admin',
    policyManaged: false,
    policies,
    mustChangePassword: true,
    createdBy: req.user._id,
  });
  await logAudit(req, 'ADMIN_CREATED', { target: saved, details: { email, employeeId: saved.employeeId, role: 'admin', policies } });
  notifyUsers([saved._id], {
    type: 'system',
    title: 'Your VEXON administrator account is ready',
    message: 'Sign in with the temporary password your Super Admin gave you. You must choose a new password at first sign-in.',
  }, { push: false });
  noStore(res);
  res.status(201).json(await User.findById(saved._id).select(ADMIN_FIELDS).lean());
});

export const updateAdmin = asyncHandler(async (req, res) => {
  const tampered = PROTECTED.filter((k) => req.body[k] !== undefined);
  if (tampered.length) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', reason: 'protected_fields_on_edit', details: { fields: tampered, target: req.params.id } });
    throw new ApiError(422, `These fields cannot be edited here: ${tampered.join(', ')}`);
  }
  const admin = await loadAdmin(req.params.id);
  const updates = pick(req.body, EDITABLE);
  if (updates.employeeId && updates.employeeId !== admin.employeeId && (await User.exists({ employeeId: updates.employeeId, _id: { $ne: admin._id } }))) {
    throw new ApiError(409, 'That employee ID is already in use');
  }
  Object.assign(admin, updates);
  const changed = admin.modifiedPaths().filter((p) => EDITABLE.includes(p));
  await admin.save({ validateModifiedOnly: true });
  if (changed.length) await logAudit(req, 'ADMIN_UPDATED', { target: admin, details: { fields: changed } });
  noStore(res);
  res.json(await User.findById(admin._id).select(ADMIN_FIELDS).lean());
});

export const setAdminStatus = asyncHandler(async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const isActive = req.body.isActive === true;
  const reason = String(req.body.reason || '').trim();
  if (admin.isActive === isActive) {
    await logAudit(req, isActive ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED', { outcome: 'unchanged', target: admin, reason });
    return res.json({ admin: await User.findById(admin._id).select(ADMIN_FIELDS).lean(), unchanged: true });
  }
  admin.isActive = isActive;
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save({ validateModifiedOnly: true });
  let revoked = 0;
  if (!isActive) revoked = await revokeSessions({ user: admin._id }, 'super_admin_deactivate');
  await logAudit(req, isActive ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED', { target: admin, reason, details: { sessionsRevoked: revoked } });
  if (isActive) notifyUsers([admin._id], { type: 'system', title: 'Your administrator account was reactivated', message: 'You can sign in again.' }, { push: false });
  noStore(res);
  res.json({ admin: await User.findById(admin._id).select(ADMIN_FIELDS).lean(), sessionsRevoked: revoked });
});

export const resetAdminPassword = asyncHandler(async (req, res) => {
  const admin = await User.findOne({ _id: req.params.id, role: 'admin' }).select('+password +tokenVersion +failedLogins +lockUntil +lastFailedLoginAt +lockoutCount');
  if (!admin) throw new ApiError(404, 'Admin account not found');
  // Temporary credential chosen by the Super Admin and handed over out of band.
  // It is never logged, returned or stored except as the bcrypt hash.
  admin.password = req.body.newPassword;
  admin.mustChangePassword = true;
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  admin.failedLogins = 0;
  admin.lockUntil = undefined;
  admin.lastFailedLoginAt = undefined;
  admin.lockoutCount = 0;
  await admin.save();
  const revoked = await revokeSessions({ user: admin._id }, 'super_admin_password_reset');
  const reason = String(req.body.reason || '').trim() || undefined;
  await logAudit(req, 'ADMIN_PASSWORD_RESET', { target: admin, reason, details: { sessionsRevoked: revoked, forcedChange: true } });
  notifyUsers([admin._id], {
    type: 'system',
    title: 'Your password was reset',
    message: 'A Super Admin reset your password. Sign in with the temporary password and choose a new one.',
  }, { push: false });
  noStore(res);
  res.json({ message: 'Password reset. All sessions were signed out; a new password is required at next sign-in.', sessionsRevoked: revoked });
});

export const revokeAdminSessions = asyncHandler(async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const revoked = await revokeSessions({ user: admin._id }, 'super_admin_revoke');
  await User.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
  await logAudit(req, 'ADMIN_SESSIONS_REVOKED', { target: admin, details: { sessionsRevoked: revoked } });
  noStore(res);
  res.json({ sessionsRevoked: revoked });
});

export const setAdminPolicies = asyncHandler(async (req, res) => {
  const updated = await applyPolicies(req, req.params.id, req.body.policies);
  noStore(res);
  res.json(await User.findById(updated._id).select(ADMIN_FIELDS).lean());
});

export const adminEvents = asyncHandler(async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = { $or: [{ actor: admin._id }, { targetUser: admin._id }] };
  const [items, total, sessions] = await Promise.all([
    SecurityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-userAgent').lean(),
    SecurityLog.countDocuments(filter),
    Session.find({ user: admin._id, revokedAt: null, expiresAt: { $gt: new Date() } }).select('client device ip lastUsedAt createdAt').lean(),
  ]);
  noStore(res);
  res.json({ items, activeSessions: sessions, ...pageMeta(total, page, limit) });
});

export const setAdminDelegation = asyncHandler(async (req, res) => {
  const updated = await applyDelegation(req, req.params.id, req.body.delegation);
  noStore(res);
  res.json(await User.findById(updated._id).select(ADMIN_FIELDS).lean());
});

export const policyCatalogue = (_req, res) => res.json({ modules: POLICY_CATALOGUE, delegatableRoles: DELEGATABLE_ROLES });

// ── Security center ─────────────────────────────────────────────────
export const securityEvents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 25, 100);
  const filter = {};
  if (req.query.event) filter.event = String(req.query.event);
  if (req.query.success === 'false') filter.success = false;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ identifier: rx }, { ip: rx }, { reason: rx }];
  }
  const [items, total] = await Promise.all([
    SecurityLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('actor', 'name email role').populate('targetUser', 'name email role').lean(),
    SecurityLog.countDocuments(filter),
  ]);
  noStore(res);
  res.json({ items, ...pageMeta(total, page, limit) });
});

/** Failed sign-ins in the last 24 h grouped by network address — bounded aggregation. */
export const suspiciousLogins = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await SecurityLog.aggregate([
    { $match: { event: 'LOGIN_FAILED', createdAt: { $gte: since } } },
    { $group: { _id: '$ip', failures: { $sum: 1 }, accounts: { $addToSet: '$identifier' }, last: { $max: '$createdAt' } } },
    { $match: { failures: { $gte: 3 } } },
    { $sort: { failures: -1 } },
    { $limit: 50 },
    { $project: { _id: 0, ip: '$_id', failures: 1, accounts: { $slice: ['$accounts', 10] }, last: 1 } },
  ]);
  noStore(res);
  res.json({ items: rows, since });
});

/** Protected audit trail — read-only; there is no edit or delete endpoint. */
export const auditTrail = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 25, 100);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('actor', 'name email role').populate('target', 'name email role').lean(),
    AuditLog.countDocuments(filter),
  ]);
  noStore(res);
  res.json({ items, ...pageMeta(total, page, limit) });
});

// ── Campus monitoring (read-only aggregates, no personal data) ──────
export const monitoring = asyncHandler(async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [attendanceSessionsToday, activePeriods, upcomingEvents, approvedClubs, pendingGatePasses] = await Promise.all([
    AttendanceSession.countDocuments({ createdAt: { $gte: startOfDay } }),
    TimetableSlot.countDocuments({ isActive: true, isBreak: { $ne: true } }),
    Event.countDocuments({ endDate: { $gte: new Date() } }),
    Club.countDocuments({ status: 'approved' }),
    GatePass.countDocuments({ status: { $in: GATE_PASS_PENDING_STATUSES } }),
  ]);
  noStore(res);
  res.json({
    attendanceSessionsToday,
    activePeriods,
    upcomingEvents,
    approvedClubs,
    pendingGatePasses,
    note: 'Read-only aggregate counts. Super Admin cannot edit academic records, and chat content is not accessible from this role.',
  });
});

// ── Chats (read-only) ───────────────────────────────────────────────
// The Super Admin can read every conversation but has no way to post: the
// confined-role guard keeps it off /chat/* and its sockets never join chat
// rooms. Every conversation opened is recorded in the protected audit trail.
const PERSON = 'name title email role department year section';

export const listChats = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = {};
  if (req.query.type) filter.type = String(req.query.type);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    const people = await User.find({ $or: [{ name: rx }, { email: rx }, { rollNo: rx }] }).limit(200).distinct('_id');
    filter.$or = [{ name: rx }, { participants: { $in: people } }];
  }
  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .select('type name participants status lastMessage updatedAt createdAt linkedDepartment linkedSection linkedYear')
      .populate('participants', PERSON)
      .populate('lastMessage.sender', 'name title')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Conversation.countDocuments(filter),
  ]);
  for (const c of items) {
    if (c.lastMessage?.body) c.lastMessage.body = openCipher(c.lastMessage.body);
    c.participantCount = c.participants?.length || 0;
    c.participants = (c.participants || []).slice(0, 8);
  }
  noStore(res);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const chatMessages = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id).select('type name participants').populate('participants', PERSON).lean();
  if (!conv) throw new ApiError(404, 'Conversation not found');
  const { page, limit, skip } = paginate(req, 50, 100);
  const [items, total] = await Promise.all([
    Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('sender', 'name title role').lean(),
    Message.countDocuments({ conversation: conv._id }),
  ]);
  const messages = items.reverse().map((m) => ({
    _id: m._id,
    sender: m.sender,
    body: m.deletedAt ? null : openCipher(m.body),
    deleted: Boolean(m.deletedAt),
    attachment: m.deletedAt ? undefined : m.attachment,
    editedAt: m.editedAt,
    createdAt: m.createdAt,
  }));
  if (page === 1) logAudit(req, 'CHAT_VIEWED', { details: { conversation: String(conv._id), type: conv.type } });
  noStore(res);
  res.json({ conversation: conv, items: messages, ...pageMeta(total, page, limit) });
});

// ── Backup & recovery ───────────────────────────────────────────────
export const recoveryStatus = asyncHandler(async (_req, res) => {
  const [backup, state] = await Promise.all([backupStatus(), getPlatformState({ fresh: true })]);
  noStore(res);
  res.json({ backup, lastHealthCheck: state.lastHealthCheck || null, healthCheckValidMs: HEALTH_CHECK_VALID_MS });
});

// ── Emergency control ───────────────────────────────────────────────
const stateView = (s) => ({
  mode: s.mode,
  version: s.version || 0,
  reason: s.reason || null,
  message: s.message || null,
  changedAt: s.changedAt || null,
  changedBy: s.changedBy || null,
  enteredRecoveryAt: s.enteredRecoveryAt || null,
  lastHealthCheck: s.lastHealthCheck || null,
  allowedTransitions: TRANSITIONS[s.mode] || [],
});

export const emergencyState = asyncHandler(async (_req, res) => {
  noStore(res);
  res.json(stateView(await getPlatformState({ fresh: true })));
});

// In-process guard against a second operation starting while one runs here.
let operationInFlight = false;

export const emergencyTransition = asyncHandler(async (req, res) => {
  const { to, reason, message, expectedVersion, confirm } = req.body;
  if (confirm !== `CONFIRM ${String(to).toUpperCase()}`) {
    throw new ApiError(422, `Type "CONFIRM ${String(to).toUpperCase()}" to confirm`);
  }
  if (operationInFlight) throw new ApiError(409, 'Another emergency operation is in progress. Try again in a moment.');
  operationInFlight = true;
  try {
    let result;
    try {
      result = await transition({ to, expectedVersion, actorId: req.user._id, reason, message });
    } catch (err) {
      if (err instanceof TransitionError) {
        await logAudit(req, 'EMERGENCY_TRANSITION', { outcome: 'failed', reason, details: { to, error: err.message } });
        throw new ApiError(err.status, err.message, undefined, err.extra?.state ? { state: stateView(err.extra.state) } : undefined);
      }
      throw err;
    }
    if (!result.changed) {
      await logAudit(req, 'EMERGENCY_TRANSITION', { outcome: 'unchanged', reason, details: { to } });
      noStore(res);
      return res.json({ state: stateView(result.state), changed: false });
    }

    // Side effects. Super Admin sessions are never touched: the recovery path stays open.
    const effects = {};
    if (to !== 'normal') {
      effects.socketsDisconnected = await disconnectAllExcept([SUPER_ADMIN_ROLE]);
    }
    if (to === 'lockdown') {
      const supers = await User.find({ role: SUPER_ADMIN_ROLE }).distinct('_id');
      effects.sessionsRevoked = await revokeSessions({ user: { $nin: supers } }, 'emergency_lockdown');
    }
    await logAudit(req, 'EMERGENCY_TRANSITION', { reason, details: { to, version: result.state.version, ...effects } });
    // Alert every Super Admin (protected channel — never broadcast to other roles).
    const supers = await User.find({ role: SUPER_ADMIN_ROLE, isActive: true }).distinct('_id');
    notifyUsers(supers, { type: 'system', title: `Emergency mode: ${to}`, message: `${req.user.name} switched the platform to ${to}. Reason: ${String(reason).slice(0, 120)}` }, { push: true });
    emitToRoles([SUPER_ADMIN_ROLE], 'platform:state', { mode: to, version: result.state.version });
    noStore(res);
    res.json({ state: stateView(result.state), changed: true, effects });
  } finally {
    operationInFlight = false;
  }
});

export const emergencyHealthCheck = asyncHandler(async (req, res) => {
  const result = await runHealthChecks();
  await recordHealthCheck(result, req.user._id);
  await logAudit(req, 'EMERGENCY_HEALTH_CHECK', { outcome: result.ok ? 'success' : 'failed', details: { checks: result.checks.map(({ name, ok, severity }) => ({ name, ok, severity })) } });
  noStore(res);
  res.json(result);
});
