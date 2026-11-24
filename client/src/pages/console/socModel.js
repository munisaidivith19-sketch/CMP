/**
 * Pure helpers for the SOC screens (no React), unit-tested in
 * client/tests/socModel.test.mjs. They only describe data the server sent —
 * they never invent a status, a count or a result.
 */

/** Badge colour for a diagnostic / health status. Unknown statuses are neutral, never green. */
export function statusTone(status) {
  switch (status) {
    case 'PASS':
      return 'success';
    case 'FAIL':
      return 'danger';
    case 'WARNING':
    case 'DEGRADED':
      return 'warning';
    case 'QUEUED':
    case 'RUNNING':
      return 'info';
    default:
      return 'neutral'; // SKIPPED, INCONCLUSIVE, TIMED_OUT, CANCELLED, UNKNOWN, anything new
  }
}

export const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'neutral' };
export const severityTone = (s) => SEVERITY_TONE[s] || 'neutral';

/** Plain-language meaning of a result status, for people new to diagnostics. */
export const STATUS_MEANING = {
  PASS: 'Checked and working.',
  FAIL: 'Checked and found a problem.',
  WARNING: 'Checked; needs attention.',
  SKIPPED: 'Did not run — a precondition was not met. Proves nothing.',
  INCONCLUSIVE: 'Ran, but could not decide. Proves nothing.',
  TIMED_OUT: 'Took too long and was stopped. Proves nothing.',
  CANCELLED: 'Cancelled. Proves nothing.',
  QUEUED: 'Waiting to start.',
  RUNNING: 'Running now.',
  UNKNOWN: 'No data — this is not the same as healthy.',
  DEGRADED: 'Partly working or not fully checked.',
};

export const isFinal = (status) => !['QUEUED', 'RUNNING'].includes(status);

/** Statement kinds in an explanation, with the label the page shows. */
export const KIND_LABEL = {
  confirmed: 'Confirmed finding',
  possible: 'Possible cause',
  recommended: 'Recommended action',
  unverified: 'Unverified assumption',
};

export const ERROR_STATUS_LABEL = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  fix_applied: 'Fix applied — awaiting verification',
  resolved: 'Resolved (verified)',
};

/**
 * A count for display. `null`/`undefined` means the server has no data for
 * it, which must read differently from a real zero.
 */
export function countLabel(n) {
  if (n === null || n === undefined) return 'No data';
  return String(n);
}

export function percentLabel(ratio) {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return 'No data';
  if (ratio > 0 && ratio < 0.001) return '<0.1 %';
  return `${(ratio * 100).toFixed(1)} %`;
}

/** Explains whether the overview's counters cover the whole selected range. */
export function telemetryNotice(telemetry) {
  if (!telemetry) return 'Telemetry status unknown.';
  if (telemetry.lastFlushError) return `Counters could not be saved recently (${telemetry.lastFlushError}). Numbers may be incomplete.`;
  if (!telemetry.coverageStart) return 'No traffic counters have been collected yet. Request and error-rate numbers are unavailable, not zero.';
  if (!telemetry.complete) return `Counters only exist from ${new Date(telemetry.coverageStart).toLocaleString()}; earlier parts of the range have no data.`;
  return 'Counters cover the whole range.';
}

/** Group an explanation's causes by kind, in the order the page shows them. */
export function groupCauses(causes = []) {
  const order = ['confirmed', 'possible', 'unverified'];
  return order.map((kind) => ({ kind, label: KIND_LABEL[kind], items: causes.filter((c) => c.kind === kind) })).filter((g) => g.items.length);
}

/** What the "Verify fix" button should say/do for an error status. */
export function verifyState(status) {
  if (status === 'fix_applied') return { enabled: true, hint: 'Runs the verification tests. The error is resolved only if all of them pass.' };
  if (status === 'resolved') return { enabled: false, hint: 'Already verified and resolved.' };
  return { enabled: false, hint: 'Mark the fix as applied first.' };
}

/** Human label for a status transition button. */
export const TRANSITION_LABEL = {
  acknowledged: 'Acknowledge',
  investigating: 'Start investigating',
  fix_applied: 'Mark fix as applied',
  open: 'Re-open',
};
