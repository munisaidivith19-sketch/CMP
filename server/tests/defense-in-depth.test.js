/**
 * Defense-in-depth hardening pass (CLAUDE.md layers 1–7). Each test guards one
 * control: it failed before the fix and passes after it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// A stand-in for client/dist, so the static-file tests do not depend on a
// client build being present (createApp serves CLIENT_DIST_DIR when set).
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dist-'));
fs.mkdirSync(path.join(DIST, 'assets'));
fs.mkdirSync(path.join(DIST, '.well-known'));
fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>VEXON</title><div id="root"></div>');
fs.writeFileSync(path.join(DIST, 'assets', 'app.js'), 'console.log("app")');
fs.writeFileSync(path.join(DIST, 'assets', 'app.js.map'), '{"sources":["../src/secret.js"]}');
fs.writeFileSync(path.join(DIST, '.env'), 'JWT_ACCESS_SECRET=leak');
fs.copyFileSync(path.join(REPO, 'client', 'public', '.well-known', 'security.txt'), path.join(DIST, '.well-known', 'security.txt'));
process.env.CLIENT_DIST_DIR = DIST;

const { startServer, PASSWORD } = await import('./helpers.js');
const { createApp, trustProxySetting } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { default: jwt } = await import('jsonwebtoken');
const { collegeSmsProvider } = await import('../src/services/otp/providers/collegeSmsProvider.js');
const { recordIpFailure } = await import('../src/utils/loginSecurity.js');
const { campusParts, dayKey, toDay } = await import('../src/utils/dates.js');
const { clock } = await import('../src/utils/clock.js');

let ctx;

before(async () => {
  ctx = await startServer();
});

after(async () => {
  if (ctx) await ctx.stop();
  fs.rmSync(DIST, { recursive: true, force: true });
});

/** Run `fn(base)` against a fresh app instance built in production mode. */
async function withProdApp(fn) {
  env.isProd = true;
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    env.isProd = false;
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A raw GET that keeps the path exactly as written (fetch would normalise "..", "%2e"). */
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const cookiesOf = (res) => (res.headers.getSetCookie?.() || []);
const cookieNamed = (res, name) => cookiesOf(res).find((c) => c.startsWith(`${name}=`));

// ── Layer 1: encryption in transit ─────────────────────────────────

test('L1.1 HSTS: production sends max-age=31536000; includeSubDomains — development does not', async () => {
  const dev = await fetch(`${ctx.base}/api/health`);
  assert.equal(dev.headers.get('strict-transport-security'), null, 'no HSTS on a plain-HTTP dev server');
  await withProdApp(async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  });
});

test('L1.2 SMS gateway: https by default; production refuses to send over plain http', async () => {
  if (!process.env.SMS_API_URL) assert.match(env.sms.apiUrl, /^https:\/\//, 'the default endpoint is https');
  const saved = { ...env.sms };
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('ok', { status: 200 });
  };
  try {
    Object.assign(env.sms, { apiKey: 'k3y', senderId: 'JNNIE', otpTemplateId: 't1', exitTemplateId: 't2' });
    env.isProd = true;
    env.sms.apiUrl = 'http://bulksms.example/vb/apikey.php';
    await assert.rejects(collegeSmsProvider.sendOtp({ to: '9876543210', studentName: 'A', otp: '123456' }), (e) => e.status === 503);
    assert.equal(calls.length, 0, 'nothing — not even the API key — went out over http');

    env.sms.apiUrl = 'https://bulksms.example/vb/apikey.php';
    await collegeSmsProvider.sendOtp({ to: '9876543210', studentName: 'A', otp: '123456' });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\//);

    // Development (no TLS on a local gateway stub) is still allowed.
    env.isProd = false;
    env.sms.apiUrl = 'http://localhost:9/vb/apikey.php';
    await collegeSmsProvider.sendOtp({ to: '9876543210', studentName: 'A', otp: '123456' });
    assert.equal(calls.length, 2);
  } finally {
    env.isProd = false;
    Object.assign(env.sms, saved);
    globalThis.fetch = realFetch;
  }
});

// ── Layer 2: auth / session ────────────────────────────────────────

test('L2.3 CSRF: a browser write (Sec-Fetch-Site) with no CSRF cookie/header is 403; the mobile app is unaffected', async () => {
  const w = await ctx.loginWeb(await ctx.createUser({ name: 'Csrf Browser' }));
  const browser = { 'sec-fetch-site': 'same-origin' };
  const body = { name: 'Csrf Browser Two' };
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, headers: browser, body })).status, 403, 'cookie and header both missing');
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, headers: { ...browser, 'x-csrf-token': w.csrf }, body })).status, 403, 'header without the cookie');
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie: w.csrfCookie, headers: browser, body })).status, 403, 'cookie without the header');
  assert.equal(
    (await ctx.request('PUT', '/users/me', { token: w.token, cookie: w.csrfCookie, headers: { ...browser, 'x-csrf-token': `${w.csrf}x` }, body })).status,
    403,
    'mismatch'
  );
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie: w.csrfCookie, headers: { ...browser, 'x-csrf-token': w.csrf }, body })).status, 200, 'valid pair');
  // Reads are never blocked.
  assert.equal((await ctx.request('GET', '/auth/me', { token: w.token, headers: browser })).status, 200);
  // Sign-in itself is exempt (the browser holds no CSRF cookie yet).
  const login = await ctx.request('POST', '/auth/login', { headers: browser, body: { email: w.user.email, password: PASSWORD } });
  assert.equal(login.status, 200);

  const m = await ctx.loginMobile(await ctx.createUser({ name: 'Csrf Mobile' }));
  const mobile = await ctx.request('PUT', '/users/me', { token: m.token, headers: { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' }, body: { name: 'Csrf Mobile Two' } });
  assert.equal(mobile.status, 200);
});

test('L2.4 cookies: production uses __Secure-cc_refresh (Path=/api/auth) and __Host-cc_csrf (Path=/, Secure, no Domain)', async () => {
  const user = await ctx.createUser({ name: 'Cookie Prod' });
  await withProdApp(async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/120.0' },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const refresh = cookieNamed(res, '__Secure-cc_refresh');
    const csrf = cookieNamed(res, '__Host-cc_csrf');
    assert.ok(refresh, cookiesOf(res).join(' | '));
    assert.ok(csrf, cookiesOf(res).join(' | '));
    assert.match(refresh, /Path=\/api\/auth/);
    assert.match(refresh, /Secure/);
    assert.match(refresh, /HttpOnly/);
    assert.match(refresh, /SameSite=Strict/);
    assert.match(csrf, /Path=\/(;|$)/);
    assert.match(csrf, /Secure/);
    assert.doesNotMatch(csrf, /Domain=/i);
    assert.equal(cookieNamed(res, 'cc_refresh'), undefined, 'the unprefixed names are not used in production');

    const refreshPair = refresh.split(';')[0];
    const csrfPair = csrf.split(';')[0];
    const token = csrfPair.slice(csrfPair.indexOf('=') + 1);
    // The renamed cookie is the one that is read.
    const ok = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { cookie: `${refreshPair}; ${csrfPair}`, 'x-csrf-token': token } });
    assert.equal(ok.status, 200);
    const rotated = cookieNamed(ok, '__Secure-cc_refresh').split(';')[0];
    // An unprefixed cookie (e.g. planted over plain HTTP) is ignored.
    const plain = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { cookie: rotated.replace('__Secure-cc_refresh', 'cc_refresh') } });
    assert.equal(plain.status, 401);
    // A cookie-authenticated write must echo the __Host- CSRF cookie.
    const newCsrf = cookieNamed(ok, '__Host-cc_csrf').split(';')[0];
    const newToken = newCsrf.slice(newCsrf.indexOf('=') + 1);
    const noHeader = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: `${rotated}; ${newCsrf}` } });
    assert.equal(noHeader.status, 403);
    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: `${rotated}; ${newCsrf}`, 'x-csrf-token': newToken } });
    assert.equal(out.status, 200);
  });
  // Development keeps the plain names.
  const dev = await ctx.loginWeb(await ctx.createUser({ name: 'Cookie Dev' }));
  assert.ok(dev.cookie.startsWith('cc_refresh='));
  assert.ok(dev.csrfCookie.startsWith('cc_csrf='));
});

test('L2.6a a token with a tampered role / sub, a foreign signature, alg "none" or a non-HS256 algorithm is rejected', async () => {
  const victim = await ctx.createUser({ name: 'Victim' });
  const student = await ctx.loginWeb(await ctx.createUser({ name: 'Tamperer' }));
  const payload = jwt.decode(student.token);
  const [h, , sig] = student.token.split('.');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const forged = [
    `${h}.${b64({ ...payload, role: 'admin' })}.${sig}`, // payload edited, old signature
    `${h}.${b64({ ...payload, sub: String(victim._id) })}.${sig}`,
    jwt.sign({ ...payload, role: 'admin' }, 'not-the-server-secret'),
    `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, role: 'admin' })}.`,
    jwt.sign({ sub: payload.sub, role: 'admin', sid: payload.sid }, env.accessSecret, { algorithm: 'HS512' }),
  ];
  for (const token of forged) {
    assert.equal((await ctx.request('GET', '/auth/me', { token })).status, 401, token.slice(0, 40));
    assert.equal((await ctx.request('GET', '/admin/users', { token })).status, 401);
  }
  // The role always comes from the database, never the token: even a validly
  // signed token claiming "admin" for a student stays a student.
  const claimed = jwt.sign({ sub: payload.sub, role: 'admin', sid: payload.sid }, env.accessSecret, { expiresIn: '5m' });
  assert.equal((await ctx.request('GET', '/admin/users', { token: claimed })).status, 403);
});

test('L2.6b replaying a rotated-out refresh token (mobile) is rejected and revokes the session', async () => {
  const m = await ctx.loginMobile(await ctx.createUser({ name: 'Rotate Mobile' }));
  const mobile = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };
  const r1 = await ctx.request('POST', '/auth/refresh', { headers: mobile, body: { refreshToken: m.refreshToken } });
  assert.equal(r1.status, 200);
  const replay = await ctx.request('POST', '/auth/refresh', { headers: mobile, body: { refreshToken: m.refreshToken } });
  assert.equal(replay.status, 401);
  const { sid } = jwt.decode(m.refreshToken);
  const row = await ctx.models.Session.findById(sid).lean();
  assert.ok(row.revokedAt, 'session revoked');
  assert.equal(row.revokedReason, 'refresh_token_reuse');
  assert.equal((await ctx.request('POST', '/auth/refresh', { headers: mobile, body: { refreshToken: r1.body.refreshToken } })).status, 401);
  assert.equal((await ctx.request('GET', '/auth/me', { token: r1.body.accessToken })).status, 401);
  await ctx.connect(r1.body.accessToken, { expectFail: true });
});

test('L2.6c a revoked or expired session can neither refresh nor open a Socket.IO connection', async () => {
  for (const kill of [{ revokedAt: new Date(), revokedReason: 'logout' }, { expiresAt: new Date(Date.now() - 1000) }]) {
    const w = await ctx.loginWeb(await ctx.createUser({ name: 'Dead Session' }));
    const socket = await ctx.connect(w.token);
    assert.ok(socket.connected, 'connects while the session is live');
    socket.disconnect();
    const { sid } = jwt.decode(w.token);
    await ctx.models.Session.updateOne({ _id: sid }, { $set: kill });
    assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: w.cookie })).status, 401, JSON.stringify(kill));
    await ctx.connect(w.token, { expectFail: true });
    assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 401);
  }
});

test('L2.5a unknown-email lockout is stored in MongoDB (hashed key, TTL) with the same thresholds and messages', async () => {
  const email = 'nobody-here@jnn.edu.in';
  const attempt = () => ctx.request('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
  const a1 = await attempt();
  assert.equal(a1.status, 401);
  assert.equal(a1.body.message, 'Invalid email or password. 2 attempt(s) remaining before 5-minute lock.');
  assert.equal((await attempt()).status, 401);
  const a3 = await attempt();
  assert.equal(a3.status, 423);
  assert.equal(a3.body.message, 'Too many failed attempts. Account locked for 5 minute(s).');

  const rows = await ctx.models.LoginThrottle.find({ kind: 'anon' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 3);
  assert.ok(rows[0].lockUntil > new Date());
  assert.ok(!JSON.stringify(rows).includes(email) && !JSON.stringify(rows).includes('127.0.0.1'), 'only hashes are stored');
  const indexes = await ctx.models.LoginThrottle.collection.indexes();
  assert.ok(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0), 'TTL index on expiresAt');

  // A brand-new app instance (a restart, or a second instance behind the load
  // balancer) shares nothing in memory — and still enforces the lock.
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password' }),
    });
    assert.equal(res.status, 423);
    assert.match((await res.json()).message, /^Too many failed attempts\. Try again in \d+ minute\(s\)\.$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── Layer 3: input / XSS ───────────────────────────────────────────

test('L3.7 web app has no raw-HTML sinks; CSP script-src has no unsafe-inline / unsafe-eval', async () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/.test(src)) offenders.push(path.relative(REPO, p));
      }
    }
  };
  walk(path.join(REPO, 'client', 'src'));
  assert.deepEqual(offenders, [], 'user content is rendered as React text, never as HTML');
  // The Markdown renderer only links http(s) URLs (no javascript: links).
  assert.match(fs.readFileSync(path.join(REPO, 'client', 'src', 'components', 'Markdown.jsx'), 'utf8'), /const SAFE_URL = \/\^https\?:\\\/\\\/\/i;/);

  const res = await fetch(`${ctx.base}/`);
  const csp = res.headers.get('content-security-policy');
  const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] || '';
  assert.ok(scriptSrc, csp);
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
});

test('L3.7b chat and complaint attachment links cannot path-traverse out of /uploads', async () => {
  const s = await ctx.loginWeb(await ctx.createUser({ name: 'Traverse Student', department: 'CSE', section: 'A', year: 3 }));
  const bad = ['/uploads/../.env', '/uploads/..%2F..%2Fserver%2F.env'];
  for (const url of bad) {
    const c = await ctx.request('POST', '/complaints', {
      token: s.token,
      body: { category: 'infrastructure', subCategory: 'classroom', escalateTo: 'hod', description: 'Attachment traversal attempt', attachments: [{ url, name: 'a' }] },
    });
    assert.equal(c.status, 422, `complaint ${url}`);
    assert.ok(c.body.errors.every((e) => e.field.startsWith('attachments')), JSON.stringify(c.body));
    const m = await ctx.request('POST', `/chat/conversations/${'a'.repeat(24)}/messages`, { token: s.token, body: { body: 'hi', attachment: { url, name: 'a' } } });
    assert.equal(m.status, 422, `chat ${url}`);
    assert.ok(m.body.errors.every((e) => e.field.startsWith('attachment')), JSON.stringify(m.body));
  }
});

// ── Layer 4: no secret / backend file leakage ──────────────────────

test('L4.8 only the built web app and /uploads are served — never .env, server source, config or source maps', async () => {
  for (const p of [
    '/.env',
    '/server/.env',
    '/server/src/config/env.js',
    '/src/config/env.js',
    '/src/app.js',
    '/render.yaml',
    '/package.json',
    '/server/package.json',
    '/.git/config',
    '/assets/app.js.map',
    '/uploads/../.env',
    '/uploads/..%2f..%2fserver%2f.env',
    '/%2e%2e/server/.env',
    '/assets/../../server/.env',
    '/CLAUDE.md',
  ]) {
    const res = await rawGet(ctx.base, p);
    assert.equal(res.status, 404, `${p} → ${res.status}`);
    assert.doesNotMatch(res.body, /JWT_|MONGO_URI|leak|sources|<div id="root">/, p);
  }
  // The real app still works.
  assert.equal((await rawGet(ctx.base, '/')).status, 200);
  const spa = await rawGet(ctx.base, '/events/66aa00000000000000000001');
  assert.equal(spa.status, 200);
  assert.match(spa.body, /id="root"/);
  assert.equal((await rawGet(ctx.base, '/assets/app.js')).status, 200);
});

test('L4.9/10 vite: no source maps, console/debugger dropped in production; verify:bundle catches secrets', () => {
  const vite = fs.readFileSync(path.join(REPO, 'client', 'vite.config.js'), 'utf8');
  assert.match(vite, /sourcemap:\s*false/);
  assert.match(vite, /drop:\s*\['console',\s*'debugger'\]/);
  assert.match(vite, /legalComments:\s*'none'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['verify:bundle']);

  // No VITE_* secret is referenced by the web app.
  const envRefs = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else for (const m of fs.readFileSync(p, 'utf8').matchAll(/import\.meta\.env\.(VITE_\w+)/g)) envRefs.push(m[1]);
    }
  };
  walk(path.join(REPO, 'client', 'src'));
  assert.deepEqual(envRefs.filter((n) => /KEY|SECRET|TOKEN|PASS|MONGO|GROQ|SMS|JWT/i.test(n)), []);

  const scan = (dir) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'verify-bundle.mjs'), dir], { encoding: 'utf8' });
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bundle-'));
  try {
    fs.writeFileSync(path.join(clean, 'index.js'), 'const a="__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED";fetch("/api/health")');
    assert.equal(scan(clean).status, 0, scan(clean).stderr);
    for (const [file, text] of [
      ['a.js', 'const k="gsk_abcdefghijklmnopqrstuvwxyz0123"'],
      ['b.js', 'const u="mongodb+srv://user:pw@cluster0.example.net/db"'],
      ['c.js', 'process.env.JWT_ACCESS_SECRET'],
      ['d.js', 'const x = { SMS_API_KEY: 1 }'],
      ['index.js.map', '{}'],
    ]) {
      const p = path.join(clean, file);
      fs.writeFileSync(p, text);
      const r = scan(clean);
      assert.equal(r.status, 1, `${file} must fail the scan`);
      assert.ok(!r.stderr.includes('abcdefghijklmnopqrstuvwxyz0123'), 'the scan never prints a full secret');
      fs.rmSync(p);
    }
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }
});

test('L4.11 PDFs and server env files are git-ignored; the profiles PDF is gone and its script never writes into the repo', async () => {
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(ignore, /^\/\*\.pdf$/m);
  assert.match(ignore, /^server\/\.env\*$/m);
  assert.match(ignore, /^!server\/\.env\.example$/m);
  assert.equal(fs.existsSync(path.join(REPO, 'CampusConnect_Profiles_Directory.pdf')), false);

  const script = fs.readFileSync(path.join(REPO, 'server', 'scripts', 'generateProfilesPdf.js'), 'utf8');
  assert.doesNotMatch(script, /[A-Z]:\\\\Users|\.gemini/, 'no hard-coded personal paths');
  const { resolveOutputPath } = await import('../scripts/generateProfilesPdf.js');
  assert.ok(resolveOutputPath(undefined, os.tmpdir()).startsWith(os.tmpdir()), 'default: OS temp directory');
  assert.throws(() => resolveOutputPath(path.join(REPO, 'x.pdf')), /inside the repository/);
  assert.throws(() => resolveOutputPath(path.join(REPO, 'server', 'out.pdf')), /inside the repository/);
  const outside = path.join(os.tmpdir(), 'cc-profiles.pdf');
  assert.equal(resolveOutputPath(outside), outside);
});

// ── Layer 5: event attendance guard ────────────────────────────────

test('L5.14 an event coordinator cannot silently overwrite recorded class attendance: confirmation + audit trail', async () => {
  const realNow = clock.now;
  const todayKey = campusParts(realNow()).dateKey;
  clock.now = () => new Date(`${todayKey}T09:30:00+05:30`);
  try {
    const login = async (role, extra = {}) => {
      const u = await ctx.createUser({ role, name: `${role} ${Math.random().toString(36).slice(2, 6)}`, employeeId: `G-${role}-${Math.random().toString(36).slice(2, 7)}`, ...extra });
      return { u, ...(await ctx.loginWeb(u)) };
    };
    const hod = await login('hod', { department: 'ME' });
    const coord = await login('faculty', { department: 'EEE' });
    const cic = await login('faculty', { department: 'ME', section: 'B', inChargeYear: 2, inChargeSemester: 3 });
    const teacher = await login('faculty', { department: 'ME', section: 'B' });
    const student = await ctx.createUser({ name: 'Guarded Student', rollNo: 'ME200', department: 'ME', section: 'B', year: 2, semester: 3 });
    const st = await ctx.loginWeb(student);

    const subject = await ctx.models.Subject.create({ code: 'ME201', name: 'Thermo', department: 'ME', year: 2, semester: 3, sections: ['B'], faculty: [teacher.u._id], isActive: true });
    const weekday = campusParts(clock.now()).weekday;
    for (const period of [1, 2]) {
      await ctx.models.TimetableSlot.create({
        subject: subject._id, faculty: teacher.u._id, department: 'ME', section: 'B', year: 2, semester: 3,
        dayOfWeek: weekday, period, startTime: period === 1 ? '09:00' : '10:00', endTime: period === 1 ? '10:00' : '11:00', isActive: true,
      });
    }

    const start = new Date(clock.now().getTime() - 24 * 3600 * 1000);
    const end = new Date(clock.now().getTime() + 24 * 3600 * 1000);
    const ev = await ctx.request('POST', '/events', {
      token: hod.token,
      body: { title: 'Guarded Expo', description: 'An event to test the attendance guard.', category: 'workshop', startDate: start.toISOString(), endDate: end.toISOString(), venue: 'Hall', facultyCoordinators: [coord.u._id] },
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));
    assert.equal((await ctx.request('POST', `/events/${ev.body._id}/register`, { token: st.token })).status, 200);

    // The period teacher already took attendance: present in period 1.
    const date = toDay(dayKey(clock.now()));
    await ctx.models.AttendanceRecord.create({ student: student._id, subject: subject._id, date, period: 1, status: 'present', department: 'ME', section: 'B', markedBy: teacher.u._id });
    const mark = (body) => ctx.request('PATCH', `/events/${ev.body._id}/attendance/${student._id}`, { token: coord.token, body: { date: dayKey(clock.now()), ...body } });

    // Without confirmation: refused, nothing changed anywhere.
    const blocked = await mark({ attended: false });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.requiresConfirmation, true);
    assert.deepEqual(blocked.body.periods, [{ period: 1, status: 'present' }]);
    assert.equal((await ctx.models.AttendanceRecord.findOne({ student: student._id, period: 1 }).lean()).status, 'present');
    assert.equal(await ctx.models.AttendanceRecord.countDocuments({ student: student._id }), 1, 'no partial write');
    const evRow = await ctx.models.Event.findById(ev.body._id).lean();
    assert.equal(evRow.registrations.find((r) => String(r.user) === String(student._id)).attendanceDays.length, 0);
    // A string "true" is not a confirmation.
    assert.equal((await mark({ attended: false, confirmOverwrite: 'yes' })).status, 422);

    // Confirmed: applied, with history on the overwritten record and the class in-charge told.
    const ok = await mark({ attended: false, confirmOverwrite: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.overwrittenPeriods, 1);
    const p1 = await ctx.models.AttendanceRecord.findOne({ student: student._id, period: 1 }).lean();
    assert.equal(p1.status, 'absent');
    assert.equal(p1.history.at(-1).from, 'present');
    assert.equal(String(p1.history.at(-1).by), String(coord.u._id));
    assert.equal((await ctx.models.AttendanceRecord.findOne({ student: student._id, period: 2 }).lean()).status, 'absent', 'unmarked period filled');
    const alert = await ctx.models.Notification.findOne({ user: cic.u._id, title: `Event Absence Alert: ${student.name}` }).lean();
    assert.match(alert.message, /1 recorded period\(s\) replaced by/);

    // The coordinator's own marks are not an "overwrite": flipping to present needs no confirmation...
    const own = await mark({ attended: true });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.overwrittenPeriods, 0);
    // ...but once the teacher corrects a period, replacing it does again, and the in-charge hears of it.
    await ctx.models.AttendanceRecord.updateOne({ student: student._id, period: 2 }, { $set: { status: 'present', markedBy: teacher.u._id } });
    assert.equal((await mark({ attended: true })).status, 409);
    assert.equal((await mark({ attended: true, confirmOverwrite: true })).status, 200);
    const p2 = await ctx.models.AttendanceRecord.findOne({ student: student._id, period: 2 }).lean();
    assert.equal(p2.status, 'od');
    assert.equal(p2.history.at(-1).to, 'od');
    assert.ok(await ctx.models.Notification.exists({ user: cic.u._id, title: `Event Attendance Override: ${student.name}` }));
  } finally {
    clock.now = realNow;
  }
});

// ── Layer 6 / 7: deployment settings ───────────────────────────────

test('L6.16 render.yaml keeps the dev OTP portal off', () => {
  const yaml = fs.readFileSync(path.join(REPO, 'render.yaml'), 'utf8');
  assert.match(yaml, /key: DEV_OTP_PORTAL\s+value: "false"/);
  assert.equal(env.otp.devPortalInProduction, false);
});

test('L7.17 trust proxy: a hop count (1 in production by default), never "trust everyone"; off in development', () => {
  assert.equal(trustProxySetting(undefined, true), 1, 'production default: Render is one hop');
  assert.equal(trustProxySetting('2', true), 2, 'Cloudflare in front of Render');
  assert.equal(trustProxySetting('false', true), false);
  assert.equal(trustProxySetting('0', true), false);
  assert.equal(trustProxySetting('true', true), 1, '"true" (trust every hop) is never used');
  assert.equal(trustProxySetting('99', true), 5);
  assert.equal(trustProxySetting(undefined, false), false, 'development: X-Forwarded-For is not trusted');
});

test('L7.17b in development a spoofed X-Forwarded-For cannot dodge the IP lockout', async () => {
  // 10 failures from this client lock the IP; rotating X-Forwarded-For must not reset it.
  await ctx.models.LoginThrottle.deleteMany({});
  for (let i = 0; i < 10; i += 1) await recordIpFailure('127.0.0.1');
  const res = await ctx.request('POST', '/auth/login', { headers: { 'x-forwarded-for': '203.0.113.9' }, body: { email: 'whoever@jnn.edu.in', password: 'x' } });
  assert.equal(res.status, 423);
  assert.equal(res.body.ipLocked, true);
  assert.match(res.body.message, /^Too many failed sign-in attempts from this network\. Try again in \d+ minute\(s\)\.$/);
  await ctx.models.LoginThrottle.deleteMany({});
});

test('L7.19 /.well-known/security.txt is served with a contact and an expiry', async () => {
  const res = await rawGet(ctx.base, '/.well-known/security.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.match(res.body, /^Contact: mailto:/m);
  assert.match(res.body, /^Expires: \d{4}-/m);
  for (const wf of ['ci.yml', 'secret-scan.yml', 'zap-baseline.yml']) {
    const text = fs.readFileSync(path.join(REPO, '.github', 'workflows', wf), 'utf8');
    assert.doesNotMatch(text, /gsk_|mongodb\+srv|SMS_API_KEY=/, wf);
  }
});
