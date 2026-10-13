/**
 * Regression: a faculty member creating a gate-pass bind group got
 * 403 "Invalid or expired CSRF token" when the browser's CSRF cookie had gone
 * stale or missing while the session itself was still valid. The client now
 * recognises that rejection, refreshes once (which issues a fresh CSRF pair)
 * and replays the write. These tests pin that contract end to end.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { startServer } = await import('./helpers.js');
const { isCsrfRejection, readCsrfToken, CSRF_REJECTION_MESSAGE } = await import('../../client/src/services/csrfCookie.js');

let ctx;

before(async () => {
  ctx = await startServer();
});

after(async () => {
  if (ctx) await ctx.stop();
});

const browser = { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/120.0', 'sec-fetch-site': 'same-origin' };
const pairOf = (c) => c.split(';')[0];

test('client: only the CSRF guard 403 triggers the refresh-and-retry', () => {
  assert.equal(isCsrfRejection({ status: 403, data: { message: CSRF_REJECTION_MESSAGE } }), true);
  assert.equal(isCsrfRejection({ status: 403, data: { message: 'Forbidden' } }), false, 'role 403 is not retried');
  assert.equal(isCsrfRejection({ status: 401, data: { message: CSRF_REJECTION_MESSAGE } }), false);
  assert.equal(isCsrfRejection(undefined), false);
});

test('a faculty bind-group write rejected for a missing/stale CSRF cookie succeeds after one refresh', async () => {
  const faculty = await ctx.createUser({ name: 'Navanitha', role: 'faculty' });
  const web = await ctx.loginWeb(faculty);
  const createBindGroup = (cookie, token, accessToken = web.token) =>
    fetch(`${ctx.base}/api/gate-pass/bind-groups`, {
      method: 'POST',
      headers: { ...browser, authorization: `Bearer ${accessToken}`, cookie, ...(token ? { 'x-csrf-token': token } : {}) },
      body: JSON.stringify({ title: 'TEST', groupName: '3RD YEAR CYBER', reason: 'TESTING' }),
    });

  // The CSRF cookie expired/cleared while the refresh cookie lives on: the guard still rejects.
  const missing = await createBindGroup(web.cookie, null);
  assert.equal(missing.status, 403);
  const missingBody = await missing.json();
  assert.equal(isCsrfRejection({ status: missing.status, data: missingBody }), true);

  // A stale token is rejected the same way (the server does not weaken).
  const stale = await createBindGroup(`${web.cookie}; cc_csrf=stale`, 'stale-other');
  assert.equal(stale.status, 403);

  // What the client does next: refresh (CSRF-exempt) -> fresh token pair.
  const refresh = await fetch(`${ctx.base}/api/auth/refresh`, { method: 'POST', headers: { ...browser, cookie: web.cookie } });
  assert.equal(refresh.status, 200);
  const { accessToken } = await refresh.json();
  const setCookies = refresh.headers.getSetCookie();
  const csrfCookie = setCookies.find((c) => c.startsWith('cc_csrf='));
  const refreshCookie = setCookies.find((c) => c.startsWith('cc_refresh='));
  assert.ok(csrfCookie && refreshCookie, 'refresh re-issues both cookies');
  const token = readCsrfToken(pairOf(csrfCookie));
  assert.ok(token);

  // The replayed write passes the CSRF guard.
  const retry = await createBindGroup(`${pairOf(refreshCookie)}; ${pairOf(csrfCookie)}`, token, accessToken);
  const retryBody = await retry.json();
  assert.notEqual(retryBody.message, CSRF_REJECTION_MESSAGE, `retry passed the CSRF guard (got ${retry.status})`);
});
