import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { IDLE_MESSAGE, expireIdleSession, idleTimeoutFor, isIdleExpired } from '../utils/sessionIdle.js';

/**
 * Verify an access token and load its user + session. Shared by the REST
 * `protect` middleware and the Socket.io handshake so both enforce the same rules:
 * valid signature, live (not revoked / expired) session, active account.
 */
export async function authenticateAccessToken(token, ip) {
  if (!token || typeof token !== 'string') throw new ApiError(401, 'Please sign in to continue');

  let payload;
  try {
    // Pin the algorithm: only HS256 tokens signed with our secret are accepted.
    payload = jwt.verify(token, env.accessSecret, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'Your session has expired');
  }
  if (!payload.sid) throw new ApiError(401, 'Your session has expired');

  const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7-day idle session timeout
  const [user, session] = await Promise.all([
    User.findById(payload.sub),
    Session.findById(payload.sid).select('user revokedAt expiresAt lastUsedAt client').lean(),
  ]);
  if (!session || session.revokedAt || session.expiresAt <= new Date() || String(session.user) !== String(payload.sub)) {
    throw new ApiError(401, 'Your session has ended. Please sign in again.');
  }

  // Enforce 7-day idle session inactivity timeout
  if (session.lastUsedAt && Date.now() - new Date(session.lastUsedAt).getTime() > IDLE_TIMEOUT_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date(), revokedReason: 'idle_timeout' } });
    throw new ApiError(401, 'Session expired due to inactivity. Please sign in again.');
  }

  if (!user || !user.isActive) throw new ApiError(401, 'Account is unavailable');

  // Web portal, non-exempt role: 2 minutes without reported user activity ends
  // the session. Client type comes from the session row, role from the
  // database — nothing the request carries can switch the rule off. Requests
  // never move lastUsedAt here, so background polling cannot keep it alive.
  const idleMs = idleTimeoutFor(session.client, user.role);
  if (idleMs) {
    if (isIdleExpired(session, idleMs)) {
      await expireIdleSession(session._id, user._id, ip);
      throw new ApiError(401, IDLE_MESSAGE, undefined, { reason: 'idle' });
    }
  } else if (!session.lastUsedAt || Date.now() - new Date(session.lastUsedAt).getTime() > 5 * 60 * 1000) {
    // Touch lastUsedAt periodically (debounced to at most once every 5 minutes)
    Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } }).catch(() => null);
  }

  return { user, sessionId: String(payload.sid), idleTimeoutMs: idleMs };
}

/** Require a valid Bearer access token; attaches req.user and req.sessionId. */
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const { user, sessionId, idleTimeoutMs } = await authenticateAccessToken(token, req.ip);
  req.user = user;
  req.sessionId = sessionId;
  req.sessionIdleTimeoutMs = idleTimeoutMs;
  next();
});

/** Role-based access control. */
export const authorize =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new ApiError(403, 'You do not have permission to perform this action'));
