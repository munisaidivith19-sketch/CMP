/**
 * Road-following route geometry from an OSRM server (Open Source Routing
 * Machine, OpenStreetMap data). Server-side only: the browser never talks to
 * the routing provider, and no key is involved.
 *
 * The provider is ROUTING_OSRM_URL (default: the public OSRM demo server,
 * which allows light use only — about one request a second, no uptime
 * guarantee). Production should point it at a self-hosted OSRM. An empty
 * value disables generation.
 *
 * Nothing here ever falls back to straight lines: when the provider cannot
 * produce a road path through every stop, the caller gets a RoutingError
 * with a code and a message saying what to fix. A result is a PREVIEW —
 * saving it is a separate, explicit action on the route.
 */
import crypto from 'node:crypto';
import { haversine, validLatLng } from './geo.js';

export const ROUTING_PROVIDER = 'osrm';
export const MAX_GEOMETRY_POINTS = 20000; // matches the route API limit
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_QUEUE = 5;

const num = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function routingConfig() {
  const raw = process.env.ROUTING_OSRM_URL;
  return {
    baseUrl: (raw === undefined ? 'https://router.project-osrm.org' : raw).trim().replace(/\/+$/, ''),
    profile: /^[a-z-]{1,20}$/.test(process.env.ROUTING_OSRM_PROFILE || '') ? process.env.ROUTING_OSRM_PROFILE : 'driving',
    timeoutMs: num('ROUTING_TIMEOUT_MS', 10000, 1000, 60000),
    // A stop farther than this from any road the router knows is an error, not a guess.
    maxSnapMeters: num('ROUTING_MAX_SNAP_M', 250, 10, 5000),
    // Spacing between calls to the provider, process-wide (the demo server's fair-use limit).
    minIntervalMs: num('ROUTING_MIN_INTERVAL_MS', 1100, 0, 60000),
  };
}

export class RoutingError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** A key for the stops' coordinates in travel order: tells whether stored geometry was made for these stops. */
export function stopsKey(stops) {
  const ordered = [...(stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const text = ordered.map((s) => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`).join(';');
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/** Validate the stops a route is generated through (2–200, valid lat/lng, in travel order). */
export function normalizeStops(stops) {
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 200) throw new RoutingError('invalid_stops', 'A route needs 2–200 stops');
  const out = stops.map((s, i) => {
    const lat = Number(s?.lat);
    const lng = Number(s?.lng);
    if (!validLatLng(lat, lng)) throw new RoutingError('invalid_stops', `Stop ${i + 1}: invalid latitude / longitude`, 422, { stopIndex: i });
    const sequence = s.sequence === undefined || s.sequence === null || s.sequence === '' ? i + 1 : Number(s.sequence);
    return { lat, lng, sequence, name: typeof s.name === 'string' ? s.name.trim().slice(0, 80) : '' };
  });
  const seq = out.map((s) => s.sequence);
  if (seq.some((n) => !Number.isInteger(n) || n < 1) || new Set(seq).size !== seq.length) throw new RoutingError('invalid_stops', 'Stop sequence numbers must be unique positive integers');
  return out.sort((a, b) => a.sequence - b.sequence);
}

const stopLabel = (s, i) => `Stop ${i + 1}${s.name ? ` (${s.name})` : ''}`;

/**
 * Douglas–Peucker simplification (metres, local projection) — only used when
 * a very long route exceeds the stored point limit. Endpoints are kept.
 */
export function simplify(points, toleranceM) {
  if (points.length <= 2) return points;
  const lat0 = (points[0][1] * Math.PI) / 180;
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  const xy = points.map(([lng, lat]) => [lng * kx, lat * ky]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = xy[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at !== -1 && worst > toleranceM) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Check an OSRM /route response against the stops it was asked for and turn
 * it into stored geometry ([lng, lat] pairs). Throws RoutingError for
 * anything that is not a usable road path through every stop.
 */
export function parseOsrmRoute(data, stops, cfg = routingConfig()) {
  if (!data || typeof data !== 'object') throw new RoutingError('bad_response', 'The routing service returned an unreadable answer', 502);
  if (data.code === 'NoRoute') throw new RoutingError('no_route', 'No road route connects these stops. Check that every stop is on or next to a road.');
  if (data.code === 'NoSegment') throw new RoutingError('stop_off_road', 'At least one stop is not near any road the routing service knows. Check the stop coordinates.');
  if (data.code === 'TooBig') throw new RoutingError('too_many_stops', 'The routing service refused this many stops.');
  if (data.code !== 'Ok') throw new RoutingError('bad_response', 'The routing service could not calculate this route', 502);

  const route = Array.isArray(data.routes) ? data.routes[0] : null;
  const coords = route?.geometry?.type === 'LineString' ? route.geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) throw new RoutingError('bad_response', 'The routing service returned no route line', 502);
  if (!Array.isArray(data.waypoints) || data.waypoints.length !== stops.length) throw new RoutingError('bad_response', 'The routing service did not route through every stop', 502);

  // Every stop must snap to a road close by — otherwise the "road route" would start somewhere else.
  const snaps = data.waypoints.map((w, i) => {
    const [lng, lat] = Array.isArray(w?.location) ? w.location.map(Number) : [];
    if (!validLatLng(lat, lng)) throw new RoutingError('bad_response', 'The routing service returned an invalid stop position', 502);
    const offset = haversine(stops[i], { lat, lng });
    if (offset > cfg.maxSnapMeters) {
      throw new RoutingError('stop_off_road', `${stopLabel(stops[i], i)} is ${Math.round(offset)} m from the nearest road the routing service knows (limit ${cfg.maxSnapMeters} m). Check its coordinates.`, 422, { stopIndex: i, offsetM: Math.round(offset) });
    }
    return { lat, lng, offsetM: Math.round(offset) };
  });

  let points = [];
  for (const p of coords) {
    const [lng, lat] = Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : [NaN, NaN];
    if (!validLatLng(lat, lng)) throw new RoutingError('bad_response', 'The routing service returned an invalid coordinate', 502);
    const q = [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
    const prev = points[points.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) points.push(q);
  }
  if (points.length < 2) throw new RoutingError('bad_response', 'The routing service returned no route line', 502);

  // GeoJSON order is [longitude, latitude]: the line must begin and end at the
  // first and last snapped stops. A swapped or unrelated line fails here.
  const near = (pt, s) => haversine({ lat: pt[1], lng: pt[0] }, s) <= 50;
  if (!near(points[0], snaps[0]) || !near(points[points.length - 1], snaps[snaps.length - 1])) {
    throw new RoutingError('bad_response', 'The routing service returned a line that does not start and end at the route’s stops', 502);
  }

  for (let tol = 1; points.length > MAX_GEOMETRY_POINTS && tol <= 64; tol *= 2) points = simplify(points, tol);
  if (points.length > MAX_GEOMETRY_POINTS) throw new RoutingError('too_long', 'This route is too long to store. Split it into shorter routes.');

  const distanceM = Number(route.distance);
  const durationS = Number(route.duration);
  return {
    geometry: points,
    distanceM: Number.isFinite(distanceM) ? Math.round(distanceM) : null,
    durationS: Number.isFinite(durationS) ? Math.round(durationS) : null,
    snaps,
    provider: ROUTING_PROVIDER,
  };
}

// ── Provider calls: spaced process-wide, bounded queue, timeout ──

let fetchImpl = (...args) => fetch(...args);
let queue = Promise.resolve();
let pending = 0;
let lastCallAt = 0;

/** Test hook: replace the HTTP client (tests never reach the network). */
export function setRoutingFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}
export function resetRoutingState() {
  queue = Promise.resolve();
  pending = 0;
  lastCallAt = 0;
}

function spaced(fn, minIntervalMs) {
  if (pending >= MAX_QUEUE) return Promise.reject(new RoutingError('busy', 'The routing service is busy. Try again in a few seconds.', 503));
  pending += 1;
  const run = queue.then(async () => {
    const wait = lastCallAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run.finally(() => {
    pending -= 1;
  });
}

/** Road geometry through `stops` (in travel order) from the configured OSRM server. */
export async function generateRoadGeometry(rawStops) {
  const cfg = routingConfig();
  if (!cfg.baseUrl) throw new RoutingError('disabled', 'Road route generation is not configured on this server (ROUTING_OSRM_URL).', 503);
  let base;
  try {
    base = new URL(cfg.baseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error();
  } catch {
    throw new RoutingError('disabled', 'Road route generation is misconfigured on this server (ROUTING_OSRM_URL).', 503);
  }
  const stops = normalizeStops(rawStops);
  const path = stops.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/route/v1/${cfg.profile}/${path}?overview=full&geometries=geojson&steps=false&alternatives=false`;

  return spaced(async () => {
    let res;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs), redirect: 'error' });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new RoutingError('timeout', 'The routing service did not answer in time. Try again.', 504);
      throw new RoutingError('unavailable', 'The routing service could not be reached. Try again later.', 502);
    }
    if (res.status === 429) throw new RoutingError('rate_limited', 'The routing service is rate-limiting requests. Wait a minute and try again.', 503);
    const text = await res.text().catch(() => '');
    if (text.length > MAX_RESPONSE_BYTES) throw new RoutingError('bad_response', 'The routing service returned too much data', 502);
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    // OSRM answers 400 with a JSON code (NoRoute, NoSegment, …) for routing problems.
    if (!res.ok && !(res.status === 400 && data?.code)) throw new RoutingError('unavailable', `The routing service failed (HTTP ${res.status}). Try again later.`, 502);
    return { ...parseOsrmRoute(data, stops, cfg), stops: stops.map(({ lat, lng, sequence }) => ({ lat, lng, sequence })) };
  }, cfg.minIntervalMs);
}
