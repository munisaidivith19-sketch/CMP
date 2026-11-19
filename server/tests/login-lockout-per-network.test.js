/**
 * Sign-in lockout is per (account, network), not per account.
 *
 * Before this change three wrong passwords locked the ACCOUNT for 5–60 minutes
 * whoever typed them, so anyone who knew an email (predictable at a college)
 * could keep its owner — the Principal, an Admin — locked out from anywhere.
 * Now a stranger's strikes lock only the stranger's network; the owner signs in
 * as usual. A distributed guess still hits an account-wide backstop, which the
 * owner's own recent networks are let past.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import {
  ACCOUNT_WIDE_LOCK_AFTER,
  checkAccountLockout,
  recordAccountFailure,
  clearAccountLocks,
  checkAnonLockout,
  recordAnonFailure,
} from '../src/utils/loginSecurity.js';

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});
// Every test here types wrong passwords from the one test client address; the
// separate per-IP throttle (10 failures → 5 m) is not what is under test.
beforeEach(() => ctx.models.LoginThrottle.deleteMany({ kind: 'ip' }));

const login = (email, password) => ctx.request('POST', '/auth/login', { body: { email, password } });
const wrongThrice = async (email) => {
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push(await login(email, 'Wrong-Pass-1!'));
  return results;
};

test('three wrong passwords from a stranger\'s network do not lock the owner out', async () => {
  const owner = await ctx.createUser({ name: 'Principal Target' });
  // The stranger's strikes come from another address (the test client is always 127.0.0.1).
  for (let i = 0; i < 3; i += 1) await recordAccountFailure(owner._id, '203.0.113.50');
  assert.equal((await checkAccountLockout(owner._id, '203.0.113.50')).locked, true, 'the stranger\'s network is locked');
  assert.equal((await checkAccountLockout(owner._id, '127.0.0.1')).locked, false, 'the owner\'s network is not');

  const res = await login(owner.email, PASSWORD);
  assert.equal(res.status, 200, `owner signs in from their own network: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.accessToken);
  assert.equal((await checkAccountLockout(owner._id, '203.0.113.50')).locked, true, 'the stranger stays locked after the owner signs in');
});

test('the same network that strikes out is locked, with the same messages and tiers as before', async () => {
  const owner = await ctx.createUser({ name: 'Local Strikes' });
  const [a1, a2, a3] = await wrongThrice(owner.email);
  assert.equal(a1.status, 401);
  assert.equal(a1.body.message, 'Invalid email or password. 2 attempt(s) remaining before 5-minute lock.');
  assert.equal(a2.body.remainingAttempts, 1);
  assert.equal(a3.status, 423);
  assert.equal(a3.body.message, 'Too many failed attempts. Account locked for 5 minute(s).');
  assert.equal(a3.body.locked, true);

  const right = await login(owner.email, PASSWORD);
  assert.equal(right.status, 423, 'the right password from the locked network still waits');
  assert.match(right.body.message, /^Too many failed attempts\. Try again in \d+ minute\(s\)\.$/);

  const user = await ctx.models.User.findById(owner._id).select('+failedLogins +lockUntil +lockoutCount').lean();
  assert.equal(user.failedLogins, 3, 'the running total across networks is kept on the account');
  assert.equal(user.lockoutCount, 1);
  assert.ok(!user.lockUntil, 'the account itself is not locked by one network');
  const rows = await ctx.models.LoginThrottle.find({ kind: 'account' }).lean();
  assert.ok(rows.length >= 1 && rows.every((r) => !JSON.stringify(r).includes(String(owner._id)) && !JSON.stringify(r).includes('127.0.0.1')), 'only hashes are stored');
});

test('an unknown email behaves exactly like a real account at the same network (no enumeration)', async () => {
  const real = await ctx.createUser({ name: 'Enum Real' });
  const fake = `nobody.${Date.now()}@test.edu`;
  const realRes = await wrongThrice(real.email);
  const fakeRes = await wrongThrice(fake);
  assert.deepEqual(fakeRes.map((r) => [r.status, r.body.message]), realRes.map((r) => [r.status, r.body.message]));
  // And like the account lock, the unknown-email lock is per network too.
  assert.equal((await checkAnonLockout(fake, '127.0.0.1')).locked, true);
  assert.equal((await checkAnonLockout(fake, '198.51.100.7')).locked, false);
});

test('account-wide backstop: many failures across networks lock the account, except for the owner\'s known networks', async () => {
  const owner = await ctx.createUser({ name: 'Distributed Target' });
  // Nobody has ever signed in as this account from 127.0.0.1 yet.
  await ctx.models.User.updateOne({ _id: owner._id }, { $set: { failedLogins: ACCOUNT_WIDE_LOCK_AFTER - 1, lastFailedLoginAt: new Date() } });
  const trip = await login(owner.email, 'Wrong-Pass-1!');
  assert.equal(trip.status, 401, 'the 30th failure itself is answered like any other (this network has 1 strike)');
  let user = await ctx.models.User.findById(owner._id).select('+lockUntil').lean();
  assert.ok(user.lockUntil && user.lockUntil > new Date(), 'the account-wide backstop is now set');

  const blocked = await login(owner.email, PASSWORD);
  assert.equal(blocked.status, 423, 'an unknown network is held by the backstop even with the right password');

  // The owner's usual network: a successful sign-in from it within 30 days.
  await ctx.models.LoginHistory.create({ user: owner._id, ip: '127.0.0.1', success: true, device: 'Chrome on Windows' });
  const ok = await login(owner.email, PASSWORD);
  assert.equal(ok.status, 200, `a known network is let past the backstop: ${JSON.stringify(ok.body)}`);
  user = await ctx.models.User.findById(owner._id).select('+lockUntil +failedLogins').lean();
  assert.ok(!user.lockUntil && user.failedLogins === 0, 'a successful sign-in clears the backstop');
});

test('an unknown email mirrors the backstop as well', async () => {
  const fake = `ghost.${Date.now()}@test.edu`;
  for (let i = 0; i < ACCOUNT_WIDE_LOCK_AFTER; i += 1) await recordAnonFailure(fake, `192.0.2.${i}`);
  const check = await checkAnonLockout(fake, '192.0.2.250');
  assert.equal(check.locked, true, 'a never-seen network is locked by the per-email total');
});

test('an administrator\'s unlock clears every network\'s strikes on the account', async () => {
  const admin = await ctx.createUser({ role: 'admin', name: 'Unlocker' });
  const victim = await ctx.createUser({ name: 'Unlock Me' });
  for (const ip of ['203.0.113.1', '203.0.113.2', '127.0.0.1']) for (let i = 0; i < 3; i += 1) await recordAccountFailure(victim._id, ip);
  assert.equal((await checkAccountLockout(victim._id, '127.0.0.1')).locked, true);
  assert.equal((await login(victim.email, PASSWORD)).status, 423);

  const adminWeb = await ctx.loginWeb(admin);
  const res = await ctx.request('PATCH', `/admin/users/${victim._id}`, { token: adminWeb.token, body: { unlock: true } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const ip of ['203.0.113.1', '203.0.113.2', '127.0.0.1']) {
    assert.equal((await checkAccountLockout(victim._id, ip)).locked, false, `${ip} is no longer locked out of the account`);
  }
  assert.equal((await login(victim.email, PASSWORD)).status, 200);
  await clearAccountLocks(victim._id);
});
