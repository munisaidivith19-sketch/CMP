import crypto from 'node:crypto';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { env } from '../src/config/env.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';
import { renderOtpSms } from '../src/services/otp/providers/collegeSmsProvider.js';
import { generateOtp, maskMobile } from '../src/services/otp/otpService.js';

let ctx;
let faculty; // class in-charge of CSE year 3 section A
let faculty2; // second faculty of the same class (keeps each under the per-user OTP rate limit)
let faculty3; // third faculty of the same class
let wrongYear; // CSE section A, but teaches year 2 — can see the request, is not assigned to the class
let sectionB; // same department, different section
let deptFaculty; // same department, no class assigned
let admin;
let studentA;
let n = 0;

const PHONE = '9876504321';

before(async () => {
  ctx = await startServer();
  const [f, f2, f3, wy, b, d, a, s] = await Promise.all([
    ctx.createUser({ role: 'faculty', name: 'Class Faculty', department: 'CSE', section: 'A', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Second Class Faculty', department: 'CSE', section: 'A', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Third Class Faculty', department: 'CSE', section: 'A', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Second Year Faculty', department: 'CSE', section: 'A', teachingYears: [2] }),
    ctx.createUser({ role: 'faculty', name: 'Section B Faculty', department: 'CSE', section: 'B', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Dept Faculty', department: 'CSE' }),
    ctx.createUser({ role: 'admin', name: 'Admin' }),
    ctx.createUser({ name: 'Rahul Kumar', department: 'CSE', section: 'A', year: 3 }),
  ]);
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  faculty2 = { u: f2, ...(await ctx.loginWeb(f2)) };
  faculty3 = { u: f3, ...(await ctx.loginWeb(f3)) };
  wrongYear = { u: wy, ...(await ctx.loginWeb(wy)) };
  sectionB = { u: b, ...(await ctx.loginWeb(b)) };
  deptFaculty = { u: d, ...(await ctx.loginWeb(d)) };
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  studentA = { u: s, ...(await ctx.loginWeb(s)) };
});
after(async () => {
  await ctx.stop();
});

/** A fresh pending request from a new CSE-3A student. */
async function newPass(overrides = {}) {
  n += 1;
  const student = await ctx.createUser({ name: `Student ${n}`, department: 'CSE', section: 'A', year: 3 });
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: student._id,
    department: 'CSE',
    section: 'A',
    regarding: 'outing',
    description: 'Family function',
    fromDate: day,
    toDate: day,
    parentPhone: PHONE,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    ...overrides,
  });
  return String(pass._id);
}

const sendOtp = (id, who = faculty) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: who.token });
const verify = (id, otp, who = faculty) => ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: who.token, body: { otp } });
const latestOtp = (id) => ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 }).select('+otpHash');
const plainOtp = async (id) => testOtpProvider.peek((await latestOtp(id))._id);
/**
 * True if `otp` is a whole value (or an "otp" key) anywhere in `data`. Exact
 * matching, because a 4-digit code can appear inside phone numbers, ids and dates.
 */
const holdsOtp = (data, otp) => {
  if (data === otp) return true;
  if (data && typeof data === 'object') return Object.entries(data).some(([k, v]) => k.toLowerCase() === 'otp' || holdsOtp(v, otp));
  return false;
};
const wrongOf = (otp) => String((Number(otp) + 1) % 10 ** otp.length).padStart(otp.length, '0');
const forward = (id, who = faculty) => ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: who.token, body: { action: 'forward' } });
/** Let the resend cooldown pass without waiting. */
const skipCooldown = (id) => ctx.models.OutpassOtp.updateMany({ gatePass: id }, { $set: { lastSentAt: new Date(Date.now() - 61000) } });

test('OTP generation: 4 secure digits, 10-minute expiry, never in the API response, only a hash in the database', async () => {
  const id = await newPass();
  const res = await sendOtp(id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.parentMobile, PHONE, 'the assigned faculty sees the full number');
  assert.equal(res.body.otpLength, 4);
  assert.equal(res.body.attemptsLeft, 5);
  assert.equal(res.body.devMode, true);
  const minutes = (new Date(res.body.expiresAt) - Date.now()) / 60000;
  assert.ok(minutes > 9.9 && minutes <= 10, `expiry ${minutes} min`);

  const otp = await plainOtp(id);
  assert.match(otp, /^\d{4}$/);
  assert.ok(!holdsOtp(res.body, otp), 'OTP never returned to the faculty');

  const state = await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: faculty.token });
  assert.equal(state.status, 200);
  assert.ok(!holdsOtp(state.body, otp));
  assert.ok(!holdsOtp((await ctx.request('GET', `/gate-pass/${id}`, { token: faculty.token })).body, otp));
  assert.ok(!holdsOtp((await ctx.request('GET', '/gate-pass', { token: faculty.token })).body, otp));

  const doc = await ctx.models.OutpassOtp.findOne({ gatePass: id }).select('+otpHash').lean();
  assert.match(doc.otpHash, /^[0-9a-f]{64}$/);
  assert.ok(!holdsOtp(doc, otp), 'no plaintext OTP stored');
  assert.equal(doc.parentMobileMasked, '******4321');
  assert.ok(!JSON.stringify(doc).includes(PHONE), 'full parent number not copied into the OTP record');
});

test('OTP is exactly 4 digits, read from OTP_LENGTH, with leading zeros; other lengths are rejected without costing an attempt', async () => {
  assert.equal(env.otp.length, 4);
  const firstDigits = new Set();
  for (let i = 0; i < 4000; i += 1) {
    const code = generateOtp();
    assert.match(code, /^\d{4}$/);
    firstDigits.add(code[0]);
  }
  assert.ok(firstDigits.has('0'), 'zero-padded codes are generated');

  // Force the random draw to 427 → "0427", then verify it end to end.
  const id = await newPass();
  const draw = mock.method(crypto, 'randomInt', () => 427);
  try {
    assert.equal((await sendOtp(id, faculty3)).status, 200);
  } finally {
    draw.mock.restore();
  }
  assert.equal(await plainOtp(id), '0427');

  for (const bad of ['042712', '123456', '427', '04 7', '04a7', '']) {
    const res = await verify(id, bad, faculty3);
    assert.equal(res.status, 422, `"${bad}" rejected`);
    assert.match(res.body.message, /4-digit OTP/);
  }
  assert.equal((await latestOtp(id)).attempts, 0, 'wrong-length input does not burn attempts');

  const ok = await verify(id, '0427', faculty3);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'parent_verified');
});

test('parent mobile: full for the assigned faculty and admin; masked for other faculty; no access for students', async () => {
  const id = await newPass();
  const owner = await ctx.models.User.findById((await ctx.models.GatePass.findById(id)).student);
  const ownerLogin = await ctx.loginWeb(owner);
  const inList = async (who) => (await ctx.request('GET', '/gate-pass', { token: who.token })).body.passes.find((p) => p._id === id);

  for (const who of [faculty, admin]) {
    assert.equal((await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: who.token })).body.parentMobile, PHONE);
    assert.equal((await ctx.request('GET', `/gate-pass/${id}`, { token: who.token })).body.parentPhone, PHONE);
    assert.equal((await inList(who)).parentPhone, PHONE);
  }

  // Can see the request, but are not assigned to this class (wrong year / no class at all).
  for (const who of [wrongYear, deptFaculty]) {
    const view = await ctx.request('GET', `/gate-pass/${id}`, { token: who.token });
    assert.equal(view.status, 200);
    assert.equal(view.body.parentPhone, '******4321');
    assert.equal((await inList(who)).parentPhone, '******4321');
    for (const res of [await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: who.token }), await sendOtp(id, who)]) {
      assert.equal(res.status, 403);
      assert.ok(!JSON.stringify(res.body).includes(PHONE));
    }
  }

  // Students (the pass owner or anyone else) cannot use the parent-verification endpoints.
  for (const who of [studentA, ownerLogin]) {
    for (const res of [await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: who.token }), await sendOtp(id, who)]) {
      assert.equal(res.status, 403);
      assert.ok(!JSON.stringify(res.body).includes(PHONE));
    }
  }
  const other = await ctx.request('GET', `/gate-pass/${id}`, { token: studentA.token });
  assert.equal(other.status, 403);
  assert.ok(!JSON.stringify(other.body).includes(PHONE));
});

test('authorization: students, other sections and unassigned faculty cannot request, view or verify', async () => {
  const id = await newPass();
  for (const who of [studentA, sectionB, deptFaculty]) {
    assert.equal((await sendOtp(id, who)).status, 403);
    assert.equal((await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: who.token })).status, 403);
    assert.equal((await verify(id, '1234', who)).status, 403);
  }
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: id }), 0);

  await sendOtp(id);
  const otp = await plainOtp(id);
  assert.equal((await verify(id, otp, sectionB)).status, 403, 'a valid OTP does not help an unrelated faculty');
  assert.equal((await verify(id, otp, studentA)).status, 403);
  assert.equal((await latestOtp(id)).attempts, 0, 'rejected callers do not burn attempts');
  assert.equal((await forward(id, sectionB)).status, 403);
});

test('a student in another year of the same section is outside the faculty scope', async () => {
  const id = await newPass();
  const year2 = await ctx.createUser({ name: 'Second year', department: 'CSE', section: 'A', year: 2 });
  await ctx.models.GatePass.updateOne({ _id: id }, { student: year2._id });
  assert.equal((await sendOtp(id)).status, 403);
});

test('forwarding to HOD is blocked until the parent OTP is verified', async () => {
  const id = await newPass();
  const blocked = await forward(id);
  assert.equal(blocked.status, 422);
  assert.match(blocked.body.message, /OTP/);
  await sendOtp(id);
  assert.equal((await forward(id)).status, 422, 'sending an OTP is not enough');
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'pending_faculty');
});

test('wrong OTP, then correct OTP → PARENT_VERIFIED → forward to HOD; the OTP cannot be reused', async () => {
  const id = await newPass();
  await sendOtp(id);
  const otp = await plainOtp(id);

  const wrong = await verify(id, wrongOf(otp));
  assert.equal(wrong.status, 422);
  assert.match(wrong.body.message, /4 attempts left/);
  assert.equal((await verify(id, 'abc')).status, 422, 'non-digit input rejected by validation');

  const ok = await verify(id, otp);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'parent_verified');
  assert.ok(ok.body.parentVerifiedAt);
  assert.equal(ok.body.parentVerifiedBy.name, 'Class Faculty');
  const rec = await latestOtp(id);
  assert.equal(rec.status, 'used');
  assert.ok(rec.usedAt);
  assert.equal(testOtpProvider.peek(rec._id), null, 'used OTP dropped from the test provider');

  assert.equal((await verify(id, otp)).status, 422, 'repeated verification refused');
  assert.equal((await sendOtp(id)).status, 422, 'no new OTP once verified');

  const fwd = await forward(id);
  assert.equal(fwd.status, 200, JSON.stringify(fwd.body));
  assert.equal(fwd.body.status, 'pending_hod');

  const actions = await ctx.models.Activity.find({ entityId: id }).distinct('action');
  for (const a of ['gate_pass.otp_requested', 'gate_pass.otp_verify_failed', 'gate_pass.otp_verified', 'gate_pass.parent_verified']) {
    assert.ok(actions.includes(a), `audit ${a}`);
  }
  const summaries = (await ctx.models.Activity.find({ entityId: id }).lean()).map((x) => x.summary || '').join(' ');
  assert.ok(!summaries.split(/\s+/).includes(otp) && !summaries.includes(PHONE), 'audit never holds the OTP or full number');
});

test('used OTP cannot verify again at the service level either', async () => {
  const { verifyOtp } = await import('../src/services/otp/otpService.js');
  const id = await newPass();
  await sendOtp(id);
  const otp = await plainOtp(id);
  await verifyOtp({ gatePassId: id, otp });
  await assert.rejects(verifyOtp({ gatePassId: id, otp }), (e) => e.status === 422);
});

test('expired OTP is refused and marked expired', async () => {
  const id = await newPass();
  await sendOtp(id);
  const otp = await plainOtp(id);
  await ctx.models.OutpassOtp.updateOne({ gatePass: id }, { expiresAt: new Date(Date.now() - 1000) });
  const state = await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: faculty.token });
  assert.equal(state.body.status, 'expired');
  const res = await verify(id, otp);
  assert.equal(res.status, 410);
  assert.equal((await latestOtp(id)).status, 'expired');
  assert.ok(await ctx.models.Activity.exists({ entityId: id, action: 'gate_pass.otp_expired' }));
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'pending_faculty');
});

test('maximum 5 attempts: the OTP locks and even the correct code is then refused', async () => {
  const id = await newPass();
  await sendOtp(id, faculty2);
  const otp = await plainOtp(id);
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await verify(id, wrongOf(otp), faculty2)).status);
  assert.deepEqual(statuses, [422, 422, 422, 422, 429]);
  assert.equal((await latestOtp(id)).status, 'locked');
  assert.equal((await verify(id, otp, faculty2)).status, 422, 'locked OTP is dead');
  assert.equal((await latestOtp(id)).attempts, 5);
});

test('concurrent guesses cannot exceed the attempt limit', async () => {
  const id = await newPass();
  await sendOtp(id, faculty2);
  const otp = await plainOtp(id);
  await Promise.all(Array.from({ length: 8 }, () => verify(id, wrongOf(otp), faculty2)));
  const rec = await latestOtp(id);
  assert.ok(rec.attempts <= 5, `attempts ${rec.attempts}`);
  assert.equal(rec.status, 'locked');
});

test('resend: 60-second cooldown, then a new OTP that invalidates the previous one', async () => {
  const id = await newPass();
  await sendOtp(id);
  const first = await plainOtp(id);
  const again = await sendOtp(id);
  assert.equal(again.status, 429);
  assert.match(again.body.message, /wait \d+ second/);
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: id }), 1);

  await skipCooldown(id);
  const resent = await sendOtp(id);
  assert.equal(resent.status, 200);
  assert.equal(resent.body.resent, true);
  assert.equal(resent.body.attemptsLeft, 5);
  const second = await plainOtp(id);
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: id, status: 'superseded' }), 1);
  assert.ok(await ctx.models.Activity.exists({ entityId: id, action: 'gate_pass.otp_resent' }));

  if (first !== second) assert.equal((await verify(id, first)).status, 422, 'previous OTP no longer works');
  assert.equal((await verify(id, second)).status, 200);
});

test('admin can act on the faculty stage (existing admin override)', async () => {
  const id = await newPass();
  assert.equal((await sendOtp(id, admin)).status, 200);
  assert.equal((await verify(id, await plainOtp(id), admin)).status, 200);
});

test('rejecting needs no OTP, from either faculty-stage status', async () => {
  const id = await newPass();
  const res = await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: faculty.token, body: { action: 'reject', reason: 'Parent unreachable' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'rejected');
  assert.equal((await sendOtp(id)).status, 422);
});

test('development OTP portal: admin only, shows the active test OTP, absent in production', async () => {
  const id = await newPass();
  await sendOtp(id);
  const otp = await plainOtp(id);

  assert.equal((await ctx.request('GET', '/dev/otp', { token: faculty.token })).status, 403);
  assert.equal((await ctx.request('GET', '/dev/otp', { token: studentA.token })).status, 403);
  assert.equal((await ctx.request('GET', '/dev/otp')).status, 401);

  const portal = await ctx.request('GET', '/dev/otp', { token: admin.token });
  assert.equal(portal.status, 200);
  assert.equal(portal.body.provider, 'test');
  const row = portal.body.otps.find((o) => String(o.gatePassId) === id);
  assert.equal(row.otp, otp);
  assert.equal(row.parentMobile, '******4321');
  assert.equal(row.status, 'active');
  assert.equal(row.attempts, 0);
  assert.equal(row.maxAttempts, 5);
  assert.match(row.passRef, /^GP-[0-9A-F]{6}$/);
  assert.ok(portal.body.otps.filter((o) => o.status !== 'active').every((o) => o.otp === null), 'only active OTPs are shown');

  env.isProd = true;
  try {
    assert.equal(env.otp.devPortalInProduction, false, 'off by default');
    assert.equal((await ctx.request('GET', '/dev/otp', { token: admin.token })).status, 404);

    // Explicit opt-in (DEV_OTP_PORTAL=true) for a deployment with no SMS provider yet — still admins only.
    env.otp.devPortalInProduction = true;
    const enabled = await ctx.request('GET', '/dev/otp', { token: admin.token });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.otps.find((o) => String(o.gatePassId) === id).otp, otp);
    assert.equal((await ctx.request('GET', '/dev/otp', { token: faculty.token })).status, 403);
    assert.equal((await ctx.request('GET', '/dev/otp', { token: studentA.token })).status, 403);
    assert.equal((await ctx.request('GET', '/dev/otp')).status, 401);
  } finally {
    env.isProd = false;
    env.otp.devPortalInProduction = false;
  }
});

test('providers: test provider stores in memory only; college SMS provider is a placeholder that refuses to send', async () => {
  testOtpProvider.forget('x');
  await testOtpProvider.sendOtp({ otpId: 'x', otp: '1234', maskedMobile: '******0000', expiresAt: new Date(Date.now() + 60000) });
  assert.equal(testOtpProvider.peek('x'), '1234');
  testOtpProvider.forget('x');
  assert.equal(testOtpProvider.peek('x'), null);

  assert.equal(maskMobile('+91 98765 04321'), '******4321');
  assert.equal(maskMobile('12'), '******');
  assert.equal(
    renderOtpSms({ studentName: 'Rahul Kumar', otp: '0427' }),
    'Dear Parent, Rahul Kumar has requested a gate pass. For confirmation, your OTP is 0427. This OTP is valid for 10 minutes. Do not share this OTP with anyone except the authorized college faculty.'
  );

  const id = await newPass();
  env.otp.provider = 'college_sms';
  try {
    const res = await sendOtp(id);
    assert.equal(res.status, 503);
    assert.equal((await latestOtp(id)).status, 'failed');
    assert.equal((await latestOtp(id)).provider, 'college_sms');
  } finally {
    env.otp.provider = 'test';
  }
});
