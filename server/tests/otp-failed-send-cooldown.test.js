/**
 * Regression: when the SMS gateway failed (e.g. not configured / unreachable),
 * the OTP record was marked "failed" but still started the 60-second resend
 * cooldown, so the faculty (web and the Kotlin app) had to wait a minute to
 * retry although nothing had been sent. A failed send no longer counts
 * toward the cooldown; a delivered one still does.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { env } from '../src/config/env.js';

let ctx;
let faculty;

before(async () => {
  ctx = await startServer();
  const f = await ctx.createUser({ role: 'faculty', name: 'Cooldown Faculty', department: 'CSE', section: 'A', teachingYears: [3] });
  faculty = await ctx.loginMobile(f);
});
after(async () => {
  await ctx.stop();
});

async function newPass() {
  const student = await ctx.createUser({ name: 'Cooldown Student', department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321' });
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: student._id, department: 'CSE', section: 'A', regarding: 'outing', description: 'Family function',
    fromDate: day, toDate: day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
  });
  return String(pass._id);
}

const sendOtp = (id) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: faculty.token, headers: { 'x-client-platform': 'mobile' } });
const otpState = (id) => ctx.request('GET', `/gate-pass/${id}/parent-otp`, { token: faculty.token, headers: { 'x-client-platform': 'mobile' } });

/** SMS switched on with no gateway credentials: every send fails with 503. */
async function withBrokenGateway(fn) {
  const saved = { otp: { ...env.otp }, sms: { ...env.sms } };
  Object.assign(env.otp, { smsEnabled: true, provider: 'college_sms' });
  Object.assign(env.sms, { apiKey: '', senderId: '', otpTemplateId: '', exitTemplateId: '' });
  try {
    return await fn();
  } finally {
    Object.assign(env.otp, saved.otp);
    Object.assign(env.sms, saved.sms);
  }
}

test('a failed SMS send does not start the resend cooldown: retrying right away works', async () => {
  const id = await newPass();
  const failed = await withBrokenGateway(() => sendOtp(id));
  assert.equal(failed.status, 503);

  const state = await otpState(id);
  assert.equal(state.status, 200);
  assert.equal(state.body.status, 'failed');
  assert.equal(state.body.resendAvailableAt, null, 'no countdown after a failed send');

  // Gateway fixed (here: test provider) — the immediate retry is accepted, not 429.
  const retry = await sendOtp(id);
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.status, 'active');
});

test('a delivered OTP still enforces the cooldown', async () => {
  const id = await newPass();
  assert.equal((await sendOtp(id)).status, 200);
  const again = await sendOtp(id);
  assert.equal(again.status, 429);
});
