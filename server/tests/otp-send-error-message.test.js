/**
 * Regression: in production, clicking "Send OTP" showed only
 * "Internal server error". The SMS provider threw a deliberate, user-safe
 * error (e.g. 503 "The college SMS service is not configured yet") but the
 * error handler replaced every 5xx message in production, so nobody could
 * tell what to fix. Deliberate ApiError messages now reach the user;
 * unexpected crashes stay masked.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { env } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/error.js';
import { ApiError } from '../src/utils/http.js';

let ctx;
let faculty;

before(async () => {
  ctx = await startServer();
  const f = await ctx.createUser({ role: 'faculty', name: 'Navanitha', department: 'CSE', section: 'A', teachingYears: [3] });
  faculty = await ctx.loginWeb(f);
});
after(async () => {
  await ctx.stop();
});

async function newPass() {
  const student = await ctx.createUser({ name: 'Otp Student', department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321' });
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: student._id, department: 'CSE', section: 'A', regarding: 'outing', description: 'Family function',
    fromDate: day, toDate: day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
  });
  return String(pass._id);
}

/** Run the request with production error handling and SMS switched on. */
async function asProductionWithSms(sms, fn) {
  const saved = { isProd: env.isProd, smsEnabled: env.otp.smsEnabled, provider: env.otp.provider, sms: { ...env.sms } };
  Object.assign(env, { isProd: true });
  Object.assign(env.otp, { smsEnabled: true, provider: 'college_sms' });
  Object.assign(env.sms, sms);
  try {
    return await fn();
  } finally {
    env.isProd = saved.isProd;
    Object.assign(env.otp, { smsEnabled: saved.smsEnabled, provider: saved.provider });
    Object.assign(env.sms, saved.sms);
  }
}

const sendOtp = (id) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: faculty.token });

test('production: unconfigured SMS gateway -> the faculty sees why, not "Internal server error"', async () => {
  const id = await newPass();
  const res = await asProductionWithSms({ apiKey: '', senderId: '', otpTemplateId: '', exitTemplateId: '' }, () => sendOtp(id));
  assert.equal(res.status, 503);
  assert.equal(res.body.message, 'The college SMS service is not configured yet. Ask an administrator.');
});

test('production: a non-https SMS_API_URL is still refused, with a readable reason', async () => {
  const id = await newPass();
  const res = await asProductionWithSms(
    { apiKey: 'k', senderId: 's', otpTemplateId: 't1', exitTemplateId: 't2', apiUrl: 'http://sms.example.invalid/send' },
    () => sendOtp(id)
  );
  assert.equal(res.status, 503);
  assert.equal(res.body.message, 'The college SMS service is not configured securely. Ask an administrator.');
});

test('production: unexpected (non-ApiError) crashes are still masked', () => {
  const run = (err) => {
    let out;
    const res = { status(s) { out = { status: s }; return this; }, json(b) { out.body = b; } };
    const saved = env.isProd;
    env.isProd = true;
    const log = console.error;
    console.error = () => {};
    try {
      errorHandler(err, {}, res, () => {});
    } finally {
      env.isProd = saved;
      console.error = log;
    }
    return out;
  };
  const crash = run(new TypeError("Cannot read properties of undefined (reading 'secret')"));
  assert.deepEqual(crash, { status: 500, body: { message: 'Internal server error' } });
  const deliberate = run(new ApiError(502, 'Could not reach the SMS service. Please try again.'));
  assert.deepEqual(deliberate, { status: 502, body: { message: 'Could not reach the SMS service. Please try again.' } });
});
