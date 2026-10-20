/**
 * Direction-aware journeys — pure logic (no I/O), shared by stop-event
 * detection (services/transport/stopEvents.js), the live journey view and the
 * tests.
 *
 *  - planFor:     the ordered stops a trip follows in its direction: the
 *                 route's own order, a separately configured return route
 *                 (its own stops and road geometry), or the same stops in
 *                 reverse.
 *  - tripPath:    the line those stops lie on, with each stop's distance
 *                 along it.
 *  - stepTracker: one accepted GPS fix → the trip's updated progress and any
 *                 stop arrival / departure it proves. Conservative: an arrival
 *                 needs evidence (several fixes at the stop, the bus standing
 *                 there, or one fix at the stop followed by progress past it);
 *                 a stop passed without such evidence is marked "not
 *                 detected", never given an invented time.
 *  - stopEtas:    predictions for the stops still ahead.
 *
 * Distances are metres along the path, times are Date / epoch ms (UTC).
 */
import { cumulative, haversine, projectWithin, routePath } from './geo.js';

export const DIRECTIONS = ['towards_college', 'towards_home'];
export const DEFAULT_DIRECTION = 'towards_college';

const ROAD_FACTOR = 1.3; // straight stop-to-stop lines underestimate the road distance
const BACKTRACK_M = 200; // GPS jitter allowed behind the last progress
const LOOKAHEAD = 3; // stops ahead an arrival may be matched to (GPS gaps)
const PASS_MARGIN_M = 100; // beyond a stop's radius before it counts as passed
const CANDIDATE_TTL_MS = 120000; // an unconfirmed arrival is forgotten after this
const MIN_MOVING_MPS = 1.5;
const STOP_GEOMETRY_TOLERANCE_M = 500; // stop farther from the road line → use stop-to-stop lines

const sortedStops = (route) => [...(route?.stops || [])].sort((a, b) => a.sequence - b.sequence);

/**
 * The direction a route's own stop order runs: towards the college unless
 * the college stop comes first (then the stored order is the run home).
 */
export function forwardDirection(route) {
  const stops = sortedStops(route);
  const ci = stops.findIndex((s) => s.isCollege);
  return stops.length > 1 && ci === 0 ? 'towards_home' : 'towards_college';
}

/**
 * The stops a trip in `direction` follows, in travel order.
 * Scheduled times are kept only where they belong to the order travelled (a
 * reversed run has no timetable of its own, so none is invented).
 */
export function planFor(route, direction, returnRoute = null) {
  if (!route?.stops?.length) return null;
  let followed = route;
  let mode = 'forward';
  if (direction !== forwardDirection(route)) {
    const usable = returnRoute && returnRoute.isActive !== false && String(returnRoute._id) !== String(route._id) && returnRoute.stops?.length >= 2;
    if (usable) {
      followed = returnRoute;
      mode = 'return_route';
    } else mode = 'reverse';
  }
  const ordered = sortedStops(followed);
  if (mode === 'reverse') ordered.reverse();
  return {
    routeId: followed._id,
    mode,
    stops: ordered.map((s) => ({
      stop: s._id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      isCollege: Boolean(s.isCollege),
      ...(mode !== 'reverse' && s.scheduledTime ? { scheduledTime: s.scheduledTime } : {}),
      ...(s.arrivalRadiusM ? { radiusM: s.arrivalRadiusM } : {}),
    })),
  };
}

/**
 * The line a trip travels along and each planned stop's distance along it.
 * Road geometry is used when every stop lies near it (reversed for a
 * reverse run); otherwise straight stop-to-stop lines, flagged approximate.
 */
export function tripPath(followedRoute, planStops, mode) {
  const stopsLine = planStops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const { points: roadPoints, exact } = routePath(followedRoute || {});
  let points = exact ? roadPoints : stopsLine;
  if (exact && mode === 'reverse') points = [...points].reverse();
  let cum = cumulative(points);
  const alongOf = (pts, c) => {
    const out = [];
    let from = 0;
    for (const s of planStops) {
      const p = projectWithin(pts, c, s, from - 1);
      out.push(p);
      from = p.along;
    }
    return out;
  };
  let proj = alongOf(points, cum);
  let usedRoad = exact;
  if (exact && proj.some((p) => p.offset > STOP_GEOMETRY_TOLERANCE_M)) {
    // Stops edited since the geometry was saved: the road line no longer fits.
    points = stopsLine;
    cum = cumulative(points);
    proj = alongOf(points, cum);
    usedRoad = false;
  }
  return { points, cum, total: cum[cum.length - 1] || 0, exact: usedRoad, reversedRoad: usedRoad && mode === 'reverse', stopAlong: proj.map((p) => p.along) };
}

export const initialTracker = () => ({
  rev: 0,
  alongM: null, // progress along the path (m)
  firstAlongM: null, // progress at the first on-route fix
  fixAt: null, // last fix considered
  nextOrder: 0, // first planned stop not yet reached or passed
  atOrder: null, // stop the bus is standing at (arrived, not yet departed)
  lastInAt: null, // last fix inside that stop's radius
  cand: null, // unconfirmed arrival { order, firstAt, lastAt, count, dist, accuracy }
  missed: [], // [{ order, reason }] stops passed without a detected arrival
  offRoute: false,
  lowAccuracy: false,
  directionWarning: false,
  predicted: null, // prediction for nextOrder, kept to compare with the actual arrival
});

const radiusOf = (planStop, cfg) => planStop.radiusM || cfg.arrivalRadiusM;
const copyState = (s) => ({ ...initialTracker(), ...s, cand: s.cand ? { ...s.cand } : null, missed: [...(s.missed || [])] });

/**
 * Advance a trip's progress by one accepted fix. Returns the new state and
 * the events it proves: { type: 'arrival' | 'departure', order, at, detectedAt, ... }.
 * `at` is the time of the GPS fix that shows the bus at (or last at) the
 * stop; `detectedAt` the fix that confirmed it.
 */
export function stepTracker(prev, path, planStops, fix, cfg) {
  const at = new Date(fix.at);
  if (prev.fixAt && at <= new Date(prev.fixAt)) return { state: prev, events: [], skipped: 'out_of_order' };
  const s = copyState(prev);
  const events = [];
  const n = planStops.length;
  const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : null;
  const dtS = s.fixAt ? (at - new Date(s.fixAt)) / 1000 : null;
  s.fixAt = at;
  if (accuracy != null && accuracy > cfg.arrivalMaxAccuracyM) {
    s.lowAccuracy = true;
    return { state: s, events, skipped: 'low_accuracy' };
  }
  s.lowAccuracy = false;

  // Progress, searched only where the bus can plausibly be since the last fix.
  // A fix off that stretch (off route, or an implausible jump) proves nothing.
  const first = s.alongM == null;
  const lo = first ? -Infinity : s.alongM - BACKTRACK_M;
  const hi = first || dtS == null ? Infinity : s.alongM + cfg.maxSpeedMps * dtS + 500;
  const proj = projectWithin(path.points, path.cum, fix, lo, hi);
  s.offRoute = proj.offset > cfg.offRouteM;
  if (s.offRoute) return { state: s, events };

  // Leaving the stop the bus stands at: confidently outside its radius.
  if (s.atOrder != null) {
    const st = planStops[s.atOrder];
    const d = haversine(fix, st);
    if (d - (accuracy || 0) > radiusOf(st, cfg) + cfg.departureMarginM) {
      events.push({ type: 'departure', order: s.atOrder, at: new Date(s.lastInAt || at), detectedAt: at, distanceM: Math.round(d), accuracy });
      s.atOrder = null;
      s.lastInAt = null;
    } else if (d <= radiusOf(st, cfg)) s.lastInAt = at;
  }
  if (first) {
    s.firstAlongM = proj.along;
    const last = planStops[n - 1];
    // Starting at the END of the planned stops: the direction is probably wrong.
    if (n > 1 && haversine(fix, last) <= radiusOf(last, cfg) * 2 && haversine(fix, planStops[0]) > radiusOf(planStops[0], cfg) * 2) s.directionWarning = true;
  }
  s.alongM = Math.max(s.alongM ?? proj.along, proj.along);
  const travelled = s.alongM - s.firstAlongM;
  const minTravel = Math.min(cfg.minTripTravelM, path.total * 0.25);
  const finalBlocked = (o) => o === n - 1 && n > 1 && (s.directionWarning || travelled < minTravel);

  // Arrival evidence at one of the next few stops.
  let hit = null;
  for (let o = s.nextOrder; o < Math.min(n, s.nextOrder + LOOKAHEAD); o += 1) {
    const st = planStops[o];
    const r = radiusOf(st, cfg);
    const d = haversine(fix, st);
    if (d <= r && Math.abs(proj.along - path.stopAlong[o]) <= r + (accuracy || 0)) {
      hit = { o, d };
      break;
    }
  }
  let confirm = null;
  if (hit) {
    if (s.cand && s.cand.order === hit.o) {
      s.cand.count += 1;
      s.cand.lastAt = at;
      s.cand.dist = Math.min(s.cand.dist, hit.d);
    } else s.cand = { order: hit.o, firstAt: at, lastAt: at, count: 1, dist: hit.d, accuracy };
    const standing = Number.isFinite(fix.speed) && fix.speed <= cfg.dwellSpeedMps;
    if (s.cand.count >= cfg.arrivalConfirmFixes || standing) confirm = { passedThrough: false };
  } else if (s.cand) {
    const st = planStops[s.cand.order];
    // Seen at the stop, now beyond it along the route: it was there and moved on.
    if (s.alongM > path.stopAlong[s.cand.order] + radiusOf(st, cfg) && haversine(fix, st) > radiusOf(st, cfg)) confirm = { passedThrough: true };
    else if (at - new Date(s.cand.lastAt) > CANDIDATE_TTL_MS) s.cand = null;
  }
  if (confirm && finalBlocked(s.cand.order)) confirm = null;

  if (confirm) {
    const c = s.cand;
    if (s.atOrder != null && s.atOrder !== c.order) {
      events.push({ type: 'departure', order: s.atOrder, at: new Date(s.lastInAt || c.firstAt), detectedAt: at, accuracy });
      s.atOrder = null;
    }
    for (let k = s.nextOrder; k < c.order; k += 1) s.missed.push({ order: k, reason: 'not_detected' });
    events.push({ type: 'arrival', order: c.order, at: new Date(c.firstAt), detectedAt: at, distanceM: Math.round(c.dist), accuracy: c.accuracy, fixes: c.count });
    if (confirm.passedThrough) {
      events.push({ type: 'departure', order: c.order, at: new Date(c.lastAt), detectedAt: at, distanceM: Math.round(haversine(fix, planStops[c.order])), accuracy });
    } else {
      s.atOrder = c.order;
      s.lastInAt = c.lastAt;
    }
    s.nextOrder = c.order + 1;
    s.cand = null;
  }

  // Stops clearly behind the bus with no detected arrival: recorded as such, never timed.
  while (s.nextOrder < n && !(s.cand && s.cand.order === s.nextOrder)) {
    const st = planStops[s.nextOrder];
    if (s.alongM > path.stopAlong[s.nextOrder] + radiusOf(st, cfg) + PASS_MARGIN_M) {
      s.missed.push({ order: s.nextOrder, reason: first ? 'before_tracking' : 'not_detected' });
      s.nextOrder += 1;
    } else break;
  }
  if (s.cand && s.cand.order < s.nextOrder) s.cand = null;
  return { state: s, events };
}

/** The stop the bus is at, the next and the following stop, and whether that reading is uncertain. */
export function nextStops(state, planStops, fresh) {
  const n = planStops.length;
  const next = state.nextOrder < n ? state.nextOrder : null;
  const following = next != null && next + 1 < n ? next + 1 : null;
  let reason = null;
  if (state.directionWarning) reason = 'The bus started at the end of this route — the trip direction may be wrong';
  else if (state.alongM == null) reason = 'Waiting for the first GPS position on this route';
  else if (fresh === 'offline') reason = 'Tracking is offline — no recent GPS position';
  else if (fresh === 'stale') reason = 'The last GPS position is a few minutes old';
  else if (state.offRoute) reason = 'The bus is away from its route right now';
  else if (state.lowAccuracy) reason = 'GPS accuracy is poor right now';
  else if (state.cand && state.cand.order !== next) reason = 'The bus may have passed a stop — confirming';
  return { currentOrder: state.atOrder ?? null, nextOrder: next, followingOrder: following, uncertain: Boolean(reason), reason };
}

/**
 * Predicted arrival at each stop still ahead (Map order → eta).
 * Per stop the best supported method is used:
 *   history       — median measured stop-to-stop times and dwell from earlier
 *                   GPS-recorded trips on this route and direction (only
 *                   segments with enough samples);
 *   recent_speed  — remaining road distance ÷ the bus's recent moving speed;
 *   assumed_speed — remaining distance ÷ ETA_DEFAULT_SPEED_KMH, a disclosed
 *                   assumption used before any measurement exists (low confidence).
 * Plus a dwell time per intermediate stop. No traffic data is used.
 */
export function stopEtas({ planStops, path, state, fresh, speed, history, now, cfg }) {
  const n = planStops.length;
  const out = new Map();
  const from = state.nextOrder;
  let common = null;
  if (state.directionWarning) common = 'The trip direction may be wrong — no estimate';
  else if (state.alongM == null) common = 'No GPS position on this route yet';
  else if (fresh === 'offline') common = 'Tracking is offline — no recent GPS position';
  else if (fresh === 'stale') common = 'The last GPS position is too old for an estimate';
  else if (state.offRoute) common = 'The bus is not on its route right now';
  if (common) {
    for (let o = from; o < n; o += 1) out.set(o, { status: 'unavailable', reason: common });
    return out;
  }
  const factor = path.exact ? 1 : ROAD_FACTOR;
  const moving = Number.isFinite(speed) && speed >= MIN_MOVING_MPS;
  const v = moving ? speed : cfg.etaDefaultSpeedKmh / 3.6; // never zero
  const baseMethod = moving ? 'recent_speed' : 'assumed_speed';
  const segKey = (a, b) => `${planStops[a].stop}>${planStops[b].stop}`;
  let histChain = Boolean(history && from > 0);
  let tHist = 0;
  for (let o = from; o < n; o += 1) {
    const remaining = Math.max(0, path.stopAlong[o] - state.alongM) * factor;
    if (histChain) {
      const seg = history.segments.get(segKey(o - 1, o));
      if (seg == null) histChain = false;
      else if (o === from) {
        const len = path.stopAlong[o] - path.stopAlong[o - 1];
        const left = len > 0 ? Math.min(1, Math.max(0, (path.stopAlong[o] - state.alongM) / len)) : 0;
        tHist = seg * left;
      } else tHist += (history.dwell.get(String(planStops[o - 1].stop)) ?? cfg.etaDwellSeconds) + seg;
    }
    const secs = histChain ? tHist : remaining / v + (o - from) * cfg.etaDwellSeconds;
    const method = histChain ? 'history' : baseMethod;
    const confidence = method === 'assumed_speed' || !path.exact ? 'low' : method === 'history' ? 'high' : 'medium';
    out.set(o, {
      status: 'ok',
      minutes: Math.max(0, Math.round(secs / 60)),
      predictedArrivalAt: new Date(now + secs * 1000).toISOString(),
      method,
      confidence,
      approximate: confidence === 'low',
      distanceMeters: Math.round(remaining),
    });
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Measured stop-to-stop times (departure → next arrival) and dwell times
 * (arrival → departure) from recorded events, keyed by stop ids; only keys
 * with at least `minSamples` trips. Returns null when nothing qualifies.
 */
export function historyFromEvents(events, minSamples) {
  const byTrip = new Map();
  for (const e of events) {
    const k = String(e.trip);
    if (!byTrip.has(k)) byTrip.set(k, new Map());
    const m = byTrip.get(k);
    if (!m.has(e.order)) m.set(e.order, { stop: String(e.stop) });
    m.get(e.order)[e.type] = new Date(e.at).getTime();
  }
  const segs = new Map();
  const dwells = new Map();
  const push = (map, key, v) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  };
  for (const m of byTrip.values()) {
    for (const [order, r] of m) {
      if (r.arrival && r.departure && r.departure >= r.arrival && r.departure - r.arrival < 3600000) push(dwells, r.stop, (r.departure - r.arrival) / 1000);
      const prev = m.get(order - 1);
      if (prev?.departure && r.arrival && r.arrival > prev.departure && r.arrival - prev.departure < 3 * 3600000) push(segs, `${prev.stop}>${r.stop}`, (r.arrival - prev.departure) / 1000);
    }
  }
  const keep = (map) => new Map([...map].filter(([, v]) => v.length >= minSamples).map(([k, v]) => [k, median(v)]));
  const segments = keep(segs);
  if (!segments.size) return null;
  return { segments, dwell: keep(dwells), trips: byTrip.size };
}
