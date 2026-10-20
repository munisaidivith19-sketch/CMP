/**
 * Road-following bus routes: OSRM response validation, provider failures,
 * the manager-only preview endpoint, and saving / preserving geometry.
 *
 * TEST DATA ONLY — every coordinate is SYNTHETIC (near 13.000° N, 80.000° E)
 * and the routing server is MOCKED: no request ever leaves the process.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { routingLimiter, writeLimiter } from '../src/middleware/rateLimit.js';

const routing = await import('../src/services/transport/routing.js');
const { generateRoadGeometry, normalizeStops, parseOsrmRoute, resetRoutingState, setRoutingFetch, simplify, stopsKey } = routing;

// ── Synthetic geography (TEST DATA) ──
const STOPS = [
  { name: 'Synthetic Stop A', lat: 13.0, lng: 80.0, sequence: 1 },
  { name: 'Synthetic Stop B', lat: 13.01, lng: 80.0, sequence: 2 },
  { name: 'Synthetic College', lat: 13.02, lng: 80.0, sequence: 3, isCollege: true },
];
// A "road" that bends east between the stops, then comes back to each stop.
const ROAD = [[80.0, 13.0], [80.002, 13.003], [80.003, 13.006], [80.0, 13.01], [80.001, 13.014], [80.002, 13.017], [80.0, 13.02]];

const osrmOk = (coords = ROAD, stops = STOPS, snapOffset = 0) => ({
  code: 'Ok',
  routes: [{ distance: 2600.4, duration: 312.7, geometry: { type: 'LineString', coordinates: coords } }],
  waypoints: stops.map((s) => ({ location: [s.lng + snapOffset, s.lat], distance: 1 })),
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls = [];
const mockFetch = (responder) => setRoutingFetch(async (url, opts) => {
  calls.push({ url, opts });
  return responder(url, opts);
});

let ctx;
let admin, transportUser, fac, student;

const resetLimits = async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  for (const a of [admin, transportUser, fac, student].filter(Boolean)) await routingLimiter.resetKey(`routing:${a.u._id}`);
};

before(async () => {
  process.env.ROUTING_OSRM_URL = 'https://osrm.test.invalid';
  process.env.ROUTING_MIN_INTERVAL_MS = '0';
  ctx = await startServer();
  const users = await Promise.all([
    ctx.createUser({ role: 'admin', name: 'Admin' }),
    ctx.createUser({ role: 'transport', name: 'Transport Officer', employeeId: 'RT1' }),
    ctx.createUser({ role: 'faculty', name: 'Faculty', department: 'CSE', employeeId: 'RF1' }),
    ctx.createUser({ name: 'Rider', department: 'CSE', section: 'A', semester: 5, rollNo: 'RR1', stayType: 'day_scholar' }),
  ]);
  [admin, transportUser, fac, student] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
});
beforeEach(async () => {
  calls = [];
  resetRoutingState();
  setRoutingFetch(null);
  await resetLimits();
});
after(async () => {
  setRoutingFetch(null);
  for (const k of ['ROUTING_OSRM_URL', 'ROUTING_MIN_INTERVAL_MS', 'ROUTING_TIMEOUT_MS']) delete process.env[k];
  await ctx.stop();
});

const call = (actor, method, path, body) => ctx.request(method, path, { token: actor.token, body });
const rejects = (fn, code) => assert.rejects(fn, (err) => {
  assert.equal(err.code, code, `${err.code}: ${err.message}`);
  return true;
});

// ── Unit: response validation ──

test('a valid OSRM answer becomes [longitude, latitude] geometry that starts and ends at the stops', () => {
  const out = parseOsrmRoute(osrmOk(), normalizeStops(STOPS));
  assert.deepEqual(out.geometry, ROAD);
  assert.equal(out.distanceM, 2600);
  assert.equal(out.durationS, 313);
  assert.equal(out.provider, 'osrm');
  assert.ok(out.geometry.every(([lng, lat]) => Math.abs(lng - 80) < 0.01 && Math.abs(lat - 13.01) < 0.02), 'GeoJSON order kept');
});

test('swapped [latitude, longitude] or unrelated lines from the provider are rejected', () => {
  const stops = normalizeStops(STOPS);
  const swapped = ROAD.map(([lng, lat]) => [lat, lng]);
  assert.throws(() => parseOsrmRoute(osrmOk(swapped), stops), (e) => e.code === 'bad_response');
  const elsewhere = ROAD.map(([lng, lat]) => [lng + 0.5, lat]);
  assert.throws(() => parseOsrmRoute(osrmOk(elsewhere), stops), (e) => e.code === 'bad_response');
});

test('invalid coordinates, missing pieces and routing error codes are reported, never patched over', () => {
  const stops = normalizeStops(STOPS);
  assert.throws(() => parseOsrmRoute(osrmOk([[80, 13], [200, 13.02]]), stops), (e) => e.code === 'bad_response', 'longitude out of range');
  assert.throws(() => parseOsrmRoute(osrmOk([[80, 13], ['x', 13.02]]), stops), (e) => e.code === 'bad_response', 'non-numeric');
  assert.throws(() => parseOsrmRoute(osrmOk([[80, 13]]), stops), (e) => e.code === 'bad_response', 'single point');
  assert.throws(() => parseOsrmRoute({ ...osrmOk(), waypoints: [] }, stops), (e) => e.code === 'bad_response', 'stops missing');
  assert.throws(() => parseOsrmRoute({ code: 'Ok', routes: [] }, stops), (e) => e.code === 'bad_response');
  assert.throws(() => parseOsrmRoute(null, stops), (e) => e.code === 'bad_response');
  assert.throws(() => parseOsrmRoute({ code: 'NoRoute' }, stops), (e) => e.code === 'no_route' && e.status === 422);
  assert.throws(() => parseOsrmRoute({ code: 'NoSegment' }, stops), (e) => e.code === 'stop_off_road');
  // A stop the router had to move ~1 km to reach a road: an error naming that stop.
  assert.throws(() => parseOsrmRoute(osrmOk(ROAD, STOPS, 0.01), stops), (e) => e.code === 'stop_off_road' && e.details.stopIndex === 0 && /Synthetic Stop A/.test(e.message));
});

test('stops are validated and put in travel order before routing', () => {
  assert.throws(() => normalizeStops([STOPS[0]]), (e) => e.code === 'invalid_stops');
  assert.throws(() => normalizeStops([STOPS[0], { lat: 95, lng: 80 }]), (e) => e.code === 'invalid_stops' && e.details.stopIndex === 1);
  assert.throws(() => normalizeStops([STOPS[0], { lat: 0, lng: 0 }]), (e) => e.code === 'invalid_stops', 'null island');
  assert.throws(() => normalizeStops([{ ...STOPS[0], sequence: 1 }, { ...STOPS[1], sequence: 1 }]), (e) => e.code === 'invalid_stops');
  assert.deepEqual(normalizeStops([STOPS[2], STOPS[0], STOPS[1]]).map((s) => s.sequence), [1, 2, 3]);
  assert.equal(stopsKey(STOPS), stopsKey([STOPS[1], STOPS[2], STOPS[0]]), 'key follows travel order');
  assert.notEqual(stopsKey(STOPS), stopsKey([STOPS[0], STOPS[1], { ...STOPS[2], lat: 13.03 }]));
});

test('very long lines are simplified under the storage limit, keeping both ends', () => {
  const dense = Array.from({ length: 30001 }, (_, i) => [80 + (i % 2) * 1e-7, 13 + i * 1e-6]);
  const out = simplify(dense, 1);
  assert.ok(out.length < 100);
  assert.deepEqual(out[0], dense[0]);
  assert.deepEqual(out[out.length - 1], dense[dense.length - 1]);
});

// ── Unit: provider calls (mocked) ──

test('the request goes server-side to OSRM with stops as longitude,latitude in travel order', async () => {
  mockFetch(() => json(osrmOk()));
  const out = await generateRoadGeometry([STOPS[1], STOPS[0], STOPS[2]]);
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin, 'https://osrm.test.invalid');
  assert.equal(u.pathname, '/route/v1/driving/80.000000,13.000000;80.000000,13.010000;80.000000,13.020000');
  assert.equal(u.searchParams.get('geometries'), 'geojson');
  assert.equal(u.searchParams.get('overview'), 'full');
  assert.ok(calls[0].opts.signal, 'a timeout signal is always set');
  assert.equal(out.geometry.length, ROAD.length);
});

test('provider failures: timeout, unreachable, rate limit, HTTP errors, bad JSON, disabled', async () => {
  mockFetch(() => {
    throw Object.assign(new Error('t'), { name: 'TimeoutError' });
  });
  await rejects(() => generateRoadGeometry(STOPS), 'timeout');
  mockFetch(() => {
    throw new TypeError('fetch failed');
  });
  await rejects(() => generateRoadGeometry(STOPS), 'unavailable');
  mockFetch(() => json({ message: 'slow down' }, 429));
  await rejects(() => generateRoadGeometry(STOPS), 'rate_limited');
  mockFetch(() => json({ message: 'boom' }, 500));
  await rejects(() => generateRoadGeometry(STOPS), 'unavailable');
  mockFetch(() => new Response('<html>not json</html>', { status: 200 }));
  await rejects(() => generateRoadGeometry(STOPS), 'bad_response');
  mockFetch(() => json({ code: 'NoRoute', message: 'Impossible route' }, 400));
  await rejects(() => generateRoadGeometry(STOPS), 'no_route');

  process.env.ROUTING_OSRM_URL = '';
  await rejects(() => generateRoadGeometry(STOPS), 'disabled');
  process.env.ROUTING_OSRM_URL = 'javascript:alert(1)';
  await rejects(() => generateRoadGeometry(STOPS), 'disabled');
  process.env.ROUTING_OSRM_URL = 'https://osrm.test.invalid';
});

test('a provider that never answers is cut off by the timeout', async () => {
  process.env.ROUTING_TIMEOUT_MS = '1000';
  mockFetch((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
  const t0 = Date.now();
  await rejects(() => generateRoadGeometry(STOPS), 'timeout');
  assert.ok(Date.now() - t0 < 3000);
  delete process.env.ROUTING_TIMEOUT_MS;
});

// ── HTTP: preview endpoint ──

test('only transport managers can preview a road route; inputs are validated', async () => {
  mockFetch(() => json(osrmOk()));
  for (const who of [student, fac]) assert.equal((await call(who, 'POST', '/transport/routes/preview-geometry', { stops: STOPS })).status, 403, who.u.role);
  assert.equal(calls.length, 0, 'refused before any provider call');
  assert.equal((await call(transportUser, 'POST', '/transport/routes/preview-geometry', { stops: [STOPS[0]] })).status, 422);
  assert.equal((await call(transportUser, 'POST', '/transport/routes/preview-geometry', { stops: [STOPS[0], { lat: 13.01, lng: 181 }] })).status, 422);
  assert.equal(calls.length, 0);

  const ok = await call(transportUser, 'POST', '/transport/routes/preview-geometry', { stops: STOPS });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.geometry, ROAD);
  assert.equal(ok.body.provider, 'osrm');
  assert.equal(ok.body.stopsKey, stopsKey(STOPS));
  assert.equal(await ctx.models.BusRoute.countDocuments(), 0, 'a preview saves nothing');
});

test('preview failures reach the manager as a clear error with a code', async () => {
  mockFetch(() => {
    throw Object.assign(new Error('t'), { name: 'TimeoutError' });
  });
  const t = await call(admin, 'POST', '/transport/routes/preview-geometry', { stops: STOPS });
  assert.equal(t.status, 504);
  assert.equal(t.body.code, 'timeout');
  assert.match(t.body.message, /did not answer in time/);
  assert.ok(!/osrm\.test\.invalid/.test(JSON.stringify(t.body)), 'provider URL not exposed');

  mockFetch(() => json(osrmOk(ROAD, STOPS, 0.01)));
  const off = await call(admin, 'POST', '/transport/routes/preview-geometry', { stops: STOPS });
  assert.equal(off.status, 422);
  assert.equal(off.body.code, 'stop_off_road');
  assert.equal(off.body.stopIndex, 0);
});

test('route generation is rate-limited per manager', async () => {
  mockFetch(() => json(osrmOk()));
  let last;
  for (let i = 0; i < 11; i += 1) last = await call(transportUser, 'POST', '/transport/routes/preview-geometry', { stops: STOPS });
  assert.equal(last.status, 429);
  assert.equal(calls.length, 10);
});

// ── HTTP: saving and preserving geometry ──

let routeId;

test('saving generated geometry records its source; pasted geometry is "manual"', async () => {
  const gen = await call(transportUser, 'POST', '/transport/routes', { name: 'Synthetic Road Route', stops: STOPS, geometry: ROAD, geometrySource: 'generated', geometryProvider: 'osrm' });
  assert.equal(gen.status, 201, JSON.stringify(gen.body));
  routeId = gen.body.route._id;
  assert.equal(gen.body.route.geometrySource, 'generated');
  assert.equal(gen.body.route.geometryProvider, 'osrm');
  assert.deepEqual(gen.body.geometryInfo, { ...gen.body.geometryInfo, points: ROAD.length, source: 'generated', stale: false });
  // The audit write is fire-and-forget: allow it a moment to land.
  let audited = null;
  for (let i = 0; i < 20 && !audited; i += 1) {
    audited = await ctx.models.Activity.exists({ action: 'transport.route_created', summary: /geometry generated \(osrm\)/ });
    if (!audited) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(audited, 'audited');

  const man = await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Manual Route', stops: STOPS, geometry: ROAD });
  assert.equal(man.status, 201);
  assert.equal(man.body.route.geometrySource, 'manual');
  assert.equal(man.body.route.geometryProvider, undefined);
});

test('saved geometry must pass near every stop: [latitude, longitude] order is refused', async () => {
  const swapped = ROAD.map(([lng, lat]) => [lat, lng]);
  // 80°N 13°E is a valid point — only the distance to the stops reveals the mistake.
  const r = await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Swapped', stops: STOPS, geometry: swapped });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'geometry_off_stops');
  const bad = await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Bad', stops: STOPS, geometry: [[80, 13], [80, 95]] });
  assert.equal(bad.status, 422, 'latitude out of range');
  const upd = await call(admin, 'PUT', `/transport/routes/${routeId}`, { geometry: swapped });
  assert.equal(upd.status, 422);
  const kept = await call(admin, 'GET', `/transport/routes/${routeId}`);
  assert.deepEqual(kept.body.route.geometry, ROAD, 'a refused update changes nothing');
});

test('editing stops keeps the stored geometry and flags it as out of date', async () => {
  const renamed = await call(admin, 'PUT', `/transport/routes/${routeId}`, { name: 'Synthetic Road Route 2' });
  assert.deepEqual(renamed.body.route.geometry, ROAD);
  assert.equal(renamed.body.geometryInfo.stale, false);

  const moved = STOPS.map((s, i) => (i === 1 ? { ...s, lat: 13.011, scheduledTime: '08:10' } : s));
  const r = await call(admin, 'PUT', `/transport/routes/${routeId}`, { stops: moved });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.route.geometry, ROAD, 'never replaced silently');
  assert.equal(r.body.route.geometrySource, 'generated');
  assert.equal(r.body.geometryInfo.stale, true, 'manager is told to regenerate');

  const list = await call(admin, 'GET', '/transport/routes?all=true');
  const row = list.body.routes.find((x) => x._id === routeId);
  assert.equal(row.geometryInfo.stale, true);
  assert.equal(row.geometryInfo.points, ROAD.length);
  assert.equal(row.geometry, undefined, 'the list never ships the whole line');
  assert.equal(row.geometryStopsKey, undefined);

  // Regenerating (explicitly) clears the warning.
  const again = await call(admin, 'PUT', `/transport/routes/${routeId}`, { stops: moved, geometry: ROAD, geometrySource: 'generated', geometryProvider: 'osrm' });
  assert.equal(again.body.geometryInfo.stale, false);
});

test('geometry is removed only on an explicit request; viewers get no geometry status', async () => {
  const r = await call(admin, 'PUT', `/transport/routes/${routeId}`, { geometry: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.route.geometry, undefined);
  assert.equal(r.body.route.geometrySource, undefined);
  assert.deepEqual(r.body.geometryInfo, { points: 0, source: null, stale: false });

  const viewer = await call(student, 'GET', '/transport/routes');
  assert.ok(viewer.body.routes.every((x) => x.geometryInfo === undefined && x.geometrySource === undefined));
  const one = await call(student, 'GET', `/transport/routes/${routeId}`);
  assert.equal(one.body.geometryInfo, undefined);
});

test('routes saved before geometry provenance existed keep their geometry, status "unrecorded"', async () => {
  const legacy = await ctx.models.BusRoute.create({ name: 'Synthetic Legacy', stops: STOPS, geometry: ROAD });
  const r = await call(admin, 'GET', `/transport/routes/${legacy._id}`);
  assert.deepEqual(r.body.route.geometry, ROAD);
  assert.equal(r.body.geometryInfo.source, 'unrecorded');
  assert.equal(r.body.geometryInfo.stale, null, 'unknown, not guessed');
  const upd = await call(admin, 'PUT', `/transport/routes/${legacy._id}`, { code: 'LEG' });
  assert.deepEqual(upd.body.route.geometry, ROAD);
});
