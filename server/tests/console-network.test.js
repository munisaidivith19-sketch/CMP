import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';

/**
 * IT support works only from CONSOLE_ALLOWED_NETWORKS (utils/consoleNetwork.js).
 * The test server is reached from 127.0.0.1; "outside" is simulated by
 * allowing only a network the test client is not on.
 */
let ctx;
let env;
let net;
let alerts;
let sent = [];
const DEFAULT = ['127.0.0.1', '::1'];
const OUTSIDE_ONLY = ['10.99.0.0/16'];

const itUser = () => ctx.createUser({ role: 'super_admin', name: 'Ops' });
const login = (user, password = PASSWORD, headers = {}) => ctx.request('POST', '/auth/login', { body: { email: user.email, password }, headers });

before(async () => {
  ctx = await startServer();
  ({ env } = await import('../src/config/env.js'));
  net = await import('../src/utils/consoleNetwork.js');
  alerts = await import('../src/services/securityAlerts.js');
  alerts.setAlertTransport(async (m) => sent.push(m));
  env.securityAlerts.apiKey = 'test-key';
  env.securityAlerts.to = ['alerts@test.edu'];
});
afterEach(() => {
  env.consoleAllowedNetworks = DEFAULT;
  sent = [];
  alerts.setAlertTransport(async (m) => sent.push(m));
});
after(() => ctx.stop());

test('the default allows the server itself: IT support signs in from 127.0.0.1', async () => {
  const u = await itUser();
  const r = await login(u);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'super_admin');
});

test('outside the allowed networks the CORRECT password is answered exactly like a wrong one', async () => {
  env.consoleAllowedNetworks = OUTSIDE_ONLY;
  const it = await itUser();
  const ordinary = await ctx.createUser({ role: 'faculty', employeeId: 'E-NW1' });

  const right = await login(it);
  const wrongForOrdinary = await login(ordinary, 'Wrong#Pass999');
  assert.equal(right.status, 401);
  assert.equal(right.status, wrongForOrdinary.status);
  assert.match(right.body.message, /^Invalid email or password\. 2 attempt\(s\) remaining/);
  assert.equal(right.body.message, wrongForOrdinary.body.message, 'word for word the same as a wrong password');
  assert.deepEqual(Object.keys(right.body).sort(), Object.keys(wrongForOrdinary.body).sort());
  assert.equal(right.body.accessToken, undefined);

  await sleep(150);
  assert.ok(sent.some((m) => /not allowed — with the CORRECT password/.test(m.subject)), sent.map((m) => m.subject).join(' | '));
  const log = await ctx.models.SecurityLog.findOne({ targetUser: it._id, reason: 'outside_allowed_network' }).lean();
  assert.equal(log.details.credentialsCorrect, true);
});

test('a session in use is ended as soon as it is used from outside, and stays ended', async () => {
  const it = await itUser();
  const { token } = await ctx.loginWeb(it);
  assert.equal((await ctx.request('GET', '/console/overview', { token })).status, 200);

  env.consoleAllowedNetworks = OUTSIDE_ONLY;
  const r = await ctx.request('GET', '/console/overview', { token });
  assert.equal(r.status, 401);
  assert.doesNotMatch(r.body.message, /network|IT support|console/i, 'gives nothing away');

  env.consoleAllowedNetworks = DEFAULT;
  assert.equal((await ctx.request('GET', '/console/overview', { token })).status, 401, 'revoked for good');
  const s = await ctx.models.Session.findOne({ user: it._id }).lean();
  assert.equal(s.revokedReason, 'outside_allowed_network');
});

test('the real-time connection is refused from outside', async () => {
  const it = await itUser();
  const { token } = await ctx.loginWeb(it);
  env.consoleAllowedNetworks = OUTSIDE_ONLY;
  await ctx.connect(token, { expectFail: true });
});

test('a forged X-Forwarded-For cannot claim to be the server', async () => {
  // No proxy is trusted here (TRUST_PROXY unset outside production): a request
  // from localhost that carries forwarding headers is a proxy hiding the visitor.
  const it = await itUser();
  const r = await login(it, PASSWORD, { 'x-forwarded-for': '127.0.0.1' });
  assert.equal(r.status, 401);
  assert.match(r.body.message, /^Invalid email or password/);
  // Ordinary accounts are unaffected by the header.
  const f = await ctx.createUser({ role: 'faculty', employeeId: 'E-NW2' });
  assert.equal((await login(f, PASSWORD, { 'x-forwarded-for': '127.0.0.1' })).status, 200);
});

test('ordinary accounts sign in from anywhere', async () => {
  env.consoleAllowedNetworks = OUTSIDE_ONLY;
  const s = await ctx.createUser({});
  assert.equal((await login(s)).status, 200);
});

test('address rules: CIDR ranges, IPv6, IPv4-mapped addresses, proxy hops, bad entries ignored', () => {
  env.consoleAllowedNetworks = ['172.16.20.0/24', '::1', 'not-an-ip', '10.0.0.1/99'];
  const at = (remoteAddress, headers = {}) => net.consoleNetworkAllowed({ remoteAddress, headers });
  assert.equal(at('172.16.20.7'), true);
  assert.equal(at('::ffff:172.16.20.7'), true);
  assert.equal(at('172.16.21.7'), false);
  assert.equal(at('::1'), true);
  assert.equal(at('127.0.0.1'), false, 'only what is listed');
  assert.equal(at(undefined), false);
  assert.deepEqual(net.consoleNetworks(), ['172.16.20.0/24', '::1']);

  // One trusted proxy hop: the visitor is the last X-Forwarded-For entry; earlier ones are client-supplied.
  assert.equal(net.clientAddress({ remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '172.16.20.7, 203.0.113.9' } }, 1), '203.0.113.9');
  assert.equal(net.clientAddress({ remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '172.16.20.7' } }, 1), '172.16.20.7');
  assert.equal(net.clientAddress({ remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '1.1.1.1' } }, false), '10.0.0.5', 'no proxy: header ignored');
});

test('with a proxy trusted, a header claiming localhost over a remote connection is refused', () => {
  const saved = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  try {
    env.consoleAllowedNetworks = DEFAULT;
    const at = (remoteAddress, xff) => net.consoleNetworkAllowed({ remoteAddress, headers: { 'x-forwarded-for': xff } });
    assert.equal(at('203.0.113.9', '127.0.0.1'), false, 'direct internet client forging the header');
    assert.equal(at('172.16.30.4', '127.0.0.1'), false, 'LAN client forging the header');
    assert.equal(at('127.0.0.1', '127.0.0.1'), true, 'a proxy on the server forwarding the server itself');
    assert.equal(at('127.0.0.1', '203.0.113.9'), false, 'a proxy on the server forwarding an outside visitor');
  } finally {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  }
});
