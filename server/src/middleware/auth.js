import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { ApiError, asyncHandler } from '../utils/http.js';

/**
 * Verify an access token and load its user + session. Shared by the REST
 * `protect` middleware and the Socket.io handshake so both enforce the same rules:
 * valid signature, live (not revoked / expired) session, active account.
 */
export async function authenticateAccessToken(token) {
  if (!token || typeof token !== 'string') throw new ApiError(401, 'Please sign in to continue');

  let payload;
  try {
    payload = jwt.verify(token, env.accessSecret);
  } catch {
    throw new ApiError(401, 'Your session has expired');
  }
  if (!payload.sid) throw new ApiError(401, 'Your session has expired');

  const [user, session] = await Promise.all([
    User.findById(payload.sub),
    Session.findById(payload.sid).select('user revokedAt expiresAt').lean(),
  ]);
  if (!session || session.revokedAt || session.expiresAt <= new Date() || String(session.user) !== String(payload.sub)) {
    throw new ApiError(401, 'Your session has ended. Please sign in again.');
  }
  if (!user || !user.isActive) throw new ApiError(401, 'Account is unavailable');
  return { user, sessionId: String(payload.sid) };
}

/** Require a valid Bearer access token; attaches req.user and req.sessionId. */
export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const { user, sessionId } = await authenticateAccessToken(token);
  req.user = user;
  req.sessionId = sessionId;
  next();
});

/** Role-based access control. */
export const authorize =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new ApiError(403, 'You do not have permission to perform this action'));
