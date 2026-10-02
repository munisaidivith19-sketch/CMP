import crypto from 'node:crypto';
import fs from 'node:fs';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import * as GatePassModule from '../src/models/GatePass.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';

const { generateGatePassSecurityCode, normalizeGateCode, GATE_CODE_PATTERN } = GatePassModule;

let ctx;
const staff = {}; // role -> { u, token }
let security2;
let n = 0;

const AUTHORITIES = ['principal', 'ao', 'dean', 'chairman'];
const minutes = (m) => new Date(Date.now() + m * 60000).toISOString();
const emergencyBody = (authority = 'principal', extra = {}) => ({
  authority,
  reason: 'Father admitted to hospital',
  destination: 'Chennai General Hospital',
  leaveAt: minutes(10),
  expectedReturnAt: minutes(6 * 60),
  ...extra,
});

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `E-${role}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A', teachingYears: [3] });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.admin = await make('admin');
  staff.security = await make('security');
  security2 = await make('security', { employeeId: 'E-security-2' });
  for (const role of AUTHORITIES) staff[role] = await make(role);
});
after(async () => {
  await ctx.stop();
});

async function newStudent() {
  n += 1;
  const u = await ctx.createUser({ name: `Student ${n}`, rollNo: `EM${100 + n}`, department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321' });
  return { u, ...(await ctx.loginWeb(u)) };
}
const create = (student, body) => ctx.request('POST', '/gate-pass/emergency', { token: student.token, body });
const decide = (id, who, action = 'approve', reason) => ctx.request('PATCH', `/gate-pass/${id}/emergency-review`, { token: who.token, body: { action, reason } });
const storedCode = async (id) => (await ctx.models.GatePass.findById(id).select('+verificationCode').lean()).verificationCode;
const verify = (code, who = staff.security) => ctx.request('POST', '/gate-pass/verify', { token: who.token, body: { code } });
const out = (id, code, who = staff.security) => ctx.request('PATCH', `/gate-pass/${id}/out`, { token: who.token, body: { code } });
const inbox = async (who) => (await ctx.request('GET', '/gate-pass', { token: who.token })).body.passes.map((p) => p._id);

/** A new student's emergency pass, approved by `authority`. */
async function approvedPass(authority = 'principal') {
  const student = await newStudent();
  const res = await create(student, emergencyBody(authority));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const ok = await decide(res.body._id, staff[authority]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return { id: res.body._id, student, code: await storedCode(res.body._id) };
}

test('student creates an emergency pass; identity and class come from the account, not the request', async () => {
  const student = await newStudent();
  const res = await create(student, emergencyBody('principal', { student: staff.admin.u._id, department: 'MECH', section: 'Z', rollNo: 'FAKE', parentPhone: '0000000000' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.passType, 'emergency');
  assert.equal(res.body.status, 'pending_authority');
  assert.equal(res.body.emergencyAuthority, 'principal');
  assert.equal(String(res.body.student), String(student.u._id));
  assert.equal(res.body.department, 'CSE');
  assert.equal(res.body.section, 'A');
  assert.equal(res.body.parentPhone, '9876504321', 'parent number from the student record');
  assert.equal(res.body.description, 'Father admitted to hospital');
  assert.equal(res.body.destination.area, 'Chennai General Hospital');
  assert.ok(res.body.leaveAt && res.body.expectedReturnAt);
  assert.ok(await ctx.models.Activity.exists({ entityId: res.body._id, action: 'gate_pass.emergency_create', summary: 'Sent to Principal' }));
});

test('authority is required and must be Principal, AO, Dean or Chairman', async () => {
  const student = await newStudent();
  const { authority, ...noAuthority } = emergencyBody();
  assert.equal(authority, 'principal');
  assert.equal((await create(student, noAuthority)).status, 422);
  for (const bad of ['faculty', 'hod', 'warden', 'security', 'admin', 'PRINCIPAL ', '']) {
    assert.equal((await create(student, emergencyBody(bad))).status, 422, bad);
  }
  for (const field of ['reason', 'destination', 'leaveAt', 'expectedReturnAt']) {
    assert.equal((await create(student, emergencyBody('principal', { [field]: '' }))).status, 422, `${field} required`);
  }
  assert.equal((await create(student, emergencyBody('principal', { expectedReturnAt: minutes(5) }))).status, 422, 'return before leaving');
  assert.equal(await ctx.models.GatePass.countDocuments({ student: student.u._id }), 0);
  assert.equal((await create(staff.faculty, emergencyBody())).status, 403, 'only students create passes');
});

test('the request goes straight to the chosen authority — nobody else sees or is notified of it', async () => {
  const student = await newStudent();
  const res = await create(student, emergencyBody('dean'));
  const id = res.body._id;
  assert.ok((await inbox(staff.dean)).includes(id));
  for (const role of ['principal', 'ao', 'chairman', 'faculty', 'hod']) {
    assert.ok(!(await inbox(staff[role])).includes(id), `${role} inbox`);
    assert.equal((await ctx.request('GET', `/gate-pass/${id}`, { token: staff[role].token })).status, role === 'principal' ? 200 : 403, `${role} detail`);
  }
  const noticesFor = async (who) =>
    (await ctx.request('GET', '/notifications', { token: who.token })).body.items.filter((x) => x.title === 'Emergency gate pass request' && x.link === `/gate-pass/${id}`);
  assert.equal((await noticesFor(staff.dean)).length >= 1, true);
  for (const role of ['principal', 'ao', 'chairman', 'faculty', 'hod']) assert.equal((await noticesFor(staff[role])).length, 0, `${role} not notified`);
  assert.ok(await ctx.models.Activity.exists({ entityId: id, action: 'gate_pass.emergency_viewed', user: staff.dean.u._id }), 'authority viewing is audited');
});

test('faculty, HOD, admin and the wrong authority cannot approve; the normal review endpoints refuse it too', async () => {
  const student = await newStudent();
  const { body } = await create(student, emergencyBody('ao'));
  for (const role of ['faculty', 'hod', 'admin']) assert.equal((await decide(body._id, staff[role])).status, 403, role);
  for (const role of ['principal', 'dean', 'chairman']) assert.equal((await decide(body._id, staff[role])).status, 403, `${role} cannot decide an AO request`);
  assert.equal((await decide(body._id, student)).status, 403, 'student');
  assert.notEqual((await ctx.request('PATCH', `/gate-pass/${body._id}/principal-review`, { token: staff.principal.token, body: { action: 'approve' } })).status, 200);
  assert.notEqual((await ctx.request('PATCH', `/gate-pass/${body._id}/faculty-review`, { token: staff.faculty.token, body: { action: 'forward' } })).status, 200);
  assert.notEqual((await ctx.request('PATCH', `/gate-pass/${body._id}/hod-review`, { token: staff.hod.token, body: { action: 'forward' } })).status, 200);
  assert.equal((await ctx.models.GatePass.findById(body._id)).status, 'pending_authority');
  assert.equal(await storedCode(body._id), undefined);
});

test('Principal, AO, Dean and Chairman can each approve their own requests', async () => {
  for (const authority of AUTHORITIES) {
    const student = await newStudent();
    const { body } = await create(student, emergencyBody(authority));
    const res = await decide(body._id, staff[authority]);
    assert.equal(res.status, 200, `${authority}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, 'approved');
    assert.equal(res.body.emergencyReview.action, 'approved');
    assert.equal(String(res.body.emergencyReview.by._id), String(staff[authority].u._id));
    assert.equal(res.body.verificationCode, undefined, 'code never in the response');
    assert.match(await storedCode(body._id), GATE_CODE_PATTERN);
    assert.equal((await decide(body._id, staff[authority])).status, 422, 'cannot be decided twice');
  }
});

test('no parent OTP is created, sent or required for an emergency pass', async () => {
  const student = await newStudent();
  const { body } = await create(student, emergencyBody());
  const sentBefore = testOtpProvider.sentMessages().length;
  assert.equal((await ctx.request('POST', `/gate-pass/${body._id}/parent-otp`, { token: staff.faculty.token })).status >= 400, true);
  assert.equal((await decide(body._id, staff.principal)).status, 200, 'approved straight from pending_authority');
  const stored = await ctx.models.GatePass.findById(body._id).lean();
  assert.equal(stored.parentVerifiedAt, undefined);
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: body._id }), 0);
  assert.equal(testOtpProvider.sentMessages().length, sentBefore);
});

test('no code or QR before approval, none after rejection; the student is told either way', async () => {
  const student = await newStudent();
  const { body } = await create(student, emergencyBody('chairman'));
  assert.equal(await storedCode(body._id), undefined);
  assert.equal((await ctx.request('GET', `/gate-pass/${body._id}/qr`, { token: student.token })).status, 422);
  const res = await decide(body._id, staff.chairman, 'reject', 'Please call the warden first');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'rejected');
  assert.equal(res.body.rejectedStage, 'authority');
  assert.equal(await storedCode(body._id), undefined);
  assert.equal((await ctx.request('GET', `/gate-pass/${body._id}/qr`, { token: student.token })).status, 422);
  const notes = (await ctx.request('GET', '/notifications', { token: student.token })).body.items.map((x) => x.title);
  assert.ok(notes.includes('Gate pass rejected'));

  const approved = await approvedPass('principal');
  const approvedNotes = (await ctx.request('GET', '/notifications', { token: approved.student.token })).body.items;
  const note = approvedNotes.find((x) => x.title === 'Gate pass approved');
  assert.ok(note && !note.message.includes(approved.code), 'approval notice does not carry the code');
  assert.ok(await ctx.models.Activity.exists({ entityId: approved.id, action: 'gate_pass.code_issued' }));
});

test('security code: 4 characters, letters and digits in random positions, from crypto', async () => {
  const masks = new Set();
  const positions = Array.from({ length: 4 }, () => new Set());
  for (let i = 0; i < 3000; i += 1) {
    const code = generateGatePassSecurityCode();
    assert.equal(code.length, 4);
    assert.match(code, GATE_CODE_PATTERN);
    assert.match(code, /[A-Z]/);
    assert.match(code, /[0-9]/);
    masks.add(code.replace(/[A-Z]/g, 'L').replace(/[0-9]/g, 'D'));
    [...code].forEach((ch, p) => positions[p].add(/[0-9]/.test(ch) ? 'D' : 'L'));
  }
  assert.ok(masks.size >= 10, `letter/digit layouts vary (${[...masks].join(',')})`);
  assert.ok(positions.every((s) => s.size === 2), 'every position can hold a letter or a digit');

  for (const style of ['A4G5', '5AG4', 'G54A', '7K2M', 'B8R3', '4TQ7', 'M62P']) {
    assert.ok(GATE_CODE_PATTERN.test(style), style);
    assert.equal(normalizeGateCode(style.toLowerCase()), style);
    assert.equal((await verify(style)).status, 404, `${style} is a well-formed code (just not a live one)`);
  }
  for (const bad of ['ABCD', '1234', 'A4G', 'A4G55', 'A4-G5!']) assert.equal(normalizeGateCode(bad), null, bad);
  assert.equal(normalizeGateCode('a4-g5'), 'A4G5');
  assert.equal(normalizeGateCode('CCGP:a4g5', 'CCGP:'), 'A4G5');

  // The old fixed "AR24" generator is gone, and the shared one uses node:crypto.
  assert.equal(GatePassModule.generateVerificationCode, undefined);
  const modelSource = fs.readFileSync(new URL('../src/models/GatePass.js', import.meta.url), 'utf8');
  assert.ok(!modelSource.includes('Math.random'));
  const sequence = [0, 24, 1, 25]; // alphabet index → "A", "2", "B", "3"
  const draw = mock.method(crypto, 'randomInt', () => sequence.shift());
  try {
    assert.equal(generateGatePassSecurityCode(), 'A2B3');
    assert.equal(draw.mock.callCount(), 4);
  } finally {
    draw.mock.restore();
  }
});

test('the code is issued once and never regenerated by refreshing, opening the QR or verifying', async () => {
  const { id, student, code } = await approvedPass('dean');
  const codes = new Set([code]);
  for (let i = 0; i < 3; i += 1) {
    const qr = await ctx.request('GET', `/gate-pass/${id}/qr`, { token: student.token });
    assert.equal(qr.status, 200);
    codes.add(qr.body.code);
    await ctx.request('GET', `/gate-pass/${id}`, { token: student.token });
    await ctx.request('GET', '/gate-pass', { token: student.token });
    assert.equal((await verify(code)).status, 200);
    codes.add(await storedCode(id));
  }
  assert.equal(codes.size, 1, 'one code throughout');
});

test('QR holds only an opaque code — no student data', async () => {
  const { id, student, code } = await approvedPass('principal');
  const qr = await ctx.request('GET', `/gate-pass/${id}/qr`, { token: student.token });
  assert.equal(qr.body.payload, `CCGP:${code}`);
  for (const secret of [student.u.name, student.u.rollNo, '9876504321', 'CSE', String(student.u._id), id]) {
    assert.ok(!qr.body.payload.includes(secret), `QR must not contain ${secret}`);
  }
});

test('security verification: valid, invalid, expired, used, unauthorized — and verifying never completes the pass', async () => {
  const { id, code } = await approvedPass('ao');
  const ok = await verify(code.toLowerCase());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.valid, true);
  assert.equal(ok.body.nextAction, 'out');
  assert.equal(ok.body.pass.passType, 'emergency');
  assert.equal(ok.body.pass.emergencyAuthority, 'ao');
  assert.equal(ok.body.pass.verificationCode, undefined);
  let stored = await ctx.models.GatePass.findById(id).lean();
  assert.equal(stored.status, 'approved', 'verifying alone changes nothing');
  assert.equal(stored.actualExit, undefined);

  assert.equal((await verify('Z9Z9')).status, 404);
  assert.equal((await verify('ZZ!9')).status, 422);
  for (const role of ['principal', 'ao', 'faculty']) {
    assert.equal((await verify(code, staff[role])).status, 403, `${role} cannot verify`);
    assert.equal((await out(id, code, staff[role])).status, 403, `${role} cannot record OUT`);
  }
  assert.equal((await out(id, 'Z9Z9')).status, 422, 'wrong code for this pass');
  assert.equal((await out(id)).status, 422, 'OUT requires the code');

  const res = await out(id, code);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'active');
  stored = await ctx.models.GatePass.findById(id).select('+verificationCode').lean();
  assert.equal(stored.verificationCode, undefined, 'credential consumed');
  assert.ok(await ctx.models.Activity.exists({ entityId: id, action: 'gate_pass.code_consumed' }));
  assert.equal((await verify(code)).status, 404, 'used code fails');
  assert.equal((await out(id, code)).status, 409, 'cannot be used twice');

  const expired = await approvedPass('principal');
  await ctx.models.GatePass.updateOne({ _id: expired.id }, { verificationExpiry: new Date(Date.now() - 1000) });
  assert.equal((await verify(expired.code)).status, 404, 'expired code fails');
  assert.equal((await out(expired.id, expired.code)).status, 422);
  assert.equal((await ctx.models.GatePass.findById(expired.id)).status, 'expired');
});

test('two guards confirming at once consume the credential exactly once', async () => {
  const { id, code } = await approvedPass('chairman');
  const results = await Promise.all([out(id, code), out(id, code, security2)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await ctx.models.Activity.countDocuments({ entityId: id, action: 'gate_pass.code_consumed' })), 1);
});

test('normal gate pass still needs parent OTP, still runs faculty → HOD → principal, and uses the new code format', async () => {
  const student = await newStudent();
  const day = new Date().toISOString().slice(0, 10);
  const res = await ctx.request('POST', '/gate-pass', {
    token: student.token,
    body: { regarding: 'outing', description: 'Weekend at home', fromDate: day, toDate: day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.passType, 'normal');
  assert.equal(res.body.status, 'pending_faculty');
  const id = res.body._id;
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: staff.faculty.token, body: { action: 'forward' } })).status, 422, 'OTP still required');
  assert.equal((await decide(id, staff.principal)).status, 422, 'emergency review cannot shortcut a normal pass');

  assert.equal((await ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: staff.faculty.token })).status, 200);
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
  assert.equal((await ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: staff.faculty.token, body: { otp: testOtpProvider.peek(rec._id) } })).status, 200);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: staff.faculty.token, body: { action: 'forward' } })).status, 200);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/hod-review`, { token: staff.hod.token, body: { action: 'forward' } })).status, 200);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/principal-review`, { token: staff.principal.token, body: { action: 'approve' } })).status, 200);
  const code = await storedCode(id);
  assert.match(code, GATE_CODE_PATTERN);
  assert.equal((await out(id, code)).status, 200);
});

test('return-to-campus still works after an emergency exit, with its own separate credential', async () => {
  const { id, student, code } = await approvedPass('principal');
  assert.equal((await out(id, code)).status, 200);
  const back = await ctx.request('POST', `/gate-pass/${id}/return-location/verify`, {
    token: student.token,
    body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
  });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.match(back.body.code, GATE_CODE_PATTERN);
  assert.match(back.body.payload, /^CCRT:/, 'return QR is the separate return token');
  const stored = await ctx.models.GatePass.findById(id).select('+returnCode +returnToken +verificationCode').lean();
  assert.equal(stored.returnCode, back.body.code);
  assert.equal(stored.verificationCode, undefined, 'exit credential already consumed; return credential is separate');
  assert.equal((await verify(back.body.code)).status, 404, 'a return code is not an exit code');
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/in`, { token: staff.security.token, body: { code: back.body.code } })).status, 200);
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'completed');
});
