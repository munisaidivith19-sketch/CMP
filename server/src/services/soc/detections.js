import SecurityLog from '../../models/SecurityLog.js';
import AuditLog from '../../models/AuditLog.js';
import ErrorEvent from '../../models/ErrorEvent.js';
import { metricTotals, metricsState } from './metrics.js';
import { captureStats } from './capture.js';

/**
 * SOC detections and the overview. Everything is computed from stored
 * records (SecurityLog, AuditLog, ErrorEvent, SocMetric) for an explicit time
 * range, with bounded, index-backed aggregations. Alerts are computed on
 * demand, not stored, so none can exist without the records behind them.
 *
 * Alerts are SUSPICIONS: each carries `assessment: 'suspected'` and the
 * evidence counts that triggered it. Turning one into a confirmed incident is
 * a human decision (Incidents → assessment, with a justification).
 */
export const RANGES = { '1h': 3600_000, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 };
export const rangeSince = (range) => new Date(Date.now() - (RANGES[range] || RANGES['24h']));

// Thresholds per range hour (scaled so a 7-day window is not flagged for normal background noise).
const THRESHOLDS = {
  failedLoginsPerIp: { medium: 10, high: 30 },
  failedLoginsPerAccount: { medium: 5, high: 15 },
  policyDenialsPerActor: { medium: 10, high: 30 },
  otpFailures: { medium: 10, high: 30 },
  rateLimitEvents: { medium: 50, high: 200 },
};
const level = (n, t) => (n >= t.high ? 'high' : n >= t.medium ? 'medium' : null);

export async function computeAlerts(range = '24h') {
  const since = rangeSince(range);
  const [perIp, perAccount, perActor, otp, escalations, rateLimited] = await Promise.all([
    SecurityLog.aggregate([
      { $match: { event: 'LOGIN_FAILED', createdAt: { $gte: since } } },
      { $group: { _id: '$ip', count: { $sum: 1 }, accounts: { $addToSet: '$identifier' }, first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
      { $match: { count: { $gte: THRESHOLDS.failedLoginsPerIp.medium } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    SecurityLog.aggregate([
      { $match: { event: 'LOGIN_FAILED', createdAt: { $gte: since }, identifier: { $exists: true } } },
      { $group: { _id: '$identifier', count: { $sum: 1 }, ips: { $addToSet: '$ip' }, last: { $max: '$createdAt' } } },
      { $match: { count: { $gte: THRESHOLDS.failedLoginsPerAccount.medium } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    SecurityLog.aggregate([
      { $match: { event: 'POLICY_DENIED', createdAt: { $gte: since } } },
      { $group: { _id: '$actor', role: { $first: '$actorRole' }, count: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $match: { count: { $gte: THRESHOLDS.policyDenialsPerActor.medium } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    SecurityLog.countDocuments({ event: { $in: ['OTP_FAILED', 'OTP_LOCKED'] }, createdAt: { $gte: since } }),
    AuditLog.find({ action: 'PRIVILEGE_ESCALATION_BLOCKED', createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(20).select('createdAt actor actorRole details').lean(),
    ErrorEvent.aggregate([
      { $match: { source: 'rate_limit', lastSeenAt: { $gte: since } } },
      { $group: { _id: '$route', count: { $sum: '$count' }, last: { $max: '$lastSeenAt' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const alerts = [];
  const add = (a) => alerts.push({ assessment: 'suspected', range, since, ...a, id: `${a.type}:${a.key}` });
  for (const r of perIp) {
    add({ type: 'failed_login_burst', key: r._id || 'unknown', severity: level(r.count, THRESHOLDS.failedLoginsPerIp), title: `Repeated failed sign-ins from one network`, detail: `${r.count} failed sign-ins from ${r._id || 'an unknown address'} against ${r.accounts.filter(Boolean).length} account name(s).`, evidence: { ip: r._id, failures: r.count, distinctAccounts: r.accounts.filter(Boolean).length, first: r.first, last: r.last }, explanation: 'Many failures from one address can be password guessing — or a shared campus network with users who forgot their passwords. Lockouts and rate limits already apply.' });
  }
  for (const r of perAccount) {
    add({ type: 'account_targeted', key: r._id, severity: r.ips.length > 1 ? level(r.count, THRESHOLDS.failedLoginsPerAccount) : 'medium', title: 'One account has many failed sign-ins', detail: `${r.count} failed sign-ins for one account name from ${r.ips.length} network(s).`, evidence: { failures: r.count, networks: r.ips.length, last: r.last }, explanation: 'Someone may be guessing this account\'s password, or its owner forgot it. Account lockout applies after repeated failures.' });
  }
  for (const r of perActor) {
    add({ type: 'repeated_authorization_failures', key: String(r._id), severity: level(r.count, THRESHOLDS.policyDenialsPerActor), title: 'An Admin is repeatedly refused by policy', detail: `${r.count} policy refusals for one ${r.role || 'admin'} account.`, evidence: { actor: r._id, role: r.role, denials: r.count, last: r.last }, explanation: 'Either the Admin needs a module they were not granted, or the account is trying actions outside its policies.' });
  }
  if (level(otp, THRESHOLDS.otpFailures)) {
    add({ type: 'otp_failures', key: 'otp', severity: level(otp, THRESHOLDS.otpFailures), title: 'Many parent-OTP failures', detail: `${otp} failed or locked parent OTP verifications.`, evidence: { failures: otp }, explanation: 'Could be OTP guessing at the gate, or SMS delivery problems making parents enter wrong codes.' });
  }
  for (const e of escalations) {
    add({ type: 'privilege_escalation_blocked', key: String(e._id), severity: 'high', title: 'Blocked attempt to set protected account fields', detail: `A ${e.actorRole || 'user'} tried to set protected fields; the server refused.`, evidence: { at: e.createdAt, actor: e.actor, fields: e.details?.fields }, explanation: 'The server refused the change. It can be a client bug or an attempt to gain privileges.' });
  }
  const rlTotal = rateLimited.reduce((s, r) => s + r.count, 0);
  if (level(rlTotal, THRESHOLDS.rateLimitEvents)) {
    add({ type: 'rate_limit_surge', key: 'rate_limit', severity: level(rlTotal, THRESHOLDS.rateLimitEvents), title: 'Surge of rate-limited requests', detail: `${rlTotal} rate-limited requests; top route ${rateLimited[0]?._id || '—'}.`, evidence: { total: rlTotal, routes: rateLimited.map((r) => ({ route: r._id, count: r.count })) }, explanation: 'Automated traffic or a client stuck in a retry loop.' });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export async function overview(range = '24h') {
  const since = rangeSince(range);
  const metricKeys = ['http.total', 'http.4xx', 'http.5xx', 'http.429', 'errors.express', 'errors.authorization', 'errors.rate_limit', 'errors.database', 'errors.job', 'errors.socket', 'errors.process', 'errors.client_web', 'errors.client_mobile'];
  const [alerts, failedLogins, policyDenials, adminChanges, errorsBySeverity, errorsByStatus, unclassified, lastSecurity, lastError, metrics] = await Promise.all([
    computeAlerts(range),
    SecurityLog.countDocuments({ event: 'LOGIN_FAILED', createdAt: { $gte: since } }),
    SecurityLog.countDocuments({ event: 'POLICY_DENIED', createdAt: { $gte: since } }),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: since }, action: { $in: ['ADMIN_CREATED', 'ADMIN_UPDATED', 'ADMIN_ACTIVATED', 'ADMIN_DEACTIVATED', 'ADMIN_PASSWORD_RESET', 'ADMIN_SESSIONS_REVOKED', 'POLICIES_CHANGED', 'EMERGENCY_TRANSITION', 'PRIVILEGE_ESCALATION_BLOCKED'] } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),
    ErrorEvent.aggregate([{ $match: { lastSeenAt: { $gte: since } } }, { $group: { _id: '$severity', count: { $sum: 1 }, occurrences: { $sum: '$count' } } }]),
    ErrorEvent.aggregate([{ $match: { lastSeenAt: { $gte: since } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ErrorEvent.countDocuments({ lastSeenAt: { $gte: since }, classified: false }),
    SecurityLog.findOne().sort({ createdAt: -1 }).select('createdAt').lean(),
    ErrorEvent.findOne().sort({ lastSeenAt: -1 }).select('lastSeenAt').lean(),
    metricTotals(since, metricKeys),
  ]);
  const t = metrics.totals;
  const ms = metricsState();
  // Telemetry coverage: the counters only exist since they were first flushed
  // (or since this process started). Earlier parts of the range are "no data", not "zero".
  const coverageStart = [metrics.firstHour, ms.processStartedAt].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0];
  const telemetry = {
    since,
    coverageStart: coverageStart || null,
    complete: Boolean(coverageStart && new Date(coverageStart) <= since),
    lastFlushAt: ms.lastFlushAt,
    lastFlushError: ms.lastFlushError,
    processStartedAt: ms.processStartedAt,
  };
  const by = (rows) => Object.fromEntries(rows.map((r) => [r._id, r]));
  return {
    range,
    since,
    generatedAt: new Date(),
    alerts: {
      total: alerts.length,
      bySeverity: alerts.reduce((m, a) => ({ ...m, [a.severity]: (m[a.severity] || 0) + 1 }), {}),
      top: alerts.slice(0, 5),
    },
    security: { failedLogins, policyDenials, adminChanges: Object.fromEntries(adminChanges.map((r) => [r._id, r.count])), lastSecurityEventAt: lastSecurity?.createdAt || null },
    errors: {
      bySeverity: by(errorsBySeverity),
      byStatus: Object.fromEntries(errorsByStatus.map((r) => [r._id, r.count])),
      unclassified,
      lastErrorAt: lastError?.lastSeenAt || null,
    },
    traffic: {
      requests: t['http.total'] ?? null,
      clientErrors: t['http.4xx'] ?? null,
      serverErrors: t['http.5xx'] ?? null,
      rateLimited: t['http.429'] ?? null,
      serverErrorRate: t['http.total'] ? (t['http.5xx'] || 0) / t['http.total'] : null,
      capturedBySource: Object.fromEntries(metricKeys.filter((k) => k.startsWith('errors.')).map((k) => [k.slice(7), t[k] ?? 0])),
    },
    telemetry,
    pipeline: captureStats(),
  };
}
