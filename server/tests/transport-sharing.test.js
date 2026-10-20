/**
 * Live bus location sharing by Faculty, HOD, Dean and AO: who may share which
 * bus, one session per bus and per person, device-bound web sessions, GPS
 * validation on that path, and the live stream reaching only permitted viewers.
 *
 * TEST DATA ONLY — synthetic users, buses and coordinates near 13.000° N, 80.000° E.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent, noEvent } from './helpers.js';
import { writeLimiter, locationLimiter } from '../src/middleware/rateLimit.js';

const { resetIngestState } = await import('../src/services/transport/ingest.js');
const { resetEventState } = await import('../src/services/transport/events.js');

const LNG = 80.0;
const STOPS = [
  { name: 'Synthetic Stop A', lat: 13.0, lng: LNG, sequence: 1 },
  { name: 'Synthetic College', lat: 13.02, lng: LNG, sequence: 2, isCollege: true },
];
const fix = (lat, secondsAgo, extra = {}) => ({ lat, lng: LNG, timestamp: Date.now() - secondsAgo * 1000, accuracy: 12, ...extra });

let ctx;
let admin, fac, hod, dean, ao, facOther, principal, student, hostler, office;
let busA, busB, busC;

const all = () => [admin, fac, hod, dean, ao, facOther, principal, student, hostler, office].filter(Boolean);
beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  for (const a of all()) await locationLimiter.resetKey(`user:${a.u._id}`);
  resetIngestState();
  resetEventState();
});

before(async () => {
  delete process.env.TRANSPORT_STUDENT_VISIBILITY;
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Synthetic Admin' }),
    mk({ role: 'faculty', name: 'Synthetic Faculty', department: 'CSE', employeeId: 'SF1' }),
    mk({ role: 'hod', name: 'Synthetic HOD', department: 'CSE', employeeId: 'SH1' }),
    mk({ role: 'dean', name: 'Synthetic Dean', employeeId: 'SD1' }),
    mk({ role: 'ao', name: 'Synthetic AO', employeeId: 'SA1' }),
    mk({ role: 'faculty', name: 'Unassigned Faculty', department: 'ECE', employeeId: 'SF2' }),
    mk({ role: 'principal', name: 'Synthetic Principal', employeeId: 'SP1' }),
    mk({ name: 'Synthetic Rider', department: 'CSE', section: 'A', semester: 5, rollNo: 'SR1', stayType: 'day_scholar' }),
    mk({ name: 'Synthetic Hosteler', department: 'CSE', section: 'A', semester: 5, rollNo: 'SR2', stayType: 'hosteler' }),
    mk({ role: 'office', name: 'Synthetic Office', employeeId: 'SO1' }),
  ]);
  [admin, fac, hod, dean, ao, facOther, principal, student, hostler, office] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));

  const route = (await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Share Route', stops: STOPS })).body.route;
  const staff = [fac, hod, dean, ao].map((a) => String(a.u._id));
  busA = (await call(admin, 'POST', '/transport/buses', { number: 'SHR-127', route: route._id, gpsSource: 'phone', trackingStaff: staff })).body.bus;
  busB = (await call(admin, 'POST', '/transport/buses', { number: 'SHR-128', route: route._id, gpsSource: 'phone', trackingStaff: [String(fac.u._id)] })).body.bus;
  busC = (await call(admin, 'POST', '/transport/buses', { number: 'SHR-129', route: route._id, gpsSource: 'phone' })).body.bus;
  assert.ok(busA && busB && busC, 'test buses created');
});
after(async () => {
  await ctx.stop();
});

function call(actor, method, path, body, headers = {}) {
  return ctx.request(method, path, { token: actor.token, body, headers });
}
const startWeb = (actor, busId) => call(actor, 'POST', '/transport/trips', { busId, bindDevice: true });
const stop = (actor, tripId) => call(actor, 'POST', `/transport/trips/${tripId}/stop`, { reason: 'stopped' });
const send = (actor, tripId, key, fixes) => call(actor, 'POST', `/transport/trips/${tripId}/locations`, { fixes }, key ? { 'x-trip-key': key } : {});

test('Faculty, HOD, Dean and AO assigned to a bus can start and stop sharing it', async () => {
  for (const who of [fac, hod, dean, ao]) {
    const r = await startWeb(who, busA._id);
    assert.equal(r.status, 201, `${who.u.role}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.trip.status, 'active');
    assert.equal(r.body.trip.mine, true);
    assert.equal(typeof r.body.deviceKey, 'string');
    assert.ok(r.body.deviceKey.length >= 40);
    const s = await stop(who, r.body.trip._id);
    assert.equal(s.status, 200);
    assert.equal(s.body.trip.status, 'stopped');
  }
  const audited = await ctx.models.Activity.countDocuments({ action: { $in: ['transport.trip_started', 'transport.trip_stopped'] } });
  assert.ok(audited >= 8, 'start and stop are audited');
});

test('other roles, and staff not assigned to the bus, cannot share it', async () => {
  for (const who of [student, principal, office, hostler]) assert.equal((await startWeb(who, busA._id)).status, 403, who.u.role);
  assert.equal((await startWeb(facOther, busA._id)).status, 403, 'a role alone grants no bus');
  assert.equal((await startWeb(fac, busC._id)).status, 403, 'bus with no tracking staff');
  assert.equal((await startWeb(fac, '64b7f0000000000000000000')).status, 404, 'unknown bus');
  assert.equal((await call(fac, 'POST', '/transport/trips', { busId: busA._id, bindDevice: 'yes' })).status, 422);
  assert.equal(await ctx.models.BusTrip.countDocuments({ status: 'active' }), 0);
});

test('the share list shows only the buses this person may share', async () => {
  const mine = (await call(dean, 'GET', '/transport/me')).body;
  assert.deepEqual(mine.shareable.map((b) => b.number), ['SHR-127']);
  assert.ok(!JSON.stringify(mine).includes('trackingStaff'));
  assert.deepEqual((await call(facOther, 'GET', '/transport/me')).body.shareable, []);
});

test('two people starting the same bus at once: exactly one wins, the other is told it is busy', async () => {
  const [a, b] = await Promise.all([startWeb(fac, busA._id), startWeb(dean, busA._id)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const lost = a.status === 409 ? a : b;
  const won = a.status === 201 ? { r: a, who: fac } : { r: b, who: dean };
  assert.equal(lost.body.code, 'bus_busy');
  assert.ok(!/Synthetic/.test(lost.body.message), 'the other sharer is not named');
  assert.equal(await ctx.models.BusTrip.countDocuments({ bus: busA._id, status: 'active' }), 1);
  await stop(won.who, won.r.body.trip._id);
});

test('one person shares one bus at a time — even when two starts race', async () => {
  const first = await startWeb(fac, busA._id);
  assert.equal(first.status, 201);
  const second = await startWeb(fac, busB._id);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'already_sharing');
  assert.match(second.body.message, /SHR-127/);
  const again = await startWeb(fac, busA._id);
  assert.equal(again.status, 409, 'not a second session on the same bus either');
  assert.equal(again.body.code, 'already_sharing');
  await stop(fac, first.body.trip._id);

  const raced = await Promise.all([startWeb(fac, busA._id), startWeb(fac, busB._id)]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await ctx.models.BusTrip.countDocuments({ sharedBy: fac.u._id, status: 'active' }), 1);
  await stop(fac, raced.find((r) => r.status === 201).body.trip._id);
});

test('a web session is bound to its device key: no key, a wrong key or another account is refused', async () => {
  const r = await startWeb(hod, busA._id);
  const { trip, deviceKey } = r.body;
  const stored = await ctx.models.BusTrip.findById(trip._id).select('+deviceKeyHash').lean();
  assert.ok(stored.deviceKeyHash && stored.deviceKeyHash !== deviceKey, 'only a hash is stored');
  assert.equal(stored.channel, 'web');

  const none = await send(hod, trip._id, null, [fix(13.001, 1)]);
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'wrong_device');
  assert.equal((await send(hod, trip._id, 'x'.repeat(43), [fix(13.001, 1)])).status, 403);
  assert.equal((await send(dean, trip._id, deviceKey, [fix(13.001, 1)])).status, 403, 'the key is useless to another account');
  const ok = await send(hod, trip._id, deviceKey, [fix(13.001, 1)]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.accepted, 1);

  const me = (await call(hod, 'GET', '/transport/me')).body;
  assert.equal(me.activeTrip.channel, 'web');
  assert.ok(!/deviceKey/.test(JSON.stringify(me)), 'neither the key nor its hash is ever returned again');
  await stop(hod, trip._id);
});

const clearPosition = (bus) => ctx.models.Bus.updateOne({ _id: bus._id }, { $unset: { lastLocation: 1 } });

test('web sharing applies the same GPS checks: invalid, stale, future, inaccurate and out-of-order fixes change nothing', async () => {
  await clearPosition(busA);
  const { trip, deviceKey } = (await startWeb(ao, busA._id)).body;
  const first = await send(ao, trip._id, deviceKey, [fix(13.002, 20)]);
  assert.equal(first.body.accepted, 1);
  const before = (await ctx.models.Bus.findById(busA._id).lean()).lastLocation;

  const bad = await send(ao, trip._id, deviceKey, [
    fix(13.003, 600), // stale
    fix(13.003, -300), // in the future
    fix(13.003, 10, { accuracy: 900 }), // inaccurate
    fix(13.003, 30), // older than the accepted fix
    fix(13.5, 10), // ~55 km in 10 s
  ]);
  assert.equal(bad.status, 200);
  assert.equal(bad.body.accepted, 0);
  assert.deepEqual(bad.body.rejected.map((x) => x.code).sort(), ['future', 'implausible_jump', 'inaccurate', 'out_of_order', 'stale'].sort());
  assert.equal((await send(ao, trip._id, deviceKey, [{ lat: 95, lng: LNG, timestamp: Date.now(), accuracy: 5 }])).status, 422, 'latitude out of range');
  const afterBad = (await ctx.models.Bus.findById(busA._id).lean()).lastLocation;
  assert.equal(String(afterBad.at), String(before.at), 'the stored position did not move');

  await stop(ao, trip._id);
  const ended = await send(ao, trip._id, deviceKey, [fix(13.004, 1)]);
  assert.equal(ended.status, 409);
  assert.equal(ended.body.code, 'trip_not_active', 'a stopped session publishes nothing more');
});

test('live positions reach only viewers allowed to see the bus; the stop is announced', async () => {
  await clearPosition(busA);
  const sub = (s, busId) => s.timeout(3000).emitWithAck('transport:subscribe', busId);
  const viewer = await ctx.connect(student.token);
  assert.equal((await sub(viewer, busA._id)).ok, true);
  const outsider = await ctx.connect(office.token);
  assert.equal((await sub(outsider, busA._id)).ok, false, 'Office has no bus tracking');
  const hostel = await ctx.connect(hostler.token);
  assert.equal((await sub(hostel, busA._id)).ok, false, 'hostelers have no bus tracking');
  const other = await ctx.connect(principal.token);
  assert.equal((await sub(other, busB._id)).ok, true, 'subscribed to a different bus only');

  const { trip, deviceKey } = (await startWeb(dean, busA._id)).body;
  const got = nextEvent(viewer, 'bus:location', (p) => p.busId === String(busA._id));
  const quietOutsider = noEvent(outsider, 'bus:location');
  const quietHostel = noEvent(hostel, 'bus:location');
  const quietOther = noEvent(other, 'bus:location');
  await send(dean, trip._id, deviceKey, [fix(13.006, 1)]);
  const p = await got;
  assert.equal(p.lat, 13.006);
  assert.equal(p.tripId, String(trip._id));
  assert.ok(!('sharedBy' in p) && !JSON.stringify(p).includes(String(dean.u._id)), 'no personal data in the live payload');
  await Promise.all([quietOutsider, quietHostel, quietOther]);

  const ended = nextEvent(viewer, 'bus:trip', (e) => e.tripId === String(trip._id) && e.status === 'stopped');
  await stop(dean, trip._id);
  await ended;
  const bus = (await call(student, 'GET', '/transport/buses')).body.buses.find((b) => b._id === String(busA._id));
  assert.equal(bus.trip, null, 'viewers see the bus is no longer being shared');
  assert.ok(bus.location?.at, 'the last position is kept, with its time');
});
