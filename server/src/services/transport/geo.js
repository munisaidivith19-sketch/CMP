/**
 * Small, dependency-free geometry for bus tracking. Coordinates are WGS84;
 * distances are metres (haversine — accurate to well under 1 % at city scale).
 */
const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);

/**
 * The path a route follows, as points in travel order: the road geometry when
 * configured (`exact`), otherwise straight lines between consecutive stops
 * (`approximate` — distances along it are underestimates).
 */
export function routePath(route) {
  if (route?.geometry?.length >= 2) return { points: route.geometry.map(([lng, lat]) => ({ lat, lng })), exact: true };
  return { points: (route?.stops || []).map((s) => ({ lat: s.lat, lng: s.lng })), exact: false };
}

/** Cumulative distance (m) at each vertex of a polyline. */
export function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  return cum;
}

/**
 * Project a position onto a polyline: the distance along it (m) of the
 * closest point and how far off the line the position is (m). Uses a local
 * equirectangular approximation per segment, fine at route scale.
 */
export function project(points, cum, p) {
  let best = { along: 0, offset: Infinity, index: 0 };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const kx = Math.cos(rad((a.lat + b.lat) / 2)) * (Math.PI / 180) * R;
    const ky = (Math.PI / 180) * R;
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lng - a.lng) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2)) : 0;
    const dx = px - t * bx;
    const dy = py - t * by;
    const offset = Math.sqrt(dx * dx + dy * dy);
    if (offset < best.offset) best = { along: cum[i - 1] + t * (cum[i] - cum[i - 1]), offset, index: i - 1 };
  }
  return best;
}

/** Distance along the path of each stop (projected), in stop order. */
export function stopPositions(route, points, cum) {
  return (route.stops || []).map((s) => ({ stop: s, along: project(points, cum, { lat: s.lat, lng: s.lng }).along }));
}

/**
 * Like `project`, but only considers the stretch of the path between
 * `minAlong` and `maxAlong` metres — where the bus can plausibly be given its
 * last known progress. Keeps a route that doubles back on the same road (or
 * passes a later stop early) from snapping to the wrong side.
 */
export function projectWithin(points, cum, p, minAlong = -Infinity, maxAlong = Infinity) {
  let best = { along: 0, offset: Infinity, index: 0 };
  for (let i = 1; i < points.length; i += 1) {
    if (cum[i] < minAlong || cum[i - 1] > maxAlong) continue;
    const a = points[i - 1];
    const b = points[i];
    const kx = Math.cos(rad((a.lat + b.lat) / 2)) * (Math.PI / 180) * R;
    const ky = (Math.PI / 180) * R;
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lng - a.lng) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const seg = cum[i] - cum[i - 1];
    let t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    let along = cum[i - 1] + t * seg;
    if (along < minAlong || along > maxAlong) {
      along = Math.max(minAlong, Math.min(maxAlong, along));
      t = seg > 0 ? (along - cum[i - 1]) / seg : 0;
    }
    const dx = px - t * bx;
    const dy = py - t * by;
    const offset = Math.sqrt(dx * dx + dy * dy);
    if (offset < best.offset) best = { along, offset, index: i - 1 };
  }
  return best;
}
