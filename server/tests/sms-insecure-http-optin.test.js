/**
 * The college SMS vendor (bulksms.2020sms.com) has no HTTPS endpoint, so the
 * production HTTPS-only rule blocked every parent OTP with 503 "not configured
 * securely". SMS_ALLOW_INSECURE_HTTP=true is the explicit opt-in that lets
 * production send over http; without it the refusal stays.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { collegeSmsProvider } from '../src/services/otp/providers/collegeSmsProvider.js';

async function withProdSms(overrides, fn) {
  const saved = { isProd: env.isProd, sms: { ...env.sms } };
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const realError = console.error;
  const calls = [];
  const warnings = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('ok', { status: 200 });
  };
  console.warn = (m) => warnings.push(String(m));
  console.error = () => {};
  env.isProd = true;
  Object.assign(env.sms, { apiKey: 'k3y', senderId: 'JNNIE', otpTemplateId: 't1', exitTemplateId: 't2' }, overrides);
  try {
    return await fn({ calls, warnings });
  } finally {
    env.isProd = saved.isProd;
    Object.assign(env.sms, saved.sms);
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.error = realError;
  }
}

const send = () => collegeSmsProvider.sendOtp({ to: '9876543210', studentName: 'A', otp: '1234' });
const HTTP_URL = 'http://bulksms.2020sms.com/vb/apikey.php';

test('production without the opt-in: http is refused and nothing is sent', async () => {
  await withProdSms({ apiUrl: HTTP_URL, allowInsecureHttp: false }, async ({ calls }) => {
    await assert.rejects(send(), (e) => e.status === 503 && /configured securely/.test(e.message));
    assert.equal(calls.length, 0);
  });
});

test('production with SMS_ALLOW_INSECURE_HTTP=true: the OTP goes out over http with a warning', async () => {
  await withProdSms({ apiUrl: HTTP_URL, allowInsecureHttp: true }, async ({ calls, warnings }) => {
    await send();
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^http:\/\/bulksms\.2020sms\.com\//);
    assert.ok(warnings.some((w) => /plain http/.test(w)), 'each insecure send is logged');
    assert.ok(!warnings.some((w) => w.includes('k3y')), 'the API key is never logged');
  });
});

test('the opt-in does not touch https: an https URL is sent as-is with no warning', async () => {
  await withProdSms({ apiUrl: 'https://sms.example/send', allowInsecureHttp: true }, async ({ calls, warnings }) => {
    await send();
    assert.match(calls[0], /^https:\/\//);
    assert.equal(warnings.length, 0);
  });
});
