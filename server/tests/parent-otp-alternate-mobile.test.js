/**
 * Parent OTP to a different number: the class faculty sees the registered
 * parent mobile by default and may send the OTP to another number when that
 * one is not reachable — only with a valid mobile and a reason, always audited,
 * and visible on the pass to the HOD / principal who review it next.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';

const REGISTERED = '9876504321';
const ALTERNATE = '9123456780';
let ctx;
let faculty, otherFaculty, student, hod;
let n = 0;

before(async () => {
  ctx = await startServer();
  const [f, o, h] = await Promise.all([
    ctx.createUser({ role: 'faculty', name: 'Class Faculty', department: 'CSE', section: 'A', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Section B Faculty', department: 'CSE', section: 'B', teachingYears: [3] }),
    ctx.createUser({ role: 'hod', name: 'CSE HOD', department: 'CSE' }),
  ]);
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  otherFaculty = { u: o, ...(await ctx.loginWeb(o)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
});
after(async () => ctx?.stop());

async function newPass() {
  n += 1;
  const s = await ctx.createUser({ name: `Alt Student ${n}`, department: 'CSE', section: 'A', year: 3, parentPhone: REGISTERED });
  student = { u: s, ...(await ctx.loginWeb(s)) };
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: s._id, department: 'CSE', section: 'A', regarding: 'outing', description: 'Family function',
    fromDate: day, toDate: day, parentPhone: REGISTERED,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
  });
  return String(pass._id);
}

const send = (id, body, who = faculty) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: who.token, body });
const latest = (id) => ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });

test('the faculty sees the registered parent number by default and the OTP goes there', async () => {
  const id = await newPass();
  const state = await ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: faculty.token });
  assert.equal(state.status, 200);
  assert.equal(state.body.parentMobile, REGISTERED);
  const res = await send(id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await latest(id)).parentMobileMasked, '******4321');
  assert.notEqual((await latest(id)).alternateMobile, true);
});

test('the faculty can send the OTP to an edited number with a reason; it is recorded on the pass', async () => {
  const id = await newPass();
  const res = await send(id, { mobile: `+91 ${ALTERNATE}`, reason: 'Father not reachable, mother’s number' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.maskedMobile, '******6780');
  assert.match(res.body.message, /alternate/i);
  const rec = await latest(id);
  assert.equal(rec.parentMobileMasked, '******6780');
  assert.equal(rec.alternateMobile, true);

  const otp = testOtpProvider.peek(rec._id);
  const ok = await ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: faculty.token, body: { otp } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'parent_verified');
  assert.equal(ok.body.parentVerifiedAlternate.mobileMasked, '******6780');
  assert.match(ok.body.parentVerifiedAlternate.reason, /not reachable/);

  // Registered number on the account is left unchanged.
  assert.equal((await ctx.models.User.findById(student.u._id)).parentPhone, REGISTERED);

  // The next reviewer sees that a different number confirmed the request.
  await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: faculty.token, body: { action: 'forward' } });
  const asHod = await ctx.request('GET', `/gate-pass/${id}`, { token: hod.token });
  assert.equal(asHod.body.parentVerifiedAlternate.mobileMasked, '******6780');

  const logs = await ctx.models.SecurityLog.find({ event: 'OTP_ALTERNATE_MOBILE' }).lean();
  assert.ok(logs.length >= 1, 'alternate number is in Security & Logs');
  assert.ok(!JSON.stringify(logs).includes(ALTERNATE), 'the log holds a masked number only');
});

test('an edited number needs a valid mobile and a reason', async () => {
  const id = await newPass();
  for (const mobile of ['12345', '0000000000', '98765abcde', '+1 415 555 0100', '5123456789']) {
    const r = await send(id, { mobile, reason: 'Not reachable' });
    assert.equal(r.status, 422, `${mobile} is rejected`);
  }
  assert.equal((await send(id, { mobile: ALTERNATE })).status, 422, 'reason is required');
  assert.equal((await send(id, { mobile: ALTERNATE, reason: 'x' })).status, 422, 'reason too short');
  assert.equal((await send(id, { mobile: { $ne: null }, reason: 'Not reachable' })).status, 422, 'operator object rejected');
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: id }), 0, 'nothing was sent');

  // Typing the registered number again is just the normal send — no reason needed.
  const same = await send(id, { mobile: REGISTERED });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.notEqual((await latest(id)).alternateMobile, true);
});

test('only the student’s class faculty can send to an edited number', async () => {
  const id = await newPass();
  assert.equal((await send(id, { mobile: ALTERNATE, reason: 'Not reachable' }, otherFaculty)).status, 403);
  assert.equal((await send(id, { mobile: ALTERNATE, reason: 'Not reachable' }, student)).status, 403);
  assert.equal(await ctx.models.OutpassOtp.countDocuments({ gatePass: id }), 0);
});
