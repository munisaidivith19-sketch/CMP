import { getDiagnostic } from './diagnostics/registry.js';
import './diagnostics/library.js';
import { jobHeartbeats, jobStatus } from './monitors.js';

/**
 * System health: bounded checks for the services that exist in this
 * repository. Each check reuses a registered read-only diagnostic and maps
 * its result to PASS / WARNING / FAIL / DEGRADED / UNKNOWN:
 *
 *   PASS → PASS, WARNING → WARNING, FAIL → FAIL,
 *   SKIPPED / INCONCLUSIVE / TIMED_OUT → UNKNOWN (missing data is never "healthy").
 *
 * Results are cached for CACHE_MS so refreshing the dashboard cannot load the
 * database; `force` bypasses the cache (rate-limited at the route).
 */
const CACHE_MS = 15_000;
const CHECKS = [
  ['api_process', 'API process', 'process.resources'],
  ['database', 'Database', 'db.connectivity'],
  ['database_stability', 'Database connection stability', 'db.connection_history'],
  ['realtime', 'Real-time server (Socket.IO)', 'socket.server'],
  ['background_jobs', 'Background jobs', 'jobs.heartbeats'],
  ['event_ingestion', 'Error capture pipeline', 'soc.pipeline'],
  ['sessions', 'Sessions and recovery access', 'auth.sessions'],
  ['platform', 'Platform mode and backups', 'platform.mode'],
  ['storage', 'File storage', 'config.storage'],
  ['ai_provider', 'AI provider configuration', 'config.ai_provider'],
  ['sms_provider', 'SMS provider configuration', 'config.sms_provider'],
  ['bus_tracking', 'Bus tracking freshness', 'transport.tracking_freshness'],
];
const MAP = { PASS: 'PASS', WARNING: 'WARNING', FAIL: 'FAIL', SKIPPED: 'UNKNOWN', INCONCLUSIVE: 'UNKNOWN', TIMED_OUT: 'UNKNOWN', CANCELLED: 'UNKNOWN' };

let cache = null; // { at, body }

async function runCheck([key, label, testId]) {
  const test = getDiagnostic(testId);
  const startedAt = Date.now();
  if (!test) return { key, label, status: 'UNKNOWN', detail: `Diagnostic ${testId} is not registered.`, testId, checkedAt: new Date() };
  const controller = new AbortController();
  let timer;
  try {
    const out = await Promise.race([
      test.run({ signal: controller.signal }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: 'TIMED_OUT', observed: `No answer within ${test.timeoutMs} ms.` });
        }, Math.min(test.timeoutMs, 6000));
      }),
    ]);
    return { key, label, status: MAP[out?.status] || 'UNKNOWN', resultStatus: out?.status, detail: out?.observed || 'No detail', testId, durationMs: Date.now() - startedAt, checkedAt: new Date() };
  } catch (err) {
    return { key, label, status: 'UNKNOWN', detail: `Check could not run: ${String(err?.message || err).slice(0, 200)}`, testId, durationMs: Date.now() - startedAt, checkedAt: new Date() };
  } finally {
    clearTimeout(timer);
  }
}

/** Overall: FAIL if any critical component fails; DEGRADED if anything else is not PASS. */
function overall(checks) {
  const critical = ['database', 'api_process', 'sessions'];
  if (checks.some((c) => critical.includes(c.key) && c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'FAIL')) return 'DEGRADED';
  if (checks.some((c) => ['WARNING', 'UNKNOWN', 'DEGRADED'].includes(c.status))) return 'DEGRADED';
  return 'PASS';
}

export async function systemHealth({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { ...cache.body, cached: true };
  const checks = await Promise.all(CHECKS.map(runCheck));
  const jobs = jobHeartbeats().map((j) => ({ name: j.name, description: j.description, ...jobStatus(j), lastRunAt: j.lastRunAt, lastSuccessAt: j.lastSuccessAt, lastFailureAt: j.lastFailureAt, consecutiveFailures: j.consecutiveFailures, lastDurationMs: j.lastDurationMs }));
  const body = { status: overall(checks), checks, jobs, checkedAt: new Date(), cacheSeconds: CACHE_MS / 1000, scope: 'This API process' };
  cache = { at: Date.now(), body };
  return { ...body, cached: false };
}

export const lastHealth = () => cache?.body || null;
export const resetHealthCacheForTests = () => {
  cache = null;
};
