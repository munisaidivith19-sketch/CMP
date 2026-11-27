/**
 * "Test tracker" (GET /transport/tracker-status): connection off, no data yet,
 * data arriving before the device is linked, live once linked, refused
 * positions, a device used by another bus, and managers only.
 *
 * TEST DATA ONLY — synthetic coordinates near 13.000° N, 80.000° E.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { resetIngestState } = await import('../src/services/transport/ingest.js');

const SECRET = 'test-secret-not-real';
let ctx;
let manager;
let student;
let busA;
let busB;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  resetIngestState();
});

before(async () => {
  ctx = await startServer();
  const m = await ctx.createUser({ role: 'transport', name: 'Transport Officer', employeeId: 'TT1' });
  manager = { u: m, ...(await ctx.loginWeb(m)) };
  const s = await ctx.createUser({ name: 'Rider', department: 'CSE', section: 'A', semester: 5, rollNo: 'TT-R1', stayType: 'day_scholar' });
  student = { u: s, ...(await ctx.loginWeb(s)) };
  const stops = [{ name: 'T Stop A', lat: 13.0, lng: 80.0, sequence: 1 }, { name: 'T College', lat: 13.02, lng: 80.0, sequence: 2, isCollege: true }];
  const route = (await ctx.request('POST', '/transport/routes', { token: manager.token, body: { name: 'Tracker Test Route', stops } })).body.route;
  busA = (await ctx.request('POST', '/transport/buses', { token: manager.token, body: { number: 'TT-1', route: route._id, gpsSource: 'tracker' } })).body.bus;
  busB = (await ctx.request('POST', '/transport/buses', { token: manager.token, body: { number: 'TT-2', route: route._id, gpsSource: 'tracker', trackerDeviceId: 'TT-OTHER' } })).body.bus;
});

after(async () => {
  delete process.env.TRACKER_WEBHOOK_SECRET;
  await ctx.stop();
});

const status = (deviceId, busId = busA._id, who = manager) =>
  ctx.request('GET', `/transport/tracker-status?deviceId=${encodeURIComponent(deviceId)}${busId ? `&busId=${busId}` : ''}`, { token: who.token });

async function send(deviceId, fix) {
  const body = JSON.stringify({ deviceId, fixes: [fix] });
  const ts = String(Date.now());
  const sig = `sha256=${crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex')}`;
  return fetch(`${ctx.base}/api/transport/tracker/locations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-timestamp': ts, 'x-tracker-signature': sig }, body });
}

test('only transport managers can test a tracker', async () => {
  assert.equal((await status('ANY', busA._id, student)).status, 403);
  assert.equal((await ctx.request('GET', '/transport/tracker-status', { token: manager.token })).status, 422, 'device ID required');
});

test('connection off → "disabled"; on but silent → "never"', async () => {
  delete process.env.TRACKER_WEBHOOK_SECRET;
  assert.equal((await status('TT-NEW')).body.status, 'disabled');
  process.env.TRACKER_WEBHOOK_SECRET = SECRET;
  const res = await status('TT-NEW');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'never');
  assert.equal(res.body.lastSeenAt, null);
});

test('data arriving before the device is linked → "unlinked"; after saving the bus → "live"', async () => {
  const fix = { lat: 13.0, lng: 80.0, timestamp: Date.now(), accuracy: 5, speed: 0 };
  assert.equal((await send('TT-NEW', fix)).status, 404, 'not linked yet');
  const before = (await status('TT-NEW')).body;
  assert.equal(before.status, 'unlinked');
  assert.ok(before.lastSeenAt);
  assert.match(before.message, /not linked to a bus yet/);

  assert.equal((await ctx.request('PUT', `/transport/buses/${busA._id}`, { token: manager.token, body: { trackerDeviceId: 'TT-NEW' } })).status, 200);
  assert.equal((await send('TT-NEW', { ...fix, timestamp: Date.now() })).status, 200);
  const live = (await status('TT-NEW')).body;
  assert.equal(live.status, 'live', JSON.stringify(live));
  assert.equal(live.bus.number, 'TT-1');
  assert.equal(live.location.lat, 13.0);
  assert.equal(live.accepted, 1);

  const list = (await ctx.request('GET', '/transport/buses', { token: manager.token })).body.buses;
  assert.equal(list.find((b) => b.number === 'TT-1').tracking, 'live', 'the bus list shows it live too');
});

test('refused positions are explained', async () => {
  await ctx.models.Bus.updateOne({ _id: busA._id }, { $unset: { lastLocation: 1 } });
  const res = await send('TT-NEW', { lat: 13.0, lng: 80.0, timestamp: Date.now() - 60 * 60000, accuracy: 5 });
  assert.equal(res.status, 200);
  const body = (await status('TT-NEW')).body;
  assert.equal(body.status, 'rejected', JSON.stringify(body));
  assert.ok(body.lastRejects.length >= 1);
});

test('a device ID already on another bus is flagged', async () => {
  const res = (await status('TT-OTHER', busA._id)).body;
  assert.equal(res.status, 'other_bus');
  assert.match(res.message, /TT-2/);
  assert.notEqual((await status('TT-OTHER', busB._id)).body.status, 'other_bus', 'its own bus is fine');
});
