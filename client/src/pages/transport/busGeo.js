/**
 * Pure helpers for the bus map (no DOM, no map library) — shared by the page
 * and its unit tests (client/tests/busGeo.test.mjs).
 */

// ── The viewer's own position ─────────────────────────────────────

// Reading the device and its states live in myLocation.js (on top of the shared
// readFreshFix); only the pure presentation helpers are here.

/**
 * Where a map opens before anything better is known (no bus position, no
 * route): Chennai at city level. Used once, when the map is created — never
 * re-applied, so panning and zooming out to Tamil Nadu, India or the world stay free.
 */
export const DEFAULT_VIEW = { center: [80.2707, 13.0827], zoom: 11 }; // [lng, lat]

/** The first framing of the bus map: the bus asked for in the link, otherwise everything known. */
export const initialFit = (selectedBusId) => ({ kind: selectedBusId ? 'bus' : 'all', nonce: 0 });

/** Coarser than this is an estimate (Wi-Fi / network / "approximate" permission), not GPS. */
export const COARSE_FIX_M = 100;

/** "± 8 m", "± 350 m", "± 2.4 km". */
export function accuracyText(m) {
  if (!Number.isFinite(m)) return '';
  return m < 1000 ? `± ${Math.round(m)} m` : `± ${(m / 1000).toFixed(1)} km`;
}

/** A GeoJSON polygon approximating a circle of `meters` around a point (the accuracy area). */
export function accuracyCircle(lat, lng, meters, steps = 48) {
  const R = 6371008.8;
  const d = meters / R;
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const b = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lng2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

/** Linear interpolation between two positions, t in [0, 1]. */
export function lerpPosition(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

/** Ease-out so the marker settles onto the real position. */
export const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * The shortest rotation from one heading to another (e.g. 350° → 10° turns
 * +20°, not −340°), so the bus never spins the long way round.
 */
export function shortestTurn(from, to) {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/**
 * A heading worth showing: only when the bus reports one AND is moving
 * (≥ 2 m/s); a parked GPS reports a meaningless heading.
 */
export const reliableHeading = (loc) => (loc && Number.isFinite(loc.heading) && Number.isFinite(loc.speed) && loc.speed >= 2 ? loc.heading : null);

/** live | stale | offline, from the fix time and the server's thresholds. */
export function freshnessOf(at, { liveSeconds = 60, staleSeconds = 300 } = {}, now = Date.now()) {
  if (!at) return 'offline';
  const age = (now - new Date(at).getTime()) / 1000;
  if (age <= liveSeconds) return 'live';
  if (age <= staleSeconds) return 'stale';
  return 'offline';
}

/**
 * What a bus's position means right now:
 *  - offline:     no position at all;
 *  - not_sharing: a phone-shared bus whose trip has ended — its last position
 *                 is history (shown with its time), never "live";
 *  - otherwise live / stale / offline by the age of the fix (vehicle trackers
 *    report without trips, so only their age counts).
 */
export function busStatus(bus, loc, thresholds, now = Date.now()) {
  if (!loc?.at) return 'offline';
  if (bus?.gpsSource !== 'tracker' && bus?.trip?.status !== 'active') return 'not_sharing';
  return freshnessOf(loc.at, thresholds, now);
}

/** "just now", "45 s ago", "3 min ago", "2 h ago". */
export function agoText(at, now = Date.now()) {
  if (!at) return 'never';
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** The text an ETA shows, never more precise than the data allows. */
export function etaText(eta) {
  if (!eta || eta.status !== 'ok') return eta?.reason || 'ETA unavailable';
  const when = new Date(eta.arrivalAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const mins = eta.minutes <= 0 ? 'arriving now' : `about ${eta.minutes} min`;
  return eta.confidence === 'low' ? `${mins} (approximate) · ~${when}` : `${mins} · ${when}`;
}

/** Bounds [[west, south], [east, north]] around points, padded for tiny spreads. */
export function boundsOf(points) {
  const valid = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!valid.length) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of valid) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const pad = 0.002;
  if (e - w < pad) {
    w -= pad;
    e += pad;
  }
  if (n - s < pad) {
    s -= pad;
    n += pad;
  }
  return [[w, s], [e, n]];
}

// ── Route line and stops ──────────────────────────────────────────

/**
 * The line a route is drawn along: its stored road geometry ([lng, lat]
 * pairs) when present (`exact`), otherwise straight lines between the stops
 * in order — which the map must label as approximate, never as a road route.
 */
export function routeLine(route) {
  if (route?.geometry?.length >= 2) return { points: route.geometry.map(([lng, lat]) => ({ lat, lng })), exact: true };
  const stops = [...(route?.stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return { points: stops.map((s) => ({ lat: s.lat, lng: s.lng })), exact: false };
}

/**
 * Stop points for the map, with the first and last stop marked as the route's
 * start and end (and named so in their labels).
 */
export function stopFeatures(stops, { selectedStopId, passed = [] } = {}) {
  const ordered = [...(stops || [])].filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const done = new Set(passed);
  const last = ordered.length - 1;
  return {
    type: 'FeatureCollection',
    features: ordered.map((s, i) => {
      const role = i === 0 ? 'start' : i === last ? 'end' : 'stop';
      const label = `${s.sequence ?? i + 1}. ${s.name || 'Unnamed stop'}`;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(s.lng), Number(s.lat)] },
        properties: {
          id: String(s._id ?? i),
          role,
          name: role === 'start' ? `Start · ${label}` : role === 'end' ? `End · ${label}` : label,
          selected: s._id != null && String(s._id) === String(selectedStopId),
          passed: done.has(s.sequence),
        },
      };
    }),
  };
}

/** Stop coordinates in travel order as text — equal only when no stop moved, was added, removed or reordered. */
export function stopsSignature(stops) {
  return (stops || []).map((s) => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`).join(';');
}

/** "12.4 km · about 35 min by road (no traffic)". */
export function routeSummary(distanceM, durationS) {
  const parts = [];
  if (Number.isFinite(distanceM)) parts.push(distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`);
  if (Number.isFinite(durationS)) parts.push(`about ${Math.max(1, Math.round(durationS / 60))} min by road (no traffic)`);
  return parts.join(' · ');
}

/**
 * The part of a route still ahead of the bus: from the route vertex nearest
 * the bus to the end (the travelled part is drawn from the bus's real
 * accepted positions instead).
 */
export function remainingPath(points, pos) {
  if (!points?.length) return [];
  if (!pos) return points;
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = (p.lat - pos.lat) ** 2 + ((p.lng - pos.lng) * Math.cos((pos.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return [pos, ...points.slice(best + 1)];
}
