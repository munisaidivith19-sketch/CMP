import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';

let ctx;
let staff;
let student; // Android
let other;
let studentSocket;
let staffSocket;

const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

before(async () => {
  ctx = await startServer();
  const [f, s, o] = await Promise.all([
    ctx.createUser({ role: 'faculty', name: 'Warden' }),
    ctx.createUser({ name: 'Gate Student', rollNo: 'R1' }),
    ctx.createUser({ name: 'Other Student' }),
  ]);
  staff = { u: f, ...(await ctx.loginWeb(f)) };
  student = { u: s, ...(await ctx.loginMobile(s)) };
  other = { u: o, ...(await ctx.loginWeb(o)) };
  studentSocket = await ctx.connect(student.token);
  staffSocket = await ctx.connect(staff.token);
});
after(async () => {
  await ctx.stop();
});

// ── Gate pass ─────────────────────────────────────────────────────

let passId;
let code;

test('gate pass: request → staff sees it live; staff cannot request; one open pass at a time', async () => {
  const body = { reason: 'medical', description: 'Dentist appointment', destination: 'City clinic', expectedExit: inMinutes(10), expectedReturn: inMinutes(180) };
  assert.equal((await ctx.request('POST', '/gate-pass', { token: staff.token, body })).status, 403);
  const bad = await ctx.request('POST', '/gate-pass', { token: student.token, body: { ...body, expectedReturn: inMinutes(5) } });
  assert.equal(bad.status, 422);

  const live = nextEvent(staffSocket, 'gatepass:updated', (p) => p.status === 'pending');
  const res = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  assert.equal(res.status, 201);
  passId = res.body._id;
  assert.equal(res.body.verificationCode, undefined, 'no code before approval');
  await live;
  assert.equal((await ctx.request('POST', '/gate-pass', { token: student.token, body })).status, 409);
});

test('gate pass: approval issues a hidden, owner-only QR code and notifies the student live', async () => {
  const live = nextEvent(studentSocket, 'gatepass:updated', (p) => p.status === 'approved');
  const r = await ctx.request('PATCH', `/gate-pass/${passId}/review`, { token: staff.token, body: { action: 'approved' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.verificationCode, undefined, 'code never leaks in staff responses');
  await live;

  const list = await ctx.request('GET', '/gate-pass', { token: staff.token });
  assert.ok(list.body.passes.every((p) => p.verificationCode === undefined));

  assert.equal((await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: other.token })).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: staff.token })).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${passId}`, { token: other.token })).status, 403);

  const qr = await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: student.token });
  assert.equal(qr.status, 200);
  code = qr.body.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.ok(qr.body.qr.startsWith('data:image/png;base64,'));
  assert.equal(qr.body.payload, `CCGP:${code}`, 'QR holds only the opaque code');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/review`, { token: staff.token, body: { action: 'rejected' } })).status, 422);
});

test('gate pass: verify → exit → return; the code is consumed after return', async () => {
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: student.token, body: { code } })).status, 403);
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: staff.token, body: { code: 'AAAAAAAAAAAA' } })).status, 404);

  const v = await ctx.request('POST', '/gate-pass/verify', { token: staff.token, body: { code: `CCGP:${code.toLowerCase()}` } });
  assert.equal(v.status, 200);
  assert.equal(v.body.valid, true);
  assert.equal(v.body.nextAction, 'exit');
  assert.equal(v.body.pass.student.name, 'Gate Student');

  const out = nextEvent(studentSocket, 'gatepass:updated', (p) => p.status === 'active');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/exit`, { token: staff.token })).status, 200);
  await out;
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/exit`, { token: staff.token })).status, 422, 'exit is single-use');
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: staff.token, body: { code } })).body.nextAction, 'return');

  const dash = await ctx.request('GET', '/gate-pass/dashboard', { token: staff.token });
  assert.equal(dash.body.studentsOutside, 1);

  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/return`, { token: staff.token })).status, 200);
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: staff.token, body: { code } })).status, 404, 'code consumed');
  const done = await ctx.request('GET', `/gate-pass/${passId}`, { token: student.token });
  assert.equal(done.body.status, 'completed');
  assert.ok(done.body.actualExit && done.body.actualReturn && done.body.approvedAt);
});

test('gate pass: student can cancel; staff can revoke; expired passes are swept', async () => {
  const body = { reason: 'outing', description: 'Market visit', expectedExit: inMinutes(30), expectedReturn: inMinutes(120) };
  const p1 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p1.body._id}/cancel`, { token: other.token })).status, 404);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p1.body._id}/cancel`, { token: student.token })).body.status, 'cancelled');

  const p2 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  await ctx.request('PATCH', `/gate-pass/${p2.body._id}/review`, { token: staff.token, body: { action: 'approved' } });
  const qr = await ctx.request('GET', `/gate-pass/${p2.body._id}/qr`, { token: student.token });
  const rv = await ctx.request('PATCH', `/gate-pass/${p2.body._id}/revoke`, { token: staff.token, body: { reason: 'Campus lockdown' } });
  assert.equal(rv.body.status, 'revoked');
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: staff.token, body: { code: qr.body.code } })).status, 404, 'revoked code is dead');

  // An approved pass whose window closed becomes expired.
  const p3 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  await ctx.request('PATCH', `/gate-pass/${p3.body._id}/review`, { token: staff.token, body: { action: 'approved' } });
  await ctx.models.GatePass.updateOne({ _id: p3.body._id }, { verificationExpiry: new Date(Date.now() - 1000) });
  const { expireGatePasses } = await import('../src/controllers/gatePassController.js');
  assert.equal(await expireGatePasses(), 1);
  assert.equal((await ctx.request('GET', `/gate-pass/${p3.body._id}`, { token: student.token })).body.status, 'expired');
});

// ── Lost & found ──────────────────────────────────────────────────

let lostId;
let foundId;

test('lost & found: contact details only for the reporter and staff', async () => {
  const lost = await ctx.request('POST', '/lost-found', {
    token: student.token,
    body: { type: 'lost', itemName: 'Blue HP laptop charger', category: 'electronics', location: 'Library second floor', dateTime: inMinutes(-120), contactMethod: 'phone' },
  });
  assert.equal(lost.status, 201);
  lostId = lost.body._id;

  const asOther = await ctx.request('GET', `/lost-found/${lostId}`, { token: other.token });
  assert.equal(asOther.body.contactMethod, undefined);
  assert.equal(asOther.body.reporter.email, undefined);
  const asOwner = await ctx.request('GET', `/lost-found/${lostId}`, { token: student.token });
  assert.equal(asOwner.body.contactMethod, 'phone');
  const asStaff = await ctx.request('GET', `/lost-found/${lostId}`, { token: staff.token });
  assert.ok(asStaff.body.reporter.email);

  const bad = await ctx.request('POST', '/lost-found', {
    token: other.token,
    body: { type: 'found', itemName: 'x', category: 'weapons', location: 'y', dateTime: 'nope', photo: 'javascript:alert(1)' },
  });
  assert.equal(bad.status, 422);
});

test('lost & found: possible matches are suggestions; only staff link and resolve them', async () => {
  const live = nextEvent(studentSocket, 'lostfound:updated', (p) => p.type === 'found');
  const found = await ctx.request('POST', '/lost-found', {
    token: other.token,
    body: { type: 'found', itemName: 'Laptop charger (HP)', category: 'electronics', location: 'Library reading hall', dateTime: inMinutes(-60) },
  });
  foundId = found.body._id;
  await live;

  const matches = await ctx.request('GET', `/lost-found/${lostId}/matches`, { token: student.token });
  assert.equal(matches.status, 200);
  assert.equal(matches.body[0]._id, foundId);
  assert.ok(matches.body[0].matchReasons.length > 0);
  assert.equal(matches.body[0].status, 'found', 'suggesting a match does not change ownership');
  assert.equal((await ctx.request('GET', `/lost-found/${lostId}/matches`, { token: other.token })).status, 403);

  assert.equal((await ctx.request('PATCH', `/lost-found/${lostId}/status`, { token: student.token, body: { status: 'returned' } })).status, 403);
  const link = await ctx.request('PATCH', `/lost-found/${lostId}/status`, { token: staff.token, body: { status: 'possible_match', matchedWith: foundId } });
  assert.equal(link.status, 200);
  const counterpart = await ctx.request('GET', `/lost-found/${foundId}`, { token: other.token });
  assert.equal(counterpart.body.status, 'possible_match');
  assert.equal(String(counterpart.body.matchedWith._id), lostId);

  const returned = await ctx.request('PATCH', `/lost-found/${lostId}/status`, { token: staff.token, body: { status: 'returned', resolutionNote: 'ID verified' } });
  assert.equal(returned.body.status, 'returned');
  assert.equal((await ctx.request('GET', `/lost-found/${foundId}`, { token: other.token })).body.status, 'returned');
});

test('lost & found: owners can close or withdraw their own open reports only', async () => {
  const r = await ctx.request('POST', '/lost-found', {
    token: other.token,
    body: { type: 'lost', itemName: 'Water bottle', category: 'other', location: 'Gym', dateTime: inMinutes(-30) },
  });
  assert.equal((await ctx.request('DELETE', `/lost-found/${r.body._id}`, { token: student.token })).status, 403);
  assert.equal((await ctx.request('PATCH', `/lost-found/${r.body._id}/status`, { token: other.token, body: { status: 'closed' } })).body.status, 'closed');
  const list = await ctx.request('GET', '/lost-found?mine=true', { token: other.token });
  assert.ok(list.body.items.every((i) => i.isMine));
  assert.ok(list.body.summary);
});

// ── Live signals for the existing features ────────────────────────

test('existing features: new announcement / event changes reach every connected client', async () => {
  const admin = await ctx.createUser({ role: 'admin' });
  const a = await ctx.loginWeb(admin);
  const ann = nextEvent(studentSocket, 'announcement:changed', (p) => p.action === 'created');
  const note = nextEvent(studentSocket, 'notification', (n) => n.type === 'announcement');
  const res = await ctx.request('POST', '/announcements', { token: a.token, body: { title: 'Holiday on Friday', content: 'Campus closed for the festival.' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await ann;
  await note;

  const ev = nextEvent(studentSocket, 'event:changed', (p) => p.action === 'created');
  const e = await ctx.request('POST', '/events', {
    token: a.token,
    body: { title: 'Tech talk', description: 'A talk about compilers.', venue: 'Auditorium', startDate: inMinutes(60 * 24), endDate: inMinutes(60 * 26) },
  });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  await ev;
  const reg = nextEvent(staffSocket, 'event:changed', (p) => p.id === e.body._id);
  await ctx.request('POST', `/events/${e.body._id}/register`, { token: student.token });
  await reg;
});
