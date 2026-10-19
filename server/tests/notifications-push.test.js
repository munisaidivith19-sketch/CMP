/**
 * Notifications: Android device tokens (FCM), the central notify service
 * (preferences, de-duplication, store-before-push, delivery status, invalid
 * tokens), next-period reminders and student campus-entry targeting.
 *
 * FCM itself is never contacted: Google's OAuth and FCM endpoints are stubbed
 * on globalThis.fetch; every other request (the test client) passes through.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { clock } = await import('../src/utils/clock.js');
const { notifyUsers } = await import('../src/utils/notify.js');
const { resetFcmForTests } = await import('../src/services/fcm.js');
const { runReminderTick } = await import('../src/services/reminders.js');
const { notifyReturned } = await import('../src/services/gatePassReturn.js');

const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const realNow = clock.now;
const realFetch = globalThis.fetch;

// ── FCM stub ──
const fcm = { sent: [], mode: 'ok' };
function stubFcm() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/')) return new Response(JSON.stringify({ access_token: 'test-access', expires_in: 3600 }), { status: 200 });
    if (u.startsWith('https://fcm.googleapis.com/')) {
      const msg = JSON.parse(opts.body).message;
      fcm.sent.push(msg);
      if (fcm.mode === 'unregistered') return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
      if (fcm.mode === 'down') return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ name: 'projects/x/messages/1' }), { status: 200 });
    }
    if (u.startsWith('https://exp.host/')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return realFetch(url, opts);
  };
}

let ctx;
let admin, fac, fac2, other, student, hod;
const TOKEN_A = `fcm-token-a:${'x'.repeat(40)}`;
const TOKEN_B = `fcm-token-b:${'y'.repeat(40)}`;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  fcm.sent = [];
  fcm.mode = 'ok';
});

before(async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FCM_SERVICE_ACCOUNT = Buffer.from(
    JSON.stringify({ project_id: 'vexon-test', client_email: 'push@vexon-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' })
  ).toString('base64');
  resetFcmForTests();
  stubFcm();
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'faculty', name: 'Fac', department: 'CSE', employeeId: 'F1', section: 'A', inChargeYear: 3, inChargeSemester: 5 }),
    mk({ role: 'faculty', name: 'Fac Two', department: 'CSE', employeeId: 'F2' }),
    mk({ role: 'faculty', name: 'Other Dept', department: 'ECE', employeeId: 'F3' }),
    mk({ name: 'Stu', department: 'CSE', section: 'A', semester: 5, rollNo: 'R1' }),
    mk({ role: 'hod', name: 'HOD', department: 'CSE', employeeId: 'H1' }),
  ]);
  admin = { u: users[0], ...(await ctx.loginWeb(users[0])) };
  fac = { u: users[1], ...(await ctx.loginMobile(users[1])) };
  fac2 = { u: users[2], ...(await ctx.loginMobile(users[2])) };
  other = { u: users[3], ...(await ctx.loginMobile(users[3])) };
  student = { u: users[4], ...(await ctx.loginMobile(users[4])) };
  hod = { u: users[5], ...(await ctx.loginWeb(users[5])) };
});
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.FCM_SERVICE_ACCOUNT;
  resetFcmForTests();
  clock.now = realNow;
  await ctx.stop();
});

const register = (actor, token) => ctx.request('POST', '/devices', { token: actor.token, body: { token, deviceName: 'Pixel 8' }, headers: { 'x-client-platform': 'mobile' } });
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// ── Device tokens ──

test('device registration needs a signed-in user and binds the token to that account only', async () => {
  assert.equal((await ctx.request('POST', '/devices', { body: { token: TOKEN_A } })).status, 401);
  assert.equal((await register(fac, 'bad token with spaces')).status, 422);
  assert.equal((await register(fac, TOKEN_A)).status, 200);
  const row = await ctx.models.DeviceToken.findOne({ token: TOKEN_A }).lean();
  assert.equal(String(row.user), String(fac.u._id));
  assert.equal(String(row.session), String((await ctx.models.Session.findOne({ user: fac.u._id }).lean())._id));

  // The same phone signs in as someone else: the token moves to THAT account (never chosen by the client).
  assert.equal((await register(fac2, TOKEN_A)).status, 200);
  assert.equal(String((await ctx.models.DeviceToken.findOne({ token: TOKEN_A }).lean()).user), String(fac2.u._id));
  assert.equal(await ctx.models.DeviceToken.countDocuments({ token: TOKEN_A }), 1);

  // Removing only ever touches the caller's own token.
  assert.equal((await ctx.request('DELETE', '/devices', { token: fac.token, body: { token: TOKEN_A }, headers: { 'x-client-platform': 'mobile' } })).status, 200);
  assert.equal(await ctx.models.DeviceToken.countDocuments({ token: TOKEN_A }), 1, 'fac cannot remove fac2’s device');
  await register(fac, TOKEN_A);
});

test('signing out stops pushes to that device', async () => {
  const s = await ctx.createUser({ role: 'faculty', name: 'Leaver', department: 'CSE', employeeId: 'F9' });
  const m = await ctx.loginMobile(s);
  await ctx.request('POST', '/devices', { token: m.token, body: { token: TOKEN_B }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(await ctx.models.DeviceToken.countDocuments({ token: TOKEN_B }), 1);
  const out = await ctx.request('POST', '/auth/logout', { body: { refreshToken: m.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(out.status, 200);
  assert.equal(await ctx.models.DeviceToken.countDocuments({ token: TOKEN_B }), 0);
});

// ── Central notify service ──

test('a notification is stored, then pushed; delivery status is recorded', async () => {
  const docs = await notifyUsers([fac.u._id], { type: 'attendance', title: 'Hello', message: 'Body', link: '/attendance' }, { category: 'staff' });
  assert.equal(docs.length, 1);
  await wait();
  const n = await ctx.models.Notification.findById(docs[0]._id).lean();
  assert.equal(n.delivery.status, 'sent');
  assert.equal(n.delivery.devices, 1);
  const msg = fcm.sent.find((m) => m.token === TOKEN_A);
  assert.ok(msg, 'pushed over FCM');
  assert.equal(msg.data.link, '/attendance');
  assert.equal(msg.data.category, 'staff');
  assert.equal(msg.android.priority, 'NORMAL', 'not every notification is high priority');
  assert.ok(!('notification' in msg), 'data-only: the app controls lock-screen visibility');
});

test('push failure never loses the notification; invalid tokens are removed', async () => {
  fcm.mode = 'down';
  const [down] = await notifyUsers([fac.u._id], { title: 'During outage', message: 'x' });
  await wait(2500);
  assert.equal((await ctx.models.Notification.findById(down._id).lean()).delivery.status, 'failed');
  assert.ok(await ctx.models.Notification.exists({ _id: down._id }), 'history kept');

  fcm.mode = 'unregistered';
  const [dead] = await notifyUsers([fac.u._id], { title: 'Uninstalled', message: 'y' });
  await wait();
  assert.equal(await ctx.models.DeviceToken.countDocuments({ user: fac.u._id }), 0, 'token cleaned up');
  assert.ok(await ctx.models.Notification.exists({ _id: dead._id }));
  fcm.mode = 'ok';
  await register(fac, TOKEN_A);
});

test('the same event never creates a second notification', async () => {
  const opts = { category: 'staff', eventKey: 'test:event:1' };
  const first = await notifyUsers([fac.u._id, fac2.u._id], { title: 'Once', message: 'only' }, opts);
  const again = await notifyUsers([fac.u._id, fac2.u._id], { title: 'Once', message: 'only' }, opts);
  assert.equal(first.length, 2);
  assert.equal(again.length, 0);
  assert.equal(await ctx.models.Notification.countDocuments({ eventKey: 'test:event:1' }), 2);
});

test('preferences switch off optional categories only', async () => {
  const put = await ctx.request('PUT', '/notifications/preferences', { token: fac2.token, body: { disabled: ['chat', 'student_entry', 'gate_pass', 'sos'], reminderMinutes: 15 }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.disabled.sort(), ['chat', 'student_entry'], 'safety and duty categories cannot be switched off');
  assert.equal(put.body.reminderMinutes, 15);
  const none = await notifyUsers([fac2.u._id], { title: 'Entry', message: 'x' }, { category: 'student_entry' });
  assert.equal(none.length, 0);
  const sos = await notifyUsers([fac2.u._id], { type: 'sos', title: 'SOS', message: 'x' });
  assert.equal(sos.length, 1, 'SOS always arrives');
  assert.equal((await ctx.request('PUT', '/notifications/preferences', { token: fac2.token, body: { reminderMinutes: 7 }, headers: { 'x-client-platform': 'mobile' } })).status, 422);
});

test('notification history is paginated and read status is tracked', async () => {
  const list = await ctx.request('GET', '/notifications?limit=2', { token: fac.token, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  assert.ok(list.body.unread >= 2);
  assert.ok(!('eventKey' in list.body.items[0]));
  const id = list.body.items[0]._id;
  await ctx.request('PATCH', `/notifications/${id}/read`, { token: fac.token, headers: { 'x-client-platform': 'mobile' } });
  const n = await ctx.models.Notification.findById(id).lean();
  assert.equal(n.read, true);
  assert.ok(n.readAt);
});

// ── Role-targeted events ──

test('a student’s campus entry reaches only their class faculty', async () => {
  const subject = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS503', department: 'CSE', semester: 5 });
  await ctx.models.TimetableSlot.create({ subject: subject._id, faculty: fac.u._id, section: 'A', department: 'CSE', dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50', semester: 5, year: 3 });
  const pass = { _id: new ctx.models.User().id };
  await notifyReturned({ pass, student: student.u.toObject ? student.u.toObject() : student.u, returnedAt: new Date() });
  const got = await ctx.models.Notification.find({ eventKey: `returned:${pass._id}` }).distinct('user');
  const ids = got.map(String);
  assert.ok(ids.includes(String(fac.u._id)), 'their class faculty');
  assert.ok(!ids.includes(String(other.u._id)), 'not another department');
  assert.ok(!ids.includes(String(fac2.u._id)), 'not faculty who switched entry notices off / do not teach them');
});

test('next-period reminders: at the preferred lead time, once, to the substitute when one is assigned', async () => {
  const subject = await ctx.models.Subject.findOne({ code: 'CS503' });
  const s2 = await ctx.models.TimetableSlot.create({ subject: subject._id, faculty: fac.u._id, section: 'A', department: 'CSE', dayOfWeek: 'monday', period: 2, startTime: '10:00', endTime: '10:50', semester: 5, year: 3, room: 'LH-301' });
  const reminders = () => ctx.models.Notification.find({ category: 'reminder' }).lean();

  // 08:45 → P1 at 09:00 is 15 min away: fac's default lead is 10 min, so nothing yet.
  await runReminderTick(at('2026-10-19', '08:45'));
  assert.equal((await reminders()).length, 0);
  await runReminderTick(at('2026-10-19', '08:51'));
  let rs = await reminders();
  assert.equal(rs.length, 1);
  assert.match(rs[0].message, /P1 · CS503 – DBMS · CSE Year 3 Sec A · 9:00 AM/);
  await runReminderTick(at('2026-10-19', '08:55'));
  assert.equal((await reminders()).length, 1, 'once per period');

  // P2 is covered by Fac Two (15-minute preference) — they get it, not fac.
  await ctx.models.PeriodCover.create({ date: new Date('2026-10-19T00:00:00Z'), timetableSlot: s2._id, startTime: '10:00', endTime: '10:50', department: 'CSE', year: 3, section: 'A', originalFaculty: fac.u._id, kind: 'substitute', substitute: fac2.u._id, assignedBy: hod.u._id });
  await runReminderTick(at('2026-10-19', '09:46'));
  rs = await reminders();
  const p2 = rs.filter((r) => /P2/.test(r.message));
  assert.equal(p2.length, 1);
  assert.equal(String(p2[0].user), String(fac2.u._id));
  assert.match(p2[0].title, /Substitute class in 14 min/);
  assert.match(p2[0].message, /LH-301/);
  await wait();
  assert.ok(fcm.sent.some((m) => m.data.category === 'reminder' && m.android.priority === 'HIGH'), 'reminders are heads-up');
});
