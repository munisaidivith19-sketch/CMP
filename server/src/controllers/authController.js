import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import DeviceToken from '../models/DeviceToken.js';
import LoginHistory from '../models/LoginHistory.js';
import { env } from '../config/env.js';
import { disconnectSessions } from '../config/socket.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sendMail } from '../utils/mailer.js';
import { parseDevice } from '../utils/device.js';
import { logSecurity } from '../utils/securityLog.js';
import { getPlatformState, maintenanceBody, platformAllows } from '../services/platformState.js';
import { SUPER_ADMIN_ROLE } from '../constants.js';
import { withLegal } from '../services/legal.js';
import {
  readRefreshCookie,
  clearRefreshCookie,
  clientTypeOf,
  GATE_DESKTOP_CLIENT,
  isGateDesktopClient,
  isMobileClient,
  isNativeClient,
  newJti,
  refreshExpiry,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';
import {
  calculateLockoutMs,
  getRemainingAttempts,
  getNextLockMinutes,
  checkIpThrottled,
  recordIpFailure,
  checkAnonLockout,
  recordAnonFailure,
} from '../utils/loginSecurity.js';
import { clearCsrfCookie, generateCsrfToken, setCsrfCookie } from '../middleware/security.js';
import { IDLE_MESSAGE, expireIdleSession, idleTimeoutFor, isIdleExpired, recordSessionActivity } from '../utils/sessionIdle.js';

const MAX_PUSH_TOKENS = 5;
// The only role the Windows Gate Scanner signs in (utils/tokens.js → isGateDesktopClient).
export const GATE_SCANNER_ROLE = 'security';
export const GATE_SCANNER_ROLE_MESSAGE = 'The Gate Scanner is for Security staff only. Sign in with a Security account.';
const MAX_CONCURRENT_SESSIONS = 5;
// Compared against when the email is unknown, so both paths cost one bcrypt check.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

/** A readable device label, e.g. "Chrome on Windows" or "Mobile app · Pixel 7". */
export { parseDevice };

// Per-account sign-in lease (User.loginBusyUntil). It expires on its own, so a
// crashed request can never block an account for longer than LOGIN_LEASE_MS.
const LOGIN_LEASE_MS = 5000;
const LOGIN_LEASE_WAIT_MS = 4000;

/** Take the account's sign-in lease, waiting briefly for a parallel attempt to finish. */
async function acquireLoginLease(userId) {
  const deadline = Date.now() + LOGIN_LEASE_WAIT_MS;
  for (;;) {
    const now = new Date();
    const { modifiedCount } = await User.updateOne(
      { _id: userId, $or: [{ loginBusyUntil: null }, { loginBusyUntil: { $lte: now } }] },
      { $set: { loginBusyUntil: new Date(now.getTime() + LOGIN_LEASE_MS) } }
    );
    if (modifiedCount) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function releaseLoginLease(userId) {
  User.updateOne({ _id: userId }, { $unset: { loginBusyUntil: 1 } }).catch(() => null);
}

const clientMeta = (req) => ({
  client: clientTypeOf(req),
  device: parseDevice(req.headers['user-agent'], req),
  userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
  ip: req.ip,
});

/**
 * Create (or rotate) a device session and hand back tokens.
 * Web: refresh token in an httpOnly cookie. Mobile: refresh token in the body.
 * Enforces maximum 5 concurrent active sessions per user (auto-evicting the oldest).
 */
async function issueSession(req, res, user, existingSession) {
  const jti = newJti();
  let session = existingSession;
  if (session) {
    const idleMs = idleTimeoutFor(session.client, user.role);
    session.jti = jti;
    session.idleTimeoutMs = idleMs;
    // Rotation is not user activity: for a session with the web idle rule
    // lastUsedAt only moves on reported activity (utils/sessionIdle.js).
    if (!idleMs) session.lastUsedAt = new Date();
    session.expiresAt = refreshExpiry();
    session.ip = req.ip;
    await session.save();
  } else {
    // Enforce concurrent session limit (max 5 active devices)
    const activeSessions = await Session.find({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: 1, createdAt: 1 })
      .select('_id')
      .lean();

    if (activeSessions.length >= MAX_CONCURRENT_SESSIONS) {
      const evictCount = activeSessions.length - MAX_CONCURRENT_SESSIONS + 1;
      const toEvict = activeSessions.slice(0, evictCount).map((s) => s._id);
      await revokeSessions({ _id: { $in: toEvict } }, 'concurrency_limit');
    }

    const meta = clientMeta(req);
    session = await Session.create({ user: user._id, jti, expiresAt: refreshExpiry(), idleTimeoutMs: idleTimeoutFor(meta.client, user.role), ...meta });
    logSecurity(req, 'SESSION_CREATED', { actor: user, target: user, entityType: 'session', entityId: session._id });
  }

  const refreshToken = signRefreshToken(user, session._id, jti);
  const fresh = await User.findById(user._id).populate('clubs', 'name slug logo');
  // The client uses idleTimeoutSec only for its own timer; the server enforces regardless.
  // `user.legal` tells every client whether the Terms must be accepted first.
  const body = { accessToken: signAccessToken(user, session._id), user: await withLegal(fresh, { enforced: isNativeClient(req) }), idleTimeoutSec: session.idleTimeoutMs ? session.idleTimeoutMs / 1000 : null };

  if (isNativeClient(req)) {
    body.refreshToken = refreshToken;
  } else {
    setRefreshCookie(res, refreshToken);
    // Double-submit CSRF cookie for browser clients (echoed in X-CSRF-Token).
    setCsrfCookie(res, generateCsrfToken());
  }
  return body;
}

export async function revokeSessions(filter, reason) {
  const sessions = await Session.find({ ...filter, revokedAt: null }).select('_id').lean();
  if (!sessions.length) return 0;
  const ids = sessions.map((s) => s._id);
  await Session.updateMany({ _id: { $in: ids } }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  disconnectSessions(ids);
  // A signed-out / revoked device must stop receiving this user's pushes.
  await DeviceToken.deleteMany({ session: { $in: ids } });
  await User.updateMany({ 'pushTokens.session': { $in: ids } }, { $pull: { pushTokens: { session: { $in: ids } } } });
  return ids.length;
}

function recordLogin(req, user, success, reason) {
  return LoginHistory.create({
    user: user._id,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    device: parseDevice(req.headers['user-agent'], req),
    success,
    reason,
  }).catch(() => null);
}

// Public sign-up always creates a *student*. Faculty / club admin / admin roles
// are granted by an administrator — never self-assigned.
const COLLEGE_EMAIL_DOMAIN = /^\S+@jnn\.edu\.in$/i;

export const register = asyncHandler(async (req, res) => {
  // Self sign-up was removed from the app: without it an outsider with any
  // @jnn.edu.in-looking address (never verified) could create a student
  // account in a class of their choosing.
  if (!env.allowSelfSignup) throw new ApiError(403, 'Self sign-up is disabled. Your account is created by the college administrator.');
  const data = pick(req.body, ['name', 'email', 'password', 'department', 'year', 'rollNo']);
  if (!COLLEGE_EMAIL_DOMAIN.test(String(data.email || ''))) {
    throw new ApiError(400, 'Use your @jnn.edu.in college email to sign up');
  }
  const exists = await User.exists({ email: String(data.email).toLowerCase() });
  if (exists) throw new ApiError(409, 'An account with this email already exists');

  const user = await User.create({ ...data, role: 'student' });
  req.user = user;
  logActivity(req, 'auth.register', { entityType: 'user', entityId: user._id, summary: user.name });
  recordLogin(req, user, true);
  res.status(201).json(await issueSession(req, res, user));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').toLowerCase().trim();

  // 1. IP-Level Throttling Check (protects against distributed attacks from a single IP)
  const ipCheck = await checkIpThrottled(req.ip);
  if (ipCheck.locked) {
    throw new ApiError(423, `Too many failed sign-in attempts from this network. Try again in ${ipCheck.mins} minute(s).`, null, {
      locked: true,
      ipLocked: true,
      lockUntil: ipCheck.lockUntil,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
      remainingAttempts: 0,
    });
  }

  const LOGIN_FIELDS = '+password +failedLogins +lockUntil +lastFailedLoginAt +lockoutCount +tokenVersion';
  let user = await User.findOne({ email: normalizedEmail }).select(LOGIN_FIELDS);

  // Serialize attempts on one account: every attempt reads, decides and writes
  // the failure counter while holding the lease, then re-reads it fresh.
  if (user) {
    if (!(await acquireLoginLease(user._id))) {
      throw new ApiError(429, 'A sign-in for this account is already in progress. Please try again in a moment.');
    }
    const leaseId = user._id;
    res.once('close', () => releaseLoginLease(leaseId));
    user = await User.findById(leaseId).select(LOGIN_FIELDS);
  }

  // 2. Anti-Enumeration Defense for Non-Existent Users
  if (!user) {
    const anonCheck = await checkAnonLockout(normalizedEmail);
    if (anonCheck.locked) {
      await bcrypt.compare(String(password), DUMMY_HASH); // equalize response timing
      throw new ApiError(423, `Too many failed attempts. Try again in ${anonCheck.mins} minute(s).`, null, {
        locked: true,
        lockUntil: anonCheck.lockUntil,
        retryAfterSeconds: anonCheck.retryAfterSeconds,
        remainingAttempts: 0,
      });
    }

    await bcrypt.compare(String(password), DUMMY_HASH); // equalize response timing
    await recordIpFailure(req.ip);
    logSecurity(req, 'LOGIN_FAILED', { actor: null, success: false, identifier: normalizedEmail, reason: 'unknown_account' });
    const anonRes = await recordAnonFailure(normalizedEmail);

    if (anonRes.locked) {
      throw new ApiError(423, `Too many failed attempts. Account locked for ${anonRes.mins} minute(s).`, null, {
        locked: true,
        lockUntil: anonRes.lockUntil,
        retryAfterSeconds: anonRes.retryAfterSeconds,
        remainingAttempts: 0,
      });
    }

    // Word this exactly like the real-account failure below: any difference in
    // the message tells an attacker which emails have accounts.
    throw new ApiError(401, `Invalid email or password. ${anonRes.remainingAttempts} attempt(s) remaining before ${anonRes.nextLockMinutes}-minute lock.`, null, {
      remainingAttempts: anonRes.remainingAttempts,
      nextLockMinutes: anonRes.nextLockMinutes,
    });
  }

  // 3. 24-Hour Cooldown Clean-up
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  if (user.lastFailedLoginAt && Date.now() - user.lastFailedLoginAt.getTime() > COOLDOWN_MS) {
    user.failedLogins = 0;
    user.lockUntil = undefined;
    await user.save({ validateModifiedOnly: true });
  }

  // 4. Existing User Lockout Check
  if (user.lockUntil && user.lockUntil > new Date()) {
    recordLogin(req, user, false, 'account_locked');
    logSecurity(req, 'LOGIN_FAILED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'account_locked' });
    const retryAfterSeconds = Math.ceil((user.lockUntil.getTime() - Date.now()) / 1000);
    const mins = Math.ceil(retryAfterSeconds / 60);
    throw new ApiError(423, `Too many failed attempts. Try again in ${mins} minute(s).`, null, {
      locked: true,
      lockUntil: user.lockUntil.toISOString(),
      retryAfterSeconds,
      remainingAttempts: 0,
    });
  }

  // 5. Password Verification
  const ok = await user.comparePassword(password);
  if (!ok) {
    await recordIpFailure(req.ip);
    logSecurity(req, 'LOGIN_FAILED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'invalid_password' });
    user.failedLogins = (user.failedLogins || 0) + 1;
    user.lastFailedLoginAt = new Date();

    const remainder = user.failedLogins % 3;
    if (remainder === 0) {
      // Escalation reached: 3 fails -> 5m, 6 fails -> 10m, 9 fails -> 30m, 12+ fails -> 60m
      const lockMs = calculateLockoutMs(user.failedLogins);
      const lockMins = Math.round(lockMs / 60000);
      user.lockUntil = new Date(Date.now() + lockMs);
      user.lockoutCount = (user.lockoutCount || 0) + 1;
      await user.save({ validateModifiedOnly: true });
      recordLogin(req, user, false, 'invalid_password');
      logActivity(req, 'auth.lockout', { user, entityType: 'user', entityId: user._id, summary: `${lockMins}m lockout` });

      const device = parseDevice(req.headers['user-agent'], req);
      const retryAfterSeconds = Math.ceil(lockMs / 1000);

      // Automated Security Alerts: In-App Notification + Push
      notifyUsers([user._id], {
        type: 'system',
        title: 'Security Alert: Account Temporarily Locked',
        message: `Your account was locked for ${lockMins} minutes following repeated failed sign-ins from ${device} (${req.ip}). If this wasn't you, contact your Class In-Charge or Admin.`,
        link: '/settings/security',
      });

      // Automated Security Alerts: HTML Email
      sendMail({
        to: user.email,
        subject: 'Security Alert: Account Temporarily Locked - CampusConnect',
        text: `Hi ${user.name},\n\nWe detected ${user.failedLogins} consecutive failed sign-in attempts to your CampusConnect account.\n\n• Device: ${device}\n• IP Address: ${req.ip}\n• Date & Time: ${new Date().toUTCString()}\n\nAs a security precaution, your account has been temporarily locked for ${lockMins} minutes.\n\nIf this was you, you may try again once the timer expires.\n\nIf this was NOT you, someone may be attempting to access your account. Contact your Class In-Charge or Admin to reset your password.\n\nCampusConnect Security Team`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2 style="color:#e11d48;margin-top:0;">🛡️ Security Alert: Account Locked</h2>
          <p>Hi <strong>${user.name.replace(/[<>&]/g, '')}</strong>,</p>
          <p>We detected <strong>${user.failedLogins} consecutive failed sign-in attempts</strong> to your CampusConnect account.</p>
          <div style="background:#f8fafc;padding:14px 18px;border-radius:10px;margin:18px 0;font-size:14px;color:#334155;">
            <p style="margin:4px 0;"><strong>Device:</strong> ${device}</p>
            <p style="margin:4px 0;"><strong>IP Address:</strong> ${req.ip}</p>
            <p style="margin:4px 0;"><strong>Lockout Duration:</strong> ${lockMins} minutes</p>
          </div>
          <p>Forgot your password? Contact your Class In-Charge or Admin to reset your password.</p>
          <p style="color:#64748b;font-size:12px;margin-top:24px;">If you were the one attempting to sign in, simply wait for the timer to expire and try again.</p>
        </div>`,
      });

      throw new ApiError(423, `Too many failed attempts. Account locked for ${lockMins} minute(s).`, null, {
        locked: true,
        lockUntil: user.lockUntil.toISOString(),
        retryAfterSeconds,
        remainingAttempts: 0,
      });
    } else {
      await user.save({ validateModifiedOnly: true });
      recordLogin(req, user, false, 'invalid_password');
      const remaining = 3 - remainder;
      const nextLockMins = getNextLockMinutes(user.failedLogins);
      throw new ApiError(401, `Invalid email or password. ${remaining} attempt(s) remaining before ${nextLockMins}-minute lock.`, null, {
        remainingAttempts: remaining,
        nextLockMinutes: nextLockMins,
      });
    }
  }

  if (!user.isActive) {
    recordLogin(req, user, false, 'account_suspended');
    logSecurity(req, 'LOGIN_FAILED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'account_disabled' });
    throw new ApiError(403, 'This account has been suspended. Contact the administrator.');
  }

  // Super Admin signs in on the web console only: the Android app has no
  // Super Admin screens, and keeping the role off mobile narrows its exposure.
  if (user.role === SUPER_ADMIN_ROLE && isMobileClient(req)) {
    logSecurity(req, 'LOGIN_FAILED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'super_admin_web_only' });
    throw new ApiError(403, 'Sign in to the Super Admin console from the web dashboard.');
  }
  // The Windows Gate Scanner is for the Security role only (role read from the database).
  if (isGateDesktopClient(req) && user.role !== GATE_SCANNER_ROLE) {
    recordLogin(req, user, false, 'gate_scanner_role');
    logSecurity(req, 'LOGIN_FAILED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'gate_scanner_role' });
    throw new ApiError(403, GATE_SCANNER_ROLE_MESSAGE, undefined, { code: 'GATE_SCANNER_ROLE_REQUIRED' });
  }
  // Maintenance / lockdown / recovery: correct credentials, but only a Super Admin gets a session.
  if (!(await platformAllows(user))) {
    logSecurity(req, 'MAINTENANCE_BLOCKED', { actor: null, target: user, success: false, identifier: normalizedEmail, reason: 'login' });
    throw new ApiError(503, maintenanceBody(await getPlatformState()).message, undefined, { code: 'MAINTENANCE', maintenance: true });
  }

  // 6. Successful Authentication: reset the account's counters. The per-IP
  // failure counter is left alone (it only expires by TTL; see loginSecurity.js).
  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastFailedLoginAt = undefined;
  user.lastLogin = new Date();
  await user.save({ validateModifiedOnly: true });

  // New-device detection: first successful sign-in from this device label.
  const device = parseDevice(req.headers['user-agent'], req);
  const [seenDevice, hasHistory] = await Promise.all([
    LoginHistory.exists({ user: user._id, success: true, device }),
    LoginHistory.exists({ user: user._id, success: true }),
  ]);

  req.user = user;
  logActivity(req, 'auth.login', { entityType: 'user', entityId: user._id, summary: device });
  logSecurity(req, 'LOGIN_SUCCESS', { actor: user, target: user });
  await recordLogin(req, user, true);

  const session = await issueSession(req, res, user);
  if (hasHistory && !seenDevice) {
    notifyUsers([user._id], {
      type: 'system',
      title: 'New sign-in to your account',
      message: `${device} · If this wasn't you, change your password and sign out other sessions.`,
      link: '/settings/security',
    });
  }
  res.json(session);
});

/** Rotate the refresh token and hand back a fresh access token. */
export const refresh = asyncHandler(async (req, res) => {
  const mobile = isNativeClient(req);
  const token = mobile ? req.body?.refreshToken : readRefreshCookie(req);
  if (!token || typeof token !== 'string') throw new ApiError(401, 'No active session');

  const fail = (message) => {
    if (!mobile) clearRefreshCookie(res);
    return new ApiError(401, message);
  };

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw fail('Session expired, please sign in again');
  }
  if (!payload.sid || !payload.jti) throw fail('Session is no longer valid');

  const session = await Session.findById(payload.sid).select('+jti');
  if (!session || String(session.user) !== String(payload.sub) || !session.isLive()) {
    throw fail('Session is no longer valid');
  }
  if (session.jti !== payload.jti) {
    // A rotated-out refresh token was replayed: treat the session as stolen.
    await revokeSessions({ _id: session._id }, 'refresh_token_reuse');
    logActivity(req, 'auth.token_reuse', { user: { _id: session.user }, entityType: 'session', entityId: session._id });
    logSecurity(req, 'SESSION_REVOKED', { actor: null, target: { _id: session.user }, success: false, reason: 'refresh_token_reuse', entityType: 'session', entityId: session._id });
    throw fail('Session is no longer valid');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive || (user.tokenVersion || 0) !== payload.v) {
    await revokeSessions({ _id: session._id }, 'token_version');
    logSecurity(req, 'REFRESH_FAILED', {
      actor: null,
      target: user || { _id: session.user },
      success: false,
      reason: !user ? 'account_missing' : !user.isActive ? 'account_disabled' : 'credentials_changed',
      entityType: 'session',
      entityId: session._id,
    });
    throw fail('Session is no longer valid');
  }

  // A Gate Scanner session ends for good once its account is no longer Security.
  if (session.client === GATE_DESKTOP_CLIENT && user.role !== GATE_SCANNER_ROLE) {
    await revokeSessions({ _id: session._id }, 'gate_scanner_role');
    logSecurity(req, 'REFRESH_FAILED', { actor: null, target: user, success: false, reason: 'gate_scanner_role', entityType: 'session', entityId: session._id });
    const err = fail(GATE_SCANNER_ROLE_MESSAGE);
    err.data = { code: 'GATE_SCANNER_ROLE_REQUIRED' };
    throw err;
  }

  // An idle web session cannot be revived by its refresh token: it is revoked
  // here, so this and every older refresh token for it are dead for good.
  if (isIdleExpired(session, idleTimeoutFor(session.client, user.role))) {
    await expireIdleSession(session._id, user._id, req.ip);
    const err = fail(IDLE_MESSAGE);
    err.data = { reason: 'idle' };
    throw err;
  }

  // Outside normal mode only a Super Admin session is renewed (the session itself is kept).
  if (!(await platformAllows(user))) {
    throw new ApiError(503, maintenanceBody(await getPlatformState()).message, undefined, { code: 'MAINTENANCE', maintenance: true });
  }

  res.json(await issueSession(req, res, user, session));
});

/** Sign out this device only. */
export const logout = asyncHandler(async (req, res) => {
  const token = isNativeClient(req) ? req.body?.refreshToken : readRefreshCookie(req);
  if (token && typeof token === 'string') {
    try {
      const { sid, sub } = verifyRefreshToken(token);
      if (sid) {
        // The web client signs out with reason "idle" when its inactivity
        // timer fires; it is recorded separately for the audit trail only.
        const idle = req.body?.reason === 'idle';
        await revokeSessions({ _id: sid, user: sub }, idle ? 'idle_timeout_client' : 'logout');
        logActivity(req, idle ? 'auth.idle_logout' : 'auth.logout', { user: { _id: sub }, entityType: 'session', entityId: sid });
        const who = (await User.findById(sub).select('role').lean()) || { _id: sub };
        logSecurity(req, idle ? 'SESSION_EXPIRED' : 'LOGOUT', { actor: who, target: who, reason: idle ? 'idle_timeout_client' : undefined, entityType: 'session', entityId: sid });
      }
      if (typeof req.body?.pushToken === 'string') {
        // The device stops receiving this user's pushes once it signs out.
        await User.updateOne({ _id: sub }, { $pull: { pushTokens: { token: req.body.pushToken } } });
      }
    } catch {
      /* token already invalid — nothing to revoke */
    }
  }
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  res.json({ message: 'Signed out' });
});

/**
 * Reported user activity for the web idle rule. The web client calls this at
 * most once every ~30 s, and only after real interaction — never on a timer.
 * The write itself is conditional (see recordSessionActivity), so this can
 * never cost more than one write per ~25 s per session. Sessions without the
 * rule (mobile, exempt roles) are a no-op. Already-idle sessions never get
 * here: protect has rejected them.
 */
export const recordActivity = asyncHandler(async (req, res) => {
  if (req.sessionIdleTimeoutMs && req.sessionId) await recordSessionActivity(req.sessionId);
  res.json({ idleTimeoutSec: req.sessionIdleTimeoutMs ? req.sessionIdleTimeoutMs / 1000 : null });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('clubs', 'name slug logo');
  res.json(await withLegal(user, { enforced: req.sessionClient !== 'web' }));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await user.comparePassword(currentPassword))) {
    logSecurity(req, 'PASSWORD_CHANGED', { target: req.user, success: false, reason: 'wrong_current_password' });
    throw new ApiError(400, 'Current password is incorrect');
  }
  if (await user.comparePassword(newPassword)) throw new ApiError(422, 'New password must be different from the current one');
  user.password = newPassword;
  user.mustChangePassword = false; // a temporary password has now been replaced
  user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidates refresh tokens everywhere
  await user.save();

  // Every other device is signed out; this device gets a rotated session.
  const signedOut = await revokeSessions({ user: user._id, _id: { $ne: req.sessionId } }, 'password_change');
  logSecurity(req, 'PASSWORD_CHANGED', { target: req.user, details: { otherSessionsSignedOut: signedOut } });
  if (signedOut) logSecurity(req, 'SESSION_REVOKED', { target: req.user, reason: 'password_change', details: { count: signedOut } });
  const current = req.sessionId ? await Session.findById(req.sessionId) : null;
  logActivity(req, 'auth.password_change', { entityType: 'user', entityId: user._id });
  notifyUsers([user._id], {
    type: 'system',
    title: 'Your password was changed',
    message: 'All other sessions were signed out.',
    link: '/settings/security',
  });
  res.json(await issueSession(req, res, user, current?.isLive() ? current : undefined));
});

// ── Password reset ─────────────────────────────────────────────────
// Email password reset is retired. A forgotten password is reset by the
// student's Class In-Charge or an Admin (POST /users/:id/reset-password), who
// are authorized server-side. These two endpoints remain only so older
// clients get a clear answer; they never read or change an account.

export const PASSWORD_HELP_MESSAGE = 'Forgot your password? Contact your Class In-Charge or Admin to reset your password.';

export const forgotPassword = asyncHandler(async () => {
  throw new ApiError(410, PASSWORD_HELP_MESSAGE);
});

export const resetPassword = asyncHandler(async () => {
  throw new ApiError(410, PASSWORD_HELP_MESSAGE);
});

// ── Sessions / devices ─────────────────────────────────────────────

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ user: req.user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  res.json(sessions.map((s) => ({ ...s, current: String(s._id) === String(req.sessionId) })));
});

export const revokeSession = asyncHandler(async (req, res) => {
  const n = await revokeSessions({ _id: req.params.id, user: req.user._id }, 'user_revoked');
  if (!n) throw new ApiError(404, 'Session not found');
  logActivity(req, 'auth.session_revoke', { entityType: 'session', entityId: req.params.id });
  logSecurity(req, 'SESSION_REVOKED', { target: req.user, reason: 'user_revoked', entityType: 'session', entityId: req.params.id });
  res.json({ message: 'Session signed out' });
});

export const revokeOtherSessions = asyncHandler(async (req, res) => {
  const n = await revokeSessions({ user: req.user._id, _id: { $ne: req.sessionId } }, 'user_revoked_others');
  logActivity(req, 'auth.session_revoke_others', { entityType: 'user', entityId: req.user._id, summary: `${n} sessions` });
  if (n) logSecurity(req, 'SESSION_REVOKED', { target: req.user, reason: 'user_revoked_others', details: { count: n } });
  res.json({ message: n ? `Signed out ${n} other session(s)` : 'No other active sessions', count: n });
});

// ── Login history ──────────────────────────────────────────────────

export const getLoginHistory = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    LoginHistory.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    LoginHistory.countDocuments({ user: req.user._id }),
  ]);

  res.json({
    records,
    pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});

// ── Mobile push tokens ─────────────────────────────────────────────

export const registerPushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  // A device token belongs to whoever signed in on that device most recently.
  await User.updateMany({ _id: { $ne: req.user._id } }, { $pull: { pushTokens: { token } } });
  const user = await User.findById(req.user._id).select('+pushTokens');
  const rest = (user.pushTokens || []).filter((t) => t.token !== token);
  // Bound to this session: revoking or signing it out drops the token (revokeSessions).
  user.pushTokens = [...rest, { token, addedAt: new Date(), session: req.sessionId }].slice(-MAX_PUSH_TOKENS);
  await user.save({ validateModifiedOnly: true });
  res.json({ ok: true });
});

export const removePushToken = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token: req.body.token } } });
  res.json({ ok: true });
});
