// Windows Gate Scanner: Security-only desktop sessions, idempotent scans that
// reuse the existing exit / return commits, dashboard counts and history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';
import { campusDayStart, toDay } from '../src/utils/dates.js';

let ctx;
const staff = {};
let n = 0;
let scanSeq = 0;

const DESKTOP = { 'x-client-platform': 'gate-desktop', 'x-device-name': 'Main Gate PC', 'x-gate-name': 'Main Gate', 'user-agent': 'VEXONGateScanner/1.0.0 (Windows NT 10.0)' };

async function loginDesktop(user, extra = {}) {
  return ctx.request('POST', '/auth/login', { body: { email: user.email, password: PASSWORD }, headers: { ...DESKTOP, ...extra } });
}

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} ${extra.employeeId || ''}`.trim(), employeeId: `GS-${role}-${extra.employeeId || '1'}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A', teachingYears: [3] });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.principal = await make('principal');
  staff.dean = await make('dean');
  staff.admin = await make('admin');
  staff.security = await make('security');
  staff.security2 = await make('security', { employeeId: '2' });
  for (const key of ['security', 'security2']) {
    const res = await loginDesktop(staff[key].u);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    staff[key].desk = { token: res.body.accessToken, refreshToken: res.body.refreshToken };
  }
});
after(async () => {
  await ctx.stop();
});

async function newStudent(extra = {}) {
  n += 1;
  const u = await ctx.createUser({ name: `Scan Student ${n}`, rollNo: `GS${200 + n}`, department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321', ...extra });
  return { u, ...(await ctx.loginWeb(u)) };
}

async function approvedNormal({ fromDate } = {}) {
  const student = await newStudent();
  const day = new Date().toISOString().slice(0, 10);
  const { body } = await ctx.request('POST', '/gate-pass', {
    token: student.token,
    body: { regarding: 'outing', description: 'Weekend at home', fromDate: fromDate || day, toDate: fromDate || day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } },
  });
  const id = body._id;
  await ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: staff.faculty.token });
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
  await ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: staff.faculty.token, body: { otp: testOtpProvider.peek(rec._id) } });
  await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: staff.faculty.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${id}/hod-review`, { token: staff.hod.token, body: { action: 'forward' } });
  const ok = await ctx.request('PATCH', `/gate-pass/${id}/principal-review`, { token: staff.principal.token, body: { action: 'approve' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return { id, student };
}

async function approvedEmergency() {
  const student = await newStudent();
  const at = (m) => new Date(Date.now() + m * 60000).toISOString();
  const { body } = await ctx.request('POST', '/gate-pass/emergency', {
    token: student.token,
    body: { authority: 'dean', reason: 'Family emergency', destination: 'Chennai', leaveAt: at(5), expectedReturnAt: at(240) },
  });
  const ok = await ctx.request('PATCH', `/gate-pass/${body._id}/emergency-review`, { token: staff.dean.token, body: { action: 'approve' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return { id: body._id, student };
}

const exitPayload = async (id, student) => (await ctx.request('GET', `/gate-pass/${id}/qr`, { token: student.token })).body.payload;
async function returnPayload(id, student) {
  const back = await ctx.request('POST', `/gate-pass/${id}/return-location/verify`, {
    token: student.token,
    body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
  });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  return back.body.payload;
}

const newScanId = () => `scan-${Date.now().toString(36)}-${(scanSeq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
const scan = (payload, { who = staff.security, scanId = newScanId(), source = 'hid', kind, extra = {} } = {}) =>
  ctx.request('POST', '/gate-scanner/scans', { token: who.desk.token, headers: DESKTOP, body: { scanId, payload, source, ...(kind ? { kind } : {}), ...extra } });
const exitSmsFor = (name) => testOtpProvider.sentMessages().filter((m) => m.message.includes(`${name} has left`));

// ── Authentication and permissions ───────────────────────────────────

test('Security signs in on the Gate Scanner: refresh token in the body, no cookie, session bound as gate_desktop', async () => {
  const res = await loginDesktop(staff.security.u);
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken, 'native client receives its refresh token in the body');
  assert.equal(res.headers.get('set-cookie'), null, 'no cookies for the desktop client');
  const session = await ctx.models.Session.findOne({ user: staff.security.u._id }).sort({ createdAt: -1 }).lean();
  assert.equal(session.client, 'gate_desktop');
  assert.equal(session.idleTimeoutMs, null, 'no 2-minute web idle rule');
  assert.match(session.device, /^Gate Scanner/);

  const who = await ctx.request('GET', '/gate-scanner/session', { token: res.body.accessToken, headers: DESKTOP });
  assert.equal(who.status, 200);
  assert.equal(who.body.guard.role, 'security');
  assert.equal(who.body.client, 'gate_desktop');
});

test('every other role is refused by the Gate Scanner sign-in, and no session is created', async () => {
  const student = await newStudent();
  const superAdmin = await ctx.createUser({ role: 'super_admin', name: 'SA' });
  for (const u of [student.u, staff.faculty.u, staff.admin.u, staff.principal.u, superAdmin]) {
    const before = await ctx.models.Session.countDocuments({ user: u._id, client: 'gate_desktop' });
    const res = await loginDesktop(u);
    assert.equal(res.status, 403, `${u.role} → ${res.status}`);
    assert.ok(['GATE_SCANNER_ROLE_REQUIRED', undefined].includes(res.body.code));
    assert.equal(res.body.accessToken, undefined);
    assert.equal(await ctx.models.Session.countDocuments({ user: u._id, client: 'gate_desktop' }), before);
  }
  // Wrong password: the normal failure, not a role hint.
  const bad = await ctx.request('POST', '/auth/login', { body: { email: staff.admin.u.email, password: 'wrong-Password1' }, headers: DESKTOP });
  assert.equal(bad.status, 401);
});

test('a browser cannot pose as the Gate Scanner (Sec-Fetch-Site makes it a web session)', async () => {
  const res = await loginDesktop(staff.security.u, { 'sec-fetch-site': 'same-origin' });
  assert.equal(res.status, 200);
  assert.equal(res.body.refreshToken, undefined);
  const session = await ctx.models.Session.findOne({ user: staff.security.u._id }).sort({ createdAt: -1 }).lean();
  assert.equal(session.client, 'web');
});

test('session restore: refresh rotates; a replayed refresh token revokes the session', async () => {
  const login = await loginDesktop(staff.security.u);
  const r1 = await ctx.request('POST', '/auth/refresh', { headers: DESKTOP, body: { refreshToken: login.body.refreshToken } });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.refreshToken && r1.body.refreshToken !== login.body.refreshToken);
  assert.equal((await ctx.request('GET', '/gate-scanner/session', { token: r1.body.accessToken, headers: DESKTOP })).status, 200);

  const replay = await ctx.request('POST', '/auth/refresh', { headers: DESKTOP, body: { refreshToken: login.body.refreshToken } });
  assert.equal(replay.status, 401);
  assert.equal((await ctx.request('GET', '/gate-scanner/session', { token: r1.body.accessToken, headers: DESKTOP })).status, 401, 'whole session revoked');
});

test('sign-out revokes the desktop session; its tokens stop working', async () => {
  const login = await loginDesktop(staff.security.u);
  const out = await ctx.request('POST', '/auth/logout', { headers: DESKTOP, body: { refreshToken: login.body.refreshToken } });
  assert.equal(out.status, 200);
  assert.equal((await ctx.request('GET', '/gate-scanner/session', { token: login.body.accessToken, headers: DESKTOP })).status, 401);
  assert.equal((await ctx.request('POST', '/auth/refresh', { headers: DESKTOP, body: { refreshToken: login.body.refreshToken } })).status, 401);
});

test('server-side revocation (sign out other devices) ends the gate PC session', async () => {
  const login = await loginDesktop(staff.security.u);
  const web = await ctx.loginWeb(staff.security.u);
  await ctx.request('POST', '/auth/sessions/revoke-others', { token: web.token, headers: { 'x-csrf-token': web.csrf, cookie: `${web.cookie}; ${web.csrfCookie}` } });
  assert.equal((await ctx.request('GET', '/gate-scanner/session', { token: login.body.accessToken, headers: DESKTOP })).status, 401);
  // Fresh tokens for the rest of the suite.
  for (const key of ['security']) {
    const res = await loginDesktop(staff[key].u);
    staff[key].desk = { token: res.body.accessToken, refreshToken: res.body.refreshToken };
    staff[key] = { ...staff[key], ...(await ctx.loginWeb(staff[key].u)) };
  }
});

test('a Security account whose role changes loses the Gate Scanner at once (access and refresh)', async () => {
  const guard = await ctx.createUser({ role: 'security', name: 'Temp guard', employeeId: 'GS-temp' });
  const login = await loginDesktop(guard);
  assert.equal(login.status, 200);
  await ctx.models.User.updateOne({ _id: guard._id }, { $set: { role: 'faculty', department: 'CSE' } });
  const res = await ctx.request('GET', '/gate-scanner/session', { token: login.body.accessToken, headers: DESKTOP });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'GATE_SCANNER_ROLE_REQUIRED');
  assert.equal((await ctx.request('POST', '/auth/refresh', { headers: DESKTOP, body: { refreshToken: login.body.refreshToken } })).status, 401);
});

test('a Gate Scanner session reaches the gate-scanner endpoints only', async () => {
  const { token } = staff.security.desk;
  for (const [method, path] of [
    ['POST', '/gate-pass/verify'],
    ['GET', '/gate-pass/dashboard/security'],
    ['GET', '/users'],
    ['GET', '/notifications'],
    ['GET', '/auth/sessions'],
    ['GET', '/announcements'],
  ]) {
    const res = await ctx.request(method, path, { token, headers: DESKTOP, body: method === 'POST' ? { code: 'A4G5' } : undefined });
    assert.equal(res.status, 403, `${method} ${path} → ${res.status}`);
    assert.equal(res.body.code, 'GATE_SCANNER_SCOPE');
  }
  assert.equal((await ctx.request('GET', '/auth/me', { token, headers: DESKTOP })).status, 200);
  assert.equal((await ctx.request('GET', '/legal/status', { token, headers: DESKTOP })).status, 200);
  // Realtime sockets are not opened for the scanner session.
  await ctx.connect(token, { expectFail: true });
});

test('the gate-scanner API is Security-only for every client, and the web Security session is unchanged', async () => {
  for (const who of [staff.admin, staff.principal, staff.faculty]) {
    assert.equal((await ctx.request('GET', '/gate-scanner/dashboard', { token: who.token })).status, 403);
  }
  assert.equal((await ctx.request('GET', '/gate-scanner/dashboard', { token: staff.security.token })).status, 200);
  // The web Security session still reaches the existing gate screens.
  assert.equal((await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token })).status, 200);
});

// ── Scan processing (existing CCGP / CCRT rules) ─────────────────────

for (const [label, make] of [
  ['normal', approvedNormal],
  ['emergency', approvedEmergency],
]) {
  test(`${label} pass: one scan of the exit QR records the exit once, attributed to the signed-in guard`, async () => {
    const { id, student } = await make();
    const payload = await exitPayload(id, student);
    const scanId = newScanId();
    const res = await scan(payload, { scanId, extra: { guard: String(staff.security2.u._id), exitVerifiedBy: String(staff.security2.u._id) } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, 'success');
    assert.equal(res.body.code, 'EXIT_RECORDED');
    assert.equal(res.body.direction, 'out');
    assert.equal(res.body.student.name, student.u.name);
    assert.equal(res.body.gate, 'Main Gate');
    assert.ok(!JSON.stringify(res.body).includes(payload.slice(5)), 'the code is never echoed back');

    const stored = await ctx.models.GatePass.findById(id).select('+verificationCode').lean();
    assert.equal(stored.status, 'active');
    assert.equal(String(stored.exitVerifiedBy), String(staff.security.u._id), 'the authenticated guard, not a body field');
    assert.equal(stored.verificationCode, undefined);

    // Retrying the same request (timeout) returns the original answer, changes nothing.
    const retry = await scan(payload, { scanId });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.outcome, 'success');
    assert.equal(retry.body.replayed, true);
    assert.equal(exitSmsFor(student.u.name).length, 1, 'one parent SMS');
    assert.equal(await ctx.models.GateScanEvent.countDocuments({ scanId }), 1);
  });
}

test('a repeated hardware read of a used QR is answered "already recorded"; nothing changes', async () => {
  const { id, student } = await approvedNormal();
  const payload = await exitPayload(id, student);
  assert.equal((await scan(payload)).body.outcome, 'success');
  const again = await scan(payload);
  assert.equal(again.status, 200);
  assert.equal(again.body.outcome, 'duplicate');
  assert.equal(again.body.code, 'ALREADY_RECORDED');
  assert.equal(again.body.student.name, student.u.name);
  assert.match(again.body.message, /Already recorded at/);
  // Another guard's read of the same QR is also a duplicate, never a second exit.
  const other = await scan(payload, { who: staff.security2 });
  assert.equal(other.body.outcome, 'duplicate');
  assert.equal(exitSmsFor(student.u.name).length, 1);
});

test('return QR: CCRT records the return through the existing return commit; the exit QR never does', async () => {
  const { id, student } = await approvedEmergency();
  const exitQr = await exitPayload(id, student);
  assert.equal((await scan(exitQr)).body.code, 'EXIT_RECORDED');
  // The used exit QR cannot act as a return.
  assert.notEqual((await scan(exitQr)).body.outcome, 'success');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'active');

  const back = await returnPayload(id, student);
  const res = await scan(back, { who: staff.security2 });
  assert.equal(res.body.outcome, 'success', JSON.stringify(res.body));
  assert.equal(res.body.code, 'RETURN_RECORDED');
  assert.equal(res.body.direction, 'in');
  const stored = await ctx.models.GatePass.findById(id).select('+returnToken').lean();
  assert.equal(stored.status, 'completed');
  assert.equal(String(stored.returnVerifiedBy), String(staff.security2.u._id));
  assert.equal(stored.returnToken, undefined);
  assert.equal((await scan(back)).body.outcome, 'duplicate', 'used return QR');
});

test('an expired return credential is rejected and the pass stays active', async () => {
  const { id, student } = await approvedEmergency();
  await scan(await exitPayload(id, student));
  const back = await returnPayload(id, student);
  await ctx.models.GatePass.updateOne({ _id: id }, { $set: { returnCredentialExpiresAt: new Date(Date.now() - 1000) } });
  const res = await scan(back);
  assert.equal(res.body.outcome, 'rejected');
  assert.equal(res.body.code, 'RETURN_EXPIRED');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'active');
});

test('malformed, foreign and incomplete payloads are rejected safely', async () => {
  const cases = [
    ['https://example.com/pay', 'NOT_A_GATE_PASS'],
    ['upi://pay?pa=shop@bank', 'NOT_A_GATE_PASS'],
    ['CCGP:<script>', 'INVALID_PAYLOAD'],
    ['CCGP:A4', 'INVALID_PAYLOAD'],
    ['CCRT:abc', 'INVALID_PAYLOAD'],
    ['A4G5', 'NOT_A_GATE_PASS'],
  ];
  for (const [payload, code] of cases) {
    const res = await scan(payload);
    assert.equal(res.status, 200, payload);
    assert.equal(res.body.outcome, 'rejected', payload);
    assert.equal(res.body.code, code, payload);
    assert.ok(!JSON.stringify(res.body).match(/stack|mongo|Error:/i));
  }
  assert.equal((await scan('A4G5', { source: 'manual' })).body.code, 'CODE_NEEDS_DIRECTION');
  // Validation: empty payload, bad scan id.
  assert.equal((await scan('')).status, 422);
  assert.equal((await scan('CCGP:A4G5', { scanId: 'x' })).status, 422);
  assert.equal((await scan('CCGP:A4G5', { source: 'bluetooth-magic' })).status, 422);
  // Rejected attempts store no payload.
  const doc = await ctx.models.GateScanEvent.findOne({ code: 'INVALID_PAYLOAD' }).lean();
  assert.ok(!JSON.stringify(doc).includes('<script>'));
});

test('manual entry of a bare exit code works only with the direction chosen', async () => {
  const { id, student } = await approvedNormal();
  const code = (await exitPayload(id, student)).slice(5);
  const wrong = await scan(code.toLowerCase(), { source: 'manual', kind: 'in' });
  assert.equal(wrong.body.outcome, 'rejected', 'an exit code is not a return code');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'approved');
  const ok = await scan(code.toLowerCase(), { source: 'manual', kind: 'out' });
  assert.equal(ok.body.code, 'EXIT_RECORDED');
});

test('approval, opening time and expiry are enforced exactly as on the web OUT screen', async () => {
  // Not yet open: a pass for a future day.
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const later = await approvedNormal({ fromDate: future });
  const early = await scan(await exitPayload(later.id, later.student));
  assert.equal(early.body.outcome, 'rejected');
  assert.equal(early.body.code, 'NOT_YET_OPEN');
  assert.equal((await ctx.models.GatePass.findById(later.id)).status, 'approved');

  // Expired verification window.
  const old = await approvedNormal();
  const payload = await exitPayload(old.id, old.student);
  await ctx.models.GatePass.updateOne({ _id: old.id }, { verificationExpiry: new Date(Date.now() - 1000) });
  const expired = await scan(payload);
  assert.equal(expired.body.outcome, 'rejected');
  assert.equal(expired.body.code, 'UNKNOWN_CREDENTIAL');
  assert.equal((await ctx.models.GatePass.findById(old.id)).status, 'expired');

  // Revoked.
  const rev = await approvedNormal();
  const revPayload = await exitPayload(rev.id, rev.student);
  await ctx.request('PATCH', `/gate-pass/${rev.id}/revoke`, { token: staff.principal.token, body: { reason: 'No' } });
  assert.equal((await scan(revPayload)).body.outcome, 'rejected');
  assert.equal((await ctx.models.GatePass.findById(rev.id)).status, 'revoked');
});

test('two guards scanning the same QR at the same moment: exactly one exit, one SMS', async () => {
  const { id, student } = await approvedNormal();
  const payload = await exitPayload(id, student);
  const results = await Promise.all([scan(payload), scan(payload, { who: staff.security2 }), scan(payload), scan(payload, { who: staff.security2 })]);
  const outcomes = results.map((r) => r.body.outcome);
  assert.equal(outcomes.filter((o) => o === 'success').length, 1, JSON.stringify(outcomes));
  assert.ok(outcomes.every((o) => ['success', 'rejected', 'duplicate'].includes(o)));
  assert.equal(exitSmsFor(student.u.name).length, 1);
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'active');
});

test('rapid scans of different students are all processed independently', async () => {
  const passes = await Promise.all([approvedNormal(), approvedNormal(), approvedEmergency(), approvedNormal(), approvedNormal()]);
  const payloads = await Promise.all(passes.map((p) => exitPayload(p.id, p.student)));
  const results = await Promise.all(payloads.map((p, i) => scan(p, { who: i % 2 ? staff.security2 : staff.security })));
  assert.deepEqual(
    results.map((r) => r.body.code),
    results.map(() => 'EXIT_RECORDED')
  );
  for (const p of passes) assert.equal((await ctx.models.GatePass.findById(p.id)).status, 'active');
});

test('uncertain outcome: a scan id can be settled later; other guards cannot read it', async () => {
  const { id, student } = await approvedNormal();
  const scanId = newScanId();
  await scan(await exitPayload(id, student), { scanId });
  const mine = await ctx.request('GET', `/gate-scanner/scans/${scanId}`, { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.code, 'EXIT_RECORDED');
  const theirs = await ctx.request('GET', `/gate-scanner/scans/${scanId}`, { token: staff.security2.desk.token, headers: DESKTOP });
  assert.equal(theirs.status, 404);
  const never = await ctx.request('GET', `/gate-scanner/scans/${newScanId()}`, { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(never.status, 404);
  assert.equal(never.body.code, 'SCAN_NOT_FOUND');
});

test('a scan interrupted after the commit settles as success; one interrupted before it settles as not recorded', async () => {
  const { id, student } = await approvedNormal();
  // Simulate a crash after the pass was committed but before the scan row was finished.
  await ctx.request('PATCH', `/gate-pass/${id}/out`, { token: staff.security.token, body: { code: await exitPayload(id, student) } });
  const committedId = newScanId();
  await ctx.models.GateScanEvent.create({ scanId: committedId, guard: staff.security.u._id, direction: 'out', gatePass: id, state: 'processing', createdAt: new Date(Date.now() - 5000) });
  const settled = await ctx.request('GET', `/gate-scanner/scans/${committedId}`, { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.outcome, 'success');

  const freshId = newScanId();
  await ctx.models.GateScanEvent.create({ scanId: freshId, guard: staff.security.u._id, state: 'processing' });
  const pending = await ctx.request('GET', `/gate-scanner/scans/${freshId}`, { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(pending.status, 202);
  assert.equal(pending.body.pending, true);

  const staleId = newScanId();
  await ctx.models.GateScanEvent.collection.insertOne({ scanId: staleId, guard: staff.security.u._id, state: 'processing', source: 'hid', createdAt: new Date(Date.now() - 60000) });
  const stale = await ctx.request('GET', `/gate-scanner/scans/${staleId}`, { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(stale.body.outcome, 'rejected');
  assert.equal(stale.body.code, 'NOT_RECORDED');
});

// ── Dashboard and history ────────────────────────────────────────────

test('dashboard: students outside are counted once each; event totals count every event', async () => {
  const before = (await ctx.request('GET', '/gate-scanner/dashboard', { token: staff.security.desk.token, headers: DESKTOP })).body;
  const a = await approvedEmergency();
  await scan(await exitPayload(a.id, a.student));
  await scan(await returnPayload(a.id, a.student));
  // The same student leaves again on a second pass: two exits, one person outside.
  const again = await ctx.request('POST', '/gate-pass/emergency', {
    token: a.student.token,
    body: { authority: 'dean', reason: 'Second trip today', destination: 'Chennai', leaveAt: new Date(Date.now() + 300000).toISOString(), expectedReturnAt: new Date(Date.now() + 7200000).toISOString() },
  });
  await ctx.request('PATCH', `/gate-pass/${again.body._id}/emergency-review`, { token: staff.dean.token, body: { action: 'approve' } });
  await scan(await exitPayload(again.body._id, a.student));

  const res = await ctx.request('GET', '/gate-scanner/dashboard', { token: staff.security.desk.token, headers: DESKTOP });
  assert.equal(res.status, 200);
  const d = res.body;
  assert.equal(d.presenceBasis, 'gate_pass');
  assert.equal(d.today.outEvents - before.today.outEvents, 2);
  assert.equal(d.today.inEvents - before.today.inEvents, 1);
  assert.equal(d.population.outsideOnPass - before.population.outsideOnPass, 1);
  assert.equal(d.population.totalStudents, await ctx.models.User.countDocuments({ role: { $in: ['student', 'club_admin'] }, isActive: true }));
  assert.equal(d.population.notOnActivePass, d.population.totalStudents - d.population.outsideOnPass);
  const outsideNow = await ctx.models.GatePass.distinct('student', { status: 'active' });
  assert.equal(d.population.outsideOnPass, outsideNow.length);
  assert.ok(d.recent.length > 0 && d.recent.length <= 10);
  assert.ok(d.myScansToday.success >= 3);
});

test('history: today / type / search / pagination, and the campus-day boundary', async () => {
  const token = staff.security.desk.token;
  const get = (qs) => ctx.request('GET', `/gate-scanner/history?${qs}`, { token, headers: DESKTOP });

  const today = await get('range=today&limit=5');
  assert.equal(today.status, 200);
  assert.ok(today.body.total > 5);
  assert.equal(today.body.items.length, 5);
  assert.equal(today.body.range.timezone, 'Asia/Kolkata');
  const page2 = await get('range=today&limit=5&page=2');
  assert.notDeepEqual(page2.body.items.map((i) => i.id), today.body.items.map((i) => i.id));
  const item = today.body.items[0];
  assert.ok(item.student.name && item.passRef && item.guard.name);
  assert.equal(item.student.email, undefined, 'no contact details');
  assert.equal(item.student.phone, undefined);

  const ins = await get('range=today&type=in&limit=100');
  assert.ok(ins.body.items.length > 0 && ins.body.items.every((i) => i.type === 'in'));
  const outs = await get('range=today&type=out&limit=100');
  assert.ok(outs.body.items.every((i) => i.type === 'out'));
  assert.equal(ins.body.total + outs.body.total, today.body.total);

  // Search by roll number.
  const { id, student } = await approvedNormal();
  await scan(await exitPayload(id, student));
  const found = await get(`range=today&q=${student.u.rollNo}`);
  assert.equal(found.body.total, 1);
  assert.equal(found.body.items[0].student.rollNo, student.u.rollNo);
  assert.equal(found.body.items[0].gate, 'Main Gate');
  assert.equal(found.body.items[0].via, 'gate_scanner');

  // Boundary: one minute before today's campus midnight is "yesterday".
  const todayStart = campusDayStart(toDay(new Date()));
  const edge = await approvedNormal();
  await ctx.models.GatePass.updateOne({ _id: edge.id }, { $set: { status: 'active', actualExit: new Date(todayStart.getTime() - 60000), exitVerifiedBy: staff.security.u._id }, $unset: { verificationCode: 1 } });
  const yest = await get(`range=yesterday&q=${edge.student.u.rollNo}`);
  assert.equal(yest.body.total, 1);
  assert.equal((await get(`range=today&q=${edge.student.u.rollNo}`)).body.total, 0);
  assert.equal((await get(`range=week&q=${edge.student.u.rollNo}`)).body.total, new Date(todayStart).getUTCDay() === 1 ? 0 : 1);

  // Custom range validation.
  assert.equal((await get('range=custom&from=2026-01-10')).status, 422);
  assert.equal((await get('range=custom&from=2026-02-10&to=2026-01-10')).status, 422);
  assert.equal((await get('range=custom&from=2020-01-01&to=2026-01-10')).status, 422);
  assert.equal((await get('range=forever')).status, 422);
  assert.equal((await get('range=month')).status, 200);
});

test('attempts: successful and rejected scans are listed for Security, filtered by outcome', async () => {
  const token = staff.security.desk.token;
  const rej = await ctx.request('GET', '/gate-scanner/attempts?range=today&outcome=rejected&limit=100', { token, headers: DESKTOP });
  assert.equal(rej.status, 200);
  assert.ok(rej.body.items.length > 0 && rej.body.items.every((i) => i.outcome === 'rejected'));
  const ok = await ctx.request('GET', '/gate-scanner/attempts?range=today&outcome=success', { token, headers: DESKTOP });
  assert.ok(ok.body.items.every((i) => i.outcome === 'success' && i.student));
  for (const who of [staff.admin, staff.principal]) {
    assert.equal((await ctx.request('GET', '/gate-scanner/attempts', { token: who.token })).status, 403);
    assert.equal((await ctx.request('GET', '/gate-scanner/history', { token: who.token })).status, 403);
  }
});

test('Terms acceptance: a gate PC session follows the native-client rule and can accept through its scope', async () => {
  const { syncPolicyVersions } = await import('../src/services/legal.js');
  await syncPolicyVersions({ log: { warn() {}, info() {}, log() {} } });
  const guard = await ctx.createUser({ role: 'security', name: 'Terms guard', employeeId: 'GS-terms' });
  const login = await loginDesktop(guard);
  const token = login.body.accessToken;
  if (!login.body.user.legal.termsRequired) return; // no Terms requiring acceptance in this build
  const blocked = await ctx.request('GET', '/gate-scanner/dashboard', { token, headers: DESKTOP });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'TERMS_ACCEPTANCE_REQUIRED');
  const accept = await ctx.request('POST', '/legal/accept', { token, headers: DESKTOP, body: { policyId: 'terms', version: login.body.user.legal.termsVersion, agreed: true } });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal((await ctx.request('GET', '/gate-scanner/dashboard', { token, headers: DESKTOP })).status, 200);
});
