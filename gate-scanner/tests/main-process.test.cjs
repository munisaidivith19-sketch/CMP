'use strict';
// Main-process modules: API client (tokens, refresh, retries, classification),
// encrypted credential store, configuration and diagnostics sanitising.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiClient, classifyHttp, classifyNetwork } = require('../electron/apiClient.cjs');
const { createCredentialStore } = require('../electron/credentialStore.cjs');
const { normaliseBaseUrl, resolveApiBaseUrl, sanitiseSettings, createSettingsStore } = require('../electron/config.cjs');
const { sanitise } = require('../electron/diagnosticsLog.cjs');
const { historyQuery } = require('../electron/queries.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate-scanner-test-'));

/** Stand-in for Electron safeStorage (DPAPI): reversible but not plain text. */
const fakeSafeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
});

const json = (status, body) => ({ status, text: async () => JSON.stringify(body) });

/** Scripted fetch: each call takes the next response (or throws). */
function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = script.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

function client(script, { store = createCredentialStore(tmp(), fakeSafeStorage()), onSignedOut } = {}) {
  const fetchImpl = scriptedFetch(script);
  const api = createApiClient({ baseUrl: 'https://gate.example.test', store, identityHeaders: () => ({ 'x-device-name': 'PC1' }), fetchImpl, onSignedOut, retryDelays: [1, 1, 1] });
  return { api, fetchImpl, store };
}

const loginOk = (rt = 'refresh-1') => json(200, { accessToken: 'access-1', refreshToken: rt, user: { name: 'Guard A', role: 'security', legal: { termsRequired: false } } });

test('credential store: encrypted at rest, survives restart, cleared on demand, never plain text', () => {
  const dir = tmp();
  const store = createCredentialStore(dir, fakeSafeStorage());
  assert.equal(store.save({ refreshToken: 'secret-refresh-token', guardName: 'Guard A' }), true);
  const onDisk = fs.readFileSync(path.join(dir, 'credentials.dat'));
  assert.ok(!onDisk.toString('utf8').includes('secret-refresh-token'), 'no plain-text token');
  const again = createCredentialStore(dir, fakeSafeStorage()); // app restart
  assert.equal(again.load().refreshToken, 'secret-refresh-token');
  again.clear();
  assert.equal(again.load(), null);
  assert.equal(fs.existsSync(path.join(dir, 'credentials.dat')), false);
});

test('credential store: without OS encryption nothing is written; unreadable files are discarded', () => {
  const dir = tmp();
  const plain = createCredentialStore(dir, fakeSafeStorage(false));
  assert.equal(plain.save({ refreshToken: 'x' }), false);
  assert.equal(fs.readdirSync(dir).length, 0);

  fs.writeFileSync(path.join(dir, 'credentials.dat'), 'garbage');
  const store = createCredentialStore(dir, { ...fakeSafeStorage(), decryptString: () => { throw new Error('other user'); } });
  assert.equal(store.load(), null);
  assert.equal(fs.existsSync(path.join(dir, 'credentials.dat')), false);
});

test('clearing the browser cache never touches the saved session (separate file)', () => {
  const dir = tmp();
  const store = createCredentialStore(dir, fakeSafeStorage());
  store.save({ refreshToken: 'keep-me' });
  for (const cache of ['Cache', 'Code Cache', 'GPUCache']) fs.rmSync(path.join(dir, cache), { recursive: true, force: true });
  assert.equal(store.load().refreshToken, 'keep-me');
});

test('login identifies the Gate Scanner, persists the refresh token, keeps the access token in memory only', async () => {
  const { api, fetchImpl, store } = client([loginOk()]);
  const r = await api.login('guard@jnn.edu.in', 'pw');
  assert.equal(r.ok, true);
  assert.equal(r.persisted, true);
  assert.equal(fetchImpl.calls[0].init.headers['x-client-platform'], 'gate-desktop');
  assert.equal(fetchImpl.calls[0].init.redirect, 'error');
  assert.equal(store.load().refreshToken, 'refresh-1');
  assert.ok(!JSON.stringify(store.load()).includes('access-1'));
  assert.ok(!JSON.stringify(store.load()).includes('pw'), 'password never stored');
});

test('login refusals are classified (wrong role, invalid, locked, maintenance, offline)', async () => {
  const cases = [
    [json(403, { code: 'GATE_SCANNER_ROLE_REQUIRED', message: 'Security only' }), 'role'],
    [json(401, { message: 'Invalid email or password' }), 'auth'],
    [json(423, { message: 'Locked' }), 'locked'],
    [json(503, { code: 'MAINTENANCE', message: 'Maintenance' }), 'maintenance'],
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'offline'],
  ];
  for (const [response, kind] of cases) {
    const { api, store } = client([response]);
    const r = await api.login('a@b.c', 'pw');
    assert.equal(r.ok, false);
    assert.equal(r.kind, kind);
    assert.equal(store.load(), null);
  }
});

test('session restore re-validates with the server; ended sessions are deleted, offline keeps them', async () => {
  const dir = tmp();
  const store = createCredentialStore(dir, fakeSafeStorage());
  store.save({ refreshToken: 'saved', guardName: 'Guard A' });

  const ok = client([loginOk('rotated')], { store });
  const r = await ok.api.restore();
  assert.equal(r.status, 'signed-in');
  assert.equal(ok.fetchImpl.calls[0].body.refreshToken, 'saved');
  assert.equal(store.load().refreshToken, 'rotated', 'rotated token re-saved');

  const offline = client([Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })], { store });
  assert.equal((await offline.api.restore()).status, 'unverified');
  assert.equal(store.load().refreshToken, 'rotated', 'kept while the server cannot be reached');

  let signedOut = null;
  const ended = client([json(401, { message: 'Session is no longer valid' })], { store, onSignedOut: (e) => (signedOut = e) });
  assert.equal((await ended.api.restore()).status, 'signed-out');
  assert.equal(store.load(), null, 'revoked session → credential deleted');
  assert.equal(signedOut.reason, 'session_ended');

  store.save({ refreshToken: 'saved2' });
  const role = client([json(401, { code: 'GATE_SCANNER_ROLE_REQUIRED', message: 'no longer authorized' })], { store });
  const rr = await role.api.restore();
  assert.equal(rr.reason, 'role');
  assert.equal(store.load(), null);
});

test('an expired access token is refreshed once (single flight) and the requests retried', async () => {
  const { api, fetchImpl } = client([
    loginOk(),
    json(401, { message: 'expired' }),
    json(401, { message: 'expired' }),
    json(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
    json(200, { a: 1 }),
    json(200, { b: 2 }),
  ]);
  await api.login('a@b.c', 'pw');
  const [r1, r2] = await Promise.all([api.request('GET', '/gate-scanner/dashboard'), api.request('GET', '/gate-scanner/session')]);
  assert.equal(r1.ok && r2.ok, true);
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/auth/refresh')).length, 1, 'one refresh for both');
  assert.equal(fetchImpl.calls.at(-1).init.headers.authorization, 'Bearer access-2');
});

test('a scan POST is retried only when asked (idempotent), with the same body; GET retries are bounded', async () => {
  const net = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const { api, fetchImpl } = client([loginOk(), net(), net(), json(200, { outcome: 'success' })]);
  await api.login('a@b.c', 'pw');
  const r = await api.request('POST', '/gate-scanner/scans', { body: { scanId: 'abc12345', payload: 'CCGP:A4G5' }, retries: 2 });
  assert.equal(r.ok, true);
  const posts = fetchImpl.calls.filter((c) => c.url.endsWith('/gate-scanner/scans'));
  assert.equal(posts.length, 3);
  assert.ok(posts.every((p) => p.body.scanId === 'abc12345'));

  const noRetry = client([loginOk(), net()]);
  await noRetry.api.login('a@b.c', 'pw');
  const once = await noRetry.api.request('POST', '/legal/accept', { body: {} });
  assert.equal(once.ok, false);
  assert.equal(once.mayHaveArrived, true);
  assert.equal(noRetry.fetchImpl.calls.length, 2, 'not retried by default');

  const gets = client([loginOk(), json(503, {}), json(503, {}), json(503, {})]);
  await gets.api.login('a@b.c', 'pw');
  const g = await gets.api.request('GET', '/gate-scanner/dashboard');
  assert.equal(g.kind, 'server');
  assert.equal(gets.fetchImpl.calls.length, 4, '1 + 2 retries');
});

test('sign-out revokes on the server and deletes the saved credential even when offline', async () => {
  const { api, fetchImpl, store } = client([loginOk(), json(200, { message: 'Signed out' })]);
  await api.login('a@b.c', 'pw');
  await api.logout('switch_guard');
  assert.equal(fetchImpl.calls[1].body.refreshToken, 'refresh-1');
  assert.equal(store.load(), null);
  assert.equal(api.signedIn, false);

  const off = client([loginOk(), Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })]);
  await off.api.login('a@b.c', 'pw');
  await off.api.logout();
  assert.equal(off.store.load(), null);
});

test('error classification covers the server codes and network failures', () => {
  assert.equal(classifyHttp(403, { code: 'GATE_SCANNER_SCOPE' }), 'scope');
  assert.equal(classifyHttp(403, { code: 'TERMS_ACCEPTANCE_REQUIRED' }), 'terms');
  assert.equal(classifyHttp(403, { code: 'PASSWORD_CHANGE_REQUIRED' }), 'password');
  assert.equal(classifyHttp(429, {}), 'rate');
  assert.equal(classifyHttp(502, null), 'server');
  assert.deepEqual(classifyNetwork({ name: 'AbortError' }), { kind: 'timeout', mayHaveArrived: true });
  assert.equal(classifyNetwork({ cause: { code: 'CERT_HAS_EXPIRED' } }).kind, 'tls');
  assert.equal(classifyNetwork({ cause: { code: 'ECONNREFUSED' } }).mayHaveArrived, false);
});

test('configuration: production is https only; machine override needs https; dev may use localhost', () => {
  assert.equal(resolveApiBaseUrl({ packaged: true, env: {}, machineConfig: null }).url, 'https://jnnedu.tech');
  assert.equal(resolveApiBaseUrl({ packaged: true, env: { GATE_SCANNER_API_URL: 'http://localhost:5000' }, machineConfig: null }).source, 'built-in', 'env ignored when packaged');
  assert.equal(resolveApiBaseUrl({ packaged: false, env: { GATE_SCANNER_API_URL: 'http://localhost:5000' } }).url, 'http://localhost:5000');
  assert.equal(resolveApiBaseUrl({ packaged: true, env: {}, machineConfig: { apiBaseUrl: 'https://gate.jnn.edu.in/some/path' } }).url, 'https://gate.jnn.edu.in');
  assert.throws(() => normaliseBaseUrl('http://jnnedu.tech', { packaged: true }));
  assert.throws(() => normaliseBaseUrl('http://localhost:5000', { packaged: true }));
  assert.throws(() => normaliseBaseUrl('https://user:pw@jnnedu.tech', { packaged: true }));
  assert.throws(() => normaliseBaseUrl('javascript:alert(1)', { packaged: false }));
});

test('settings are validated and persisted; unknown keys dropped', () => {
  const s = sanitiseSettings({ gateName: 'Main <Gate>', scannerMode: 'bogus', terminator: 'Tab', maxKeyGapMs: 5, serialBaudRate: 115200, evil: 1, alwaysOnTop: 'yes' });
  assert.equal(s.gateName, 'Main Gate');
  assert.equal(s.scannerMode, 'hid');
  assert.equal(s.terminator, 'Tab');
  assert.equal(s.maxKeyGapMs, 60);
  assert.equal(s.serialBaudRate, 115200);
  assert.equal(s.evil, undefined);
  assert.equal(s.alwaysOnTop, false);
  const dir = tmp();
  createSettingsStore(dir).set({ gateName: 'North Gate' });
  assert.equal(createSettingsStore(dir).get().gateName, 'North Gate');
});

test('diagnostics never record secrets or QR payloads; history queries are whitelisted', () => {
  const e = sanitise({ event: 'x', refreshToken: 'r', password: 'p', payload: 'CCGP:A4G5', authorization: 'Bearer', code: 'EXIT_RECORDED', kind: 'timeout', nested: { a: 1 } });
  assert.deepEqual(e, { event: 'x', code: 'EXIT_RECORDED', kind: 'timeout' });
  assert.equal(sanitise({ code: 'A4G5' }).code, undefined, 'a gate code is not a status code');

  const q = new URLSearchParams(historyQuery({ range: 'custom', from: '2026-01-01', to: '2026-01-31', type: 'in', q: '  21CS001 ', page: 2, limit: 500, evil: 'x', outcome: 'rejected' }));
  assert.equal(q.get('range'), 'custom');
  assert.equal(q.get('q'), '21CS001');
  assert.equal(q.get('limit'), '25');
  assert.equal(q.get('evil'), null);
  assert.equal(q.get('outcome'), null, 'outcome only for attempts');
  assert.equal(new URLSearchParams(historyQuery({ range: 'bad' })).get('range'), 'today');
});
