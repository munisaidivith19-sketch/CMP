/**
 * Web-portal idle-session policy — the single source of truth.
 *
 * A web session of a non-exempt role ends after WEB_IDLE_TIMEOUT_MS without
 * reported USER ACTIVITY. For those sessions `Session.lastUsedAt` means
 * "last reported user activity" (server clock), and only two things move it:
 *   - signing in (the session is created), and
 *   - POST /api/auth/activity, which the web client sends at most once every
 *     ~30 s and only after real interaction (pointer, key, scroll, touch).
 * Ordinary API calls, background polling and refresh-token rotation never
 * move it, so none of them can keep an unattended session alive.
 *
 * The server is the authority: the same check runs in the REST middleware,
 * the Socket.IO handshake (both via authenticateAccessToken) and the refresh
 * endpoint, and a periodic sweep revokes stale sessions so their open sockets
 * are disconnected even if the tab sends no HTTP requests at all. The
 * browser's own 2-minute timer is only a user-experience layer on top.
 *
 * Mobile sessions, and the exempt roles' web sessions, keep the existing rule
 * (7 days idle, lastUsedAt written at most every 5 minutes) unchanged.
 */
import Session from '../models/Session.js';
import { registerJob, runJob } from '../services/soc/monitors.js';
import { disconnectSessions } from '../config/socket.js';
import { logActivity } from './activity.js';
import { logSecurity } from './securityLog.js';

export const WEB_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
// The activity endpoint writes at most once per this interval per session
// (the client sends at most once per 30 s; 25 s absorbs network jitter).
export const ACTIVITY_WRITE_THROTTLE_MS = 25 * 1000;
// How often the server sweeps for idle web sessions (socket clean-up).
export const IDLE_SWEEP_INTERVAL_MS = 30 * 1000;
// Roles whose web sessions keep the existing behaviour.
export const WEB_IDLE_EXEMPT_ROLES = ['faculty', 'hod', 'admin', 'principal', 'ao', 'dean', 'chairman', 'warden', 'security'];

export const IDLE_MESSAGE = 'Your session expired due to inactivity. Please log in again.';

/**
 * The idle limit (ms) for a session, or null when the 2-minute rule does not
 * apply. `client` comes from the Session row (bound at sign-in, never from the
 * request) and `role` from the user's database record (never from a token
 * claim or the client).
 */
export const idleTimeoutFor = (client, role) =>
  client === 'web' && !WEB_IDLE_EXEMPT_ROLES.includes(role) ? WEB_IDLE_TIMEOUT_MS : null;

/** True when the session has gone longer than its idle limit without reported activity. */
export function isIdleExpired(session, idleMs, now = new Date()) {
  if (!idleMs) return false;
  const last = session.lastUsedAt ? new Date(session.lastUsedAt).getTime() : 0;
  return now.getTime() - last > idleMs;
}

/**
 * End an idle session for real: revoke the row (so every access and refresh
 * token bound to it stops working), drop its sockets, and audit it. Never
 * logs a token or cookie.
 */
export async function expireIdleSession(sessionId, userId, ip) {
  const res = await Session.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'idle_timeout_web' } }
  );
  disconnectSessions([sessionId]);
  if (res.modifiedCount) {
    logActivity({ ip }, 'auth.idle_expired', { user: userId, entityType: 'session', entityId: sessionId, summary: 'web session idle > 2 min' });
    logSecurity(ip ? { ip } : null, 'SESSION_EXPIRED', { actor: null, target: { _id: userId }, reason: 'idle_timeout_web', entityType: 'session', entityId: sessionId });
  }
}

/**
 * Record reported user activity for a session that has the 2-minute rule.
 * Conditional update: it only matches when lastUsedAt is older than the
 * throttle, so a client cannot turn this into a write per request.
 */
export function recordSessionActivity(sessionId) {
  const now = new Date();
  return Session.updateOne(
    { _id: sessionId, revokedAt: null, lastUsedAt: { $lt: new Date(now.getTime() - ACTIVITY_WRITE_THROTTLE_MS) } },
    { $set: { lastUsedAt: now } }
  );
}

/**
 * Revoke every web session that has passed its idle limit. One indexed query;
 * only sessions that newly crossed the limit match (revoked ones drop out).
 */
export async function sweepIdleWebSessions() {
  const now = new Date();
  const stale = await Session.find({
    idleTimeoutMs: WEB_IDLE_TIMEOUT_MS,
    revokedAt: null,
    lastUsedAt: { $lt: new Date(now.getTime() - WEB_IDLE_TIMEOUT_MS) },
  })
    .select('_id user')
    .limit(500)
    .lean();
  for (const s of stale) await expireIdleSession(s._id, s.user, undefined);
  return stale.length;
}

export function startIdleSessionSweeper() {
  registerJob('auth.idle_session_sweep', { intervalMs: IDLE_SWEEP_INTERVAL_MS, description: 'Revoke idle web sessions' });
  const timer = setInterval(
    () => runJob('auth.idle_session_sweep', sweepIdleWebSessions, { logTag: '[auth] idle-session sweep' }),
    IDLE_SWEEP_INTERVAL_MS
  );
  timer.unref();
  return timer;
}
