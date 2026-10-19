import QRCode from 'qrcode';
import { registerJob, runJob } from './soc/monitors.js';
import GatePass, { generateGatePassSecurityCode } from '../models/GatePass.js';
import { env } from '../config/env.js';
import { emitToRoles, emitToUsers } from '../config/socket.js';
import { notifyUsers } from '../utils/notify.js';
import { GATE_STAFF, QR_PREFIX } from '../controllers/gatePassController.js';

/**
 * Gate-code queue for bind-group (bulk) approvals.
 *
 * When the principal approves a group, its passes become `approved` without a
 * code and are queued here with the time their code is due. A worker tick
 * claims at most `codeBatchSize` (default 5) due passes, issues each one's code,
 * checks its QR renders, and moves on — so approving many groups at once never
 * turns into one burst of work on the server. A failure is retried on a later
 * tick with a growing delay; the approval itself is never needed again.
 */

const STALE_CLAIM_MS = 2 * 60 * 1000;
const MAX_CODE_DRAWS = 6;

const batchSize = () => env.gatePass.codeBatchSize;
const batchInterval = () => env.gatePass.codeBatchIntervalMs;

/** The QR the student will be shown — rendered once here so a broken one is caught and retried. */
const renderQr = (code) => QRCode.toDataURL(`${QR_PREFIX}${code}`, { errorCorrectionLevel: 'M', margin: 1, width: 320 });

/** Passes already waiting for a code (only live, approved ones count). */
export const queuedCount = () => GatePass.countDocuments({ status: 'approved', 'codeIssue.state': { $in: ['queued', 'processing'] } });

/**
 * When each of `count` new passes will get its code, placed after everything
 * already waiting: one batch per interval, `batchSize` passes per batch.
 */
export async function scheduleSlots(count, now = new Date()) {
  const ahead = await queuedCount();
  return Array.from({ length: count }, (_, i) => new Date(now.getTime() + Math.floor((ahead + i) / batchSize()) * batchInterval()));
}

/** `$set` fields that put a pass in the queue at `scheduledAt`. */
export const queuedFields = (scheduledAt) => ({
  'codeIssue.state': 'queued',
  'codeIssue.scheduledAt': scheduledAt,
  'codeIssue.attempts': 0,
});

const retryDelay = (attempts) => Math.min(batchInterval() * 2 ** Math.max(0, attempts - 1), env.gatePass.codeRetryMaxMs);

/** Issue one claimed pass's code. Returns 'issued' | 'skipped'; throws on failure. */
async function issueOne(pass, now, render) {
  for (let draw = 0; draw < MAX_CODE_DRAWS; draw += 1) {
    const code = generateGatePassSecurityCode();
    await render(code);
    try {
      const updated = await GatePass.findOneAndUpdate(
        { _id: pass._id, status: 'approved', 'codeIssue.state': 'processing', verificationCode: { $exists: false } },
        { $set: { verificationCode: code, 'codeIssue.state': 'issued', 'codeIssue.issuedAt': now }, $unset: { 'codeIssue.lastError': 1, 'codeIssue.claimedAt': 1 } },
        { new: true }
      );
      if (updated) return 'issued';
      // Revoked / expired / already issued while it waited — nothing to issue.
      await GatePass.updateOne({ _id: pass._id, 'codeIssue.state': 'processing' }, { $set: { 'codeIssue.state': 'skipped' }, $unset: { 'codeIssue.claimedAt': 1 } });
      return 'skipped';
    } catch (err) {
      if (err?.code !== 11000) throw err; // code clash with another live pass: draw again
    }
  }
  throw new Error('Could not draw a unique gate code');
}

/**
 * One worker tick: issue codes for at most `limit` due passes.
 * `render` is injectable so tests can simulate a QR generation failure.
 */
export async function processCodeQueue({ now = new Date(), limit = batchSize(), render = renderQr } = {}) {
  // A claim left behind by a crashed tick goes back in the queue.
  await GatePass.updateMany(
    { 'codeIssue.state': 'processing', 'codeIssue.claimedAt': { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    { $set: { 'codeIssue.state': 'queued' }, $unset: { 'codeIssue.claimedAt': 1 } }
  );

  const claimed = [];
  for (let i = 0; i < limit; i += 1) {
    // Atomic claim: two workers (or two server instances) never take the same pass.
    const pass = await GatePass.findOneAndUpdate(
      { status: 'approved', 'codeIssue.state': 'queued', 'codeIssue.scheduledAt': { $lte: now } },
      { $set: { 'codeIssue.state': 'processing', 'codeIssue.claimedAt': now } },
      { sort: { 'codeIssue.scheduledAt': 1, _id: 1 }, new: true, projection: { student: 1, codeIssue: 1 } }
    );
    if (!pass) break;
    claimed.push(pass);
  }

  const result = { issued: 0, failed: 0, skipped: 0 };
  const issuedTo = [];
  for (const pass of claimed) {
    try {
      const outcome = await issueOne(pass, now, render);
      result[outcome] += 1;
      if (outcome === 'issued') issuedTo.push(pass);
    } catch (err) {
      result.failed += 1;
      const attempts = (pass.codeIssue?.attempts || 0) + 1;
      console.error(`[gate-code-queue] pass ${pass._id} attempt ${attempts} failed: ${err?.message || err}`);
      await GatePass.updateOne(
        { _id: pass._id, 'codeIssue.state': 'processing' },
        {
          $set: {
            'codeIssue.state': 'queued',
            'codeIssue.attempts': attempts,
            'codeIssue.scheduledAt': new Date(now.getTime() + retryDelay(attempts)),
            'codeIssue.lastError': 'QR / code generation failed — retrying automatically',
          },
          $unset: { 'codeIssue.claimedAt': 1 },
        }
      );
    }
  }

  if (issuedTo.length) {
    const students = issuedTo.map((p) => p.student);
    await notifyUsers(students, {
      type: 'gate_pass',
      title: 'Your gate pass QR is ready',
      message: 'Your bulk-approved gate pass now has its QR and code. Show it to Security at the gate.',
      link: '/gate-pass',
    });
    issuedTo.forEach((p) => emitToUsers([p.student], 'gatepass:updated', { passId: String(p._id), status: 'approved', codeReady: true }));
    emitToRoles(GATE_STAFF, 'gatepass:updated', { codeReady: true, count: issuedTo.length });
  }
  return result;
}

let timer = null;
let running = false;

/** Run one tick unless one is already in progress (ticks never overlap). */
export async function tickCodeQueue() {
  if (running) return null;
  running = true;
  try {
    return (await runJob('gate_pass.code_queue', processCodeQueue, { logTag: '[gate-code-queue] tick' })) ?? null;
  } finally {
    running = false;
  }
}

/** Start the background worker (server.js). Tests drive processCodeQueue directly instead. */
export function startGatePassCodeQueue() {
  if (timer) return;
  registerJob('gate_pass.code_queue', { intervalMs: batchInterval(), description: 'Issue gate codes and QR for bulk approvals' });
  timer = setInterval(tickCodeQueue, batchInterval());
  timer.unref();
  tickCodeQueue();
}

/** Ask for an immediate tick (e.g. right after an approval) — only once the worker is running. */
export function kickCodeQueue() {
  if (timer) setImmediate(tickCodeQueue);
}
