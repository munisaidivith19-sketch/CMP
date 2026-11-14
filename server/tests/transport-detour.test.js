/**
 * A bus away from its route: the map gets the ROAD path back to the route
 * (from the routing server), never a straight line — and the routing server
 * is asked sparingly.
 *
 * TEST DATA ONLY — every coordinate is SYNTHETIC (near 13.000° N, 80.000° E)
 * and the routing server is MOCKED: no request ever leaves the process.
 * Pure unit tests (no database).
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ROUTING_OSRM_URL = 'https://osrm.test.invalid';
process.env.ROUTING_MIN_INTERVAL_MS = '0';

const { roadPathBetween, resetRoutingState, setRoutingFetch } = await import('../src/services/transport/routing.js');
const { busDetour, offRoute, resetDetourState } = await import('../src/services/transport/detour.js');
const { pointAt, cumulative } = await import('../src/services/transport/geo.js');
const { transportConfig } = await import('../src/services/transport/config.js');

// A straight north-south synthetic route, 13.000 → 13.020 along lng 80.000.
const ROUTE = {
  _id: 'route1',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  stops: [
    { _id: 's1', name: 'Synthetic A', lat: 13.0, lng: 80.0, sequence: 1 },
    { _id: 's2', name: 'Synthetic College', lat: 13.02, lng: 80.0, sequence: 2, isCollege: true },
  ],
  geometry: [[80.0, 13.0], [80.0, 13.01], [80.0, 13.02]],
};
const NOW = Date.parse('2026-03-02T08:00:00Z');
const busAt = (lat, lng, extra = {}) => ({ _id: 'bus1', lastLocation: { lat, lng, at: new Date(NOW - 5000), accuracy: 10, ...extra } });
// ~0.005° of longitude ≈ 540 m east of the route.
const OFF = busAt(13.01, 80.005);
// A synthetic road that bends from the bus back to the route.
const ROAD = [[80.005, 13.01], [80.004, 13.012], [80.001, 13.011], [80.0, 13.01]];

const osrm = (coords = ROAD) => ({
  code: 'Ok',
  routes: [{ distance: 700, duration: 90, geometry: { type: 'LineString', coordinates: coords } }],
  waypoints: [{ location: coords[0] }, { location: coords[coords.length - 1] }],
});
let calls = [];
const respond = (fn) =>
  setRoutingFetch(async (url) => {
    calls.push(url);
    return fn(url);
  });
const ok = (body = osrm()) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const cfg = (over = {}) => ({ ...transportConfig(), detourWaitMs: 2000, ...over });

beforeEach(() => {
  calls = [];
  resetRoutingState();
  resetDetourState();
  respond(() => ok());
});
after(() => {
  setRoutingFetch(null);
  for (const k of ['ROUTING_OSRM_URL', 'ROUTING_MIN_INTERVAL_MS']) delete process.env[k];
});

test('pointAt interpolates along a line and clamps to its ends', () => {
  const pts = [{ lat: 13.0, lng: 80.0 }, { lat: 13.01, lng: 80.0 }];
  const cum = cumulative(pts);
  assert.deepEqual(pointAt(pts, cum, -5), pts[0]);
  assert.deepEqual(pointAt(pts, cum, cum[1] + 100), pts[1]);
  const mid = pointAt(pts, cum, cum[1] / 2);
  assert.ok(Math.abs(mid.lat - 13.005) < 1e-9 && mid.lng === 80.0);
});

test('offRoute measures the distance to the line and the rejoin point on it', () => {
  const r = offRoute(ROUTE, OFF.lastLocation);
  assert.ok(r.offsetM > 500 && r.offsetM < 580, `offset ${r.offsetM}`);
  assert.ok(Math.abs(r.rejoin.lat - 13.01) < 1e-6 && Math.abs(r.rejoin.lng - 80.0) < 1e-9);
});

test('a bus on its route gets no detour and the router is never called', async () => {
  assert.equal(await busDetour(busAt(13.005, 80.0003), ROUTE, { now: NOW, cfg: cfg() }), null);
  assert.equal(calls.length, 0);
});

test('poor GPS accuracy widens the on-route tolerance', async () => {
  // ~110 m off the line, but the fix is only good to 150 m: not proof of leaving the route.
  assert.equal(await busDetour(busAt(13.005, 80.001, { accuracy: 150 }), ROUTE, { now: NOW, cfg: cfg() }), null);
  assert.equal(calls.length, 0);
});

test('off route: the road path from the bus to the nearest point of the route', async () => {
  const d = await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() });
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.geometry, ROAD);
  assert.equal(d.distanceM, 700);
  assert.ok(d.offsetM > 500);
  assert.equal(calls.length, 1);
  // From the bus (lng,lat) to the rejoin point on the route.
  assert.match(calls[0], /\/route\/v1\/driving\/80\.005000,13\.010000;80\.000000,13\.010000\?/);
});

test('the path is reused while the bus stays close; re-requested after it moves', async () => {
  await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() });
  await busDetour(busAt(13.0101, 80.005), ROUTE, { now: NOW + 5000, cfg: cfg() }); // ~11 m
  assert.equal(calls.length, 1);
  await busDetour(busAt(13.013, 80.005), ROUTE, { now: NOW + 10000, cfg: cfg() }); // ~330 m
  assert.equal(calls.length, 2);
});

test('many viewers at once share one routing request', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() })));
  assert.equal(calls.length, 1);
  assert.ok(results.every((r) => r.status === 'ok'));
});

test('a router failure means NO line (unavailable), retried only after a minute', async () => {
  respond(() => new Response('oops', { status: 500 }));
  const d = await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() });
  assert.equal(d.status, 'unavailable');
  assert.ok(!d.geometry);
  assert.ok(d.reason);
  respond(() => ok());
  assert.equal((await busDetour(OFF, ROUTE, { now: NOW + 10000, cfg: cfg() })).status, 'unavailable');
  assert.equal(calls.length, 1);
});

test('a bus far from any known road gets no invented path', async () => {
  // The router snaps the bus 2 km away: that is not where the bus is.
  respond(() => ok(osrm([[80.03, 13.01], [80.0, 13.01]])));
  const d = await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() });
  assert.equal(d.status, 'unavailable');
  assert.equal(d.reason, 'The bus is not near a road the map knows');
});

test('an offline (parked) bus also gets the road path, requested once while it does not move', async () => {
  const parked = busAt(13.01, 80.005, { at: new Date(NOW - 3600000) });
  const d = await busDetour(parked, ROUTE, { now: NOW, cfg: cfg() });
  assert.equal(d.status, 'ok');
  await busDetour(parked, ROUTE, { now: NOW + 60000, cfg: cfg() });
  assert.equal(calls.length, 1);
});

test('a slow router answers "pending" first, then the cached path', async () => {
  let release;
  respond(() => new Promise((r) => (release = () => r(ok()))));
  const first = await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg({ detourWaitMs: 20 }) });
  assert.equal(first.status, 'pending');
  release();
  await new Promise((r) => setTimeout(r, 20));
  const next = await busDetour(OFF, ROUTE, { now: NOW + 3000, cfg: cfg({ detourWaitMs: 20 }) });
  assert.equal(next.status, 'ok');
  assert.equal(calls.length, 1);
});

test('routing disabled: unavailable with a reason, no request', async () => {
  process.env.ROUTING_OSRM_URL = '';
  try {
    const d = await busDetour(OFF, ROUTE, { now: NOW, cfg: cfg() });
    assert.equal(d.status, 'unavailable');
    assert.equal(d.reason, 'Road routing is not configured on this server');
    assert.equal(calls.length, 0);
  } finally {
    process.env.ROUTING_OSRM_URL = 'https://osrm.test.invalid';
  }
});

test('detour requests leave room in the routing queue for route generation', async () => {
  const releases = [];
  respond(() => new Promise((r) => releases.push(() => r(ok()))));
  const a = roadPathBetween({ lat: 13.01, lng: 80.005 }, { lat: 13.01, lng: 80.0 });
  const b = roadPathBetween({ lat: 13.011, lng: 80.005 }, { lat: 13.011, lng: 80.0 });
  await assert.rejects(roadPathBetween({ lat: 13.012, lng: 80.005 }, { lat: 13.012, lng: 80.0 }), (e) => e.code === 'busy');
  // The queue is serial: answer each request as it reaches the (mocked) router.
  let done = false;
  const all = Promise.all([a, b]).finally(() => (done = true));
  while (!done) {
    while (releases.length) releases.shift()();
    await new Promise((r) => setTimeout(r, 5));
  }
  await all;
  assert.equal(calls.length, 2);
});
