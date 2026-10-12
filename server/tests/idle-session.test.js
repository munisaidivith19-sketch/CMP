import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { sweepIdleWebSessions, WEB_IDLE_TIMEOUT_MS } = await import('../src/utils/sessionIdle.js');

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const sidOf = (accessToken) => JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).sid;
// Time is injected by ageing the session row rather than waiting 2 real minutes.
const age = (sid, ms) => ctx.models.Session.updateOne({ _id: sid }, { $set: { lastUsedAt: new Date(Date.now() - ms) } });
const lastUsed = async (sid) => (await ctx.models.Session.findById(sid).lean()).lastUsedAt.getTime();
const OVER = WEB_IDLE_TIMEOUT_MS + 1000;

async function webUser(role, extra = {}) {
  const u = await ctx.createUser({ role, department: ['student', 'faculty', 'hod'].includes(role) ? 'CSE' : undefined, section: role === 'student' ? 'A' : undefined, ...extra });
  const s = await ctx.loginWeb(u);
  return { u, ...s, sid: sidOf(s.token) };
}

// ── Who the rule applies to ────────────────────────────────────────

for (const role of ['student']) {
  test(`${role}: web session ends after 2 minutes without activity — server-side`, async () => {
    const w = await webUser(role);
    assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 200);

    await age(w.sid, OVER);
    const res = await ctx.request('GET', '/auth/me', { token: w.token });
    assert.equal(res.status, 401);
    assert.equal(res.body.reason, 'idle');
    assert.match(res.body.message, /expired due to inactivity/);

    const row = await ctx.models.Session.findById(w.sid).lean();
    assert.ok(row.revokedAt, 'the session is revoked, not just refused once');
    assert.equal(row.revokedReason, 'idle_timeout_web');

    // The same (still unexpired) access token stays dead, and so does the refresh cookie.
    assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 401);
    assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: w.cookie })).status, 401);
  });
}

for (const role of ['faculty', 'hod', 'dean', 'ao', 'warden', 'chairman', 'security', 'admin', 'principal']) {
  test(`${role} is exempt: web session survives long inactivity`, async () => {
    const w = await webUser(role);
    await age(w.sid, 60 * 60 * 1000);
    assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 200);
    assert.equal((await ctx.models.Session.findById(w.sid).lean()).idleTimeoutMs, null);
  });
}

test('mobile sessions are not affected', async () => {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A' });
  const m = await ctx.loginMobile(u);
  const sid = sidOf(m.token);
  await age(sid, 60 * 60 * 1000);
  assert.equal((await ctx.request('GET', '/auth/me', { token: m.token, headers: { 'x-client-platform': 'mobile' } })).status, 200);
  const r = await ctx.request('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.idleTimeoutSec, null);
});

test('a browser cannot sign in as "mobile" to escape the rule', async () => {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A' });
  const res = await ctx.request('POST', '/auth/login', {
    body: { email: u.email, password: 'Password@123' },
    headers: { 'x-client-platform': 'mobile', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.refreshToken, undefined, 'no refresh token handed to page JavaScript');
  assert.equal(res.body.idleTimeoutSec, 120);
  const row = await ctx.models.Session.findById(sidOf(res.body.accessToken)).lean();
  assert.equal(row.client, 'web');
  assert.equal(row.idleTimeoutMs, WEB_IDLE_TIMEOUT_MS);
});

// ── What counts as activity ───────────────────────────────────────

test('ordinary API requests and polling never extend the session', async () => {
  const w = await webUser('student');
  await age(w.sid, 60 * 1000);
  const before = await lastUsed(w.sid);
  for (let i = 0; i < 5; i += 1) assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 200);
  assert.equal(await lastUsed(w.sid), before, 'no lastUsedAt write from plain requests');

  await age(w.sid, OVER);
  assert.equal((await ctx.request('GET', '/notifications', { token: w.token })).status, 401);
});

test('reported activity keeps the session alive, with at most one write per ~25 s', async () => {
  const w = await webUser('student');
  await age(w.sid, 100 * 1000);
  const r1 = await ctx.request('POST', '/auth/activity', { token: w.token });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.idleTimeoutSec, 120);
  const t1 = await lastUsed(w.sid);
  assert.ok(Date.now() - t1 < 5000, 'activity moved lastUsedAt to now');

  // Immediately again: throttled, no write.
  await ctx.request('POST', '/auth/activity', { token: w.token });
  assert.equal(await lastUsed(w.sid), t1);
  assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 200);

  // Activity cannot revive a session that has already expired.
  await age(w.sid, OVER);
  assert.equal((await ctx.request('POST', '/auth/activity', { token: w.token })).status, 401);
});

test('refresh-token rotation is not activity, and cannot revive an idle session', async () => {
  const w = await webUser('student');
  await age(w.sid, 60 * 1000);
  const before = await lastUsed(w.sid);
  const r = await ctx.request('POST', '/auth/refresh', { cookie: w.cookie });
  assert.equal(r.status, 200);
  assert.equal(await lastUsed(w.sid), before, 'rotation leaves lastUsedAt alone');
  const rotatedCookie = (r.headers.get('set-cookie') || '').split(';')[0];

  await age(w.sid, OVER);
  const dead = await ctx.request('POST', '/auth/refresh', { cookie: rotatedCookie });
  assert.equal(dead.status, 401);
  assert.equal(dead.body.reason, 'idle');
  // Old (rotated-out) refresh token replay: still nothing.
  assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: w.cookie })).status, 401);
  assert.equal((await ctx.request('GET', '/auth/me', { token: r.body.accessToken })).status, 401);
});

// ── Logout / realtime / headers ───────────────────────────────────

test('client-side idle logout is a real logout', async () => {
  const w = await webUser('student');
  // Exactly what the web client sends: both cookies plus the X-CSRF-Token echo.
  const res = await ctx.request('POST', '/auth/logout', { cookie: `${w.cookie}; ${w.csrfCookie}`, headers: { 'x-csrf-token': w.csrf }, body: { reason: 'idle' } });
  assert.equal(res.status, 200);
  const row = await ctx.models.Session.findById(w.sid).lean();
  assert.equal(row.revokedReason, 'idle_timeout_client');
  assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).status, 401);
  assert.equal((await ctx.request('POST', '/auth/refresh', { cookie: w.cookie })).status, 401);
  assert.ok(await ctx.models.Activity.exists({ action: 'auth.idle_logout', entityId: w.sid }));
});

test('the sweep drops an idle session\'s socket even with no HTTP traffic; reconnect is refused', async () => {
  const w = await webUser('student');
  const exempt = await webUser('admin');
  const socket = await ctx.connect(w.token);
  const adminSocket = await ctx.connect(exempt.token);
  await age(w.sid, OVER);
  await age(exempt.sid, OVER);

  const dropped = new Promise((resolve) => socket.once('disconnect', resolve));
  assert.ok((await sweepIdleWebSessions()) >= 1);
  assert.equal(await dropped, 'io server disconnect');
  assert.ok(adminSocket.connected, 'exempt role keeps its socket');
  assert.ok(await ctx.models.Activity.exists({ action: 'auth.idle_expired', entityId: w.sid }));

  await ctx.connect(w.token, { expectFail: true });
});

test('API responses are not cacheable', async () => {
  const w = await webUser('admin');
  const res = await ctx.request('GET', '/auth/me', { token: w.token });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('an access token signed with another algorithm is rejected', async () => {
  const w = await webUser('admin');
  const [, payload] = w.token.split('.');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
  assert.equal((await ctx.request('GET', '/auth/me', { token: none })).status, 401);
});
