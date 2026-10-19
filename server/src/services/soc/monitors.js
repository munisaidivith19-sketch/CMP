import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { captureError } from './capture.js';
import { redactLine } from './sanitize.js';

/**
 * Runtime monitors: background-job heartbeats, MongoDB connection events,
 * Socket.IO state, request correlation IDs and process-level errors.
 * All state is per API process (see docs/SOC.md — "Limitations").
 */

// ── Background jobs ──────────────────────────────────────────────────
const jobs = new Map(); // name -> heartbeat

/**
 * Declare a job so the health page can report it as UNKNOWN until it first
 * runs (rather than not listing it at all).
 */
export function registerJob(name, { intervalMs, description } = {}) {
  if (!jobs.has(name)) {
    jobs.set(name, { name, description, intervalMs, registeredAt: new Date(), runs: 0, failures: 0, consecutiveFailures: 0, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null, lastDurationMs: null, running: false });
  }
  return jobs.get(name);
}

/**
 * Run one tick of a job, recording its heartbeat and capturing failures.
 * Never rejects: the job's own log line is kept (`logTag`), exactly as before.
 */
export async function runJob(name, fn, { logTag } = {}) {
  const hb = registerJob(name);
  const started = Date.now();
  hb.running = true;
  try {
    const result = await fn();
    hb.lastSuccessAt = new Date();
    hb.consecutiveFailures = 0;
    return result;
  } catch (err) {
    hb.failures += 1;
    hb.consecutiveFailures += 1;
    hb.lastFailureAt = new Date();
    hb.lastError = redactLine(err?.message || err, 200);
    console.error(`${logTag || `[${name}]`} failed:`, err?.message || err);
    captureError({ source: 'job', err, route: `job:${name}`, jobName: name, service: 'scheduler', meta: { job: name, consecutiveFailures: hb.consecutiveFailures } });
    return undefined;
  } finally {
    hb.runs += 1;
    hb.lastRunAt = new Date();
    hb.lastDurationMs = Date.now() - started;
    hb.running = false;
  }
}

export const jobHeartbeats = () => [...jobs.values()].map((j) => ({ ...j }));

/** PASS / FAIL / DEGRADED / UNKNOWN for one heartbeat. */
export function jobStatus(j, now = Date.now()) {
  if (!j.lastRunAt) return { status: 'UNKNOWN', reason: 'Has not run since this API process started.' };
  if (j.consecutiveFailures >= 3) return { status: 'FAIL', reason: `Failed ${j.consecutiveFailures} runs in a row.` };
  if (j.consecutiveFailures > 0) return { status: 'DEGRADED', reason: 'The latest run failed.' };
  if (j.intervalMs && now - new Date(j.lastRunAt).getTime() > j.intervalMs * 3 + 60_000) {
    return { status: 'DEGRADED', reason: `No run for ${Math.round((now - new Date(j.lastRunAt).getTime()) / 60000)} min (expected every ${Math.round(j.intervalMs / 60000) || 1} min).` };
  }
  return { status: 'PASS', reason: 'Latest run succeeded on schedule.' };
}

// ── MongoDB connection events ────────────────────────────────────────
const dbEvents = []; // newest last, capped
let dbMonitorAttached = false;

export function attachDbMonitor(connection = mongoose.connection) {
  if (dbMonitorAttached) return;
  dbMonitorAttached = true;
  const record = (type, err) => {
    dbEvents.push({ type, at: new Date(), message: err ? redactLine(err.message, 200) : undefined });
    if (dbEvents.length > 50) dbEvents.shift();
  };
  connection.on('connected', () => record('connected'));
  connection.on('reconnected', () => record('reconnected'));
  connection.on('disconnected', () => {
    record('disconnected');
    // Stored once the connection is back (capture needs the database).
    pendingDbIncident = pendingDbIncident || { type: 'disconnected', at: new Date() };
  });
  connection.on('error', (err) => {
    record('error', err);
    pendingDbIncident = pendingDbIncident || { type: 'error', at: new Date(), err };
  });
  connection.on('connected', flushDbIncident);
  connection.on('reconnected', flushDbIncident);
}

let pendingDbIncident = null;
function flushDbIncident() {
  if (!pendingDbIncident) return;
  const p = pendingDbIncident;
  pendingDbIncident = null;
  captureError({
    source: 'database',
    err: p.err,
    message: p.type === 'disconnected' ? 'MongoDB connection lost' : `MongoDB connection error${p.err ? `: ${p.err.message}` : ''}`,
    route: 'mongodb',
    module: 'database',
    service: 'mongodb',
    meta: { event: p.type, at: p.at, reconnectedAt: new Date() },
  });
}

export const dbConnectionEvents = () => dbEvents.map((e) => ({ ...e }));

// ── Socket.IO ────────────────────────────────────────────────────────
let socketServer = null;
export function attachSocketMonitor(io) {
  socketServer = io;
  io.engine.on('connection_error', (err) => {
    captureError({ source: 'socket', err, message: `Socket.IO connection error: ${err?.message || 'unknown'}`, route: 'socket.io', module: 'realtime', service: 'socket.io', meta: { transportCode: err?.code } });
  });
}
export function socketState() {
  if (!socketServer) return { initialized: false };
  return { initialized: true, connected: socketServer.engine?.clientsCount ?? null, rooms: socketServer.sockets?.adapter?.rooms?.size ?? null };
}

// ── Correlation IDs ──────────────────────────────────────────────────
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Give every request an ID (accepting a well-formed incoming X-Request-Id) and echo it back. */
export function correlationId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// ── Process-level errors ─────────────────────────────────────────────
let processHooked = false;
/**
 * Observe (not handle) crashes: uncaughtExceptionMonitor runs before Node's
 * default handler, so the existing crash-and-restart behaviour is unchanged.
 * Unhandled rejections also arrive here (origin "unhandledRejection") under
 * Node's default --unhandled-rejections=throw. Best-effort: the process may
 * exit before the write completes.
 */
export function attachProcessMonitor() {
  if (processHooked) return;
  processHooked = true;
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    captureError({ source: 'process', err, route: `process:${origin}`, module: 'api', service: 'node', meta: { origin } });
  });
}
