import { getPlatformState, maintenanceBody, platformAllows } from '../services/platformState.js';
import Session from '../models/Session.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { SUPER_ADMIN_ROLE } from '../constants.js';

// Public endpoints that keep working in maintenance so the Super Admin can
// still sign in (login / refresh refuse everyone else themselves) and every
// client can ask what is going on.
const PUBLIC_OPEN = new Set(['/auth/login', '/auth/refresh', '/auth/logout', '/platform/status']);

/** Before authentication: public endpoints are closed outside normal mode. */
export const publicPlatformGate = asyncHandler(async (req, res, next) => {
  if (PUBLIC_OPEN.has(req.path.replace(/\/+$/, ''))) return next();
  // Requests with a bearer token are judged per account by platformGate after protect.
  if (String(req.headers.authorization || '').startsWith('Bearer ')) return next();
  const state = await getPlatformState();
  if (state.mode === 'normal') return next();
  res.set('Retry-After', '300');
  return res.status(503).json(maintenanceBody(state));
});

/** After authentication: only a Super Admin gets through outside normal mode. */
export const platformGate = asyncHandler(async (req, res, next) => {
  if (await platformAllows(req.user)) return next();
  const state = await getPlatformState();
  res.set('Retry-After', '300');
  return res.status(503).json(maintenanceBody(state));
});

// What an account holding a temporary password may still do: read itself,
// change the password, sign out, keep its session alive.
const PASSWORD_CHANGE_OPEN = [/^\/auth\/me$/, /^\/auth\/change-password$/, /^\/auth\/activity$/, /^\/auth\/sessions(\/|$)/, /^\/auth\/push-token$/, /^\/notifications(\/|$)/];

/** A temporary password set by a Super Admin must be replaced before anything else. */
export function passwordChangeGate(req, _res, next) {
  if (!req.user?.mustChangePassword) return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  if (PASSWORD_CHANGE_OPEN.some((re) => re.test(path))) return next();
  return next(new ApiError(403, 'Change your temporary password before continuing', undefined, { code: 'PASSWORD_CHANGE_REQUIRED' }));
}

export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Sensitive Super Admin actions need the password re-entered on this session
 * within the last five minutes (POST /super-admin/reauth). The proof lives on
 * the server-side session row, never in anything the client sends.
 */
export const requireRecentReauth = asyncHandler(async (req, _res, next) => {
  if (req.user?.role !== SUPER_ADMIN_ROLE) throw new ApiError(403, 'You do not have permission to perform this action');
  const session = req.sessionId ? await Session.findById(req.sessionId).select('reauthAt').lean() : null;
  const at = session?.reauthAt ? new Date(session.reauthAt).getTime() : 0;
  if (!at || Date.now() - at > REAUTH_WINDOW_MS) {
    // 403, not 401: the session itself is fine, so clients must not try a token refresh.
    throw new ApiError(403, 'Confirm your password to continue', undefined, { code: 'REAUTH_REQUIRED' });
  }
  next();
});
