import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, nextEvent, sleep } from './helpers.js';

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

test('protected routes reject missing and forged tokens', async () => {
  assert.equal((await ctx.request('GET', '/auth/me')).status, 401);
  assert.equal((await ctx.request('GET', '/auth/me', { token: 'not.a.jwt' })).status, 401);
});

test('login never reveals whether an email exists', async () => {
  const user = await ctx.createUser();
  const unknown = await ctx.request('POST', '/auth/login', { body: { email: 'nobody@test.edu', password: 'Wrong123' } });
  const wrong = await ctx.request('POST', '/auth/login', { body: { email: user.email, password: 'Wrong123' } });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.message, wrong.body.message);
});

test('web session: cookie refresh rotates, replaying an old refresh token kills the session', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  assert.ok(web.cookie.startsWith('cc_refresh='));

  const r1 = await ctx.request('POST', '/auth/refresh', { cookie: web.cookie });
  assert.equal(r1.status, 200);
  const rotated = r1.headers.get('set-cookie').split(';')[0];
  assert.notEqual(rotated, web.cookie);

  // Replaying the rotated-out token = theft signal → whole session revoked.
  const replay = await ctx.request('POST', '/auth/refresh', { cookie: web.cookie });
  assert.equal(replay.status, 401);
  const after = await ctx.request('POST', '/auth/refresh', { cookie: rotated });
  assert.equal(after.status, 401, 'legitimate token of a revoked session must also stop working');
  assert.equal((await ctx.request('GET', '/auth/me', { token: r1.body.accessToken })).status, 401);
});

test('mobile session: refresh token travels in the body, never as a cookie', async () => {
  const user = await ctx.createUser();
  const m = await ctx.loginMobile(user);
  assert.ok(m.refreshToken);
  const r = await ctx.request('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.refreshToken && r.body.refreshToken !== m.refreshToken);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('logout signs out only this device; sessions list + revoke-others', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  const phone = await ctx.loginMobile(user);

  const list = await ctx.request('GET', '/auth/sessions', { token: web.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 2);
  assert.equal(list.body.filter((s) => s.current).length, 1);
  assert.ok(list.body.some((s) => s.client === 'mobile' && /Pixel 8/.test(s.device)));

  // Phone signs out → web keeps working, phone token dies immediately.
  await ctx.request('POST', '/auth/logout', { body: { refreshToken: phone.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal((await ctx.request('GET', '/auth/me', { token: phone.token })).status, 401);
  assert.equal((await ctx.request('GET', '/auth/me', { token: web.token })).status, 200);

  const phone2 = await ctx.loginMobile(user);
  const res = await ctx.request('POST', '/auth/sessions/revoke-others', { token: web.token });
  assert.equal(res.body.count, 1);
  assert.equal((await ctx.request('GET', '/auth/me', { token: phone2.token })).status, 401);
  assert.equal((await ctx.request('GET', '/auth/me', { token: web.token })).status, 200);

  // A user cannot revoke someone else's session.
  const other = await ctx.loginWeb(await ctx.createUser());
  const theirs = (await ctx.request('GET', '/auth/sessions', { token: other.token })).body[0]._id;
  assert.equal((await ctx.request('DELETE', `/auth/sessions/${theirs}`, { token: web.token })).status, 404);
});

test('revoking a session disconnects its live socket', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  const phone = await ctx.loginMobile(user);
  const phoneSocket = await ctx.connect(phone.token);
  const sessions = (await ctx.request('GET', '/auth/sessions', { token: web.token })).body;
  const phoneSession = sessions.find((s) => s.client === 'mobile');
  const dropped = nextEvent(phoneSocket, 'disconnect');
  await ctx.request('DELETE', `/auth/sessions/${phoneSession._id}`, { token: web.token });
  assert.ok(await dropped);
  // And it cannot reconnect with that token.
  await ctx.connect(phone.token, { expectFail: true });
});

test('sockets without a valid token are refused', async () => {
  await ctx.connect(undefined, { expectFail: true });
  await ctx.connect('garbage', { expectFail: true });
});

test('forgot password: same response for known and unknown emails', async () => {
  const user = await ctx.createUser();
  const known = await ctx.request('POST', '/auth/forgot-password', { body: { email: user.email } });
  const unknown = await ctx.request('POST', '/auth/forgot-password', { body: { email: 'ghost@test.edu' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body);
  await sleep(300);
  const stored = await ctx.models.User.findById(user._id).select('+resetTokenHash +resetTokenExpires');
  assert.ok(stored.resetTokenHash, 'a hashed token is stored');
  assert.ok(stored.resetTokenExpires > new Date());
});

test('password reset is single-use, expires, and signs out every session', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await ctx.models.User.updateOne({ _id: user._id }, { resetTokenHash: hash, resetTokenExpires: new Date(Date.now() + 60000) });

  const weak = await ctx.request('POST', '/auth/reset-password', { body: { token, password: 'short' } });
  assert.equal(weak.status, 422);

  const ok = await ctx.request('POST', '/auth/reset-password', { body: { token, password: 'BrandNew123' } });
  assert.equal(ok.status, 200);
  assert.equal((await ctx.request('POST', '/auth/reset-password', { body: { token, password: 'Another123' } })).status, 400, 'token is single-use');
  assert.equal((await ctx.request('GET', '/auth/me', { token: web.token })).status, 401, 'old sessions revoked');
  const login = await ctx.request('POST', '/auth/login', { body: { email: user.email, password: 'BrandNew123' } });
  assert.equal(login.status, 200);

  // Expired token.
  const t2 = crypto.randomBytes(32).toString('base64url');
  await ctx.models.User.updateOne(
    { _id: user._id },
    { resetTokenHash: crypto.createHash('sha256').update(t2).digest('hex'), resetTokenExpires: new Date(Date.now() - 1000) }
  );
  assert.equal((await ctx.request('POST', '/auth/reset-password', { body: { token: t2, password: 'Another123' } })).status, 400);
});

test('change password keeps this device and signs out the others', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  const phone = await ctx.loginMobile(user);
  const res = await ctx.request('POST', '/auth/change-password', {
    token: web.token,
    body: { currentPassword: 'Password@123', newPassword: 'Changed123' },
  });
  assert.equal(res.status, 200);
  assert.equal((await ctx.request('GET', '/auth/me', { token: res.body.accessToken })).status, 200);
  assert.equal((await ctx.request('GET', '/auth/me', { token: phone.token })).status, 401);
});

test('login history records failures and new-device sign-ins notify the user', async () => {
  const user = await ctx.createUser();
  await ctx.loginWeb(user);
  await ctx.request('POST', '/auth/login', { body: { email: user.email, password: 'Nope1234' } });
  const m = await ctx.loginMobile(user);
  const hist = await ctx.request('GET', '/auth/login-history', { token: m.token });
  assert.equal(hist.body.records.length, 3);
  assert.ok(hist.body.records.some((r) => !r.success && r.reason === 'invalid_password'));
  await sleep(200);
  const notes = await ctx.request('GET', '/notifications', { token: m.token });
  assert.ok(notes.body.items.some((n) => n.title === 'New sign-in to your account'));
});

test('suspending a user cuts off their sessions immediately', async () => {
  const admin = await ctx.createUser({ role: 'admin' });
  const target = await ctx.createUser();
  const a = await ctx.loginWeb(admin);
  const t = await ctx.loginWeb(target);
  await ctx.request('PATCH', `/admin/users/${target._id}`, { token: a.token, body: { isActive: false } });
  assert.equal((await ctx.request('GET', '/auth/me', { token: t.token })).status, 401);
});
