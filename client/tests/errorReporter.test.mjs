import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorKind, createErrorReporter } from '../src/services/errorReporter.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts = {}) {
  let t = 0;
  const sent = [];
  const r = createErrorReporter({ send: async (b) => sent.push(b), now: () => t, getRoute: () => '/attendance', ...opts });
  return { r, sent, advance: (ms) => (t += ms) };
}

test('deduplicates the same error for a minute, then sends it again', async () => {
  const { r, sent, advance } = setup();
  assert.equal(r.report({ kind: 'render', message: 'Cannot read x of item 12' }), true);
  await flush();
  assert.equal(r.report({ kind: 'render', message: 'Cannot read x of item 13' }), false, 'same shape, numbers differ');
  advance(61_000);
  assert.equal(r.report({ kind: 'render', message: 'Cannot read x of item 14' }), true);
  await flush();
  assert.equal(sent.length, 2);
});

test('caps reports per minute so an error loop cannot flood the server', async () => {
  const { r, sent, advance } = setup();
  for (let i = 0; i < 30; i += 1) {
    r.report({ kind: 'window_error', message: `distinct problem ${'x'.repeat(i)}` });
    await flush();
  }
  assert.equal(sent.length, 10);
  advance(60_000);
  r.report({ kind: 'window_error', message: 'after the window' });
  await flush();
  assert.equal(sent.length, 11);
});

test('sends nothing while signed out, never the query string, and never throws', async () => {
  const out = setup({ isSignedIn: () => false });
  assert.equal(out.r.report({ kind: 'render', message: 'x' }), false);
  const { r, sent } = setup({ getRoute: () => '/gate-pass?token=secret#frag' });
  r.report({ kind: 'api', message: 'Server answered 500', status: 500, endpoint: '/gate-pass/123?otp=999', correlationId: 'bad id with spaces' });
  await flush();
  assert.equal(sent[0].route, '/gate-pass');
  assert.equal(sent[0].endpoint, '/gate-pass/123');
  assert.equal(sent[0].correlationId, undefined, 'malformed correlation ids are dropped');
  const throwing = createErrorReporter({ send: () => { throw new Error('nope'); } });
  assert.doesNotThrow(() => throwing.report({ kind: 'render', message: 'x' }));
});

test('install/uninstall listens for script errors and unhandled rejections', async () => {
  const { r, sent } = setup();
  const handlers = {};
  const target = { addEventListener: (n, f) => (handlers[n] = f), removeEventListener: (n) => delete handlers[n] };
  const uninstall = r.install(target);
  handlers.unhandledrejection({ reason: new TypeError('promise broke') });
  await flush();
  handlers.error({ message: 'script broke', error: new RangeError('script broke') });
  await flush();
  assert.deepEqual(sent.map((s) => s.kind), ['unhandled_rejection', 'window_error']);
  uninstall();
  assert.deepEqual(Object.keys(handlers), []);
});

test('only network failures and 5xx are reported; 4xx answers and maintenance are not', () => {
  assert.equal(apiErrorKind({ status: 'FETCH_ERROR' }), 'network');
  assert.equal(apiErrorKind({ status: 'TIMEOUT_ERROR' }), 'network');
  assert.equal(apiErrorKind({ status: 502 }), 'api');
  assert.equal(apiErrorKind({ status: 503, data: { code: 'MAINTENANCE' } }), null);
  for (const s of [400, 401, 403, 404, 409, 422, 429]) assert.equal(apiErrorKind({ status: s }), null, String(s));
  assert.equal(apiErrorKind(undefined), null);
});
