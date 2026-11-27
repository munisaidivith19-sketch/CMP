/**
 * Route distance and time per stop: road distance from the first stop and
 * from the previous one, and the time to reach each stop (measured history,
 * else the timetable, else an assumed speed).
 *
 * TEST DATA ONLY — synthetic coordinates on a straight north-bound line near
 * 13.000° N, 80.000° E (about 1112 m per 0.01°). No real bus or GPS position.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { planLegs } = await import('../src/services/transport/journey.js');

const LNG = 80.0;
const STOPS = [
  { name: 'Stats Stop A', lat: 13.0, lng: LNG, sequence: 1 },
  { name: 'Stats Stop B', lat: 13.01, lng: LNG, sequence: 2 },
  { name: 'Stats College', lat: 13.02, lng: LNG, sequence: 3, isCollege: true },
];
const GEOMETRY = [[LNG, 13.0], [LNG, 13.005], [LNG, 13.01], [LNG, 13.015], [LNG, 13.02]];
const CFG = { etaDefaultSpeedKmh: 20, etaDwellSeconds: 30 };

let ctx;
let manager;
let student;

before(async () => {
  ctx = await startServer();
  const m = await ctx.createUser({ role: 'transport', name: 'Transport Officer', employeeId: 'RS1' });
  manager = { u: m, ...(await ctx.loginWeb(m)) };
  const s = await ctx.createUser({ name: 'Rider', department: 'CSE', section: 'A', semester: 5, rollNo: 'RS-R1', stayType: 'day_scholar' });
  student = { u: s, ...(await ctx.loginWeb(s)) };
});

after(async () => {
  await ctx.stop();
});

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);

test('planLegs: road distances, assumed speed with dwell, and the timetable when it exists', () => {
  const planStops = [{ stop: 'a' }, { stop: 'b', scheduledTime: '07:10' }, { stop: 'c', scheduledTime: '07:25' }];
  const path = { exact: true, stopAlong: [0, 1000, 3000] };
  const speed = planLegs({ planStops: planStops.map(({ stop }) => ({ stop })), path, history: null, cfg: CFG });
  assert.deepEqual(speed.stops.map((s) => s.fromStartM), [0, 1000, 3000]);
  assert.deepEqual(speed.stops.map((s) => s.fromPrevM), [0, 1000, 2000]);
  // 1000 m at 20 km/h = 180 s; then 30 s dwell + 360 s.
  assert.deepEqual(speed.stops.map((s) => s.minutesFromPrev), [0, 3, 7]);
  assert.equal(speed.minutes, 10);
  assert.equal(speed.method, 'assumed_speed');

  const timed = planLegs({ planStops: [{ stop: 'a', scheduledTime: '07:00' }, ...planStops.slice(1)], path, history: null, cfg: CFG });
  assert.deepEqual(timed.stops.map((s) => s.minutesFromStart), [0, 10, 25]);
  assert.equal(timed.method, 'timetable');

  const history = { segments: new Map([['a>b', 120]]), dwell: new Map() };
  const mixed = planLegs({ planStops: planStops.map(({ stop }) => ({ stop })), path, history, cfg: CFG });
  assert.equal(mixed.stops[1].method, 'history');
  assert.equal(mixed.stops[1].minutesFromPrev, 2);
  assert.equal(mixed.stops[2].method, 'assumed_speed');
  assert.equal(mixed.method, 'mixed');

  const straight = planLegs({ planStops: planStops.map(({ stop }) => ({ stop })), path: { exact: false, stopAlong: [0, 1000, 3000] }, history: null, cfg: CFG });
  assert.equal(straight.exact, false);
  assert.equal(straight.distanceM, 3900, 'straight lines are scaled up to approximate the road');
});

test('routes list and route detail carry the distance and time of every stop, for riders too', async () => {
  const created = await ctx.request('POST', '/transport/routes', { token: manager.token, body: { name: 'Stats Route', stops: STOPS, geometry: GEOMETRY } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.route._id;

  const list = (await ctx.request('GET', '/transport/routes?all=true', { token: manager.token })).body.routes;
  const r = list.find((x) => x._id === id);
  assert.ok(r.stats, 'stats present');
  assert.equal(r.geometry, undefined, 'the road line is not sent in the list');
  assert.equal(r.geometryInfo.points, GEOMETRY.length);
  assert.equal(r.stats.exact, true);
  assert.equal(r.stats.direction, 'towards_college');
  near(r.stats.distanceM, 2224, 15, 'total road distance');
  assert.equal(r.stats.stops.length, 3);
  near(r.stats.stops[1].fromStartM, 1112, 10, 'stop B from the start');
  near(r.stats.stops[2].fromPrevM, 1112, 10, 'college from stop B');
  assert.equal(r.stats.stops[2].name, 'Stats College');
  // 1112 m at 20 km/h ≈ 200 s, then 30 s dwell + 200 s → about 7 minutes.
  assert.equal(r.stats.minutes, 7);
  assert.equal(r.stats.method, 'assumed_speed');

  const detail = await ctx.request('GET', `/transport/routes/${id}`, { token: manager.token });
  assert.equal(detail.status, 200);
  near(detail.body.stats.distanceM, 2224, 15, 'detail total');

  const rider = await ctx.request('GET', '/transport/routes', { token: student.token });
  assert.equal(rider.status, 200);
  const seen = rider.body.routes.find((x) => x._id === id);
  if (seen) {
    assert.ok(seen.stats, 'riders see the stats');
    assert.equal(seen.geometry, undefined);
  }
});
