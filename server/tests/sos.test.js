import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';

let ctx;
let student;
let otherStudent;
let security;
let admin;
let hod;
let faculty;

before(async () => {
  ctx = await startServer();
  const [s1, s2, sec, adm, h, fac] = await Promise.all([
    ctx.createUser({ name: 'Rahul Sharma', department: 'CSE', section: 'A', rollNo: 'CSE101' }),
    ctx.createUser({ name: 'Priya Patel', department: 'ECE', section: 'B', rollNo: 'ECE102' }),
    ctx.createUser({ role: 'security', name: 'Campus Security Office' }),
    ctx.createUser({ role: 'admin', name: 'Super Admin' }),
    ctx.createUser({ role: 'hod', name: 'HOD CSE', department: 'CSE' }),
    ctx.createUser({ role: 'faculty', name: 'Prof. Anitha', department: 'CSE' }),
  ]);

  student = { u: s1, ...(await ctx.loginWeb(s1)) };
  otherStudent = { u: s2, ...(await ctx.loginWeb(s2)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  admin = { u: adm, ...(await ctx.loginWeb(adm)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  faculty = { u: fac, ...(await ctx.loginWeb(fac)) };
});

after(async () => {
  await ctx.stop();
});

test('Campus SOS: non-responders get 403 on list, ack, resolve', async () => {
  const forbiddenList = await ctx.request('GET', '/sos', { token: student.token });
  assert.equal(forbiddenList.status, 403);

  const fakeId = '507f1f77bcf86cd799439011';
  const forbiddenAck = await ctx.request('PATCH', `/sos/${fakeId}/ack`, { token: student.token });
  assert.equal(forbiddenAck.status, 403);

  const forbiddenResolve = await ctx.request('PATCH', `/sos/${fakeId}/resolve`, {
    token: faculty.token,
    body: { status: 'resolved', resolutionNote: 'Attempted resolution' },
  });
  assert.equal(forbiddenResolve.status, 403);
});

test('Campus SOS: validations - invalid type, missing resolution note, unknown alert id', async () => {
  // Invalid type
  const badType = await ctx.request('POST', '/sos', {
    token: student.token,
    body: { type: 'invalid_emergency_type', note: 'Testing invalid' },
  });
  assert.ok([400, 422].includes(badType.status), 'Should return validation error status 400 or 422');

  // Missing note when resolving an existing alert
  const tempAlert = await ctx.request('POST', '/sos', {
    token: student.token,
    body: { type: 'other', note: 'Need help' },
  });
  assert.equal(tempAlert.status, 201);
  const noNote = await ctx.request('PATCH', `/sos/${tempAlert.body._id}/resolve`, {
    token: security.token,
    body: { status: 'resolved', resolutionNote: '   ' },
  });
  assert.equal(noNote.status, 400);

  const fakeId = '507f1f77bcf86cd799439011';

  // Unknown id with valid body
  const notFound = await ctx.request('PATCH', `/sos/${fakeId}/resolve`, {
    token: security.token,
    body: { status: 'resolved', resolutionNote: 'Handled situation' },
  });
  assert.equal(notFound.status, 404);
});

test('Campus SOS: student creates alert, notifications persisted, responders see, ack, and resolve', async () => {
  // Connect a socket for responder to test real-time broadcast
  const secSocket = await ctx.connect(security.token);
  const sosNewPromise = nextEvent(secSocket, 'sos:new');

  const created = await ctx.request('POST', '/sos', {
    token: student.token,
    body: {
      type: 'medical',
      note: 'Injured ankle near sports ground',
      location: { lat: 12.9716, lng: 77.5946, accuracy: 5 },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'active');
  assert.equal(created.body.type, 'medical');
  assert.equal(created.body.note, 'Injured ankle near sports ground');
  assert.equal(created.body.user.name, 'Rahul Sharma');
  assert.equal(created.body.department, 'CSE');
  assert.equal(created.body.section, 'A');

  const alertId = created.body._id;

  // Check socket event
  const receivedNew = await sosNewPromise;
  assert.equal(receivedNew.alertId, alertId);
  assert.equal(receivedNew.triggeredBy.name, 'Rahul Sharma');

  // Verify Notification row with type 'sos' exists for other users (guards §14 #1)
  const Notification = ctx.models.Notification;
  const notifs = await Notification.find({ type: 'sos', user: otherStudent.u._id });
  assert.ok(notifs.length > 0, 'Notification with type "sos" must be persisted');
  assert.match(notifs[0].title, /Campus SOS: MEDICAL/i);

  // Responder lists alerts
  const list = await ctx.request('GET', '/sos', { token: security.token });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.items));
  assert.ok(list.body.items.some((i) => i._id === alertId));

  // Filter by status and type
  const filteredList = await ctx.request('GET', '/sos?status=active&type=medical', { token: hod.token });
  assert.equal(filteredList.status, 200);
  assert.ok(filteredList.body.items.some((i) => i._id === alertId));

  // Responder acknowledges alert
  const sosUpdatedPromise1 = nextEvent(secSocket, 'sos:updated');
  const ack = await ctx.request('PATCH', `/sos/${alertId}/ack`, { token: security.token });
  assert.equal(ack.status, 200);
  assert.equal(ack.body.status, 'acknowledged');
  assert.equal(ack.body.acknowledgedBy.role, 'security');

  const ackEvent = await sosUpdatedPromise1;
  assert.equal(ackEvent._id, alertId);
  assert.equal(ackEvent.status, 'acknowledged');

  // Notification sent to sender on ack
  const senderAckNotif = await Notification.findOne({ type: 'sos', user: student.u._id });
  assert.ok(senderAckNotif, 'Sender should receive acknowledgement notification');
  assert.equal(senderAckNotif.title, 'SOS alert acknowledged');

  // Responder resolves alert
  const sosUpdatedPromise2 = nextEvent(secSocket, 'sos:updated');
  const res = await ctx.request('PATCH', `/sos/${alertId}/resolve`, {
    token: admin.token,
    body: { status: 'resolved', resolutionNote: 'First aid team dispatched and student assisted.' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'resolved');
  assert.equal(res.body.resolutionNote, 'First aid team dispatched and student assisted.');
  assert.equal(res.body.resolvedBy.role, 'admin');

  const resEvent = await sosUpdatedPromise2;
  assert.equal(resEvent._id, alertId);
  assert.equal(resEvent.status, 'resolved');

  // Notification sent to sender on resolve
  const senderResolveNotifs = await Notification.find({ type: 'sos', user: student.u._id }).sort({ createdAt: -1 });
  assert.ok(senderResolveNotifs.length >= 2);
  assert.equal(senderResolveNotifs[0].title, 'SOS alert resolved');
  assert.equal(senderResolveNotifs[0].message, 'First aid team dispatched and student assisted.');

  secSocket.disconnect();
});

test('Campus SOS: fire alert sets fire title, and false_alarm outcome works', async () => {
  const Notification = ctx.models.Notification;

  const fireAlert = await ctx.request('POST', '/sos', {
    token: student.token,
    body: { type: 'fire', note: 'Smoke in chemistry lab' },
  });
  assert.equal(fireAlert.status, 201);
  assert.equal(fireAlert.body.type, 'fire');

  const fireNotif = await Notification.findOne({ type: 'sos', user: otherStudent.u._id, title: '🚨 FIRE EMERGENCY ALERT' });
  assert.ok(fireNotif, 'Fire alert must send 🚨 FIRE EMERGENCY ALERT notification');

  // Close as false alarm
  const closed = await ctx.request('PATCH', `/sos/${fireAlert.body._id}/resolve`, {
    token: security.token,
    body: { status: 'false_alarm', resolutionNote: 'Inspection showed vapor from hot kettle, no fire hazard.' },
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, 'false_alarm');
});
