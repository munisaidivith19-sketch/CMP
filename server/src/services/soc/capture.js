import crypto from 'node:crypto';
import mongoose from 'mongoose';
import ErrorEvent from '../../models/ErrorEvent.js';
import { classify, UNCLASSIFIED } from './catalog.js';
import { incrementMetric } from './metrics.js';
import { messageShape, redactLine, redactObject, redactStack, redactText, routeTemplate } from './sanitize.js';

/**
 * Platform-wide error capture. Every source (Express, authorization refusals,
 * rate limits, database events, background jobs, Socket.IO, the process, the
 * web client) calls captureError(); nothing else writes ErrorEvent.
 *
 * Guarantees:
 *  - never throws and never delays the caller (writes are fire-and-forget);
 *  - stores only redacted data (sanitize.js) — never bodies, headers, tokens;
 *  - one document per fingerprint: repeats are a $inc, not a new row;
 *  - storm protection: each fingerprint is written at most once per
 *    WRITE_WINDOW_MS (repeats inside the window are added to the next write),
 *    and at most GLOBAL_PER_MIN writes happen per minute; anything beyond is
 *    counted as "dropped" and reported on the health page;
 *  - noise (rate-limit and authorization refusals, which anyone can trigger
 *    from outside) has its own per-minute budget, NOISE_PER_MIN, so a flood
 *    of it can never use up the budget of real faults (5xx, database, jobs);
 *  - unknown errors are stored as UNCLASSIFIED, never discarded.
 */
const WRITE_WINDOW_MS = 5_000;
const GLOBAL_PER_MIN = 300;
const NOISE_PER_MIN = 100;
const MAX_TRACKED = 2_000;
const NOISE_SOURCES = new Set(['rate_limit', 'authorization']);

const stats = {
  accepted: 0,
  written: 0,
  coalesced: 0,
  dropped: 0,
  droppedNoise: 0,
  failed: 0,
  lastWriteAt: null,
  lastFailureAt: null,
  lastFailure: null,
  startedAt: new Date(),
};
let enabled = process.env.SOC_CAPTURE_ENABLED !== 'false';
const windows = new Map(); // fingerprint -> { lastWriteAt, pendingCount }
let minuteStart = Date.now();
let minuteWrites = 0; // faults
let minuteNoiseWrites = 0; // rate-limit / authorization refusals

export const captureStats = () => ({ ...stats, enabled, trackedFingerprints: windows.size });
export const setCaptureEnabled = (v) => {
  enabled = Boolean(v);
};

export const environmentName = () => (process.env.SOC_ENVIRONMENT || process.env.NODE_ENV || 'development').slice(0, 20);

// Path prefix (below /api) → module, for the modules that exist in routes/.
const MODULES = [
  [/^\/super-admin\/soc(\/|$)/, 'soc'],
  [/^\/super-admin(\/|$)/, 'super_admin'],
  [/^\/client-errors$/, 'soc'],
  [/^\/auth(\/|$)/, 'authentication'],
  [/^\/attendance\/(faculty|staff)/, 'staff_attendance'],
  [/^\/staff(\/|$)/, 'staff_attendance'],
  [/^\/attendance(\/|$)/, 'attendance'],
  [/^\/od-leave|^\/attendance\/od/, 'attendance'],
  [/^\/(timetable|subjects)(\/|$)/, 'timetables'],
  [/^\/exams(\/|$)/, 'exams'],
  [/^\/chat(\/|$)/, 'chat'],
  [/^\/(notifications|devices)(\/|$)/, 'notifications'],
  [/^\/gate-pass(\/|$)/, 'gate_passes'],
  [/^\/complaints(\/|$)/, 'complaints'],
  [/^\/events(\/|$)/, 'events'],
  [/^\/study-materials(\/|$)/, 'study_materials'],
  [/^\/ai(\/|$)/, 'ai_assistant'],
  [/^\/transport(\/|$)/, 'bus_tracking'],
  [/^\/(admin|users)(\/|$)/, 'user_admin'],
  [/^\/(alumni|mentorship|mentorship-requests)(\/|$)/, 'alumni'],
  [/^\/sos(\/|$)/, 'sos'],
  [/^\/hostel(\/|$)/, 'hostel'],
  [/^\/clubs(\/|$)/, 'clubs'],
  [/^\/announcements(\/|$)/, 'announcements'],
  [/^\/discussions(\/|$)/, 'discussions'],
  [/^\/lost-found(\/|$)/, 'lost_found'],
  [/^\/holidays(\/|$)/, 'holidays'],
  [/^\/achievements(\/|$)/, 'achievements'],
  [/^\/(dashboard|analytics|search|reports)(\/|$)/, 'dashboards'],
  [/^\/uploads(\/|$)/, 'uploads'],
  [/^\/class-students(\/|$)/, 'class_management'],
  [/^\/platform(\/|$)/, 'platform'],
];

export function moduleForPath(path = '') {
  const p = String(path).replace(/^\/api/, '').split('?')[0];
  return MODULES.find(([re]) => re.test(p))?.[1] || 'unknown';
}

function fingerprintOf(parts) {
  return crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 32);
}

const SEVERITY_FOR_SOURCE = {
  express: 'high',
  authorization: 'low',
  rate_limit: 'low',
  database: 'high',
  job: 'medium',
  socket: 'low',
  process: 'critical',
  client_web: 'medium',
  client_mobile: 'medium',
};

/**
 * Record one error occurrence.
 * @param {object} o
 * @param {string} o.source  one of ERROR_SOURCES
 * @param {Error|object} [o.err]
 * @param {object} [o.req]   Express request (route, method, correlation id, actor role)
 * @param {number} [o.httpStatus]
 * @param {string} [o.module] overrides the module derived from the route
 * @param {string} [o.service]
 * @param {string} [o.message] overrides err.message
 * @param {string} [o.route]  for non-Express sources (client page, job name)
 * @param {string} [o.clientKind] web client: render | unhandled_rejection | window_error | network | api
 * @param {string} [o.client] web | mobile | system
 * @param {string} [o.correlationId]
 * @param {object} [o.meta]   extra safe metadata (redacted before storage)
 */
export function captureError(o = {}) {
  try {
    if (!enabled) return null;
    stats.accepted += 1;
    const err = o.err || {};
    const req = o.req;
    const rawPath = o.route ?? (req ? req.originalUrl || req.path || '' : '');
    const route = routeTemplate(rawPath);
    const message = redactText(o.message ?? err.message ?? 'Unknown error', 600);
    const signal = {
      source: o.source,
      httpStatus: o.httpStatus,
      errName: String(err.name || '').slice(0, 80),
      errCode: typeof err.code === 'number' ? err.code : undefined,
      dataCode: err.data?.code || o.dataCode,
      message: String(o.message ?? err.message ?? ''),
      clientKind: o.clientKind,
      jobName: o.jobName,
    };
    const def = classify(signal);
    const code = def?.code || UNCLASSIFIED;
    const module = redactLine(o.module || (o.source === 'job' ? 'background_jobs' : null) || moduleForPath(rawPath) || def?.module, 40);
    const shape = messageShape(signal.message);
    // Classified errors group by code + where; unclassified also by message shape.
    const fingerprint = fingerprintOf([o.source, code, module, req?.method || '', route, o.jobName || '', def ? '' : signal.errName, def ? '' : shape]);
    incrementMetric(`errors.${o.source}`);

    const now = Date.now();
    const w = windows.get(fingerprint);
    if (w && now - w.lastWriteAt < WRITE_WINDOW_MS) {
      w.pendingCount += 1;
      stats.coalesced += 1;
      // Repeats inside the window are added once it closes, even if no later
      // occurrence comes along to carry them.
      if (!w.timer) {
        w.timer = setTimeout(() => {
          const n = w.pendingCount;
          w.pendingCount = 0;
          w.timer = null;
          w.lastWriteAt = Date.now();
          if (!n || mongoose.connection.readyState !== 1) return;
          ErrorEvent.updateOne({ fingerprint }, { $inc: { count: n }, $set: { lastSeenAt: new Date() } }).catch(() => {
            stats.failed += 1;
          });
        }, Math.max(50, WRITE_WINDOW_MS - (now - w.lastWriteAt)));
        w.timer.unref?.();
      }
      return fingerprint;
    }
    if (now - minuteStart > 60_000) {
      minuteStart = now;
      minuteWrites = 0;
      minuteNoiseWrites = 0;
    }
    if (NOISE_SOURCES.has(o.source)) {
      if (minuteNoiseWrites >= NOISE_PER_MIN) {
        stats.dropped += 1;
        stats.droppedNoise += 1;
        return null;
      }
      minuteNoiseWrites += 1;
    } else {
      if (minuteWrites >= GLOBAL_PER_MIN) {
        stats.dropped += 1;
        return null;
      }
      minuteWrites += 1;
    }
    const count = 1 + (w && !w.timer ? w.pendingCount : 0);
    if (w?.timer) w.lastWriteAt = now;
    else {
      if (windows.size >= MAX_TRACKED && !w) windows.delete(windows.keys().next().value);
      windows.set(fingerprint, { lastWriteAt: now, pendingCount: 0, timer: null });
    }

    if (mongoose.connection.readyState !== 1) {
      // Database down: nothing can be stored. Counted so the health page shows it.
      stats.failed += 1;
      stats.lastFailureAt = new Date();
      stats.lastFailure = 'database not connected';
      return null;
    }

    const correlationId = redactLine(o.correlationId || req?.id, 64);
    const actorRole = req?.user?.role;
    const client = o.client || (req ? (req.headers?.['x-client-platform'] === 'mobile' ? 'mobile' : 'web') : 'system');
    const severity = def?.severity || (o.httpStatus && o.httpStatus < 500 ? 'low' : SEVERITY_FOR_SOURCE[o.source] || 'medium');
    const sample = redactObject({
      errorCode: signal.errCode,
      responseCode: signal.dataCode,
      category: err.category,
      stack: redactStack(o.stack || err.stack),
      ...(o.meta || {}),
    });
    const at = new Date();
    const push = { $each: correlationId ? [correlationId] : [], $slice: -20 };
    const update = {
      $setOnInsert: {
        fingerprint,
        code,
        classified: Boolean(def),
        source: o.source,
        module,
        service: redactLine(o.service || def?.service || 'api', 40),
        title: redactLine(def?.title || `${signal.errName || 'Error'}: ${message}`, 200),
        errorName: signal.errName || undefined,
        method: req?.method,
        route,
        firstSeenAt: at,
        status: 'open',
      },
      $set: { lastSeenAt: at, message, severity, environment: environmentName(), sample, ...(o.httpStatus ? { httpStatus: o.httpStatus } : {}) },
      $inc: { count },
      $push: { correlationIds: push },
      $addToSet: { ...(actorRole ? { actorRoles: actorRole } : {}), clients: client },
    };
    const write = () => ErrorEvent.findOneAndUpdate({ fingerprint }, update, { upsert: true, new: true, projection: { status: 1, resolvedAt: 1 } });
    // Two processes inserting the same new fingerprint at once: the loser retries as an update.
    write()
      .catch((e) => (e?.code === 11000 ? write() : Promise.reject(e)))
      .then((doc) => {
        stats.written += 1;
        stats.lastWriteAt = new Date();
        // A resolved error that happens again is re-opened: the fix did not hold.
        if (doc?.status === 'resolved' && doc.resolvedAt && doc.resolvedAt < at) {
          return ErrorEvent.updateOne(
            { _id: doc._id, status: 'resolved' },
            { $set: { status: 'open', regressedAt: at, statusChangedAt: at }, $inc: { regressions: 1 }, $push: { notes: { $each: [{ at, kind: 'regressed', text: 'The error occurred again after it was marked resolved. Re-opened automatically.' }], $slice: -100 } } }
          );
        }
        return null;
      })
      .catch((e) => {
        stats.failed += 1;
        stats.lastFailureAt = new Date();
        stats.lastFailure = redactLine(e?.message, 200);
      });
    return fingerprint;
  } catch (e) {
    stats.failed += 1;
    stats.lastFailureAt = new Date();
    stats.lastFailure = redactLine(e?.message, 200);
    return null;
  }
}

/** Test hook: forget storm-protection windows and counters. */
export function resetCaptureForTests() {
  for (const w of windows.values()) if (w.timer) clearTimeout(w.timer);
  windows.clear();
  minuteWrites = 0;
  minuteNoiseWrites = 0;
  minuteStart = Date.now();
  Object.assign(stats, { accepted: 0, written: 0, coalesced: 0, dropped: 0, droppedNoise: 0, failed: 0, lastWriteAt: null, lastFailureAt: null, lastFailure: null });
}

/** Test hook: wait until fire-and-forget writes have settled. */
export const flushCaptureForTests = () => new Promise((r) => setTimeout(r, 120));
