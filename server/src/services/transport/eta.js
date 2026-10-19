/**
 * Estimated arrival of a bus at a stop.
 *
 * Distance is measured ALONG the route (road geometry when configured, else
 * the stop-to-stop line, scaled by a road factor and flagged low-confidence) —
 * never as a straight line from the bus to the stop. Time comes from the bus's
 * recent moving speed, or from the route's scheduled stop times when speed is
 * unknown. When the data cannot support an estimate (no fresh fix, off route,
 * stop already passed, no movement and no schedule) the result says so with a
 * reason instead of inventing a time. No traffic data is used (none is configured).
 */
import BusLocation from '../../models/BusLocation.js';
import { cumulative, haversine, project, routePath, stopPositions } from './geo.js';
import { freshness, transportConfig } from './config.js';

const ROAD_FACTOR = 1.3; // straight stop-to-stop lines underestimate road distance
const OFF_ROUTE_M = 500;
const MIN_MOVING_MPS = 1.5;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Average moving speed (m/s) over the last few minutes of accepted fixes, or null. */
export async function recentSpeed(busId, now = Date.now()) {
  const fixes = await BusLocation.find({ bus: busId, at: { $gte: new Date(now - 5 * 60000) } }).sort({ at: 1 }).select('lat lng at speed').lean();
  return speedFrom(fixes);
}

export function speedFrom(fixes) {
  if (fixes.length < 2) {
    const s = fixes[0]?.speed;
    return Number.isFinite(s) && s >= MIN_MOVING_MPS ? s : null;
  }
  let dist = 0;
  let secs = 0;
  for (let i = 1; i < fixes.length; i += 1) {
    const dt = (new Date(fixes[i].at) - new Date(fixes[i - 1].at)) / 1000;
    if (dt <= 0 || dt > 120) continue;
    dist += haversine(fixes[i - 1], fixes[i]);
    secs += dt;
  }
  const derived = secs > 0 ? dist / secs : null;
  const reported = fixes.map((f) => f.speed).filter(Number.isFinite);
  const avgReported = reported.length ? reported.reduce((a, b) => a + b, 0) / reported.length : null;
  const s = derived ?? avgReported;
  return s != null && s >= MIN_MOVING_MPS ? s : null;
}

/**
 * Pure ETA computation (no I/O).
 * `location` is the bus's last valid fix; `speed` the recent moving speed (m/s) or null.
 */
export function computeEta({ route, location, stopId, speed, now = Date.now(), campusMinutesNow, cfg = transportConfig() }) {
  const base = { computedAt: new Date(now).toISOString() };
  const unavailable = (reason) => ({ ...base, status: 'unavailable', reason });
  if (!route?.stops?.length) return unavailable('This bus has no route configured');
  if (!location?.at) return unavailable('No GPS position has been received for this bus');
  const fresh = freshness(location.at, now, cfg);
  if (fresh === 'offline') return unavailable('Tracking is offline — no recent GPS position');
  if (fresh === 'stale') return unavailable('The last GPS position is too old for an estimate');

  const { points, exact } = routePath(route);
  if (points.length < 2) return unavailable('The route has too few points');
  const cum = cumulative(points);
  const at = project(points, cum, location);
  if (at.offset > OFF_ROUTE_M) return unavailable('The bus is not on its route right now');

  const stops = stopPositions(route, points, cum);
  const ahead = stops.filter((s) => s.along > at.along + 30);
  const next = ahead[0] || null;
  const target = stopId ? stops.find((s) => String(s.stop._id) === String(stopId)) : next;
  if (!target) return { ...unavailable(stopId ? 'Unknown stop on this route' : 'The bus has reached the end of its route'), nextStop: null };
  const nextStop = next ? { _id: next.stop._id, name: next.stop.name, sequence: next.stop.sequence } : null;
  if (target.along < at.along - 50) return { ...unavailable('The bus has already passed this stop'), passed: true, nextStop };

  const distance = Math.max(0, target.along - at.along) * (exact ? 1 : ROAD_FACTOR);
  let minutes = null;
  let method = null;
  if (speed && speed >= MIN_MOVING_MPS) {
    minutes = distance / speed / 60;
    method = 'recent_speed';
  } else if (target.stop.scheduledTime && campusMinutesNow != null) {
    // Scheduled time at the bus's position: interpolate between the scheduled stops around it.
    const timed = stops.filter((s) => s.stop.scheduledTime);
    const before = [...timed].reverse().find((s) => s.along <= at.along);
    const after = timed.find((s) => s.along > at.along);
    if (before && after) {
      const f = (at.along - before.along) / Math.max(1, after.along - before.along);
      const schedNow = minutesOf(before.stop.scheduledTime) + f * (minutesOf(after.stop.scheduledTime) - minutesOf(before.stop.scheduledTime));
      minutes = Math.max(0, minutesOf(target.stop.scheduledTime) - schedNow);
      method = 'schedule';
    }
  }
  if (minutes == null) return { ...unavailable('Not enough movement data yet — the bus may be stopped'), nextStop, distanceMeters: Math.round(distance) };

  const confidence = !exact ? 'low' : method === 'recent_speed' && fresh === 'live' ? 'high' : 'medium';
  const rounded = Math.max(0, Math.round(minutes));
  return {
    ...base,
    status: 'ok',
    stop: { _id: target.stop._id, name: target.stop.name, sequence: target.stop.sequence },
    nextStop,
    minutes: rounded,
    arrivalAt: new Date(now + rounded * 60000).toISOString(),
    distanceMeters: Math.round(distance),
    method,
    confidence,
    approximateRoute: !exact,
  };
}

/** Route progress: how far along, which stops are passed / next. */
export function progress(route, location) {
  if (!route?.stops?.length || !location?.at) return null;
  const { points } = routePath(route);
  if (points.length < 2) return null;
  const cum = cumulative(points);
  const at = project(points, cum, location);
  const total = cum[cum.length - 1] || 1;
  const stops = stopPositions(route, points, cum);
  return {
    fraction: Math.min(1, Math.max(0, at.along / total)),
    offRoute: at.offset > OFF_ROUTE_M,
    passedSequences: stops.filter((s) => s.along <= at.along + 30).map((s) => s.stop.sequence),
    alongMeters: Math.round(at.along),
  };
}
