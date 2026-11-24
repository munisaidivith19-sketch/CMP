import AuditLog from '../models/AuditLog.js';
import { clientInfo, scrub } from './securityLog.js';
import { securityAlert } from '../services/securityAlerts.js';

const idOf = (v) => v?._id || v || undefined;

/**
 * Append one protected audit record (models/AuditLog.js). Awaitable so
 * emergency operations can confirm the record was written; never throws.
 */
export function logAudit(req, action, { actor, target, outcome = 'success', reason, details } = {}) {
  const who = actor === undefined ? req?.user : actor;
  securityAlert('audit', action, {
    actorRole: who?.role,
    actorId: idOf(who) && String(idOf(who)),
    actorEmail: who?.email,
    targetRole: target?.role,
    account: target?.email || details?.email || who?.email,
    outcome,
    reason,
    details,
    client: clientInfo(req),
  });
  return AuditLog.create({
    action,
    outcome,
    actor: idOf(who),
    actorRole: who?.role,
    target: idOf(target),
    targetRole: target?.role,
    reason: reason ? String(reason).slice(0, 500) : undefined,
    details: details ? scrub(details) : undefined,
    ip: req?.ip,
    userAgent: req?.headers ? String(req.headers['user-agent'] || '').slice(0, 300) : undefined,
  }).catch((err) => {
    console.error('[audit-log] failed:', err.message);
    return null;
  });
}
