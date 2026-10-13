/**
 * Regression: after production renamed the CSRF cookie to __Host-cc_csrf, a
 * browser that still held the old cc_csrf echoed the stale value (the client
 * matched whichever name document.cookie listed first) and every web write —
 * e.g. the Security console's gate-pass Verify — failed with
 * 403 "Invalid or expired CSRF token".
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { startServer, PASSWORD } = await import('./helpers.js');
const { createApp } = await import('../src/app.js');
const { env } = await import('../src/config/env.js');
const { readCsrfToken } = await import('../../client/src/services/csrfCookie.js');

let ctx;

before(async () => {
  ctx = await startServer();
});

after(async () => {
  if (ctx) await ctx.stop();
});

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

const cookiesOf = (res) => res.headers.getSetCookie?.() || [];
const cookieNamed = (res, name) => cookiesOf(res).find((c) => c.startsWith(`${name}=`));
const pairOf = (c) => c.split(';')[0];
const valueOf = (c) => pairOf(c).slice(pairOf(c).indexOf('=') + 1);

test('client: the __Host- CSRF cookie wins over a stale legacy cc_csrf, whatever the order', () => {
  // document.cookie lists the older (legacy) cookie first — the failing case.
  assert.equal(readCsrfToken('cc_csrf=stale; __Host-cc_csrf=fresh'), 'fresh');
  assert.equal(readCsrfToken('__Host-cc_csrf=fresh; cc_csrf=stale'), 'fresh');
  assert.equal(readCsrfToken('other=1; cc_csrf=dev-token'), 'dev-token', 'development name still works');
  assert.equal(readCsrfToken('x_cc_csrf=nope; __Host-cc_csrfx=nope'), null, 'only exact names match');
  assert.equal(readCsrfToken('__Host-cc_csrf=a%2Bb'), 'a+b', 'value is URI-decoded');
  assert.equal(readCsrfToken(''), null);
  assert.equal(readCsrfToken(undefined), null);
});

test('production: a browser holding a stale cc_csrf can write once the client echoes __Host-cc_csrf, and the legacy cookies are expired', async () => {
  const security = await ctx.createUser({ name: 'Gate Guard', role: 'security' });
  await withProdApp(async (base) => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/120.0', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ email: security.email, password: PASSWORD }),
    });
    assert.equal(login.status, 200);
    const { accessToken } = await login.json();

    // The server tells the browser to drop the pre-rename cookies.
    for (const legacy of ['cc_csrf', 'cc_refresh']) {
      const c = cookieNamed(login, legacy);
      assert.ok(c, `${legacy} is expired on sign-in: ${cookiesOf(login).join(' | ')}`);
      assert.match(c, /Expires=Thu, 01 Jan 1970/);
    }

    const fresh = cookieNamed(login, '__Host-cc_csrf');
    // What the browser held: the legacy cookie first, the new one second.
    const documentCookie = `cc_csrf=stale-legacy-token; ${pairOf(fresh)}`;
    const verify = (token) =>
      fetch(`${base}/api/gate-pass/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          'sec-fetch-site': 'same-origin',
          cookie: documentCookie,
          'x-csrf-token': token,
        },
        body: JSON.stringify({ code: 'M38H' }),
      });

    // Echoing the stale value is what the user saw.
    const stale = await verify('stale-legacy-token');
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).message, 'Invalid or expired CSRF token');

    // The client now picks the __Host- value and the request passes the CSRF guard.
    const token = readCsrfToken(documentCookie);
    assert.equal(token, valueOf(fresh));
    const ok = await verify(token);
    assert.notEqual(ok.status, 403, `CSRF guard passed (got ${ok.status})`);
  });
});

test('development: no legacy-cookie expiry is sent (the plain names are the live ones)', async () => {
  const user = await ctx.createUser({ name: 'Dev Cookies' });
  const res = await fetch(`${ctx.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/120.0' },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  assert.doesNotMatch(cookieNamed(res, 'cc_csrf'), /Expires=Thu, 01 Jan 1970/);
  assert.doesNotMatch(cookieNamed(res, 'cc_refresh'), /Expires=Thu, 01 Jan 1970/);
});
