import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'cc_refresh';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const newJti = () => crypto.randomBytes(18).toString('base64url');

// `sid` ties the access token to a Session row, so revoking a session (logout,
// "sign out other devices", password reset) cuts off its access tokens too.
export const signAccessToken = (user, sid) =>
  jwt.sign({ sub: String(user._id), role: user.role, sid: sid ? String(sid) : undefined }, env.accessSecret, {
    expiresIn: env.accessExpires,
  });

// `v` ties the refresh token to the user's tokenVersion so a password change or
// an admin role/status change invalidates every outstanding refresh token.
export const signRefreshToken = (user, sid, jti) =>
  jwt.sign({ sub: String(user._id), v: user.tokenVersion || 0, sid: String(sid), jti }, env.refreshSecret, {
    expiresIn: env.refreshExpires,
  });

export const verifyRefreshToken = (token) => jwt.verify(token, env.refreshSecret);

export const refreshExpiry = () => new Date(Date.now() + REFRESH_MAX_AGE_MS);

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'strict', path: '/api/auth' });
}

/**
 * Native apps cannot use the httpOnly cookie reliably, so a client that
 * identifies itself as mobile receives the refresh token in the JSON body and
 * sends it back in the body (it is kept in the device's secure store).
 */
export const isMobileClient = (req) => req.get('x-client-platform') === 'mobile';

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
