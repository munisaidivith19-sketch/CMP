import Activity from '../models/Activity.js';

/**
 * Record an activity / audit entry. Never throws.
 * Pass `user` when the actor is known but not yet on req (e.g. during sign-in).
 */
export function logActivity(req, action, { entityType, entityId, summary, user } = {}) {
  Activity.create({
    user: user?._id || user || req.user?._id,
    action,
    entityType,
    entityId,
    summary: summary?.slice(0, 200),
    ip: req.ip,
  }).catch((err) => console.error('[activity] failed:', err.message));
}
