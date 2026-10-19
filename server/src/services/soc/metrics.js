import SocMetric from '../../models/SocMetric.js';

/**
 * In-process counters, flushed to SocMetric once a minute.
 *
 * `processStartedAt` lets the dashboard tell "zero errors" apart from "this
 * process has not been collecting for long", and `lastFlushAt` /
 * `lastFlushError` let the health page report a broken pipeline instead of
 * silently showing zeros.
 */
const pending = new Map(); // `${hourIso}|${key}` -> count
const state = {
  processStartedAt: new Date(),
  lastFlushAt: null,
  lastFlushError: null,
  lastFlushErrorAt: null,
  flushes: 0,
};
const MAX_KEYS = 500; // hard cap so a bug cannot grow memory without bound

const hourOf = (d = new Date()) => {
  const h = new Date(d);
  h.setUTCMinutes(0, 0, 0);
  return h;
};

export function incrementMetric(key, by = 1, at = new Date()) {
  const k = `${hourOf(at).toISOString()}|${String(key).slice(0, 60)}`;
  if (!pending.has(k) && pending.size >= MAX_KEYS) return;
  pending.set(k, (pending.get(k) || 0) + by);
}

/** Write pending counts. Failed writes are put back for the next flush. */
export async function flushMetrics() {
  if (!pending.size) {
    state.lastFlushAt = new Date();
    return 0;
  }
  const batch = [...pending.entries()];
  pending.clear();
  try {
    await SocMetric.bulkWrite(
      batch.map(([k, count]) => {
        const [hour, key] = k.split('|');
        return { updateOne: { filter: { hour: new Date(hour), key }, update: { $inc: { count } }, upsert: true } };
      }),
      { ordered: false }
    );
    state.lastFlushAt = new Date();
    state.flushes += 1;
    return batch.length;
  } catch (err) {
    for (const [k, c] of batch) if (pending.size < MAX_KEYS || pending.has(k)) pending.set(k, (pending.get(k) || 0) + c);
    state.lastFlushError = String(err?.message || err).slice(0, 200);
    state.lastFlushErrorAt = new Date();
    return 0;
  }
}

export const metricsState = () => ({ ...state, pendingKeys: pending.size });

let timer = null;
export function startMetricsFlusher(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => flushMetrics().catch(() => {}), intervalMs);
  timer.unref();
}

/**
 * Sum of counters per key since `since` (inclusive of the current hour,
 * which also includes counts not yet flushed by this process).
 */
export async function metricTotals(since, keys) {
  const rows = await SocMetric.aggregate([
    { $match: { hour: { $gte: hourOf(since) }, ...(keys ? { key: { $in: keys } } : {}) } },
    { $group: { _id: '$key', count: { $sum: '$count' }, firstHour: { $min: '$hour' } } },
  ]);
  const out = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const sinceHour = hourOf(since).getTime();
  for (const [k, c] of pending) {
    const [hour, key] = k.split('|');
    if (new Date(hour).getTime() >= sinceHour && (!keys || keys.includes(key))) out[key] = (out[key] || 0) + c;
  }
  const firstHour = rows.reduce((m, r) => (!m || r.firstHour < m ? r.firstHour : m), null);
  return { totals: out, firstHour };
}

/** Express middleware: counts every /api response by status class. */
export function requestMetrics(req, res, next) {
  res.on('finish', () => {
    incrementMetric('http.total');
    if (res.statusCode >= 500) incrementMetric('http.5xx');
    else if (res.statusCode >= 400) incrementMetric('http.4xx');
    if (res.statusCode === 429) incrementMetric('http.429');
  });
  next();
}

/** Test hook. */
export function resetMetricsForTests() {
  pending.clear();
  state.lastFlushAt = null;
  state.lastFlushError = null;
  state.lastFlushErrorAt = null;
}
