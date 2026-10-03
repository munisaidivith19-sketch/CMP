import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import LoginHistory from '../models/LoginHistory.js';
import { env } from '../config/env.js';
import { disconnectSessions } from '../config/socket.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sendMail } from '../utils/mailer.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  hashToken,
  isMobileClient,
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
  clearIpFailure,
  checkAnonLockout,
  recordAnonFailure,
} from '../utils/loginSecurity.js';
import { CSRF_COOKIE, generateCsrfToken } from '../middleware/security.js';

const MAX_PUSH_TOKENS = 5;
const MAX_CONCURRENT_SESSIONS = 5;
// Compared against when the email is unknown, so both paths cost one bcrypt check.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

/** A readable device label, e.g. "Chrome on Windows" or "CampusConnect app · Pixel 7". */
export function parseDevice(ua = '', req) {
  const mobileName = req?.get?.('x-device-name');
  if (req && isMobileClient(req)) {
    return `Mobile app${mobileName ? ` · ${String(mobileName).replace(/[^\w .\-()]/g, '').slice(0, 60)}` : ''}`;
  }
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}

const clientMeta = (req) => ({
  client: isMobileClient(req) ? 'mobile' : 'web',
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
    session.jti = jti;
    session.lastUsedAt = new Date();
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

    session = await Session.create({ user: user._id, jti, expiresAt: refreshExpiry(), ...clientMeta(req) });
  }

  const refreshToken = signRefreshToken(user, session._id, jti);
  const fresh = await User.findById(user._id).populate('clubs', 'name slug logo');
  const body = { accessToken: signAccessToken(user, session._id), user: fresh };

  if (isMobileClient(req)) {
    body.refreshToken = refreshToken;
  } else {
    setRefreshCookie(res, refreshToken);
    // Double-submit CSRF cookie for browser clients
    const csrfToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false, // Accessible to client-side JS to attach to X-CSRF-Token header
      secure: env.isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  return body;
}

async function revokeSessions(filter, reason) {
  const sessions = await Session.find({ ...filter, revokedAt: null }).select('_id').lean();
  if (!sessions.length) return 0;
  const ids = sessions.map((s) => s._id);
  await Session.updateMany({ _id: { $in: ids } }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  disconnectSessions(ids);
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
  const ipCheck = checkIpThrottled(req.ip);
  if (ipCheck.locked) {
    throw new ApiError(423, `Too many failed sign-in attempts from this network. Try again in ${ipCheck.mins} minute(s).`, null, {
      locked: true,
      ipLocked: true,
      lockUntil: ipCheck.lockUntil,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
      remainingAttempts: 0,
    });
  }

  const user = await User.findOne({ email: normalizedEmail }).select(
    '+password +failedLogins +lockUntil +lastFailedLoginAt +lockoutCount +tokenVersion'
  );

  // 2. Anti-Enumeration Defense for Non-Existent Users
  if (!user) {
    const anonCheck = checkAnonLockout(req.ip, normalizedEmail);
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
    recordIpFailure(req.ip);
    const anonRes = recordAnonFailure(req.ip, normalizedEmail);

    if (anonRes.locked) {
      throw new ApiError(423, `Too many failed attempts. Account locked for ${anonRes.mins} minute(s).`, null, {
        locked: true,
        lockUntil: anonRes.lockUntil,
        retryAfterSeconds: anonRes.retryAfterSeconds,
        remainingAttempts: 0,
      });
    }

    throw new ApiError(401, `Invalid email or password. ${anonRes.remainingAttempts} attempt(s) remaining before temporary lockout.`, null, {
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
    recordIpFailure(req.ip);
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
        message: `Your account was locked for ${lockMins} minutes following repeated failed sign-ins from ${device} (${req.ip}). If this wasn't you, reset your password immediately.`,
        link: '/settings/security',
      });

      // Automated Security Alerts: HTML Email
      sendMail({
        to: user.email,
        subject: 'Security Alert: Account Temporarily Locked - CampusConnect',
        text: `Hi ${user.name},\n\nWe detected ${user.failedLogins} consecutive failed sign-in attempts to your CampusConnect account.\n\n• Device: ${device}\n• IP Address: ${req.ip}\n• Date & Time: ${new Date().toUTCString()}\n\nAs a security precaution, your account has been temporarily locked for ${lockMins} minutes.\n\nIf this was you, you may try again once the timer expires.\n\nIf this was NOT you, someone may be attempting to access your account. Please reset your password immediately:\n${env.appUrl.replace(/\/$/, '')}/forgot-password\n\nCampusConnect Security Team`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">
          <h2 style="color:#e11d48;margin-top:0;">🛡️ Security Alert: Account Locked</h2>
          <p>Hi <strong>${user.name.replace(/[<>&]/g, '')}</strong>,</p>
          <p>We detected <strong>${user.failedLogins} consecutive failed sign-in attempts</strong> to your CampusConnect account.</p>
          <div style="background:#f8fafc;padding:14px 18px;border-radius:10px;margin:18px 0;font-size:14px;color:#334155;">
            <p style="margin:4px 0;"><strong>Device:</strong> ${device}</p>
            <p style="margin:4px 0;"><strong>IP Address:</strong> ${req.ip}</p>
            <p style="margin:4px 0;"><strong>Lockout Duration:</strong> ${lockMins} minutes</p>
          </div>
          <p>If you forgot your password, you can reset it safely using the link below:</p>
          <p style="margin:20px 0;"><a href="${env.appUrl.replace(/\/$/, '')}/forgot-password" style="background:#2563eb;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block;">Reset Password</a></p>
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
    throw new ApiError(403, 'This account has been suspended. Contact the administrator.');
  }

  // 6. Successful Authentication: Reset counters & clear IP penalty
  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastFailedLoginAt = undefined;
  user.lastLogin = new Date();
  await user.save({ validateModifiedOnly: true });
  clearIpFailure(req.ip);

  // New-device detection: first successful sign-in from this device label.
  const device = parseDevice(req.headers['user-agent'], req);
  const [seenDevice, hasHistory] = await Promise.all([
    LoginHistory.exists({ user: user._id, success: true, device }),
    LoginHistory.exists({ user: user._id, success: true }),
  ]);

  req.user = user;
  logActivity(req, 'auth.login', { entityType: 'user', entityId: user._id, summary: device });
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
  const mobile = isMobileClient(req);
  const token = mobile ? req.body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
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
    throw fail('Session is no longer valid');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive || (user.tokenVersion || 0) !== payload.v) {
    await revokeSessions({ _id: session._id }, 'token_version');
    throw fail('Session is no longer valid');
  }

  res.json(await issueSession(req, res, user, session));
});

/** Sign out this device only. */
export const logout = asyncHandler(async (req, res) => {
  const token = isMobileClient(req) ? req.body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
  if (token && typeof token === 'string') {
    try {
      const { sid, sub } = verifyRefreshToken(token);
      if (sid) {
        await revokeSessions({ _id: sid, user: sub }, 'logout');
        logActivity(req, 'auth.logout', { user: { _id: sub }, entityType: 'session', entityId: sid });
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
  res.json({ message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('clubs', 'name slug logo');
  res.json(user);
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password +tokenVersion');
  if (!(await user.comparePassword(currentPassword))) throw new ApiError(400, 'Current password is incorrect');
  if (await user.comparePassword(newPassword)) throw new ApiError(422, 'New password must be different from the current one');
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // invalidates refresh tokens everywhere
  await user.save();

  // Every other device is signed out; this device gets a rotated session.
  await revokeSessions({ user: user._id, _id: { $ne: req.sessionId } }, 'password_change');
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

const GENERIC_RESET = { message: 'If an account exists for that email, a password reset link has been sent to your inbox.' };

/**
 * Always answers with the same message and status (no account enumeration).
 * The work happens after the response so timing does not leak either.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  res.json(GENERIC_RESET);

  try {
    const user = await User.findOne({ email, isActive: true }).select('+resetTokenExpires');
    if (!user) return;
    const ttl = env.passwordResetMinutes * 60000;
    // At most one email per minute per account.
    if (user.resetTokenExpires && user.resetTokenExpires.getTime() - Date.now() > ttl - 60000) return;

    const token = crypto.randomBytes(32).toString('base64url');
    user.resetTokenHash = hashToken(token);
    user.resetTokenExpires = new Date(Date.now() + ttl);
    await user.save({ validateModifiedOnly: true });

    // Token goes in the URL fragment: browsers never send it to any server log.
    const link = `${env.appUrl.replace(/\/$/, '')}/reset-password#token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your CampusConnect password',
      text: `Hi ${user.name},\n\nUse this link to choose a new password. It expires in ${env.passwordResetMinutes} minutes and works once:\n\n${link}\n\nIf you did not ask for this, ignore this email — your password stays the same.`,
      html: `<p>Hi ${user.name.replace(/[<>&]/g, '')},</p><p>Use this link to choose a new password. It expires in ${env.passwordResetMinutes} minutes and works once:</p><p><a href="${link}">Reset my password</a></p><p>If you did not ask for this, ignore this email — your password stays the same.</p>`,
    });
    logActivity(req, 'auth.password_reset_request', { user, entityType: 'user', entityId: user._id });
  } catch (err) {
    console.error('[auth] forgot-password processing failed:', err.message);
  }
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({
    resetTokenHash: hashToken(token),
    resetTokenExpires: { $gt: new Date() },
  }).select('+password +tokenVersion +resetTokenHash +resetTokenExpires +failedLogins +lockUntil +lastFailedLoginAt +lockoutCount');
  if (!user || !user.isActive) throw new ApiError(400, 'This reset link is invalid or has expired');

  // Single use: the token is cleared in the same save that sets the password.
  user.password = password;
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastFailedLoginAt = undefined;
  user.lockoutCount = 0;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await revokeSessions({ user: user._id }, 'password_reset');
  logActivity(req, 'auth.password_reset', { user, entityType: 'user', entityId: user._id });
  notifyUsers([user._id], {
    type: 'system',
    title: 'Your password was reset',
    message: 'All sessions were signed out. If this was not you, contact the administrator.',
    link: '/settings/security',
  });
  res.json({ message: 'Password updated. Please sign in with your new password.' });
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
  res.json({ message: 'Session signed out' });
});

export const revokeOtherSessions = asyncHandler(async (req, res) => {
  const n = await revokeSessions({ user: req.user._id, _id: { $ne: req.sessionId } }, 'user_revoked_others');
  logActivity(req, 'auth.session_revoke_others', { entityType: 'user', entityId: req.user._id, summary: `${n} sessions` });
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
  user.pushTokens = [...rest, { token, addedAt: new Date() }].slice(-MAX_PUSH_TOKENS);
  await user.save({ validateModifiedOnly: true });
  res.json({ ok: true });
});

export const removePushToken = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token: req.body.token } } });
  res.json({ ok: true });
});
