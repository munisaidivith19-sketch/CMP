import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

/**
 * Troubleshooting → SMS / OTP test (POST /api/console/soc/diagnostics/sms-test).
 * The SMS vendor is a fake: global fetch is replaced while a test runs.
 */
let ctx;
let env;
let it;
let admin;
let calls = [];
const realFetch = globalThis.fetch;
const VENDOR = 'https://sms.vendor.test/api.php';

const run = (who, phone) => ctx.request('POST', '/console/soc/diagnostics/sms-test', { token: who.token, body: { phone } });

function configure() {
  Object.assign(env.sms, { apiKey: 'k-secret', senderId: 'JNNIET', otpTemplateId: 'T-OTP', exitTemplateId: 'T-EXIT', apiUrl: VENDOR });
}
function fakeVendor(ok = true) {
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith(VENDOR)) {
      calls.push(new URL(url));
      return new Response(ok ? 'ok' : 'error', { status: ok ? 200 : 500 });
    }
    return realFetch(url, opts);
  };
}

before(async () => {
  ctx = await startServer();
  ({ env } = await import('../src/config/env.js'));
  const u = await ctx.createUser({ role: 'super_admin' });
  it = { u, ...(await ctx.loginWeb(u)) };
  const a = await ctx.createUser({ role: 'admin', employeeId: 'E-SMS1' });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
  Object.assign(env.sms, { apiKey: '', senderId: '', otpTemplateId: '', exitTemplateId: '' });
});
after(() => ctx.stop());

test('only IT support can run it; the number must be a valid Indian mobile', async () => {
  assert.equal((await run(admin, '9876543210')).status, 403);
  const bad = await run(it, '12345');
  assert.equal(bad.status, 422);
});

test('not configured: both messages are SKIPPED and the missing settings are named (never their values)', async () => {
  const r = await run(it, '98765 43210');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.deepEqual(r.body.results.map((x) => x.status), ['SKIPPED', 'SKIPPED']);
  assert.match(r.body.results[0].detail, /SMS_API_KEY/);
  assert.equal(r.body.to, '******3210');
  assert.equal(calls.length, 0);
});

test('configured: sends the Gate Pass OTP SMS and the left-campus SMS with their own templates', async () => {
  configure();
  fakeVendor(true);
  const r = await run(it, '+91 98765 43210');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.results.map((x) => x.status), ['SENT', 'SENT']);
  assert.equal(calls.length, 2);
  const [otp, exit] = calls;
  assert.equal(otp.searchParams.get('number'), '919876543210');
  assert.equal(otp.searchParams.get('templateid'), 'T-OTP');
  assert.match(otp.searchParams.get('message'), new RegExp(`Test Student has requested a Gate Pass\\. OTP to approve is ${r.body.testOtp}\\.`));
  assert.equal(exit.searchParams.get('templateid'), 'T-EXIT');
  assert.match(exit.searchParams.get('message'), /^Dear Parent, Test Student has left the campus on \d\d\/\d\d\/\d{4} at /);
  assert.ok(!JSON.stringify(r.body).includes('k-secret'), 'the API key never reaches the browser');

  const audit = await ctx.models.AuditLog.findOne({ action: 'SOC_DIAGNOSTIC_RUN', 'details.test': 'sms.otp_and_exit' }).lean();
  assert.equal(audit.details.to, '******3210');
  assert.ok(!JSON.stringify(audit).includes('9876543210'), 'full number not stored');
});

test('a vendor failure is reported per message', async () => {
  configure();
  fakeVendor(false);
  const r = await run(it, '9876543210');
  assert.equal(r.body.ok, false);
  assert.deepEqual(r.body.results.map((x) => x.status), ['FAILED', 'FAILED']);
  assert.match(r.body.results[0].detail, /rejected/);
});

test('rate limited: each run sends real SMS', async () => {
  // Four runs above already counted against this account's 5 per 15 minutes.
  const statuses = [];
  for (let i = 0; i < 3; i += 1) statuses.push((await run(it, '9876543210')).status);
  assert.ok(statuses.includes(429), statuses.join(','));
});
