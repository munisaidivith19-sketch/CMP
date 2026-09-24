import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';

let ctx;
let staff; // faculty, class in-charge of CSE-A
let student; // Android — CSE-A
let student2; // CSE-A — used only where a second, independent request is needed
let other;
let hod;
let principal;
let security;
let outsiderFaculty; // different section — must not be able to act
let studentSocket;
let staffSocket;

const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

before(async () => {
  ctx = await startServer();
  const [f, s, s2, o, h, p, sec, of] = await Promise.all([
    ctx.createUser({ role: 'faculty', name: 'Warden', department: 'CSE', section: 'A' }),
    ctx.createUser({ name: 'Gate Student', rollNo: 'R1', department: 'CSE', section: 'A' }),
    ctx.createUser({ name: 'Second Gate Student', rollNo: 'R2', department: 'CSE', section: 'A' }),
    ctx.createUser({ name: 'Other Student' }),
    ctx.createUser({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H-1' }),
    ctx.createUser({ role: 'principal', name: 'Principal', employeeId: 'P-1' }),
    ctx.createUser({ role: 'security', name: 'Gatekeeper', employeeId: 'S-1' }),
    ctx.createUser({ role: 'faculty', name: 'Other Faculty', department: 'ECE', section: 'B' }),
  ]);
  staff = { u: f, ...(await ctx.loginWeb(f)) };
  student = { u: s, ...(await ctx.loginMobile(s)) };
  student2 = { u: s2, ...(await ctx.loginWeb(s2)) };
  other = { u: o, ...(await ctx.loginWeb(o)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  outsiderFaculty = { u: of, ...(await ctx.loginWeb(of)) };
  studentSocket = await ctx.connect(student.token);
  staffSocket = await ctx.connect(staff.token);
});
after(async () => {
  await ctx.stop();
});

// ── Gate pass ─────────────────────────────────────────────────────

let passId;
let code;
const gateBody = () => ({
  regarding: 'outing',
  description: 'Visiting family for the weekend',
  // Departure "today" so the early-exit window is already open when the test verifies OUT.
  fromDate: new Date().toISOString().slice(0, 10),
  toDate: inDays(1).slice(0, 10),
  parentPhone: '9800000000',
  destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' },
});

test('gate pass: student requests → class faculty sees it live; staff cannot request; one open pass at a time', async () => {
  const body = gateBody();
  assert.equal((await ctx.request('POST', '/gate-pass', { token: staff.token, body })).status, 403);
  const bad = await ctx.request('POST', '/gate-pass', { token: student.token, body: { ...body, toDate: inDays(-5).slice(0, 10) } });
  assert.equal(bad.status, 422);

  const live = nextEvent(staffSocket, 'gatepass:updated', (p) => p.status === 'pending_faculty');
  const res = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  passId = res.body._id;
  assert.equal(res.body.status, 'pending_faculty');
  assert.equal(res.body.verificationCode, undefined, 'no code before approval');
  await live;
  assert.equal((await ctx.request('POST', '/gate-pass', { token: student.token, body })).status, 409);

  // A different section's faculty does not see it in their queue.
  const outsiderList = await ctx.request('GET', '/gate-pass', { token: outsiderFaculty.token });
  assert.ok(!outsiderList.body.passes.some((p) => p._id === passId));
});

test('gate pass: faculty forwards to HOD, HOD forwards to principal, principal approves with a 4-char code', async () => {
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/faculty-review`, { token: outsiderFaculty.token, body: { action: 'forward' } })).status, 403);

  const toHod = await ctx.request('PATCH', `/gate-pass/${passId}/faculty-review`, { token: staff.token, body: { action: 'forward' } });
  assert.equal(toHod.status, 200, JSON.stringify(toHod.body));
  assert.equal(toHod.body.status, 'pending_hod');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/faculty-review`, { token: staff.token, body: { action: 'forward' } })).status, 422, 'already moved on');

  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/hod-review`, { token: outsiderFaculty.token, body: { action: 'forward' } })).status, 403);
  const toPrincipal = await ctx.request('PATCH', `/gate-pass/${passId}/hod-review`, { token: hod.token, body: { action: 'forward' } });
  assert.equal(toPrincipal.status, 200);
  assert.equal(toPrincipal.body.status, 'pending_principal');

  const live = nextEvent(studentSocket, 'gatepass:updated', (p) => p.status === 'approved');
  const approved = await ctx.request('PATCH', `/gate-pass/${passId}/principal-review`, { token: principal.token, body: { action: 'approve' } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'approved');
  assert.equal(approved.body.verificationCode, undefined, 'code never leaks in staff responses');
  await live;

  assert.equal((await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: other.token })).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: staff.token })).status, 403);
  const qr = await ctx.request('GET', `/gate-pass/${passId}/qr`, { token: student.token });
  assert.equal(qr.status, 200);
  code = qr.body.code;
  assert.match(code, /^[A-Z]{2}[0-9]{2}$/, 'code is 2 letters + 2 digits');
  assert.ok(qr.body.qr.startsWith('data:image/png;base64,'));
  assert.equal(qr.body.payload, `CCGP:${code}`);
});

test('gate pass: any stage can reject, ending the request', async () => {
  const body = gateBody();
  const p = await ctx.request('POST', '/gate-pass', { token: student2.token, body });
  const rejected = await ctx.request('PATCH', `/gate-pass/${p.body._id}/faculty-review`, { token: staff.token, body: { action: 'reject', reason: 'No supporting document' } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.rejectedStage, 'faculty');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p.body._id}/faculty-review`, { token: staff.token, body: { action: 'forward' } })).status, 422);
});

test('gate pass: security verifies the code and records OUT then IN; class faculty is notified on return', async () => {
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: student.token, body: { code } })).status, 403);
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code: 'ZZ99' } })).status, 404);

  const v = await ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code: `CCGP:${code.toLowerCase()}` } });
  assert.equal(v.status, 200);
  assert.equal(v.body.valid, true);
  assert.equal(v.body.nextAction, 'out');
  assert.equal(v.body.pass.student.name, 'Gate Student');

  const out = nextEvent(studentSocket, 'gatepass:updated', (p) => p.status === 'active');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/out`, { token: security.token })).status, 200);
  await out;
  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/out`, { token: security.token })).status, 422, 'OUT is single-use');
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code } })).body.nextAction, 'in');

  const dash = await ctx.request('GET', '/gate-pass/dashboard/security', { token: security.token });
  assert.equal(dash.status, 200);
  assert.equal(dash.body.outside, 1);
  assert.ok(dash.body.inside >= 0);

  assert.equal((await ctx.request('PATCH', `/gate-pass/${passId}/in`, { token: security.token })).status, 200);
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code } })).status, 404, 'code consumed');
  const done = await ctx.request('GET', `/gate-pass/${passId}`, { token: student.token });
  assert.equal(done.body.status, 'completed');
  assert.ok(done.body.actualExit && done.body.actualReturn);

  const notified = await ctx.request('GET', '/notifications', { token: staff.token });
  assert.ok(notified.body.items.some((n) => n.title === 'Student back on campus'));
});

test('gate pass: student can cancel while pending; admin/principal can revoke; expired requests are swept', async () => {
  const body = gateBody();
  const p1 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p1.body._id}/cancel`, { token: other.token })).status, 404);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p1.body._id}/cancel`, { token: student.token })).body.status, 'cancelled');

  const p2 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  await ctx.request('PATCH', `/gate-pass/${p2.body._id}/faculty-review`, { token: staff.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${p2.body._id}/hod-review`, { token: hod.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${p2.body._id}/principal-review`, { token: principal.token, body: { action: 'approve' } });
  const qr = await ctx.request('GET', `/gate-pass/${p2.body._id}/qr`, { token: student.token });
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p2.body._id}/revoke`, { token: staff.token, body: {} })).status, 403, 'only admin/principal can revoke');
  const rv = await ctx.request('PATCH', `/gate-pass/${p2.body._id}/revoke`, { token: principal.token, body: { reason: 'Campus lockdown' } });
  assert.equal(rv.body.status, 'revoked');
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code: qr.body.code } })).status, 404, 'revoked code is dead');

  // An approved pass whose window closed becomes expired.
  const p3 = await ctx.request('POST', '/gate-pass', { token: student.token, body });
  await ctx.request('PATCH', `/gate-pass/${p3.body._id}/faculty-review`, { token: staff.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${p3.body._id}/hod-review`, { token: hod.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${p3.body._id}/principal-review`, { token: principal.token, body: { action: 'approve' } });
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
