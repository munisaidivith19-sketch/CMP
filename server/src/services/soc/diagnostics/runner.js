import crypto from 'node:crypto';
import mongoose from 'mongoose';
import DiagnosticRun from '../../../models/DiagnosticRun.js';
import ErrorEvent from '../../../models/ErrorEvent.js';
import { SUPER_ADMIN_ROLE } from '../../../constants.js';
import { getDiagnostic, RESULT } from './registry.js';
import { environmentName } from '../capture.js';
import { redactLine, redactObject, redactText } from '../sanitize.js';
import './library.js';

/**
 * Executes registered diagnostics. Isolation and limits:
 *  - only registered, read-only tests run (validated here, not just in the route);
 *  - each run has a hard timeout (the test's timeoutMs, max 30 s) → TIMED_OUT;
 *  - at most MAX_CONCURRENT runs at once in this process, MAX_PER_USER per
 *    Super Admin, and one run of the same test for the same error at a time;
 *  - a run can be cancelled; the test receives an AbortSignal;
 *  - any exception inside a test becomes INCONCLUSIVE with the (redacted)
 *    error message — never PASS.
 * Runs execute in the API process after the HTTP response is sent; their
 * results are stored in DiagnosticRun and polled by the dashboard.
 */
export const MAX_CONCURRENT = Number(process.env.SOC_DIAG_MAX_CONCURRENT) || 3;
export const MAX_PER_USER = 2;

const active = new Map(); // runId -> { controller, userId, key }

export class DiagnosticError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const activeRunCount = () => active.size;

/**
 * Validate and queue a run. Returns the stored run document (QUEUED); the
 * test executes asynchronously. `onFinished(run)` is called with the final run.
 */
export async function startRun({ testId, user, errorEvent = null, incidentId, purpose = 'diagnosis', verificationBatch, onFinished }) {
  const test = getDiagnostic(testId);
  if (!test) throw new DiagnosticError(404, 'Unknown diagnostic test');
  if (user?.role !== SUPER_ADMIN_ROLE || test.authorization !== 'super_admin') throw new DiagnosticError(403, 'You do not have permission to run diagnostics');
  if (!test.readOnly) throw new DiagnosticError(403, 'State-changing diagnostics cannot be run from the dashboard');
  if (test.requiresError && !errorEvent) throw new DiagnosticError(422, 'This test needs a selected error');
  if (active.size >= MAX_CONCURRENT) throw new DiagnosticError(429, 'Too many diagnostics are running. Wait for one to finish.');
  const mine = [...active.values()].filter((a) => a.userId === String(user._id)).length;
  if (mine >= MAX_PER_USER) throw new DiagnosticError(429, `You already have ${mine} diagnostics running. Wait for one to finish.`);
  const key = `${testId}|${errorEvent?._id || ''}`;
  if ([...active.values()].some((a) => a.key === key)) throw new DiagnosticError(409, 'This test is already running for this error');

  const run = await DiagnosticRun.create({
    testId,
    testName: test.name,
    testVersion: test.version,
    status: 'QUEUED',
    purpose,
    errorEvent: errorEvent?._id,
    errorCode: errorEvent?.code,
    incident: incidentId,
    verificationBatch,
    requestedBy: user._id,
    environment: environmentName(),
    timeoutMs: test.timeoutMs,
    readOnly: true,
  });
  const controller = new AbortController();
  active.set(String(run._id), { controller, userId: String(user._id), key });
  setImmediate(() => execute(run._id, test, errorEvent, controller).then((final) => onFinished?.(final)).catch(() => {}));
  return run;
}

async function execute(runId, test, errorEvent, controller) {
  const startedAt = new Date();
  try {
    await DiagnosticRun.updateOne({ _id: runId, status: 'QUEUED' }, { $set: { status: 'RUNNING', startedAt } });
    let timer;
    let timedOut = false;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve({ status: 'TIMED_OUT', checked: test.name, observed: `No result within ${test.timeoutMs} ms.`, reason: 'The test exceeded its time limit and was stopped. This says nothing about whether the component is healthy.' });
      }, test.timeoutMs);
    });
    const cancelled = new Promise((resolve) => {
      controller.signal.addEventListener('abort', () => !timedOut && resolve({ status: 'CANCELLED', checked: test.name, observed: 'Cancelled before it finished.', reason: 'Cancelled by a Super Admin; no conclusion.' }), { once: true });
    });
    const work = Promise.resolve()
      .then(() => test.run({ signal: controller.signal, errorEvent }))
      .catch((err) =>
        err?.name === 'AbortError' && !timedOut
          ? { status: 'CANCELLED', checked: test.name, observed: 'Stopped.', reason: 'The run was stopped before it finished.' }
          : { status: 'INCONCLUSIVE', checked: test.name, observed: `The test itself failed: ${err?.message || err}`, reason: 'The test could not complete, so no conclusion can be drawn.' }
      );
    let out = await Promise.race([work, timeout, cancelled]);
    clearTimeout(timer);
    // A test that returns something other than a recognised result is not trusted.
    if (!out || ![...RESULT, 'TIMED_OUT', 'CANCELLED'].includes(out.status)) {
      out = { status: 'INCONCLUSIVE', checked: test.name, observed: 'The test returned no valid result.', reason: 'Invalid test output.' };
    }
    const finishedAt = new Date();
    const current = await DiagnosticRun.findById(runId).select('status').lean();
    // Cancelled through the API while running: keep CANCELLED.
    if (current?.status === 'CANCELLED') return DiagnosticRun.findById(runId).lean();
    const update = {
      status: out.status,
      checked: redactLine(out.checked, 600),
      observed: redactText(out.observed, 1500),
      reason: redactText(out.reason, 600),
      evidence: redactObject(out.evidence || {}),
      nextSteps: (test.nextSteps[out.status] || []).map((s) => redactText(s, 400)),
      confirmsCause: test.causes?.[out.status] || undefined,
      finishedAt,
      durationMs: finishedAt - startedAt,
    };
    return await DiagnosticRun.findOneAndUpdate({ _id: runId }, { $set: update }, { new: true, lean: true });
  } catch (err) {
    // Storage failure: record if possible; nothing pretends the test passed.
    if (mongoose.connection.readyState === 1) {
      await DiagnosticRun.updateOne({ _id: runId }, { $set: { status: 'INCONCLUSIVE', reason: redactText(`Runner error: ${err?.message}`, 600), finishedAt: new Date() } }).catch(() => {});
    }
    return DiagnosticRun.findById(runId).lean().catch(() => null);
  } finally {
    active.delete(String(runId));
  }
}

/** Cancel a queued/running run. Returns the updated run, or null if it had already finished. */
export async function cancelRun(runId, user) {
  const run = await DiagnosticRun.findOneAndUpdate(
    { _id: runId, status: { $in: ['QUEUED', 'RUNNING'] } },
    { $set: { status: 'CANCELLED', cancelledBy: user._id, finishedAt: new Date(), observed: 'Cancelled before it finished.', reason: 'Cancelled by a Super Admin; no conclusion.' } },
    { new: true, lean: true }
  );
  active.get(String(runId))?.controller.abort();
  return run;
}

/**
 * Verification: run the error's verification tests together. When every one
 * of them passes, the error is resolved; otherwise it goes back to
 * investigating. The decision is made here from stored results only.
 */
export async function startVerification({ errorEvent, definition, user, onDecided }) {
  const ids = (definition?.verification?.tests || []).filter((id) => getDiagnostic(id));
  if (!ids.length) throw new DiagnosticError(422, 'This error has no verification tests, so a fix cannot be verified automatically');
  const batch = crypto.randomUUID();

  const decide = async () => {
    const results = await DiagnosticRun.find({ verificationBatch: batch }).select('testId status').lean();
    const allPass = results.length === ids.length && results.every((r) => r.status === 'PASS');
    const at = new Date();
    const summary = results.map((r) => `${r.testId}: ${r.status}`).join(', ');
    const update = allPass
      ? { $set: { status: 'resolved', resolvedAt: at, statusChangedAt: at, statusChangedBy: user._id }, $push: { notes: { $each: [{ at, by: user._id, kind: 'verified', text: `Verification passed (${summary}). Marked resolved.` }], $slice: -100 } } }
      : { $set: { status: 'investigating', statusChangedAt: at, statusChangedBy: user._id }, $push: { notes: { $each: [{ at, by: user._id, kind: 'verification_failed', text: `Verification did not pass (${summary}). Not resolved.` }], $slice: -100 } } };
    // Only an error still waiting for verification is changed.
    await ErrorEvent.updateOne({ _id: errorEvent._id, status: 'fix_applied' }, update);
    onDecided?.({ batch, allPass, results });
  };

  // Tests run one after another (one slot), so a batch never exceeds the limits.
  const startAt = async (i) => {
    if (i >= ids.length) return decide();
    const testId = ids[i];
    try {
      return await startRun({ testId, user, errorEvent, purpose: 'verification', verificationBatch: batch, onFinished: () => startAt(i + 1).catch(() => {}) });
    } catch (err) {
      // A test that could not start counts as not passed.
      await DiagnosticRun.create({ testId, testName: getDiagnostic(testId)?.name, status: 'SKIPPED', purpose: 'verification', verificationBatch: batch, errorEvent: errorEvent._id, errorCode: errorEvent.code, requestedBy: user._id, environment: environmentName(), reason: redactText(`Could not start: ${err.message}`, 600), finishedAt: new Date() });
      return startAt(i + 1);
    }
  };
  const first = await startAt(0);
  return { batch, tests: ids, firstRun: first?._id ? first : null };
}
