// The scan queue: idempotent submission, per-credential ordering, local
// de-duplication, uncertain-result settling and offline refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanQueue } from '../src/lib/scanQueue.js';
import { explainJob } from '../src/lib/explain.js';

const tick = () => new Promise((r) => setImmediate(r));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await tick();
  }
}

/** A fake server keyed by scanId (processes each scanId once, like the real one). */
function fakeServer({ delay = 0, outcomeFor = () => 'success' } = {}) {
  const seen = new Map();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const submit = async (body) => {
    calls.push(body);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delay));
    inFlight -= 1;
    if (!seen.has(body.scanId)) seen.set(body.scanId, { outcome: outcomeFor(body), code: 'EXIT_RECORDED', scanId: body.scanId });
    return { ok: true, data: seen.get(body.scanId) };
  };
  const checkStatus = async (scanId) => (seen.has(scanId) ? { ok: true, data: seen.get(scanId) } : { ok: false, kind: 'notfound' });
  return { submit, checkStatus, calls, seen, get maxInFlight() { return maxInFlight; } };
}

test('rapid scans of different students are all sent, in parallel, each with its own scanId', async () => {
  const server = fakeServer({ delay: 20 });
  const q = createScanQueue({ submit: server.submit, checkStatus: server.checkStatus });
  const codes = ['A4G5', 'B7K2', 'Z9Q3', 'M3N4', 'P5R6', 'T7U8'];
  codes.forEach((c) => q.enqueue({ payload: `CCGP:${c}` }));
  await until(() => q.pending === 0);
  assert.equal(server.calls.length, 6);
  assert.equal(new Set(server.calls.map((c) => c.scanId)).size, 6);
  assert.ok(server.maxInFlight > 1 && server.maxInFlight <= 4, `bounded parallelism (${server.maxInFlight})`);
  assert.ok(q.jobs.every((j) => j.state === 'success'));
});

test('a repeated hardware read of the same QR is dropped locally; a different student right after is not', async () => {
  let now = 1000;
  const server = fakeServer();
  const q = createScanQueue({ submit: server.submit, checkStatus: server.checkStatus, now: () => now });
  q.enqueue({ payload: 'CCGP:A4G5' });
  now += 300;
  assert.equal(q.enqueue({ payload: 'ccgp:a4g5' }).ignored, true);
  now += 100;
  assert.equal(q.enqueue({ payload: 'CCGP:B7K2' }).ignored, undefined);
  await until(() => q.pending === 0);
  assert.equal(server.calls.length, 2);
  // After the short window the same QR goes to the server again (which answers "already recorded").
  now += 5000;
  assert.equal(q.enqueue({ payload: 'CCGP:A4G5' }).ignored, undefined);
  await until(() => q.pending === 0);
  assert.equal(server.calls.length, 3);
});

test('the same credential is never in flight twice; scans arriving while one is pending wait their turn', async () => {
  let now = 0;
  const server = fakeServer({ delay: 30 });
  const q = createScanQueue({ submit: server.submit, checkStatus: server.checkStatus, now: () => now, dedupeWindowMs: 0 });
  q.enqueue({ payload: 'CCGP:A4G5' });
  q.enqueue({ payload: 'CCGP:A4G5' });
  q.enqueue({ payload: 'CCGP:B7K2' });
  await tick();
  const sending = q.jobs.filter((j) => j.state === 'sending');
  assert.equal(sending.length, 2, 'A4G5 once + B7K2');
  await until(() => q.pending === 0);
  assert.equal(server.calls.length, 3);
});

test('timeout after the server may have committed → uncertain → settled by scanId, never re-submitted', async () => {
  const server = fakeServer();
  let first = true;
  const submit = async (body) => {
    if (first) {
      first = false;
      await server.submit(body); // the server committed …
      return { ok: false, kind: 'timeout', mayHaveArrived: true }; // … but the answer was lost
    }
    return server.submit(body);
  };
  const q = createScanQueue({ submit, checkStatus: server.checkStatus, settleDelays: [5, 5, 5] });
  const job = q.enqueue({ payload: 'CCGP:A4G5' });
  await until(() => q.jobs[0].state === 'uncertain');
  assert.equal(explainJob(q.jobs[0]).tone, 'pending', 'shown as checking, never as success');
  await until(() => q.jobs[0].state === 'success');
  assert.equal(q.jobs[0].scanId, job.scanId);
  assert.equal(server.calls.length, 1, 'no second submission');
});

test('a scan that never reached the server settles as "not recorded" (safe to scan again)', async () => {
  const server = fakeServer();
  const q = createScanQueue({ submit: async () => ({ ok: false, kind: 'timeout', mayHaveArrived: true }), checkStatus: server.checkStatus, settleDelays: [5] });
  q.enqueue({ payload: 'CCGP:A4G5' });
  await until(() => q.jobs[0].state === 'failed');
  assert.equal(q.jobs[0].error.kind, 'not_recorded');
});

test('still unreachable after every check → stays uncertain with a "check history" instruction', async () => {
  const q = createScanQueue({ submit: async () => ({ ok: false, kind: 'offline', mayHaveArrived: true }), checkStatus: async () => ({ ok: false, kind: 'offline' }), settleDelays: [2, 2] });
  q.enqueue({ payload: 'CCGP:A4G5' });
  await until(() => q.jobs[0].error?.kind === 'unconfirmed');
  assert.equal(q.jobs[0].state, 'uncertain');
  assert.match(explainJob(q.jobs[0]).action, /Gate History/);
});

test('server unreachable before sending (connection refused) → failed, not uncertain', async () => {
  const q = createScanQueue({ submit: async () => ({ ok: false, kind: 'offline', mayHaveArrived: false }), checkStatus: async () => ({ ok: false }) });
  q.enqueue({ payload: 'CCGP:A4G5' });
  await until(() => q.pending === 0);
  assert.equal(q.jobs[0].state, 'failed');
  assert.equal(explainJob(q.jobs[0]).title, 'Server unreachable');
});

test('offline: scans are refused at once and nothing is queued for later replay', async () => {
  const server = fakeServer();
  const q = createScanQueue({ submit: server.submit, checkStatus: server.checkStatus, isOnline: () => false });
  q.enqueue({ payload: 'CCGP:A4G5' });
  await tick();
  assert.equal(q.jobs[0].state, 'failed');
  assert.equal(q.jobs[0].error.kind, 'offline');
  assert.equal(server.calls.length, 0);
});

test('Caps Lock on a case-sensitive return QR is caught before sending; exit codes are unaffected', async () => {
  const server = fakeServer();
  const q = createScanQueue({ submit: server.submit, checkStatus: server.checkStatus });
  q.enqueue({ payload: 'CCRT:ABCDEFGHIJKLMNOPQRSTUVWX', capsLock: true });
  q.enqueue({ payload: 'CCGP:A4G5', capsLock: true });
  await until(() => q.pending === 0);
  const [exit, ret] = q.jobs;
  assert.equal(ret.state, 'failed');
  assert.equal(ret.error.kind, 'caps_lock');
  assert.equal(exit.state, 'success');
  assert.equal(server.calls.length, 1);
});

test('server rejections are shown as rejections with the server message; payloads are not retained', async () => {
  const server = fakeServer({ outcomeFor: () => 'rejected' });
  const submit = async (b) => {
    const r = await server.submit(b);
    return { ok: true, data: { ...r.data, code: 'EXPIRED', message: 'This pass has expired' } };
  };
  const q = createScanQueue({ submit, checkStatus: server.checkStatus });
  q.enqueue({ payload: 'CCGP:A4G5' });
  await until(() => q.pending === 0);
  const view = explainJob(q.jobs[0]);
  assert.equal(view.tone, 'error');
  assert.equal(view.title, 'Pass expired');
  assert.equal(view.detail, 'This pass has expired');
  assert.ok(!JSON.stringify(q.jobs).includes('A4G5'), 'the scan list keeps no credential');
});
