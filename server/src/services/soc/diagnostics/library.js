import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { env } from '../../../config/env.js';
import { registerDiagnostic } from './registry.js';
import { captureStats } from '../capture.js';
import { metricsState } from '../metrics.js';
import { dbConnectionEvents, jobHeartbeats, jobStatus, socketState } from '../monitors.js';
import { getPlatformState, backupStatus, HEALTH_CHECK_VALID_MS } from '../../platformState.js';
import { isConfigured as aiConfigured } from '../../ai/groqService.js';
import { trustProxySetting } from '../../../app.js';
import { UPLOAD_ROOT } from '../../../utils/storage.js';
import Session from '../../../models/Session.js';
import SecurityLog from '../../../models/SecurityLog.js';
import ErrorEvent from '../../../models/ErrorEvent.js';
import BusTrip from '../../../models/BusTrip.js';
import User from '../../../models/User.js';

/**
 * The diagnostic test library. Every test here is READ-ONLY: it reads
 * process state, configuration presence (never values), or runs bounded,
 * index-backed database reads. None of them changes data.
 *
 * Results describe exactly what was looked at and what was seen. A test that
 * cannot decide answers INCONCLUSIVE or SKIPPED — never PASS.
 */
const result = (status, checked, observed, reason, evidence) => ({ status, checked, observed, reason, evidence });
const abortable = (signal) => {
  if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
};

// ── Database ────────────────────────────────────────────────────────
registerDiagnostic({
  id: 'db.connectivity',
  name: 'Database connectivity',
  purpose: 'Checks that the API is connected to MongoDB and measures a ping round trip.',
  supports: { codes: ['DB_UNAVAILABLE', 'DB_CONNECTION_LOST', 'DB_OPERATION_TIMEOUT', 'DB_SERVER_ERROR', 'JOB_FAILED'], services: ['mongodb'] },
  preconditions: ['None'],
  timeoutMs: 5000,
  expectedDurationMs: 100,
  limits: 'One "ping" admin command.',
  output: 'PASS when connected and ping < 500 ms; WARNING when slower; FAIL when not connected or ping fails.',
  evidence: '{ readyState, pingMs, host (no credentials), database name }',
  nextSteps: {
    PASS: ['The database is reachable now. If errors continue, run "Database indexes" and check the recurrence test.'],
    WARNING: ['The database answers slowly. Check database load (Atlas → Metrics) and run "Database indexes".'],
    FAIL: ['Follow the repair guide: check DB_TARGET / MONGO_URI in server/.env, the database service, and Atlas Network Access.'],
  },
  verification: 'PASS means the API can currently reach MongoDB.',
  causes: { FAIL: 'db_down' },
  async run() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const readyState = mongoose.connection.readyState;
    const base = { readyState: states[readyState] || String(readyState), host: mongoose.connection.host, database: mongoose.connection.name };
    if (readyState !== 1) return result('FAIL', 'Mongoose connection state', `Connection state is "${base.readyState}".`, 'The API is not connected to MongoDB.', base);
    const t0 = performance.now();
    try {
      await mongoose.connection.db.admin().ping();
    } catch (err) {
      return result('FAIL', 'MongoDB ping command', `Ping failed: ${err.message}`, 'The connection exists but the database did not answer.', base);
    }
    const pingMs = Math.round(performance.now() - t0);
    if (pingMs > 500) return result('WARNING', 'MongoDB ping command', `Ping took ${pingMs} ms.`, 'Connected, but a round trip above 500 ms slows every page.', { ...base, pingMs });
    return result('PASS', 'MongoDB ping command', `Connected; ping took ${pingMs} ms.`, 'Connected and responding quickly.', { ...base, pingMs });
  },
});

registerDiagnostic({
  id: 'db.connection_history',
  name: 'Database connection history',
  purpose: 'Lists the connection events (disconnects, errors, reconnects) this API process has seen.',
  supports: { codes: ['DB_CONNECTION_LOST', 'DB_UNAVAILABLE', 'DB_OPERATION_TIMEOUT'], services: ['mongodb'] },
  preconditions: ['Events are kept in memory since this API process started.'],
  timeoutMs: 1000,
  expectedDurationMs: 5,
  limits: 'In-memory list, last 50 events.',
  output: 'PASS with no disconnects in the last hour; WARNING with 1–2; FAIL with 3 or more or when currently disconnected.',
  evidence: '{ events: [{ type, at }], processStartedAt }',
  nextSteps: {
    PASS: ['No recent connection drops in this process.'],
    WARNING: ['Occasional drops: check network stability and Atlas maintenance events.'],
    FAIL: ['Frequent drops: check the database host, network and the Atlas cluster tier.'],
  },
  verification: 'PASS means no disconnects in the last hour of this process.',
  causes: { FAIL: 'db_network', WARNING: 'db_network' },
  async run() {
    const events = dbConnectionEvents();
    const since = Date.now() - 3600_000;
    const drops = events.filter((e) => ['disconnected', 'error'].includes(e.type) && new Date(e.at).getTime() >= since);
    const evidence = { events: events.slice(-15).map(({ type, at, message }) => ({ type, at, message })), processStartedAt: metricsState().processStartedAt };
    if (mongoose.connection.readyState !== 1) return result('FAIL', 'Connection events in this process', `Currently not connected; ${drops.length} drop(s) in the last hour.`, 'The database is disconnected right now.', evidence);
    if (drops.length >= 3) return result('FAIL', 'Connection events in this process', `${drops.length} disconnects/errors in the last hour.`, 'Repeated connection drops.', evidence);
    if (drops.length > 0) return result('WARNING', 'Connection events in this process', `${drops.length} disconnect/error event(s) in the last hour, connected now.`, 'Some drops happened recently but the connection recovered.', evidence);
    return result('PASS', 'Connection events in this process', 'No disconnects or connection errors in the last hour.', 'Connection has been stable.', evidence);
  },
});

registerDiagnostic({
  id: 'db.indexes',
  name: 'Database indexes',
  purpose: 'Compares the indexes each model declares with the indexes that exist in MongoDB.',
  supports: { codes: ['DB_OPERATION_TIMEOUT'], services: ['mongodb'] },
  preconditions: ['Database connected.'],
  timeoutMs: 15000,
  expectedDurationMs: 1500,
  limits: 'One listIndexes call per model (read-only); stops at the timeout.',
  output: 'PASS when every declared index exists; WARNING when some are missing; SKIPPED when the database is not connected.',
  evidence: '{ modelsChecked, missing: [{ model, index }] }',
  nextSteps: {
    PASS: ['Indexes are in place; slow queries are not caused by a missing declared index.'],
    WARNING: ['Restart the API: server/src/config/db.js builds declared indexes at start-up (syncIndexes). Expect extra database load while they build.'],
    SKIPPED: ['Fix database connectivity first.'],
  },
  verification: 'PASS means every index declared in server/src/models exists.',
  causes: { WARNING: 'db_missing_index' },
  async run({ signal }) {
    if (mongoose.connection.readyState !== 1) return result('SKIPPED', 'Declared vs actual indexes', 'Database is not connected.', 'Cannot read indexes without a connection.', {});
    const missing = [];
    let checked = 0;
    for (const model of Object.values(mongoose.models)) {
      abortable(signal);
      let existing;
      try {
        existing = await model.collection.indexes();
      } catch (err) {
        // Collection not created yet: nothing stored, so nothing can be slow.
        if (err?.codeName === 'NamespaceNotFound' || err?.code === 26) continue;
        throw err;
      }
      checked += 1;
      const have = new Set(existing.map((i) => JSON.stringify(i.key)));
      const hasText = existing.some((i) => i.key?._fts === 'text');
      for (const [fields] of model.schema.indexes()) {
        // Text indexes are stored as { _fts: 'text', _ftsx: 1 }, not by field name.
        if (Object.values(fields).includes('text') ? hasText : have.has(JSON.stringify(fields))) continue;
        missing.push({ model: model.modelName, index: fields });
      }
    }
    const evidence = { modelsChecked: checked, missing: missing.slice(0, 25), missingCount: missing.length };
    if (missing.length) return result('WARNING', `Declared indexes on ${checked} models`, `${missing.length} declared index(es) are missing.`, 'Queries that rely on a missing index scan the whole collection.', evidence);
    return result('PASS', `Declared indexes on ${checked} models`, 'Every declared index exists.', 'No missing indexes.', evidence);
  },
});

// ── Configuration (presence only — values are never read out) ────────
const isDefaultSecret = (v) => !v || String(v).startsWith('dev_') || String(v).startsWith('replace_with');

registerDiagnostic({
  id: 'config.secrets',
  name: 'Signing and encryption secrets',
  purpose: 'Checks that JWT and chat-encryption secrets are set, are not development defaults and are long enough. Values are never shown.',
  supports: { codes: [], services: ['api'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'Reads configuration in memory only.',
  output: 'PASS when all secrets are set and ≥ 32 characters; WARNING when shorter; FAIL when a development default is in use in production.',
  evidence: '{ [name]: { set, length, developmentDefault } } — never the value',
  nextSteps: {
    PASS: ['Secrets are configured.'],
    WARNING: ['Use secrets of at least 32 random characters (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CHAT_ENCRYPTION_KEY in server/.env). Changing a JWT secret signs everyone out; changing CHAT_ENCRYPTION_KEY makes older messages unreadable.'],
    FAIL: ['Set real secrets in server/.env before running in production.'],
  },
  verification: 'PASS means no development defaults and adequate length.',
  async run() {
    const items = { JWT_ACCESS_SECRET: env.accessSecret, JWT_REFRESH_SECRET: env.refreshSecret, CHAT_ENCRYPTION_KEY: env.chatKey };
    const evidence = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { set: Boolean(v), length: v ? String(v).length : 0, developmentDefault: isDefaultSecret(v) }]));
    const defaults = Object.keys(items).filter((k) => evidence[k].developmentDefault);
    const short = Object.keys(items).filter((k) => evidence[k].length < 32);
    if (defaults.length && env.isProd) return result('FAIL', 'Secret configuration', `Development defaults in production: ${defaults.join(', ')}.`, 'Anyone who knows the default could forge sessions.', evidence);
    if (defaults.length) return result('WARNING', 'Secret configuration', `Development defaults in use: ${defaults.join(', ')} (not production).`, 'Acceptable for local development only.', evidence);
    if (short.length) return result('WARNING', 'Secret configuration', `Shorter than 32 characters: ${short.join(', ')}.`, 'Short secrets are easier to guess.', evidence);
    return result('PASS', 'Secret configuration', 'All secrets set, none are defaults, all ≥ 32 characters.', 'Secrets look adequate.', evidence);
  },
});

registerDiagnostic({
  id: 'config.cors',
  name: 'Allowed web origins (CLIENT_URL)',
  purpose: 'Lists the web addresses allowed to call the API from a browser and flags insecure ones in production.',
  supports: { codes: ['AUTHZ_ORIGIN_BLOCKED', 'AUTHZ_CSRF_REJECTED'], services: ['api'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'Reads configuration in memory only.',
  output: 'PASS when origins are set (https in production); WARNING for http origins in production or only localhost in production.',
  evidence: '{ origins, production }',
  nextSteps: {
    PASS: ['If users are still blocked, compare the blocked origin in the error\'s technical details with this list.'],
    WARNING: ['Set CLIENT_URL in server/.env to the https address(es) users open, then restart.'],
  },
  verification: 'PASS means the origin list is set and secure for the environment.',
  causes: { WARNING: 'cors_config' },
  async run() {
    const origins = env.clientUrls;
    const evidence = { origins, production: env.isProd };
    if (!origins.length) return result('WARNING', 'CLIENT_URL', 'No origins configured.', 'Browsers cannot use the API.', evidence);
    if (env.isProd && origins.some((o) => o.startsWith('http://'))) return result('WARNING', 'CLIENT_URL', 'Production allows an http:// origin.', 'Cookies and tokens could travel unencrypted.', evidence);
    if (env.isProd && origins.every((o) => /localhost|127\.0\.0\.1/.test(o))) return result('WARNING', 'CLIENT_URL', 'Production only allows localhost.', 'Real users\' browsers will be blocked.', evidence);
    return result('PASS', 'CLIENT_URL', `${origins.length} origin(s) configured.`, 'Origins are set for this environment.', evidence);
  },
});

registerDiagnostic({
  id: 'config.proxy',
  name: 'Proxy configuration (TRUST_PROXY)',
  purpose: 'Shows how many reverse-proxy hops the API trusts for client IP addresses, which rate limits and sign-in lockouts depend on.',
  supports: { codes: ['RATE_LIMITED'], services: ['api'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'Reads configuration in memory only.',
  output: 'PASS when production trusts 1–2 hops; WARNING when production trusts none; INCONCLUSIVE outside production.',
  evidence: '{ trustProxy, production }',
  nextSteps: {
    PASS: ['Client IPs are taken from the proxy as configured.'],
    WARNING: ['Set TRUST_PROXY in server/.env (1 on Render, 2 behind Cloudflare + Render) and restart.'],
    INCONCLUSIVE: ['Proxy trust matters in production; development usually runs without a proxy.'],
  },
  verification: 'PASS means rate limits see real client addresses.',
  causes: { WARNING: 'shared_ip' },
  async run() {
    const trust = trustProxySetting();
    const evidence = { trustProxy: trust, production: env.isProd };
    if (!env.isProd) return result('INCONCLUSIVE', 'TRUST_PROXY', `Trust setting: ${String(trust)} (not production).`, 'Whether this is right depends on the production proxy chain.', evidence);
    if (trust === false) return result('WARNING', 'TRUST_PROXY', 'Production trusts no proxy hops.', 'Behind a proxy every visitor appears to share the proxy\'s IP and one limit.', evidence);
    return result('PASS', 'TRUST_PROXY', `Production trusts ${trust} hop(s).`, 'Configured for a proxied deployment.', evidence);
  },
});

registerDiagnostic({
  id: 'config.ai_provider',
  name: 'AI provider configuration',
  purpose: 'Checks whether an AI provider key (GROQ_API_KEY) is configured. The key is never shown and no request is sent to the provider.',
  supports: { codes: ['AI_PROVIDER_ERROR'], services: ['groq'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'No network call.',
  output: 'PASS when a key is configured; FAIL when it is not. Cannot tell whether the key is valid (that needs a provider call).',
  evidence: '{ configured, model }',
  nextSteps: {
    PASS: ['A key is configured. If AI errors continue, the key may be revoked or over quota — check the Groq console.'],
    FAIL: ['Set GROQ_API_KEY in server/.env and restart the API.'],
  },
  verification: 'PASS means a key is configured (validity not tested).',
  causes: { FAIL: 'ai_key' },
  async run() {
    const configured = aiConfigured();
    const evidence = { configured, model: env.ai.model };
    return configured
      ? result('PASS', 'GROQ_API_KEY presence', 'A key is configured.', 'Presence only; validity is not tested.', evidence)
      : result('FAIL', 'GROQ_API_KEY presence', 'No key is configured.', 'The Study Assistant cannot work without a key.', evidence);
  },
});

registerDiagnostic({
  id: 'config.sms_provider',
  name: 'SMS provider configuration',
  purpose: 'Checks that parent-OTP SMS sending is enabled and its settings are present. Values are never shown; no SMS is sent.',
  supports: { codes: [], services: ['sms'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'No network call.',
  output: 'PASS when enabled with key, sender and OTP template; WARNING when disabled; FAIL when enabled but incomplete.',
  evidence: '{ enabled, apiKeySet, senderIdSet, otpTemplateSet, https }',
  nextSteps: {
    PASS: ['Settings are present. Delivery itself depends on the provider.'],
    WARNING: ['OTP_SMS_ENABLED is off: parent OTPs are not sent by SMS.'],
    FAIL: ['Set SMS_API_KEY, SMS_SENDER_ID and SMS_OTP_TEMPLATE_ID in server/.env.'],
  },
  verification: 'PASS means SMS settings are complete.',
  async run() {
    const evidence = {
      enabled: env.otp.smsEnabled,
      apiKeySet: Boolean(env.sms.apiKey),
      senderIdSet: Boolean(env.sms.senderId),
      otpTemplateSet: Boolean(env.sms.otpTemplateId),
      https: String(env.sms.apiUrl || '').startsWith('https://'),
    };
    if (!evidence.enabled) return result('WARNING', 'OTP_SMS_ENABLED and SMS settings', 'SMS sending is disabled.', 'Parents do not receive OTPs by SMS.', evidence);
    const missing = ['apiKeySet', 'senderIdSet', 'otpTemplateSet'].filter((k) => !evidence[k]);
    if (missing.length) return result('FAIL', 'OTP_SMS_ENABLED and SMS settings', `Enabled but missing: ${missing.join(', ')}.`, 'SMS sends will fail.', evidence);
    return result('PASS', 'OTP_SMS_ENABLED and SMS settings', 'Enabled and complete.', 'Settings present.', evidence);
  },
});

registerDiagnostic({
  id: 'config.storage',
  name: 'File storage',
  purpose: 'Checks where uploads are stored: Cloudinary configuration, or that the local upload directory exists and is writable (checked with fs.access, nothing is written).',
  supports: { codes: [], services: ['storage'] },
  preconditions: ['None'],
  timeoutMs: 2000,
  expectedDurationMs: 5,
  limits: 'One fs.access call.',
  output: 'PASS when Cloudinary is configured or the upload directory is writable; WARNING when the directory is missing; FAIL when it is not writable.',
  evidence: '{ cloudinary, uploadDirExists, uploadDirWritable }',
  nextSteps: {
    PASS: ['Uploads have somewhere to go.'],
    WARNING: ['The upload directory does not exist yet; it is created on first upload, or set UPLOAD_DIR.'],
    FAIL: ['Give the API process write permission on the upload directory (UPLOAD_DIR), or configure Cloudinary.'],
  },
  verification: 'PASS means uploads can be stored.',
  async run() {
    const evidence = { cloudinary: env.cloudinary.enabled, uploadDirExists: false, uploadDirWritable: false };
    try {
      await fs.access(UPLOAD_ROOT);
      evidence.uploadDirExists = true;
      await fs.access(UPLOAD_ROOT, fs.constants.W_OK);
      evidence.uploadDirWritable = true;
    } catch {
      /* recorded in evidence */
    }
    if (evidence.cloudinary) return result('PASS', 'Cloudinary / upload directory', 'Cloudinary is configured.', 'Uploads go to Cloudinary.', evidence);
    if (evidence.uploadDirWritable) return result('PASS', 'Cloudinary / upload directory', 'Local upload directory is writable.', 'Uploads can be stored locally.', evidence);
    if (!evidence.uploadDirExists) return result('WARNING', 'Cloudinary / upload directory', 'Upload directory does not exist.', 'It may be created on first upload.', evidence);
    return result('FAIL', 'Cloudinary / upload directory', 'Upload directory is not writable.', 'Uploads will fail.', evidence);
  },
});

// ── Runtime ─────────────────────────────────────────────────────────
registerDiagnostic({
  id: 'jobs.heartbeats',
  name: 'Background job heartbeats',
  purpose: 'Reports when each background job last ran and whether it succeeded.',
  supports: { codes: ['JOB_FAILED'], services: ['scheduler'] },
  preconditions: ['Heartbeats are kept in memory by this API process.'],
  timeoutMs: 1000,
  expectedDurationMs: 2,
  limits: 'In-memory only.',
  output: 'PASS when every job ran on schedule; WARNING when some are degraded or have not run yet; FAIL when a job failed 3 times in a row; INCONCLUSIVE when no jobs are registered (for example in tests).',
  evidence: '{ jobs: [{ name, status, lastRunAt, lastSuccessAt, consecutiveFailures, lastError }] }',
  nextSteps: {
    PASS: ['All jobs are running.'],
    WARNING: ['Check the jobs marked DEGRADED or UNKNOWN; UNKNOWN right after a restart is normal.'],
    FAIL: ['Read the server log lines for the failing job and follow the JOB_FAILED repair guide.'],
    INCONCLUSIVE: ['No job has registered in this process — the schedulers start in server/src/server.js.'],
  },
  verification: 'PASS means every job\'s latest run succeeded on schedule.',
  causes: { FAIL: 'job_stuck' },
  async run() {
    const list = jobHeartbeats().map((j) => ({ name: j.name, ...jobStatus(j), lastRunAt: j.lastRunAt, lastSuccessAt: j.lastSuccessAt, consecutiveFailures: j.consecutiveFailures, lastError: j.lastError }));
    const evidence = { jobs: list };
    if (!list.length) return result('INCONCLUSIVE', 'Job heartbeats', 'No background jobs are registered in this process.', 'Nothing to judge.', evidence);
    const failed = list.filter((j) => j.status === 'FAIL');
    const degraded = list.filter((j) => ['DEGRADED', 'UNKNOWN'].includes(j.status));
    if (failed.length) return result('FAIL', `${list.length} job heartbeats`, `Failing: ${failed.map((j) => j.name).join(', ')}.`, 'At least one job failed three or more runs in a row.', evidence);
    if (degraded.length) return result('WARNING', `${list.length} job heartbeats`, `Degraded or not yet run: ${degraded.map((j) => j.name).join(', ')}.`, 'Some jobs have not completed a healthy run recently.', evidence);
    return result('PASS', `${list.length} job heartbeats`, 'Every job ran on schedule and succeeded.', 'All healthy.', evidence);
  },
});

registerDiagnostic({
  id: 'socket.server',
  name: 'Real-time server (Socket.IO)',
  purpose: 'Checks that the Socket.IO server is running in this process and reports how many clients are connected.',
  supports: { codes: ['SOCKET_CONNECTION_ERROR'], services: ['socket.io'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'In-memory only.',
  output: 'PASS when initialized; FAIL when not initialized. Zero connected clients is reported, not judged.',
  evidence: '{ initialized, connected, rooms }',
  nextSteps: {
    PASS: ['The server is running. If clients cannot connect, check that the proxy forwards WebSocket upgrades.'],
    FAIL: ['initSocket() did not run — check the start-up log for errors.'],
  },
  verification: 'PASS means the real-time server is running.',
  causes: { FAIL: 'proxy_ws' },
  async run() {
    const s = socketState();
    if (!s.initialized) return result('FAIL', 'Socket.IO server state', 'Socket.IO is not initialized in this process.', 'Live updates cannot work.', s);
    return result('PASS', 'Socket.IO server state', `Running; ${s.connected ?? 'unknown'} client(s) connected.`, 'The server is running.', s);
  },
});

registerDiagnostic({
  id: 'process.resources',
  name: 'API process resources',
  purpose: 'Measures memory use and event-loop delay of the API process for one second.',
  supports: { codes: ['PROCESS_UNCAUGHT', 'CLIENT_NETWORK_ERROR'], services: ['node'] },
  preconditions: ['None'],
  timeoutMs: 5000,
  expectedDurationMs: 1000,
  limits: 'Samples the event loop for 1 s.',
  output: 'PASS when heap < 85 % of its limit and p99 loop delay < 200 ms; WARNING otherwise.',
  evidence: '{ uptimeSec, rssMb, heapUsedMb, heapLimitMb, loopDelayP99Ms }',
  nextSteps: {
    PASS: ['The process has headroom.'],
    WARNING: ['High memory or a blocked event loop slows every request. Look for heavy exports or reports running at the same time.'],
  },
  verification: 'PASS means the process is responsive with memory headroom.',
  async run({ signal }) {
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    await new Promise((r) => setTimeout(r, 1000));
    h.disable();
    abortable(signal);
    const { heapUsed, rss } = process.memoryUsage();
    const v8 = await import('node:v8');
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const evidence = {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(rss / 1048576),
      heapUsedMb: Math.round(heapUsed / 1048576),
      heapLimitMb: Math.round(heapLimit / 1048576),
      loopDelayP99Ms: Math.round(h.percentile(99) / 1e6),
    };
    const heapPct = heapUsed / heapLimit;
    if (heapPct > 0.85 || evidence.loopDelayP99Ms > 200) return result('WARNING', 'Memory and event-loop delay (1 s sample)', `Heap ${Math.round(heapPct * 100)} % of limit; p99 loop delay ${evidence.loopDelayP99Ms} ms.`, 'The process is under pressure.', evidence);
    return result('PASS', 'Memory and event-loop delay (1 s sample)', `Heap ${Math.round(heapPct * 100)} % of limit; p99 loop delay ${evidence.loopDelayP99Ms} ms.`, 'Healthy headroom.', evidence);
  },
});

registerDiagnostic({
  id: 'soc.pipeline',
  name: 'Error capture pipeline',
  purpose: 'Checks that error capture and metric flushing are working in this process.',
  supports: { codes: [], services: ['soc'] },
  preconditions: ['None'],
  timeoutMs: 1000,
  expectedDurationMs: 1,
  limits: 'In-memory counters only.',
  output: 'FAIL when capture is disabled or the last write/flush failed more recently than it succeeded; WARNING when events were dropped by storm protection; PASS otherwise.',
  evidence: '{ capture: {...counters}, metrics: { lastFlushAt, lastFlushError } }',
  nextSteps: {
    PASS: ['Errors are being recorded.'],
    WARNING: ['Storm protection dropped some events — a flood of errors happened. Look at the errors with the highest counts.'],
    FAIL: ['Error records are not being stored: check database connectivity, and that SOC_CAPTURE_ENABLED is not "false".'],
  },
  verification: 'PASS means captured errors reach the database.',
  async run() {
    const c = captureStats();
    const m = metricsState();
    const evidence = { capture: c, metrics: { lastFlushAt: m.lastFlushAt, lastFlushError: m.lastFlushError, lastFlushErrorAt: m.lastFlushErrorAt, processStartedAt: m.processStartedAt } };
    if (!c.enabled) return result('FAIL', 'Capture counters', 'Error capture is disabled (SOC_CAPTURE_ENABLED=false).', 'No errors are being recorded.', evidence);
    const after = (a, b) => a && (!b || new Date(a) > new Date(b));
    if (after(c.lastFailureAt, c.lastWriteAt)) return result('FAIL', 'Capture counters', `The latest error write failed: ${c.lastFailure}.`, 'Errors are not reaching the database.', evidence);
    if (after(m.lastFlushErrorAt, m.lastFlushAt)) return result('FAIL', 'Metric flush', `The latest metric flush failed: ${m.lastFlushError}.`, 'Error-rate numbers are not being saved.', evidence);
    if (c.dropped > 0) return result('WARNING', 'Capture counters', `${c.dropped} event(s) dropped by storm protection since start.`, 'An error flood exceeded the write budget.', evidence);
    return result('PASS', 'Capture counters', `${c.written} write(s), ${c.coalesced} coalesced repeat(s), no failures pending.`, 'Pipeline healthy.', evidence);
  },
});

registerDiagnostic({
  id: 'platform.mode',
  name: 'Platform mode and recovery readiness',
  purpose: 'Reports the emergency-control mode, the last recovery health check and the backup status.',
  supports: { codes: [], services: ['platform'] },
  preconditions: ['Database connected.'],
  timeoutMs: 3000,
  expectedDurationMs: 20,
  limits: 'One read of the platform-state document and the backup status file.',
  output: 'PASS in normal mode; WARNING in maintenance/lockdown/recovery or with an old/missing backup; never changes the mode.',
  evidence: '{ mode, lastHealthCheck, backup }',
  nextSteps: {
    PASS: ['Platform is in normal mode.'],
    WARNING: ['A restricted mode is active or backups are not reported. Use Emergency Control to review (password confirmation required).'],
  },
  verification: 'PASS means the platform is open to users.',
  async run() {
    const [s, backup] = await Promise.all([getPlatformState({ fresh: true }), backupStatus()]);
    const hc = s.lastHealthCheck;
    const evidence = { mode: s.mode, changedAt: s.changedAt, lastHealthCheck: hc ? { ok: hc.ok, at: hc.at, recent: Date.now() - new Date(hc.at).getTime() <= HEALTH_CHECK_VALID_MS } : null, backup };
    if (s.mode !== 'normal') return result('WARNING', 'Platform state', `Platform is in ${s.mode} mode.`, 'Ordinary users cannot use VEXON in this mode.', evidence);
    if (!backup.configured) return result('WARNING', 'Platform state and backups', 'Normal mode; backup status is not configured (BACKUP_STATUS_FILE).', 'Backups cannot be confirmed.', evidence);
    return result('PASS', 'Platform state and backups', 'Normal mode.', 'Platform open.', evidence);
  },
});

registerDiagnostic({
  id: 'auth.sessions',
  name: 'Session store',
  purpose: 'Checks that the session collection can be read and counts active sessions and Super Admin accounts.',
  supports: { codes: [], services: ['api'] },
  preconditions: ['Database connected.'],
  timeoutMs: 5000,
  expectedDurationMs: 50,
  limits: 'Two indexed count queries.',
  output: 'PASS when readable and at least one active Super Admin exists; FAIL when no active Super Admin exists; SKIPPED without a database.',
  evidence: '{ activeSessions, activeSuperAdmins }',
  nextSteps: {
    PASS: ['Sign-in sessions are readable.'],
    FAIL: ['Create a Super Admin with server/scripts/create-super-admin.mjs so the recovery path stays available.'],
    SKIPPED: ['Fix database connectivity first.'],
  },
  verification: 'PASS means sessions are readable and recovery access exists.',
  async run() {
    if (mongoose.connection.readyState !== 1) return result('SKIPPED', 'Session store', 'Database is not connected.', 'Cannot read sessions.', {});
    const [activeSessions, activeSuperAdmins] = await Promise.all([
      Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
      User.countDocuments({ role: 'super_admin', isActive: true }),
    ]);
    const evidence = { activeSessions, activeSuperAdmins };
    if (!activeSuperAdmins) return result('FAIL', 'Session store and recovery access', 'No active Super Admin account.', 'Nobody can reach emergency recovery.', evidence);
    return result('PASS', 'Session store and recovery access', `${activeSessions} active session(s); ${activeSuperAdmins} active Super Admin(s).`, 'Readable; recovery access exists.', evidence);
  },
});

// ── Security patterns ───────────────────────────────────────────────
registerDiagnostic({
  id: 'security.failed_logins',
  name: 'Failed sign-in volume',
  purpose: 'Counts failed sign-ins in the last hour and the networks with the most failures.',
  supports: { codes: ['RATE_LIMITED'], services: ['api'] },
  preconditions: ['Database connected.'],
  timeoutMs: 5000,
  expectedDurationMs: 50,
  limits: 'One indexed aggregation over the last hour of security logs; top 10 networks.',
  output: 'PASS under 20 failures/hour with no network over 10; WARNING above either. Suspicious, not proof of an attack.',
  evidence: '{ failuresLastHour, topNetworks: [{ ip, failures, accounts }] }',
  nextSteps: {
    PASS: ['Failed sign-ins are at a normal level.'],
    WARNING: ['Review the networks listed. Rate limits and account lockouts are already applied; open an incident if one network targets many accounts.'],
    SKIPPED: ['Fix database connectivity first.'],
  },
  verification: 'PASS means failed sign-ins are back to normal levels.',
  causes: { WARNING: 'brute_force' },
  async run() {
    if (mongoose.connection.readyState !== 1) return result('SKIPPED', 'LOGIN_FAILED events', 'Database is not connected.', 'Cannot read security logs.', {});
    const since = new Date(Date.now() - 3600_000);
    const [total, top] = await Promise.all([
      SecurityLog.countDocuments({ event: 'LOGIN_FAILED', createdAt: { $gte: since } }),
      SecurityLog.aggregate([
        { $match: { event: 'LOGIN_FAILED', createdAt: { $gte: since } } },
        { $group: { _id: '$ip', failures: { $sum: 1 }, accounts: { $addToSet: '$identifier' } } },
        { $sort: { failures: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, ip: '$_id', failures: 1, accounts: { $size: '$accounts' } } },
      ]),
    ]);
    const evidence = { failuresLastHour: total, topNetworks: top };
    if (total >= 20 || top.some((t) => t.failures >= 10)) return result('WARNING', 'LOGIN_FAILED events, last hour', `${total} failed sign-in(s); busiest network ${top[0]?.failures || 0}.`, 'Above the normal level — possible password guessing (not confirmed).', evidence);
    return result('PASS', 'LOGIN_FAILED events, last hour', `${total} failed sign-in(s).`, 'Normal level.', evidence);
  },
});

registerDiagnostic({
  id: 'security.authz_denials',
  name: 'Authorization refusals',
  purpose: 'Counts admin-policy refusals and other 403 refusals in the last hour, grouped by account.',
  supports: { codes: ['AUTHZ_POLICY_DENIED', 'AUTHZ_FORBIDDEN'], services: ['api'] },
  preconditions: ['Database connected.'],
  timeoutMs: 5000,
  expectedDurationMs: 50,
  limits: 'Indexed aggregation over the last hour; top 10 accounts.',
  output: 'PASS when no account has 10+ refusals in the hour; WARNING otherwise. Suspicious, not proof of misuse.',
  evidence: '{ policyDenialsLastHour, topActors: [{ actor, role, denials }], authorizationErrorRecords }',
  nextSteps: {
    PASS: ['Refusals are at a normal level.'],
    WARNING: ['Look at the accounts listed: a broken UI link or someone trying URLs outside their role.'],
    SKIPPED: ['Fix database connectivity first.'],
  },
  verification: 'PASS means refusals are back to normal levels.',
  causes: { WARNING: 'probing' },
  async run() {
    if (mongoose.connection.readyState !== 1) return result('SKIPPED', 'POLICY_DENIED events', 'Database is not connected.', 'Cannot read security logs.', {});
    const since = new Date(Date.now() - 3600_000);
    const [top, authzErrors] = await Promise.all([
      SecurityLog.aggregate([
        { $match: { event: 'POLICY_DENIED', createdAt: { $gte: since } } },
        { $group: { _id: '$actor', role: { $first: '$actorRole' }, denials: { $sum: 1 } } },
        { $sort: { denials: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, actor: '$_id', role: 1, denials: 1 } },
      ]),
      ErrorEvent.countDocuments({ source: 'authorization', lastSeenAt: { $gte: since } }),
    ]);
    const total = top.reduce((s, t) => s + t.denials, 0);
    const evidence = { policyDenialsLastHour: total, topActors: top, authorizationErrorRecords: authzErrors };
    if (top.some((t) => t.denials >= 10)) return result('WARNING', 'POLICY_DENIED events and 403 records, last hour', `Busiest account: ${top[0].denials} refusals.`, 'One account is being refused repeatedly (not confirmed misuse).', evidence);
    return result('PASS', 'POLICY_DENIED events and 403 records, last hour', `${total} policy refusal(s); ${authzErrors} 403 error record(s) active.`, 'Normal level.', evidence);
  },
});

registerDiagnostic({
  id: 'transport.tracking_freshness',
  name: 'Bus tracking freshness',
  purpose: 'For active bus trips, reports how old the latest GPS fix is. Reads trip metadata only; no positions are shown.',
  supports: { codes: [], services: ['transport'] },
  preconditions: ['Database connected.'],
  timeoutMs: 5000,
  expectedDurationMs: 30,
  limits: 'Indexed query over active trips (max 200).',
  output: 'PASS when every active trip reported in the last 2 min; WARNING when some are stale; SKIPPED when no trip is active.',
  evidence: '{ activeTrips, staleTrips }',
  nextSteps: {
    PASS: ['Live trips are reporting.'],
    WARNING: ['A trip phone or tracker stopped reporting — the trip sweeper will flag lost tracking.'],
    SKIPPED: ['No active trips right now; nothing to check.'],
  },
  verification: 'PASS means active trips report positions.',
  async run() {
    if (mongoose.connection.readyState !== 1) return result('SKIPPED', 'Active trips', 'Database is not connected.', 'Cannot read trips.', {});
    const trips = await BusTrip.find({ status: 'active' }).select('lastLocationAt').limit(200).lean();
    if (!trips.length) return result('SKIPPED', 'Active trips', 'No active bus trips.', 'Nothing to measure.', { activeTrips: 0 });
    const stale = trips.filter((t) => !t.lastLocationAt || Date.now() - new Date(t.lastLocationAt).getTime() > 120_000).length;
    const evidence = { activeTrips: trips.length, staleTrips: stale };
    if (stale) return result('WARNING', 'Active trips', `${stale} of ${trips.length} active trip(s) have no fix in the last 2 min.`, 'Some buses are not reporting.', evidence);
    return result('PASS', 'Active trips', `All ${trips.length} active trip(s) reported in the last 2 min.`, 'Tracking is fresh.', evidence);
  },
});

// ── Error-specific ──────────────────────────────────────────────────
export const RECURRENCE_WINDOW_MS = Number(process.env.SOC_VERIFY_WINDOW_MS) || 15 * 60 * 1000;

registerDiagnostic({
  id: 'errors.recurrence',
  name: 'Error recurrence',
  purpose: 'For the selected error, checks whether it has occurred again since the fix was applied (or in the observation window).',
  supports: { codes: ['*'], services: [] },
  preconditions: ['An error must be selected.', 'For verification, the fix should be marked as applied first.'],
  requiresError: true,
  timeoutMs: 3000,
  expectedDurationMs: 10,
  limits: 'One read of the selected error record.',
  output: 'PASS when the error has not occurred since the fix and the observation window has passed; INCONCLUSIVE when the window has not passed yet; FAIL when it occurred again.',
  evidence: '{ since, lastSeenAt, count, windowMinutes, elapsedMinutes }',
  nextSteps: {
    PASS: ['No recurrence during the observation window.'],
    INCONCLUSIVE: ['Wait until the observation window has passed and run the test again.'],
    FAIL: ['The fix did not hold, or there is a second cause. Re-run the diagnostics and review the repair guide.'],
  },
  verification: 'PASS means no occurrences after the fix for the full observation window.',
  async run({ errorEvent }) {
    if (!errorEvent) return result('SKIPPED', 'Selected error', 'No error was selected.', 'This test needs an error.', {});
    const fresh = await ErrorEvent.findById(errorEvent._id).select('lastSeenAt count fixAppliedAt firstSeenAt').lean();
    if (!fresh) return result('INCONCLUSIVE', 'Selected error', 'The error record no longer exists (retention).', 'Cannot judge.', {});
    const since = fresh.fixAppliedAt || null;
    const windowMinutes = Math.round(RECURRENCE_WINDOW_MS / 60000);
    if (!since) {
      const quietMs = Date.now() - new Date(fresh.lastSeenAt).getTime();
      const evidence = { since: null, lastSeenAt: fresh.lastSeenAt, count: fresh.count, windowMinutes, quietMinutes: Math.round(quietMs / 60000) };
      if (quietMs < RECURRENCE_WINDOW_MS) return result('FAIL', `Occurrences in the last ${windowMinutes} min`, `Last occurred ${Math.round(quietMs / 60000)} min ago.`, 'The error is still happening.', evidence);
      return result('INCONCLUSIVE', `Occurrences in the last ${windowMinutes} min`, `Quiet for ${Math.round(quietMs / 60000)} min, but no fix has been marked as applied.`, 'Quiet does not prove fixed — mark the fix as applied, then verify.', evidence);
    }
    const elapsed = Date.now() - new Date(since).getTime();
    const evidence = { since, lastSeenAt: fresh.lastSeenAt, count: fresh.count, windowMinutes, elapsedMinutes: Math.round(elapsed / 60000) };
    if (new Date(fresh.lastSeenAt) > new Date(since)) return result('FAIL', 'Occurrences since the fix was applied', `Occurred again at ${new Date(fresh.lastSeenAt).toISOString()}.`, 'The error happened after the fix.', evidence);
    if (elapsed < RECURRENCE_WINDOW_MS) return result('INCONCLUSIVE', 'Occurrences since the fix was applied', `None so far, but only ${Math.round(elapsed / 60000)} of ${windowMinutes} min have passed.`, 'Not enough time to judge.', evidence);
    return result('PASS', 'Occurrences since the fix was applied', `None in the ${Math.round(elapsed / 60000)} min since the fix.`, 'No recurrence for the full window.', evidence);
  },
});
