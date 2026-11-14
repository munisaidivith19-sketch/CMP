/**
 * HTTPS enforcement (middleware/https.js): plain-HTTP page loads are sent to
 * the configured https APP_URL — never to a host taken from the request —
 * plain-HTTP writes are refused, the platform health probe still works, and
 * the realtime socket refuses plain-HTTP handshakes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { forceHttpsEnabled, httpsOnly, isSecureRawRequest } from '../src/middleware/https.js';

function run(mw, req) {
  const out = { nextCalled: false };
  const res = {
    redirect(status, url) { out.status = status; out.location = url; },
    status(s) { out.status = s; return this; },
    json(b) { out.body = b; },
  };
  mw({ method: 'GET', path: '/', originalUrl: '/', secure: false, hostname: 'jnn.onrender.com', ...req }, res, () => (out.nextCalled = true));
  return out;
}

function withAppUrl(url, fn) {
  const saved = { appUrl: env.appUrl, clientUrls: env.clientUrls };
  env.appUrl = url;
  env.clientUrls = [url];
  try {
    return fn();
  } finally {
    Object.assign(env, saved);
  }
}

test('FORCE_HTTPS: on by default in production, off in development, explicit values win', () => {
  assert.equal(forceHttpsEnabled(undefined, true), true);
  assert.equal(forceHttpsEnabled(undefined, false), false);
  assert.equal(forceHttpsEnabled('false', true), false, 'plain-HTTP campus server');
  assert.equal(forceHttpsEnabled('true', false), true);
});

test('a plain-HTTP page load is redirected (301) to the same path on the https APP_URL', () => {
  withAppUrl('https://jnn.onrender.com', () => {
    const out = run(httpsOnly(true), { originalUrl: '/attendance?day=2026-11-06', path: '/attendance' });
    assert.deepEqual([out.status, out.location], [301, 'https://jnn.onrender.com/attendance?day=2026-11-06']);
  });
});

test('the redirect target never comes from the Host header (no open redirect)', () => {
  withAppUrl('https://jnn.onrender.com', () => {
    const out = run(httpsOnly(true), { hostname: 'evil.example', originalUrl: '//evil.example/x', path: '//evil.example/x' });
    assert.ok(out.location.startsWith('https://jnn.onrender.com/'), out.location);
  });
  // No https APP_URL and a host that is not a configured origin: refused, not redirected.
  withAppUrl('http://campus.local', () => {
    const out = run(httpsOnly(true), { hostname: 'evil.example' });
    assert.equal(out.status, 403);
    assert.equal(out.location, undefined);
  });
});

test('plain-HTTP writes are refused, not replayed over HTTPS', () => {
  withAppUrl('https://jnn.onrender.com', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const out = run(httpsOnly(true), { method, path: '/api/auth/login', originalUrl: '/api/auth/login' });
      assert.equal(out.status, 403, method);
      assert.equal(out.body.code, 'HTTPS_REQUIRED');
    }
  });
});

test('HTTPS requests, the health probe and a disabled setting pass straight through', () => {
  assert.equal(run(httpsOnly(true), { secure: true }).nextCalled, true);
  assert.equal(run(httpsOnly(true), { path: '/api/health', originalUrl: '/api/health' }).nextCalled, true);
  assert.equal(run(httpsOnly(false), {}).nextCalled, true);
});

test('socket handshakes: TLS directly or via a trusted proxy only', () => {
  assert.equal(isSecureRawRequest({ socket: { encrypted: true }, headers: {} }, false), true);
  assert.equal(isSecureRawRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }, 1), true);
  assert.equal(isSecureRawRequest({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }, 1), false);
  assert.equal(isSecureRawRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }, false), false, 'untrusted header ignored');
});
