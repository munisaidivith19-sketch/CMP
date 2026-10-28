/**
 * The scan queue between the scanner and the server.
 *
 * - Every scan gets its own scanId; the server processes a scanId once, so a
 *   retry after a timeout returns the original answer instead of acting twice.
 * - Different students are sent in parallel (bounded); scans of the SAME
 *   credential are never in flight together (strict order per credential).
 * - A repeated hardware read of the same QR within a short window is dropped
 *   locally — a short window, not a cooldown: other students are unaffected.
 * - Nothing is ever shown as recorded until the server says so. A request
 *   that may have arrived (timeout, dropped connection) becomes "uncertain"
 *   and is settled by asking the server about that scanId. While the server
 *   is offline, scans are refused with a clear message — never stored and
 *   replayed later.
 */
import { newScanId } from './scanId.js';
import { describePayload } from './payload.js';

export const DEDUPE_WINDOW_MS = 2500;
export const MAX_CONCURRENT = 4;
export const SETTLE_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const KEEP_JOBS = 60;

export const FINAL_STATES = ['success', 'rejected', 'duplicate', 'failed'];

export function createScanQueue({
  submit,
  checkStatus,
  onChange = () => {},
  isOnline = () => true,
  dedupeWindowMs = DEDUPE_WINDOW_MS,
  maxConcurrent = MAX_CONCURRENT,
  settleDelays = SETTLE_DELAYS_MS,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  makeId = newScanId,
}) {
  let jobs = []; // newest first
  const payloads = new Map(); // scanId → payload, only until it has been sent
  const inFlightKeys = new Set();
  let running = 0;
  let ignoredRepeats = 0;

  const emit = () => onChange({ jobs: jobs.slice(), ignoredRepeats });
  const update = (job, patch) => {
    Object.assign(job, patch, { updatedAt: now() });
    emit();
  };

  function finalFromServer(job, data) {
    if (data?.pending) return update(job, { state: 'uncertain', result: data });
    update(job, { state: ['success', 'rejected', 'duplicate'].includes(data?.outcome) ? data.outcome : 'failed', result: data });
  }

  function settle(job, attempt = 0) {
    if (attempt >= settleDelays.length) {
      update(job, { state: 'uncertain', settling: false, error: { kind: 'unconfirmed', message: 'Could not confirm with the server. Check Gate History before scanning this student again.' } });
      return;
    }
    update(job, { settling: true });
    schedule(async () => {
      const res = await checkStatus(job.scanId);
      if (res?.ok && !res.data?.pending) {
        update(job, { settling: false });
        return finalFromServer(job, res.data);
      }
      if (!res?.ok && res?.kind === 'notfound') {
        // The server never received it: nothing was recorded, scanning again is safe.
        return update(job, { state: 'failed', settling: false, error: { kind: 'not_recorded', message: 'Not recorded — the scan never reached the server. Scan again.' } });
      }
      if (!res?.ok && ['auth', 'role'].includes(res?.kind)) return update(job, { state: 'uncertain', settling: false, error: res });
      settle(job, attempt + 1);
    }, settleDelays[attempt]);
  }

  async function run(job) {
    running += 1;
    inFlightKeys.add(job.key);
    update(job, { state: 'sending' });
    const payload = payloads.get(job.scanId);
    let res;
    try {
      res = await submit({ scanId: job.scanId, payload, source: job.source, kind: job.kind });
    } catch (err) {
      res = { ok: false, kind: 'offline', mayHaveArrived: true, message: String(err?.message || err) };
    }
    payloads.delete(job.scanId); // the QR contents are not kept once sent
    if (res.ok) finalFromServer(job, res.data);
    else if (res.mayHaveArrived && ['timeout', 'offline', 'server'].includes(res.kind)) {
      update(job, { state: 'uncertain', error: res });
      settle(job);
    } else update(job, { state: 'failed', error: res });
    running -= 1;
    inFlightKeys.delete(job.key);
    pump();
  }

  function pump() {
    for (const job of [...jobs].reverse()) {
      if (running >= maxConcurrent) return;
      if (job.state === 'queued' && !inFlightKeys.has(job.key)) run(job);
    }
  }

  return {
    /**
     * Add a scan. Returns the job, or { ignored: true } for a repeated read.
     * @param {{ payload: string, source: 'hid'|'serial'|'manual', kind?: 'in'|'out', capsLock?: boolean }} input
     */
    enqueue({ payload, source = 'hid', kind, capsLock = false }) {
      const info = describePayload(payload, { kind });
      const at = now();
      const recent = jobs.find((j) => j.key === info.key && at - j.receivedAt < dedupeWindowMs && j.state !== 'failed');
      if (recent && source !== 'manual') {
        ignoredRepeats += 1;
        emit();
        return { ignored: true, of: recent.scanId };
      }
      const job = { scanId: makeId(), key: info.key, label: info.label, direction: info.direction, source, kind, receivedAt: at, updatedAt: at, state: 'queued' };
      jobs = [job, ...jobs].slice(0, KEEP_JOBS);
      // Caught here so the guard gets the reason at once; the server would refuse it anyway.
      if (info.direction === 'in' && info.caseSensitive && capsLock) {
        update(job, { state: 'failed', error: { kind: 'caps_lock', message: 'Caps Lock was on, so the return QR was read wrongly. Turn Caps Lock off and scan again.' } });
        return job;
      }
      if (!isOnline()) {
        update(job, { state: 'failed', error: { kind: 'offline', message: 'Not recorded — the server is offline. Use the manual gate register and scan again when the connection is back.' } });
        return job;
      }
      payloads.set(job.scanId, String(payload));
      emit();
      pump();
      return job;
    },
    /** Ask the server again about an uncertain scan. */
    recheck(scanId) {
      const job = jobs.find((j) => j.scanId === scanId);
      if (job && job.state === 'uncertain' && !job.settling) settle(job);
    },
    get jobs() {
      return jobs.slice();
    },
    get pending() {
      return jobs.filter((j) => !FINAL_STATES.includes(j.state)).length;
    },
  };
}
