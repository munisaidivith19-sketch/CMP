import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';

let ctx;
let student, bystander, security, admin;

before(async () => {
  ctx = await startServer();
  const [s1, s2, sec, adm] = await Promise.all([
    ctx.createUser({ name: 'Sender Student', department: 'CSE', section: 'A', rollNo: 'CSE201', phone: '9876543210' }),
    ctx.createUser({ name: 'Bystander Student', department: 'ECE', section: 'B', rollNo: 'ECE202' }),
    ctx.createUser({ role: 'security', name: 'Gate Security' }),
    ctx.createUser({ role: 'admin', name: 'Admin' }),
  ]);
  student = { u: s1, ...(await ctx.loginWeb(s1)) };
  bystander = { u: s2, ...(await ctx.loginWeb(s2)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  admin = { u: adm, ...(await ctx.loginWeb(adm)) };
});

after(async () => {
  await ctx.stop();
});

const raise = (who, body = {}) => ctx.request('POST', '/sos', { token: who.token, body: { type: 'medical', ...body } });

test('SOS broadcast: bystanders are alerted but never receive the sender’s phone, roll number or GPS position', async () => {
  const [bySock, secSock] = await Promise.all([ctx.connect(bystander.token), ctx.connect(security.token)]);
  const byEvt = nextEvent(bySock, 'sos:new');
  const secEvt = nextEvent(secSock, 'sos:new');
  const res = await raise(student, { note: 'Need help', location: { lat: 13.1, lng: 79.9, accuracy: 10 } });
  assert.equal(res.status, 201);

  const [toBystander, toSecurity] = await Promise.all([byEvt, secEvt]);
  // Bystanders still get what the popup shows.
  assert.equal(toBystander.type, 'medical');
  assert.equal(toBystander.triggeredBy.name, 'Sender Student');
  assert.ok(toBystander.alertId);
  // ...but no private contact / location data.
  assert.equal(toBystander.location, undefined, 'no GPS position to every campus user');
  assert.equal(toBystander.user?.phone, undefined, 'no phone number to every campus user');
  assert.equal(toBystander.user?.rollNo, undefined);
  // Responders keep the full details they need to act.
  assert.equal(toSecurity.location.lat, 13.1);
  assert.equal(toSecurity.user.phone, '9876543210');
});

test('SOS: input validation — out-of-range GPS, non-string resolution note, injected list filter', async () => {
  assert.equal((await raise(bystander, { location: { lat: 999, lng: 79.9 } })).status, 422);
  assert.equal((await raise(bystander, { location: { lat: 13, lng: -500 } })).status, 422);

  const created = await raise(bystander);
  assert.equal(created.status, 201);
  const arrNote = await ctx.request('PATCH', `/sos/${created.body._id}/resolve`, {
    token: security.token,
    body: { resolutionNote: ['a', 'b'] },
  });
  assert.equal(arrNote.status, 422, 'array note is a validation error, not a server crash');

  const injected = await ctx.request('GET', '/sos?type[$ne]=x', { token: security.token });
  assert.equal(injected.status, 422, 'operator objects in the type filter are rejected');
  const badType = await ctx.request('GET', '/sos?type=not_a_type', { token: security.token });
  assert.equal(badType.status, 422);
});

test('SOS: a closed alert cannot be re-acknowledged or re-resolved over the original record', async () => {
  const created = await raise(bystander);
  const resolved = await ctx.request('PATCH', `/sos/${created.body._id}/resolve`, {
    token: security.token,
    body: { status: 'resolved', resolutionNote: 'Handled by security' },
  });
  assert.equal(resolved.status, 200);

  const reAck = await ctx.request('PATCH', `/sos/${created.body._id}/ack`, { token: admin.token });
  assert.equal(reAck.status, 409);
  const reResolve = await ctx.request('PATCH', `/sos/${created.body._id}/resolve`, {
    token: admin.token,
    body: { status: 'false_alarm', resolutionNote: 'Overwrite' },
  });
  assert.equal(reResolve.status, 409);

  const stored = await ctx.models.SOSAlert.findById(created.body._id).lean();
  assert.equal(stored.status, 'resolved');
  assert.equal(stored.resolutionNote, 'Handled by security');
  assert.equal(String(stored.resolvedBy), String(security.u._id));
});

test('SOS: one account cannot flood the whole campus with alerts', async () => {
  const spammer = await ctx.createUser({ name: 'Spammer', department: 'CSE', section: 'C', rollNo: 'CSE299' });
  const s = await ctx.loginWeb(spammer);
  const statuses = [];
  for (let i = 0; i < 8; i += 1) statuses.push((await raise(s)).status);
  assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201], 'genuine repeated alerts still go through');
  assert.ok(statuses.slice(5).every((c) => c === 429), `later alerts are throttled: ${statuses}`);
  assert.equal(await ctx.models.SOSAlert.countDocuments({ user: spammer._id }), 5);
});
