/**
 * Automatic trips for GPS-tracker buses: a trip starts when the bus moves off,
 * ends when it stays parked, takes its direction from where it set off, is
 * paused after a manager stops it by hand, and can be switched off per bus.
 *
 * TEST DATA ONLY — synthetic coordinates on a straight north-bound line near
 * 13.000° N, 80.000° E (about 111 m per 0.001°). No real bus or GPS position.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { resetIngestState } = await import('../src/services/transport/ingest.js');

const SECRET = 'test-secret-not-real';
const LNG = 80.0;
const STOPS = [
  { name: 'Auto Stop A', lat: 13.0, lng: LNG, sequence: 1 },
  { name: 'Auto Stop B', lat: 13.01, lng: LNG, sequence: 2 },
  { name: 'Auto College', lat: 13.02, lng: LNG, sequence: 3, isCollege: true },
];
const GEOMETRY = [[LNG, 13.0], [LNG, 13.005], [LNG, 13.01], [LNG, 13.015], [LNG, 13.02]];

let ctx;
let manager;
let bus;
// Fix times advance a minute per fix, starting well in the past (old fixes are allowed below).
let clock = Date.now() - 50 * 60000;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

before(async () => {
  process.env.TRACKER_WEBHOOK_SECRET = SECRET;
  process.env.GPS_MAX_AGE_SECONDS = '3600';
  process.env.GPS_MIN_INTERVAL_MS = '0';
  ctx = await startServer();
  const u = await ctx.createUser({ role: 'transport', name: 'Transport Officer', employeeId: 'TA1' });
  manager = { u, ...(await ctx.loginWeb(u)) };
  const call = (method, path, body) => ctx.request(method, path, { token: manager.token, body });
  const route = (await call('POST', '/transport/routes', { name: 'Auto Route', code: 'AUT', stops: STOPS, geometry: GEOMETRY })).body.route;
  const res = await call('POST', '/transport/buses', { number: 'AUTO-1', route: route._id, gpsSource: 'tracker', trackerDeviceId: 'AUTO-DEVICE-1' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  bus = res.body.bus;
  assert.equal(bus.autoTrips, true, 'on by default');
});

after(async () => {
  for (const k of ['TRACKER_WEBHOOK_SECRET', 'GPS_MAX_AGE_SECONDS', 'GPS_MIN_INTERVAL_MS']) delete process.env[k];
  await ctx.stop();
});

/** Send one tracker fix at `lat`; returns the webhook answer. */
async function at(lat) {
  resetIngestState();
  clock += 60000;
  const body = JSON.stringify({ deviceId: 'AUTO-DEVICE-1', fixes: [{ lat, lng: LNG, timestamp: clock, accuracy: 5, speed: 8 }] });
  const ts = String(Date.now());
  const sig = `sha256=${crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
  const res = await fetch(`${ctx.base}/api/transport/tracker/locations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-timestamp': ts, 'x-tracker-signature': sig }, body });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.accepted, 1, JSON.stringify(json));
  return json;
}

const activeTrip = () => ctx.models.BusTrip.findOne({ bus: bus._id, status: 'active' }).lean();

test('a tracker bus starts its own trip when it moves off, towards college from a far stop', async () => {
  assert.equal((await at(13.0)).trip, 'anchored', 'first position: remembered, no trip');
  assert.equal((await at(13.003)).trip, 'waiting', '~330 m: not far enough yet');
  assert.equal(await activeTrip(), null);
  assert.equal((await at(13.006)).trip, 'started', '~660 m from where it stood');
  const trip = await activeTrip();
  assert.ok(trip.autoStarted);
  assert.equal(trip.startedBy, undefined, 'nobody started it');
  assert.equal(trip.source, 'tracker');
  assert.equal(trip.direction, 'towards_college');
  assert.equal(trip.directionAssumed, false);
  assert.ok(await ctx.models.BusStopEvent.exists({ trip: trip._id, type: 'trip_started' }), 'the start is recorded');
});

test('the trip ends by itself once the bus stays parked, and does not restart until it moves again', async () => {
  const trip = await activeTrip();
  assert.equal((await at(13.0062)).trip, 'parked', 'within the parking radius');
  // Pretend it has been standing here for 15 minutes.
  await ctx.models.BusTrip.updateOne({ _id: trip._id }, { $set: { 'parkAnchor.at': new Date(clock - 15 * 60000) } });
  assert.equal((await at(13.0063)).trip, 'ended');
  const ended = await ctx.models.BusTrip.findById(trip._id).lean();
  assert.equal(ended.status, 'completed');
  assert.match(ended.endReason, /parked/i);
  assert.equal((await at(13.0064)).trip, 'waiting', 'still parked: no new trip');
  assert.equal(await activeTrip(), null);
});

test('a manager who stops a tracker trip pauses automatic starts', async () => {
  assert.equal((await at(13.0115)).trip, 'started');
  const trip = await activeTrip();
  const stop = await ctx.request('POST', `/transport/trips/${trip._id}/stop`, { token: manager.token, body: { reason: 'stopped' } });
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.ok((await ctx.models.Bus.findById(bus._id).lean()).autoTrip.pausedUntil > new Date());
  assert.equal((await at(13.0175)).trip, 'paused', 'moved far, but paused');
  assert.equal(await activeTrip(), null);
});

test('setting off from the college means a trip towards home', async () => {
  await ctx.models.Bus.updateOne({ _id: bus._id }, { $unset: { 'autoTrip.pausedUntil': 1 }, $set: { 'autoTrip.anchor': { lat: 13.02, lng: LNG, at: new Date(clock) } } });
  assert.equal((await at(13.014)).trip, 'started');
  const trip = await activeTrip();
  assert.equal(trip.direction, 'towards_home');
  await ctx.request('POST', `/transport/trips/${trip._id}/stop`, { token: manager.token, body: {} });
});

test('automatic trips can be switched off for a bus', async () => {
  const res = await ctx.request('PUT', `/transport/buses/${bus._id}`, { token: manager.token, body: { autoTrips: false } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await ctx.models.Bus.updateOne({ _id: bus._id }, { $unset: { 'autoTrip.pausedUntil': 1 } });
  assert.equal((await at(13.0)).trip, 'off');
  assert.equal(await activeTrip(), null, 'moved 1.5 km, but no trip');
});
