/**
 * Regression: the session-refresh endpoint must be rate-limited so a flood of
 * garbage/expired refresh tokens cannot be used to probe or overload the server
 * (defence-in-depth on top of the refresh token's signature + one-time rotation).
 *
 * REFRESH_RATE_LIMIT is set to a small value BEFORE the app is imported (the
 * limiter reads it at module load), so this file can trip the cap quickly
 * without affecting any other test file — node:test runs each file in its own
 * process. A dynamic import is used so the env var is set first.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.REFRESH_RATE_LIMIT = '5';
const { startServer } = await import('./helpers.js');

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

// Runs first, while the failure counter is still empty: a real rotation works
// and — because successful refreshes are skipped — does not consume the cap.
test('a legitimate rotation succeeds and does not consume the failure budget', async () => {
  const user = await ctx.createUser();
  const web = await ctx.loginWeb(user);
  const r = await ctx.request('POST', '/auth/refresh', { cookie: web.cookie });
  assert.equal(r.status, 200, 'a valid refresh must still succeed');
  assert.ok(r.headers.get('set-cookie'), 'a valid refresh must rotate the cookie');
});

test('refresh endpoint is rate-limited after repeated failed attempts', async () => {
  // No cookie / no body → every refresh fails (401). Only failures count
  // (skipSuccessfulRequests), so once the small cap is exceeded we get 429.
  let sawRateLimit = false;
  let saw401 = false;
  for (let i = 0; i < 12; i += 1) {
    const res = await ctx.request('POST', '/auth/refresh');
    if (res.status === 401) saw401 = true;
    if (res.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(saw401, 'invalid refresh attempts should be rejected with 401');
  assert.ok(sawRateLimit, 'excessive failed refresh attempts should eventually return 429');
});
