// The mobile scanner sends the raw QR payload to the same endpoints a typed code
// uses. These tests drive those endpoints with exactly what a camera would read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';

let ctx;
const staff = {};
let n = 0;

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `Q-${role}-${extra.employeeId || ''}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A', teachingYears: [3] });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.principal = await make('principal');
  staff.dean = await make('dean');
  staff.security = await make('security');
  staff.security2 = await make('security', { employeeId: '2' });
});
after(async () => {
  await ctx.stop();
});

async function newStudent() {
  n += 1;
  const u = await ctx.createUser({ name: `QR Student ${n}`, rollNo: `QR${100 + n}`, department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321' });
  return { u, ...(await ctx.loginWeb(u)) };
}

/** An approved normal pass (OTP → faculty → HOD → principal). */
async function approvedNormal() {
  const student = await newStudent();
  const day = new Date().toISOString().slice(0, 10);
  const { body } = await ctx.request('POST', '/gate-pass', {
    token: student.token,
    body: { regarding: 'outing', description: 'Weekend at home', fromDate: day, toDate: day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } },
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

/** An approved emergency pass (straight to the Dean). */
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

/** What the student's QR encodes — exactly what the camera reads. */
const scannedPayload = async (id, student) => (await ctx.request('GET', `/gate-pass/${id}/qr`, { token: student.token })).body.payload;
const scanVerify = (payload, who = staff.security) => ctx.request('POST', '/gate-pass/verify', { token: who.token, body: { code: payload } });
const confirmOut = (id, payload, who = staff.security) => ctx.request('PATCH', `/gate-pass/${id}/out`, { token: who.token, body: { code: payload } });

for (const [label, make] of [
  ['normal', approvedNormal],
  ['emergency', approvedEmergency],
]) {
  test(`${label} pass: the scanned QR verifies, shows details, and only Security's confirmation uses it up`, async () => {
    const { id, student } = await make();
    const payload = await scannedPayload(id, student);
    assert.match(payload, /^CCGP:(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4}$/, 'QR holds the opaque gate code only');

    const scanned = await scanVerify(payload);
    assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
    assert.equal(scanned.body.valid, true);
    assert.equal(scanned.body.nextAction, 'out');
    assert.equal(scanned.body.pass._id, id);
    assert.equal(scanned.body.pass.passType, label);
    assert.equal(scanned.body.pass.student.name, student.u.name);
    assert.equal(scanned.body.pass.verificationCode, undefined, 'the code is never echoed back');

    // Scanning (even repeatedly) changes nothing.
    await scanVerify(payload);
    let stored = await ctx.models.GatePass.findById(id).lean();
    assert.equal(stored.status, 'approved');
    assert.equal(stored.actualExit, undefined);

    // The scanned value works the same as the typed code.
    assert.equal((await scanVerify(payload.slice(5).toLowerCase())).status, 200);

    const out = await confirmOut(id, payload);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    stored = await ctx.models.GatePass.findById(id).select('+verificationCode').lean();
    assert.equal(stored.status, 'active');
    assert.equal(stored.verificationCode, undefined);

    assert.equal((await scanVerify(payload)).status, 404, 'scanning the same QR again fails — used');
    assert.equal((await confirmOut(id, payload, staff.security2)).status, 409);
  });
}

test('expired, foreign and unauthorized scans are refused without changing the pass', async () => {
  const { id, student } = await approvedNormal();
  const payload = await scannedPayload(id, student);

  for (const role of ['faculty', 'principal', 'dean']) assert.equal((await scanVerify(payload, staff[role])).status, 403, `${role} cannot scan`);
  assert.equal((await scanVerify(payload, student)).status, 403, 'student cannot scan');
  assert.equal((await confirmOut(id, payload, student)).status, 403);

  for (const foreign of ['https://example.com/pay', 'upi://pay?pa=shop@bank', 'CCGP:<script>', 'CCRT:abc']) {
    const res = await scanVerify(foreign);
    assert.ok([404, 422].includes(res.status), `${foreign} → ${res.status}`);
    assert.ok(!JSON.stringify(res.body).match(/stack|mongo|Error:/i), 'no internal details');
  }

  await ctx.models.GatePass.updateOne({ _id: id }, { verificationExpiry: new Date(Date.now() - 1000) });
  assert.equal((await scanVerify(payload)).status, 404, 'expired QR fails');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'expired');
});

test('return QR: the scanned CCRT token verifies on the return screen and is separate from the exit QR', async () => {
  const { id, student } = await approvedEmergency();
  const exitPayload = await scannedPayload(id, student);
  assert.equal((await confirmOut(id, exitPayload)).status, 200);

  const back = await ctx.request('POST', `/gate-pass/${id}/return-location/verify`, {
    token: student.token,
    body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
  });
  assert.equal(back.status, 200);
  const returnPayload = back.body.payload;
  assert.match(returnPayload, /^CCRT:[A-Za-z0-9_-]{32}$/);

  assert.equal((await scanVerify(returnPayload)).status, 422, 'a return QR is not accepted as an exit code');
  const scanned = await ctx.request('POST', '/gate-pass/return/verify', { token: staff.security.token, body: { code: returnPayload } });
  assert.equal(scanned.status, 200);
  assert.equal(scanned.body.nextAction, 'inside');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'active', 'scanning the return QR does not complete it');

  const inside = await ctx.request('PATCH', `/gate-pass/${id}/in`, { token: staff.security.token, body: { code: returnPayload } });
  assert.equal(inside.status, 200);
  assert.equal((await ctx.request('POST', '/gate-pass/return/verify', { token: staff.security.token, body: { code: returnPayload } })).status, 404, 'used');
});
