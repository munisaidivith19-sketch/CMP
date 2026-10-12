import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * The refresh cookie. In production it carries the __Secure- prefix, so a
 * browser only accepts it over HTTPS with the Secure flag (it cannot be
 * planted or overwritten from plain HTTP or a sibling subdomain). Path stays
 * /api/auth: the token is sent to the auth endpoints only. Development keeps
 * the plain name (no HTTPS on localhost).
 */
export const refreshCookieName = () => (env.isProd ? '__Secure-cc_refresh' : 'cc_refresh');

/** The refresh token a browser sent (the one place the cookie is read). */
export const readRefreshCookie = (req) => {
  const v = req.cookies?.[refreshCookieName()];
  return typeof v === 'string' && v ? v : null;
};
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

export const verifyRefreshToken = (token) => jwt.verify(token, env.refreshSecret, { algorithms: ['HS256'] });

export const refreshExpiry = () => new Date(Date.now() + REFRESH_MAX_AGE_MS);

export function setRefreshCookie(res, token) {
  res.cookie(refreshCookieName(), token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(refreshCookieName(), { httpOnly: true, secure: env.isProd, sameSite: 'strict', path: '/api/auth' });
}

/**
 * Native apps cannot use the httpOnly cookie reliably, so a client that
 * identifies itself as mobile receives the refresh token in the JSON body and
 * sends it back in the body (it is kept in the device's secure store).
 *
 * A request carrying Sec-Fetch-Site is never mobile: browsers always send
 * that header and page scripts cannot remove or forge it, while the native
 * app's HTTP client never sends it. So a browser cannot sign in as "mobile"
 * to escape the web portal's idle-session rule. The client type is then
 * bound to the Session row at sign-in and never re-read from a request.
 */
export const isMobileClient = (req) => req.get('x-client-platform') === 'mobile' && !req.get('sec-fetch-site');

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
