/**
 * The road a bus takes back to its route while it is away from it.
 *
 * The maps draw the route ahead of the bus. When the bus is ON its route that
 * line starts at the bus. When it is OFF its route (diversion, depot, wrong
 * turn) the only honest connection is a road path — never a straight line
 * across buildings. This module asks the routing server (routing.js, OSRM)
 * for the road from the bus's latest accepted position to the nearest point
 * of the route line, and answers:
 *
 *   null                                   — on its route (or nothing to draw);
 *   { status: 'ok', geometry, … }          — the road path, [lng, lat] pairs;
 *   { status: 'pending' | 'unavailable' }  — off route, no road path (yet):
 *                                            clients draw NO connector.
 *
 * Cost control (the default OSRM server is a fair-use demo): one path per bus,
 * re-requested only after the bus moved ROUTE_DETOUR_REFRESH_M or the path is
 * ROUTE_DETOUR_MAX_AGE_SECONDS old; a failure is retried after a minute; one
 * request per bus in flight however many people are watching (a parked or
 * offline bus, whose position does not change, costs at most one request per
 * ROUTE_DETOUR_MAX_AGE_SECONDS while viewed); and detour requests never take
 * the whole routing queue.
 */
import { cumulative, haversine, pointAt, project, routePath, validLatLng } from './geo.js';
import { transportConfig } from './config.js';
import { roadPathBetween } from './routing.js';

const RETRY_MS = 60000;
const MAX_ENTRIES = 500;

const cache = new Map(); // busId → { key, origin, at, value }
const inflight = new Map(); // busId → { key, origin, promise }

const REASONS = {
  disabled: 'Road routing is not configured on this server',
  no_route: 'No road path back to the route was found',
  stop_off_road: 'The bus is not near a road the map knows',
};
const reasonOf = (err) => REASONS[err?.code] || 'The road path back to the route could not be calculated right now';

function remember(busKey, entry) {
  cache.delete(busKey);
  cache.set(busKey, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

const withTimeout = (promise, ms) =>
  ms > 0 ? Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms, null).unref?.())]) : Promise.race([promise, Promise.resolve(null)]);

/**
 * Where `location` is relative to the route line: how far off it is (m) and
 * the nearest point of the line (where the bus rejoins it).
 */
export function offRoute(route, location) {
  const { points } = routePath(route || {});
  if (points.length < 2 || !location || !validLatLng(location.lat, location.lng)) return null;
  const cum = cumulative(points);
  const at = project(points, cum, location);
  return { offsetM: at.offset, rejoin: pointAt(points, cum, at.along) };
}

/**
 * The detour for `bus` (its lastLocation) back to `route` — the line the
 * clients draw for it. Waits at most ROUTE_DETOUR_WAIT_MS for a new path; a
 * slower answer is cached for the next request.
 */
export async function busDetour(bus, route, { now = Date.now(), cfg = transportConfig() } = {}) {
  const loc = bus?.lastLocation;
  if (!route || !loc?.at) return null;
  const where = offRoute(route, loc);
  if (!where) return null;
  const threshold = Math.max(cfg.detourMinM, Number.isFinite(loc.accuracy) ? loc.accuracy : 0);
  if (where.offsetM <= threshold) return null;
  const offsetM = Math.round(where.offsetM);

  const busKey = String(bus._id);
  const key = `${route._id}:${route.updatedAt ? new Date(route.updatedAt).getTime() : 0}`;
  const close = (entry) => entry && entry.key === key && haversine(entry.origin, loc) < cfg.detourRefreshM;
  const hit = cache.get(busKey);
  if (close(hit) && now - hit.at < (hit.value.status === 'ok' ? cfg.detourMaxAgeSeconds * 1000 : RETRY_MS)) return { ...hit.value, offsetM };

  let job = inflight.get(busKey);
  if (!close(job)) {
    const origin = { lat: loc.lat, lng: loc.lng };
    const promise = roadPathBetween(origin, where.rejoin)
      .then((r) => ({ status: 'ok', geometry: r.geometry, distanceM: r.distanceM, durationS: r.durationS, provider: r.provider }))
      .catch((err) => ({ status: 'unavailable', reason: reasonOf(err) }))
      .then((value) => {
        remember(busKey, { key, origin, at: now, value });
        if (inflight.get(busKey)?.promise === promise) inflight.delete(busKey);
        return value;
      });
    job = { key, origin, promise };
    inflight.set(busKey, job);
  }
  const value = await withTimeout(job.promise, cfg.detourWaitMs);
  return value ? { ...value, offsetM } : { status: 'pending', offsetM };
}

/** Test hook. */
export function resetDetourState() {
  cache.clear();
  inflight.clear();
}
