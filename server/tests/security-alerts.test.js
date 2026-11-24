import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';

/**
 * Security alert emails (services/securityAlerts.js). A fake transport stands
 * in for Resend; nothing is sent anywhere.
 */
let ctx;
let it; // IT support (web session)
let admin;
let student;
let env;
let alerts;
let sent = [];

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const settle = () => sleep(150);
const titles = () => sent.map((m) => m.subject);

before(async () => {
  ctx = await startServer();
  ({ env } = await import('../src/config/env.js'));
  alerts = await import('../src/services/securityAlerts.js');
  // Install the fake transport before alerts are switched on: no request ever reaches Resend.
  alerts.setAlertTransport(async (m) => sent.push(m));
  env.securityAlerts.apiKey = 'test-key';
  env.securityAlerts.to = ['alerts@test.edu'];
  const u = await ctx.createUser({ role: 'super_admin', name: 'Ops' });
  it = { u, ...(await ctx.loginWeb(u)) };
  const a = await ctx.createUser({ role: 'admin', employeeId: 'E-AL1' });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  student = await ctx.createUser({});
});
beforeEach(async () => {
  await settle();
  sent = [];
  alerts.setAlertTransport(async (m) => sent.push(m));
});
after(() => ctx.stop());

test('IT support sign-in is emailed with time, IP, browser and device; never the password', async () => {
  await ctx.loginWeb(it.u);
  await settle();
  assert.equal(sent.length, 1, titles().join(' | '));
  const m = sent[0];
  assert.match(m.subject, /IT support signed in/);
  assert.deepEqual(m.to, ['alerts@test.edu']);
  assert.match(m.from, /tech@jnn\.edu\.in/);
  for (const field of ['Time (IST)', 'Time (UTC)', 'IP address', 'Device', 'Browser', 'Operating system', it.u.email]) assert.ok(m.text.includes(field), field);
  assert.match(m.text, /Browser: Chrome/);
  assert.ok(!m.text.includes(PASSWORD) && !m.html.includes(PASSWORD));
  assert.ok(!/token/i.test(m.text.replace(/User agent:.*$/m, '')));
});

test('failed sign-ins: the first is emailed at once, the rest are grouped (no flood)', async () => {
  for (let i = 0; i < 3; i += 1) {
    await ctx.request('POST', '/auth/login', { body: { email: it.u.email, password: 'Wrong#Pass999' } });
  }
  await settle();
  assert.equal(sent.length, 1, titles().join(' | '));
  assert.match(sent[0].subject, /Failed sign-in to the IT support account/);
  assert.match(sent[0].text, /Reason: Wrong password/);
});

test('ordinary accounts never trigger an alert', async () => {
  await ctx.loginWeb(student);
  await ctx.request('POST', '/auth/login', { body: { email: student.email, password: 'Wrong#Pass999' } });
  await ctx.loginWeb(admin.u);
  await settle();
  assert.deepEqual(titles(), []);
});

test('an attempt to give an account the Admin role from the Users page is refused and emailed', async () => {
  const r = await req('POST', '/admin/users', admin, { name: 'Sneaky', email: 'sneaky.admin@test.edu', password: 'Welcome@1234', role: 'admin', employeeId: 'X-ADM' });
  assert.equal(r.status, 422);
  await settle();
  assert.equal(sent.length, 1, titles().join(' | '));
  assert.match(sent[0].subject, /Blocked attempt to create an Admin account/);
  assert.match(sent[0].text, /Requested role: admin/);
  assert.ok(sent[0].text.includes(admin.u.email), 'names who tried');
});

test('IT support creating an Admin, opening Backup & recovery, and a wrong confirmation password are emailed', async () => {
  assert.equal((await req('POST', '/console/reauth', it, { password: PASSWORD })).status, 200);
  const ok = await req('POST', '/console/admins', it, { name: 'Ops Admin', email: 'alert.admin@test.edu', employeeId: 'E-AL2', password: 'Temp#Pass1234', policies: [{ module: 'user_management', actions: ['view'] }] });
  assert.equal(ok.status, 201);
  assert.equal((await req('GET', '/console/recovery', it)).status, 200);
  assert.equal((await req('POST', '/console/reauth', it, { password: 'Wrong#Pass999' })).status, 400);
  await settle();
  const t = titles().join(' | ');
  assert.match(t, /Admin account created/);
  assert.match(t, /Backup & recovery opened/);
  assert.match(t, /Wrong password at an IT support confirmation/);
});

test('Emergency Control and server-shell recovery are always emailed; HTML is escaped', async () => {
  const rule = alerts.classify('audit', 'EMERGENCY_TRANSITION', { outcome: 'success', details: { from: 'normal', to: 'lockdown' } });
  assert.match(rule.title, /Emergency Control used → lockdown/);
  assert.equal(rule.group, undefined, 'never grouped');
  assert.match(alerts.classify('audit', 'ADMIN_PASSWORD_RESET', { targetRole: 'super_admin' }).title, /from the server/);
  assert.equal(alerts.classify('audit', 'ADMIN_PASSWORD_RESET', { targetRole: 'admin' }), null);

  const { html } = alerts.render({ title: 'T', severity: 'High' }, [{ at: new Date(), client: { userAgent: '<script>alert(1)</script>', ip: '1.2.3.4' } }]);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});

test('without an API key or recipient nothing is sent', async () => {
  const event = { actorRole: 'super_admin', account: 'x@test.edu', client: {} };
  const saved = { ...env.securityAlerts };
  env.securityAlerts.to = [];
  assert.equal(await alerts.securityAlert('security', 'LOGIN_SUCCESS', event), false);
  env.securityAlerts.to = saved.to;
  env.securityAlerts.apiKey = '';
  assert.equal(await alerts.securityAlert('security', 'LOGIN_SUCCESS', event), false);
  Object.assign(env.securityAlerts, saved);
  assert.deepEqual(titles(), []);
  assert.equal(await alerts.securityAlert('security', 'LOGIN_SUCCESS', event), true, 'control: sent when configured');
});
