import SecurityLog from '../models/SecurityLog.js';
import { isMobileClient } from './tokens.js';
import { parseBrowser, parseDevice, parseOs } from './device.js';

// Keys that must never reach a security record, however they are nested.
const SECRET_KEY = /password|passwd|hash|token|secret|cookie|jti|authorization|api[-_]?key|^otp$|^code$/i;

/** Copy plain context, dropping anything that looks like a credential. */
export function scrub(value, depth = 0) {
  if (value == null || depth > 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') return String(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || k.startsWith('$')) continue;
      const clean = scrub(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 200);
  return value;
}

/** Client details derived from the request on the server — never from the body. */
export function clientInfo(req) {
  if (!req?.headers) return { client: 'system', ip: req?.ip };
  const ua = String(req.headers['user-agent'] || '');
  const mobile = isMobileClient(req);
  return {
    client: mobile ? 'mobile' : 'web',
    device: parseDevice(ua, req),
    os: parseOs(ua),
    browser: mobile ? 'Mobile app' : parseBrowser(ua),
    userAgent: ua.slice(0, 300),
    ip: req.ip,
  };
}

const idOf = (v) => v?._id || v || undefined;

/**
 * Append one security event. Never throws and never blocks the request.
 *
 * The actor defaults to the authenticated user on `req` (its role is read from
 * that database record). `target` may be a user document or `{ _id, role }`.
 * Pass `actor: null` for anonymous events (failed login for an unknown email).
 */
export function logSecurity(req, event, { actor, target, success = true, reason, identifier, entityType, entityId, details } = {}) {
  const who = actor === undefined ? req?.user : actor;
  return SecurityLog.create({
    event,
    success,
    actor: idOf(who),
    actorRole: who?.role,
    targetUser: idOf(target),
    targetRole: target?.role,
    identifier: identifier ? String(identifier).slice(0, 120) : undefined,
    reason: reason ? String(reason).slice(0, 300) : undefined,
    entityType,
    entityId: idOf(entityId),
    details: details ? scrub(details) : undefined,
    ...clientInfo(req),
  }).catch((err) => console.error('[security-log] failed:', err.message));
}
