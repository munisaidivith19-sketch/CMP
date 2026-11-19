/**
 * Sign-in CAPTCHA (Cloudflare Turnstile) in place of network locks.
 *
 * The per-network lock cannot tell people apart behind one shared campus
 * Wi-Fi: a stranger on it could still lock the Principal out. With Turnstile
 * configured, a web sign-in from a network with recent failures must pass a
 * CAPTCHA instead, and a passed CAPTCHA is never locked out by them.
 *
 * Cloudflare's siteverify is stubbed on globalThis.fetch; every other request
 * (the test client) passes through.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer, PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { loginPublicKey } from '../src/services/loginCrypto.js';
import { loginLimiter } from '../src/middleware/rateLimit.js';

const SITE_KEY = '0x4AAAAAAATestSiteKey';
const SECRET = '0x4AAAAAAATestSecretValue';
const HOST = 'campus.test';

let ctx;
const realFetch = globalThis.fetch;
const verify = { calls: [], used: new Set(), down: false };
let tokenSeq = 0;
const freshToken = (kind = 'good') => `${kind}-${(tokenSeq += 1)}`;

function stubSiteverify() {
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) return realFetch(url, opts);
    if (verify.down) throw new TypeError('fetch failed');
    const form = new URLSearchParams(String(opts.body));
    verify.calls.push({ secret: form.get('secret'), response: form.get('response'), remoteip: form.get('remoteip') });
    const token = form.get('response');
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (form.get('secret') !== SECRET) return json({ success: false, 'error-codes': ['invalid-input-secret'] });
    if (verify.used.has(token)) return json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    verify.used.add(token);
    if (token.startsWith('bad-')) return json({ success: false, 'error-codes': ['invalid-input-response'] });
    if (token.startsWith('signup-')) return json({ success: true, action: 'signup', hostname: HOST });
    if (token.startsWith('foreign-')) return json({ success: true, action: 'login', hostname: 'evil.example' });
    return json({ success: true, action: 'login', hostname: HOST });
  };
}

before(async () => {
  ctx = await startServer();
  process.env.TURNSTILE_SITE_KEY = SITE_KEY;
  process.env.TURNSTILE_SECRET = SECRET;
  process.env.TURNSTILE_HOSTNAMES = HOST;
  stubSiteverify();
});
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_HOSTNAMES;
  await ctx.stop();
});
beforeEach(async () => {
  await ctx.models.LoginThrottle.deleteMany({});
  // Each test starts from a fresh per-address limiter (all requests come from one address here).
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await loginLimiter.resetKey(ip);
  verify.calls.length = 0;
  verify.down = false;
});

const login = (email, password, extra = {}, headers = {}) => ctx.request('POST', '/auth/login', { body: { email, password, ...extra }, headers });

test('shared Wi-Fi: a stranger\'s failures ask for a CAPTCHA, never lock the Principal out', async () => {
  const principal = await ctx.createUser({ role: 'principal', name: 'Principal Shared WiFi' });

  // The stranger on the same campus address (every test request is 127.0.0.1).
  const f1 = await login(principal.email, 'Wrong-Guess-1!');
  assert.equal(f1.status, 401);
  assert.equal(f1.body.message, 'Invalid email or password.');
  assert.equal(f1.body.captchaRequired, false, 'one failure: no CAPTCHA yet');
  const f2 = await login(principal.email, 'Wrong-Guess-2!');
  assert.equal(f2.status, 401);
  assert.equal(f2.body.captchaRequired, true, 'two failures: the next attempt needs the CAPTCHA');
  assert.equal(f2.body.siteKey, SITE_KEY);

  const noToken = await login(principal.email, 'Wrong-Guess-3!');
  assert.equal(noToken.status, 428);
  assert.equal(noToken.body.code, 'CAPTCHA_REQUIRED');
  assert.equal(noToken.body.siteKey, SITE_KEY);

  // Even a human who solves the CAPTCHA every time is never turned into a lock.
  for (let i = 0; i < 12; i += 1) {
    const r = await login(principal.email, `Wrong-Guess-x${i}!`, { captchaToken: freshToken() });
    assert.equal(r.status, 401, `attempt ${i}: ${JSON.stringify(r.body)}`);
    assert.ok(!r.body.locked);
  }

  // The real Principal, same Wi-Fi, solves the check and signs in.
  const ok = await login(principal.email, PASSWORD, { captchaToken: freshToken() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.accessToken);

  const call = verify.calls.at(-1);
  assert.equal(call.secret, SECRET, 'the secret goes to Cloudflare, server-side');
  assert.equal(call.remoteip, '127.0.0.1');
});

test('the CAPTCHA is checked before the password: a rejected token never reaches the password', async () => {
  const user = await ctx.createUser({ name: 'Captcha Rejections' });
  await login(user.email, 'Wrong-1!');
  await login(user.email, 'Wrong-2!');
  const before = (await ctx.models.User.findById(user._id).select('+failedLogins').lean()).failedLogins;

  const reused = freshToken();
  assert.equal((await login(user.email, 'Wrong-3!', { captchaToken: reused })).status, 401, 'first use is fine');
  const cases = {
    'replayed token': reused,
    'rejected by Cloudflare': freshToken('bad'),
    'token for another action': freshToken('signup'),
    'token from another site': freshToken('foreign'),
    'oversized token': 'x'.repeat(3000),
  };
  for (const [label, captchaToken] of Object.entries(cases)) {
    const r = await login(user.email, PASSWORD, { captchaToken });
    assert.equal(r.status, label === 'oversized token' ? 422 : 428, `${label}: ${JSON.stringify(r.body)}`);
  }
  verify.down = true;
  const down = await login(user.email, PASSWORD, { captchaToken: freshToken() });
  assert.equal(down.status, 428, 'Cloudflare unreachable: fail closed');

  const after = (await ctx.models.User.findById(user._id).select('+failedLogins').lean()).failedLogins;
  assert.equal(after, before + 1, 'only the one attempt with a valid CAPTCHA was checked against the password');
});

test('real and unknown emails answer identically under the CAPTCHA (no enumeration)', async () => {
  const real = await ctx.createUser({ name: 'Captcha Enum' });
  const fake = `nobody.captcha.${Date.now()}@test.edu`;
  const run = async (email) => {
    await ctx.models.LoginThrottle.deleteMany({});
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await login(email, 'Wrong-Pass-1!', i === 2 ? {} : {});
      out.push([r.status, r.body.message, r.body.captchaRequired, r.body.code]);
    }
    const solved = await login(email, 'Wrong-Pass-1!', { captchaToken: freshToken() });
    out.push([solved.status, solved.body.message, solved.body.captchaRequired]);
    return out;
  };
  assert.deepEqual(await run(fake), await run(real.email));
});

test('the native apps cannot show the widget and keep the per-network lock', async () => {
  const user = await ctx.createUser({ name: 'Mobile Lock' });
  const mobile = { 'x-client-platform': 'mobile' };
  const r = [];
  for (let i = 0; i < 3; i += 1) r.push(await login(user.email, 'Wrong-Pass-1!', {}, mobile));
  assert.deepEqual(r.map((x) => x.status), [401, 401, 423]);
  assert.match(r[0].body.message, /attempt\(s\) remaining/);
  assert.equal(verify.calls.length, 0, 'no CAPTCHA for the native app');
});

test('shared Wi-Fi: 25 failed browser sign-ins from one address do not trip the sign-in rate limit for everyone', async () => {
  const victim = await ctx.createUser({ name: 'Rate Limit Neighbour' });
  const someone = await ctx.createUser({ name: 'Rate Limit Bystander' });
  for (let i = 0; i < 25; i += 1) {
    const r = await login(victim.email, `Wrong-${i}!`, i >= 2 ? { captchaToken: freshToken() } : {});
    assert.ok([401, 428].includes(r.status), `attempt ${i}: ${r.status}`);
  }
  const ok = await login(someone.email, PASSWORD, { captchaToken: freshToken() });
  assert.equal(ok.status, 200, `a bystander on the same address still signs in: ${JSON.stringify(ok.body)}`);
});

test('the CAPTCHA token survives the encrypted-password envelope', async () => {
  const user = await ctx.createUser({ name: 'Envelope Captcha' });
  await login(user.email, 'Wrong-1!');
  await login(user.email, 'Wrong-2!');

  const { keyId, publicKey } = loginPublicKey();
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  const envelope = Buffer.from(JSON.stringify({ p: PASSWORD, t: Date.now(), n: crypto.randomBytes(12).toString('hex') }));
  const encryptedPassword = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, envelope).toString('base64');

  const r = await ctx.request('POST', '/auth/login', { body: { email: user.email, encryptedPassword, keyId, captchaToken: freshToken() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('the CSP admits Turnstile\'s script and frame only while it is configured', async () => {
  const cspOf = async (app) => {
    // fetch refuses a few "restricted" ports (e.g. 6000, 6665-6669, 10080); the OS can hand one out
    // at random, so retry on a fresh port instead of failing the test intermittently.
    for (let attempt = 1; ; attempt++) {
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        return (await realFetch(`http://127.0.0.1:${server.address().port}/api/health`)).headers.get('content-security-policy');
      } catch (err) {
        if (attempt >= 5) throw err;
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  };
  const on = await cspOf(createApp());
  assert.match(on, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(on, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  // (The 20-per-15-minutes sign-in cap stays for browsers while the CAPTCHA is off: see the native-app test above.)
  assert.doesNotMatch(/script-src ([^;]+)/.exec(on)[1], /unsafe-inline|unsafe-eval/);

  delete process.env.TURNSTILE_SECRET;
  try {
    const off = await cspOf(createApp());
    assert.doesNotMatch(off, /challenges\.cloudflare\.com/);
  } finally {
    process.env.TURNSTILE_SECRET = SECRET;
  }
});
