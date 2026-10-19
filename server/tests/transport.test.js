/**
 * College bus tracking: management RBAC, viewer scope, trips, validated GPS
 * ingestion, Socket.IO room authorization, the tracker webhook, ETA and the
 * trip sweeper.
 *
 * TEST DATA ONLY — every coordinate below is SYNTHETIC: a straight north-
 * bound line near 13.000° N, 80.000° E. No real bus, route or GPS position.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { computeEta, speedFrom } = await import('../src/services/transport/eta.js');
const { sweepTrips } = await import('../src/services/transport/trips.js');
const { resetIngestState } = await import('../src/services/transport/ingest.js');
const { resetEventState, evaluateTripEvents } = await import('../src/services/transport/events.js');

// ── Synthetic geography (TEST DATA) ──
const LNG = 80.0;
const at = (lat) => ({ lat, lng: LNG });
const STOPS = [
  { name: 'Test Stop A', ...at(13.0), sequence: 1 },
  { name: 'Test Stop B', ...at(13.01), sequence: 2 },
  { name: 'Test College', ...at(13.02), sequence: 3, isCollege: true },
];
const GEOMETRY = [[LNG, 13.0], [LNG, 13.005], [LNG, 13.01], [LNG, 13.015], [LNG, 13.02]];

let ctx;
let admin, transportUser, fac, fac2, student, student2, office, alumni;
let route, route2, bus1, bus2;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  resetIngestState();
  resetEventState();
});

before(async () => {
  delete process.env.TRANSPORT_STUDENT_VISIBILITY;
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'transport', name: 'Transport Officer', employeeId: 'T1' }),
    mk({ role: 'faculty', name: 'Bus Faculty', department: 'CSE', employeeId: 'F1' }),
    mk({ role: 'faculty', name: 'Other Faculty', department: 'CSE', employeeId: 'F2' }),
    mk({ name: 'Rider One', department: 'CSE', section: 'A', semester: 5, rollNo: 'R1', phone: '9000000001', stayType: 'day_scholar' }),
    mk({ name: 'Rider Two', department: 'ECE', section: 'A', semester: 5, rollNo: 'R2', stayType: 'day_scholar' }),
    mk({ role: 'office', name: 'Office', employeeId: 'O1' }),
    mk({ role: 'alumni', name: 'Alumnus' }),
  ]);
  [admin, transportUser, fac, fac2, student, student2, office, alumni] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  // The trip phone is the Android app.
  fac = { u: fac.u, ...(await ctx.loginMobile(fac.u)) };
});
after(async () => {
  delete process.env.TRANSPORT_STUDENT_VISIBILITY;
  delete process.env.TRACKER_WEBHOOK_SECRET;
  await ctx.stop();
});

const call = (actor, method, path, body) => ctx.request(method, path, { token: actor.token, body, headers: actor.refreshToken ? { 'x-client-platform': 'mobile' } : {} });

// ── Management ──

test('only transport managers manage routes and buses; inputs are validated', async () => {
  const body = { name: 'Test Route North', code: 'TRN', stops: STOPS, geometry: GEOMETRY };
  for (const who of [student, fac, office]) assert.equal((await call(who, 'POST', '/transport/routes', body)).status, 403, who.u.role);
  const bad = await call(transportUser, 'POST', '/transport/routes', { ...body, stops: [{ name: 'X1', lat: 95, lng: 80, sequence: 1 }, { name: 'X2', lat: 13, lng: 80, sequence: 2 }] });
  assert.equal(bad.status, 422, 'latitude out of range');
  const dupSeq = await call(transportUser, 'POST', '/transport/routes', { ...body, stops: STOPS.map((s) => ({ ...s, sequence: 1 })) });
  assert.equal(dupSeq.status, 422, 'duplicate stop sequence');
  const ok = await call(transportUser, 'POST', '/transport/routes', body);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  route = ok.body.route;
  assert.deepEqual(route.stops.map((s) => s.sequence), [1, 2, 3]);
  route2 = (await call(admin, 'POST', '/transport/routes', { name: 'Test Route Two', stops: STOPS })).body.route;

  const b1 = await call(transportUser, 'POST', '/transport/buses', { number: 'tst-1', route: route._id, gpsSource: 'phone', trackingStaff: [String(fac.u._id)] });
  assert.equal(b1.status, 201, JSON.stringify(b1.body));
  assert.equal(b1.body.bus.number, 'TST-1');
  bus1 = b1.body.bus;
  assert.equal((await call(transportUser, 'POST', '/transport/buses', { number: 'TST-1', route: route._id })).status, 409, 'duplicate number');
  assert.equal((await call(transportUser, 'POST', '/transport/buses', { number: 'TST-9', trackingStaff: [String(student.u._id)] })).status, 422, 'a student cannot share trips');
  bus2 = (await call(admin, 'POST', '/transport/buses', { number: 'TST-2', route: route2._id, gpsSource: 'tracker', trackerDeviceId: 'TEST-DEVICE-2' })).body.bus;
  assert.equal((await call(admin, 'PUT', `/transport/routes/${route._id}`, { isActive: false })).status, 409, 'route still used by an active bus');
  assert.ok(await ctx.models.Activity.exists({ action: 'transport.bus_created' }), 'audited');
});

test('viewers: everyone with transport access sees buses; personal data never appears', async () => {
  for (const who of [student, fac, admin, transportUser]) {
    const res = await call(who, 'GET', '/transport/buses');
    assert.equal(res.status, 200, who.u.role);
    assert.deepEqual(res.body.buses.map((b) => b.number).sort(), ['TST-1', 'TST-2']);
  }
  for (const who of [office, alumni]) assert.equal((await call(who, 'GET', '/transport/buses')).status, 403, who.u.role);
  const s = await call(student, 'GET', '/transport/buses');
  const text = JSON.stringify(s.body);
  assert.ok(!text.includes('9000000001') && !('trackingStaff' in s.body.buses[0]), 'no phones, no staff lists for students');
  assert.equal(s.body.buses[0].tracking, 'offline', 'no position yet → never shown as live');
  assert.equal(s.body.buses[0].location, null);
  const search = await call(student, 'GET', '/transport/search?q=test stop b');
  assert.equal(search.body.stops[0].name, 'Test Stop B');
});

test('the transport role is confined to Bus Tracking', async () => {
  for (const path of ['/users', '/attendance/summary', '/timetable', '/chat/conversations']) assert.equal((await call(transportUser, 'GET', path)).status, 403, path);
  assert.equal((await call(transportUser, 'GET', '/transport/assignments')).status, 200);
  assert.equal((await call(student, 'GET', '/transport/assignments')).status, 403, 'passenger lists are for managers only');
});

// ── Trips and validated locations ──

let trip;
const now = () => Date.now();
const fix = (lat, secondsAgo, extra = {}) => ({ lat, lng: LNG, timestamp: now() - secondsAgo * 1000, accuracy: 10, ...extra });

test('only assigned staff start a trip; nobody takes over a running one', async () => {
  assert.equal((await call(fac2, 'POST', '/transport/trips', { busId: bus1._id })).status, 403, 'not assigned to this bus');
  assert.equal((await call(student, 'POST', '/transport/trips', { busId: bus1._id })).status, 403);
  const res = await call(fac, 'POST', '/transport/trips', { busId: bus1._id });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  trip = res.body.trip;
  assert.equal(trip.status, 'active');
  assert.equal((await call(transportUser, 'POST', '/transport/trips', { busId: bus1._id })).status, 409, 'one active trip per bus');
  assert.equal((await call(fac2, 'POST', `/transport/trips/${trip._id}/stop`)).status, 403, 'others cannot stop it');
  assert.ok(await ctx.models.Activity.exists({ action: 'transport.trip_started' }));
});

test('location fixes are validated: bad, stale, future, inaccurate, implausible and too-frequent fixes are rejected', async () => {
  const post = (fixes, who = fac) => call(who, 'POST', `/transport/trips/${trip._id}/locations`, { fixes });
  assert.equal((await post([fix(13.001, 50)], fac2)).status, 403, 'only the sharer');
  assert.equal((await post([{ lat: 200, lng: LNG, timestamp: now(), accuracy: 5 }])).status, 422, 'coordinates out of range');
  const r = await post([
    fix(13.001, 600), // stale
    fix(13.001, -120), // future
    fix(13.001, 50, { accuracy: 900 }), // inaccurate
    { lat: 0, lng: 0, timestamp: now() - 40000, accuracy: 5 }, // null island
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 0);
  assert.deepEqual(r.body.rejected.map((x) => x.code).sort(), ['future', 'inaccurate', 'invalid_coordinates', 'stale']);
  assert.equal((await ctx.models.Bus.findById(bus1._id).lean()).lastLocation?.at, undefined, 'nothing stored');

  const good = await post([fix(13.0005, 60), fix(13.001, 50)]);
  assert.equal(good.body.accepted, 2, JSON.stringify(good.body));
  const later = await post([
    fix(13.0011, 49.5), // 0.5 s after the last: too frequent
    fix(13.0009, 55), // older than the last accepted
    fix(13.2, 45), // 22 km in 5 s: implausible jump
  ]);
  assert.deepEqual(later.body.rejected.map((x) => x.code).sort(), ['implausible_jump', 'out_of_order', 'too_frequent']);
  const bus = await ctx.models.Bus.findById(bus1._id).lean();
  assert.equal(bus.lastLocation.lat, 13.001);
  assert.equal(String(bus.lastLocation.trip), String(trip._id));
});

test('live updates reach only permitted viewers, per bus, across reconnects', async () => {
  const seen = (s) => {
    const got = [];
    s.on('bus:location', (p) => got.push(p.busId));
    return got;
  };
  const sub = (s, busId = null) => s.timeout(3000).emitWithAck('transport:subscribe', busId);

  // Visibility "all": students see every bus.
  const sAll = await ctx.connect(student.token);
  const gotAll = seen(sAll);
  assert.equal((await sub(sAll)).ok, true);
  const sOffice = await ctx.connect(office.token);
  assert.equal((await sub(sOffice)).ok, false, 'Office has no transport access');

  // Visibility "assigned": a student sees only the bus of their route.
  process.env.TRANSPORT_STUDENT_VISIBILITY = 'assigned';
  await call(admin, 'PUT', '/transport/assignments', { user: String(student2.u._id), route: route._id, stop: route.stops[1]._id });
  const s2 = await ctx.connect(student2.token);
  const got2 = seen(s2);
  const r2 = await sub(s2);
  assert.deepEqual(r2.rooms, [String(bus1._id)]);
  assert.equal((await sub(s2, bus2._id)).ok, false, 'not their bus');
  assert.equal((await call(student2, 'GET', `/transport/buses/${bus2._id}`)).status, 404);
  assert.deepEqual((await call(student2, 'GET', '/transport/buses')).body.buses.map((b) => b.number), ['TST-1']);

  await call(fac, 'POST', `/transport/trips/${trip._id}/locations`, { fixes: [fix(13.002, 40)] });
  // Tracker bus 2 (via the webhook) — student2 must not receive it.
  process.env.TRACKER_WEBHOOK_SECRET = 'test-secret-not-real';
  const body = JSON.stringify({ deviceId: 'TEST-DEVICE-2', fixes: [fix(13.003, 30)] });
  const ts = String(Date.now());
  const sig = `sha256=${crypto.createHmac('sha256', 'test-secret-not-real').update(`${ts}.${body}`).digest('hex')}`;
  const hook = await fetch(`${ctx.base}/api/transport/tracker/locations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-timestamp': ts, 'x-tracker-signature': sig }, body });
  assert.equal(hook.status, 200, await hook.clone().text());
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual([...new Set(gotAll)].sort(), [String(bus1._id), String(bus2._id)].sort(), 'the all-buses viewer gets both');
  assert.deepEqual([...new Set(got2)], [String(bus1._id)], 'the assigned student gets only their bus');

  // Reconnect: a new socket must subscribe again, and then receives updates.
  s2.disconnect();
  const s2b = await ctx.connect(student2.token);
  const got2b = seen(s2b);
  assert.equal((await sub(s2b)).ok, true);
  await call(fac, 'POST', `/transport/trips/${trip._id}/locations`, { fixes: [fix(13.0035, 30)] });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(got2b, [String(bus1._id)]);

  // A deactivated account can no longer subscribe.
  await ctx.models.User.updateOne({ _id: student2.u._id }, { isActive: false });
  const denied = await sub(s2b).catch(() => ({ ok: false }));
  assert.equal(denied.ok, false);
  await ctx.models.User.updateOne({ _id: student2.u._id }, { isActive: true });
  delete process.env.TRANSPORT_STUDENT_VISIBILITY;
});

test('the tracker webhook is disabled without a secret and rejects bad or replayed signatures', async () => {
  const send = (headers, body) => fetch(`${ctx.base}/api/transport/tracker/locations`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  const body = JSON.stringify({ deviceId: 'TEST-DEVICE-2', fixes: [fix(13.004, 20)] });
  const sign = (ts, b = body) => `sha256=${crypto.createHmac('sha256', 'test-secret-not-real').update(`${ts}.${b}`).digest('hex')}`;
  delete process.env.TRACKER_WEBHOOK_SECRET;
  assert.equal((await send({}, body)).status, 404, 'off until configured');
  process.env.TRACKER_WEBHOOK_SECRET = 'test-secret-not-real';
  const ts = String(Date.now());
  assert.equal((await send({ 'x-tracker-timestamp': ts, 'x-tracker-signature': 'sha256=deadbeef' }, body)).status, 401);
  const old = String(Date.now() - 10 * 60000);
  assert.equal((await send({ 'x-tracker-timestamp': old, 'x-tracker-signature': sign(old) }, body)).status, 401, 'replay');
  const unknown = JSON.stringify({ deviceId: 'NOPE', fixes: [fix(13.004, 20)] });
  assert.equal((await send({ 'x-tracker-timestamp': ts, 'x-tracker-signature': sign(ts, unknown) }, unknown)).status, 404);
  delete process.env.TRACKER_WEBHOOK_SECRET;
});

test('bus details: route, progress, travelled path and an ETA with its confidence', async () => {
  const res = await call(student, 'GET', `/transport/buses/${bus1._id}?stopId=${route.stops[2]._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.bus.tracking, 'live');
  assert.equal(res.body.route.stops.length, 3);
  assert.ok(res.body.travelled.length >= 1);
  assert.ok(res.body.progress.fraction > 0 && res.body.progress.fraction < 0.5);
  assert.equal(res.body.eta.status, 'ok', JSON.stringify(res.body.eta));
  assert.equal(res.body.eta.stop.name, 'Test College');
  assert.ok(['high', 'medium'].includes(res.body.eta.confidence));
  assert.ok(res.body.eta.minutes > 0 && res.body.eta.arrivalAt);
});

test('an approaching-stop alert goes once to riders of that stop', async () => {
  // Rider One waits at Test Stop B; the bus is ~700 m away moving ~10 m/s → about 1 min.
  await call(admin, 'PUT', '/transport/assignments', { user: String(student.u._id), route: route._id, stop: route.stops[1]._id });
  const b = await ctx.models.Bus.findById(bus1._id).lean();
  const t = await ctx.models.BusTrip.findById(trip._id).lean();
  await evaluateTripEvents(b, b.lastLocation, t, { force: true });
  await evaluateTripEvents(b, b.lastLocation, t, { force: true });
  const alerts = await ctx.models.Notification.find({ user: student.u._id, category: 'transport', title: /min away/ }).lean();
  assert.equal(alerts.length, 1, 'once per trip');
  assert.match(alerts[0].message, /TST-1 · Test Route North is approaching Test Stop B/);
  assert.ok(!/Rider|9000000001/.test(alerts[0].message), 'no personal data');
});

test('ending the trip stops further phone locations; idle trips time out by themselves', async () => {
  const stop = await call(fac, 'POST', `/transport/trips/${trip._id}/stop`);
  assert.equal(stop.body.trip.status, 'completed');
  const after = await call(fac, 'POST', `/transport/trips/${trip._id}/locations`, { fixes: [fix(13.004, 10)] });
  assert.equal(after.status, 409);
  assert.equal(after.body.code, 'trip_not_active', 'the phone is told to stop sharing');

  const t2 = (await call(fac, 'POST', '/transport/trips', { busId: bus1._id })).body.trip;
  await ctx.models.BusTrip.updateOne({ _id: t2._id }, { startedAt: new Date(Date.now() - 60 * 60000), lastLocationAt: new Date(Date.now() - 30 * 60000) });
  const ended = await sweepTrips();
  assert.equal(ended, 1);
  const t2db = await ctx.models.BusTrip.findById(t2._id).lean();
  assert.equal(t2db.status, 'timeout');
});

// ── ETA (pure, TEST DATA) ──

test('ETA: along the route at recent speed; clear "unavailable" states instead of guesses', () => {
  const r = { stops: STOPS.map((s, i) => ({ ...s, _id: `s${i}` })), geometry: GEOMETRY };
  const nowMs = Date.parse('2026-10-19T03:00:00Z');
  const loc = (lat, ageS = 5) => ({ lat, lng: LNG, at: new Date(nowMs - ageS * 1000) });

  const ok = computeEta({ route: r, location: loc(13.005), stopId: 's2', speed: 10, now: nowMs });
  assert.equal(ok.status, 'ok');
  // ≈ 1668 m to the college at 10 m/s ≈ 2.8 min.
  assert.ok(Math.abs(ok.distanceMeters - 1668) < 15, String(ok.distanceMeters));
  assert.equal(ok.minutes, 3);
  assert.equal(ok.confidence, 'high');
  assert.equal(ok.nextStop.name, 'Test Stop B');

  assert.equal(computeEta({ route: r, location: null, speed: 10, now: nowMs }).status, 'unavailable');
  assert.match(computeEta({ route: r, location: loc(13.005, 200), speed: 10, now: nowMs }).reason, /too old/);
  assert.match(computeEta({ route: r, location: loc(13.005, 4000), speed: 10, now: nowMs }).reason, /offline/);
  assert.match(computeEta({ route: r, location: { lat: 13.005, lng: 80.05, at: new Date(nowMs) }, speed: 10, now: nowMs }).reason, /not on its route/);
  assert.equal(computeEta({ route: r, location: loc(13.015), stopId: 's0', speed: 10, now: nowMs }).passed, true);
  assert.match(computeEta({ route: r, location: loc(13.005), stopId: 's2', speed: null, now: nowMs }).reason, /Not enough movement/);

  // No speed, but a timetable: interpolate the schedule.
  const timed = { ...r, stops: r.stops.map((s, i) => ({ ...s, scheduledTime: ['08:00', '08:10', '08:20'][i] })) };
  const sched = computeEta({ route: timed, location: loc(13.005), stopId: 's2', speed: null, now: nowMs, campusMinutesNow: 8 * 60 + 5 });
  assert.equal(sched.method, 'schedule');
  assert.equal(sched.minutes, 15);

  // No road geometry: stop-to-stop line, scaled, and flagged low confidence.
  const approx = computeEta({ route: { stops: r.stops }, location: loc(13.005), stopId: 's2', speed: 10, now: nowMs });
  assert.equal(approx.confidence, 'low');
  assert.equal(approx.approximateRoute, true);

  // Recent speed from fixes; a parked bus has none.
  const base = Date.parse('2026-10-19T03:00:00Z');
  assert.ok(Math.abs(speedFrom([{ lat: 13.0, lng: LNG, at: new Date(base) }, { lat: 13.0009, lng: LNG, at: new Date(base + 10000) }]) - 10) < 0.2);
  assert.equal(speedFrom([{ lat: 13.0, lng: LNG, at: new Date(base) }, { lat: 13.0, lng: LNG, at: new Date(base + 10000) }]), null);
});

test('hostelers and students without a stay type get no bus tracking', async () => {
  const hosteler = await ctx.createUser({ name: 'Hosteler', department: 'CSE', section: 'A', semester: 5, rollNo: 'R9', stayType: 'hosteler' });
  const h = { u: hosteler, ...(await ctx.loginWeb(hosteler)) };
  assert.equal((await call(h, 'GET', '/transport/buses')).status, 403);
  assert.equal((await call(h, 'GET', '/transport/config')).status, 403);
  assert.equal((await call(student, 'GET', '/transport/buses')).status, 200);
});
