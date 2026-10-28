import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { startServer, PASSWORD } from './helpers.js';

const legal = await import('../src/services/legal.js');
const { POLICY_REGISTRY } = await import('../src/legal/registry.js');

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const PAST = '2025-01-01T00:00:00.000Z';
const TEXT = {
  'terms-a.md': '# Terms A\n\nFirst terms.',
  'terms-b.md': '# Terms B\n\nMaterial change.',
  'terms-c.md': '# Terms C\n\nTypo fix.',
  'privacy-a.md': '# Privacy A',
  'privacy-b.md': '# Privacy B',
  'terms-draft.md': '# Draft terms',
};
const readContent = async (file) => TEXT[file];
const entry = (policyId, version, file, extra = {}) => ({ policyId, version, file, status: 'published', effectiveAt: PAST, requiresAcceptance: policyId === 'terms', ...extra });
const publish = (...entries) => legal.syncPolicyVersions({ registry: entries, readContent, log: { warn() {} } });

const MOBILE = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };

// The Terms gate applies to the mobile apps; the web app is never asked.
async function student() {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A' });
  return { u, ...(await ctx.loginMobile(u)) };
}
async function webStudent() {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A' });
  return { u, ...(await ctx.loginWeb(u)) };
}
const accept = (s, body) => ctx.request('POST', '/legal/accept', { token: s.token, headers: MOBILE, body });
const dashboard = (s) => ctx.request('GET', '/dashboard', { token: s.token, headers: s.cookie ? undefined : MOBILE });

// ── Before anything is published ───────────────────────────────────

test('no published Terms: nobody is gated and the public documents are 404', async () => {
  const s = await student();
  assert.equal(s.user.legal.termsRequired, false);
  assert.equal(s.user.legal.termsVersion, null);
  assert.equal((await dashboard(s)).status, 200);
  assert.equal((await ctx.request('GET', '/legal/policies/terms')).status, 404);
  assert.equal((await accept(s, { policyId: 'terms', version: 1, agreed: true })).status, 404);
});

test('the shipped registry syncs: one published Terms and one Privacy Policy, idempotently', async () => {
  // Read-only check in a throw-away collection state: sync, inspect, then remove.
  const first = await legal.syncPolicyVersions();
  assert.equal(first.inserted, POLICY_REGISTRY.length);
  const again = await legal.syncPolicyVersions();
  assert.equal(again.inserted, 0);
  assert.equal(again.unchanged, POLICY_REGISTRY.length);
  const docs = await ctx.models.PolicyVersion.find().lean();
  assert.deepEqual(docs.map((d) => d.policyId).sort(), ['privacy', 'terms']);
  for (const d of docs) {
    assert.equal(d.status, 'published');
    assert.match(d.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(d.contentHash, legal.hashContent(d.content));
    // Public documents never expose internal infrastructure details.
    assert.doesNotMatch(d.content, /mongodb(\+srv)?:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b|onrender\.com|API_KEY|SECRET|password\s*[:=]/i);
  }
  // Remove them through the raw driver (the model refuses deletes by design).
  await ctx.models.PolicyVersion.collection.deleteMany({});
  legal.clearLegalCache();
});

// ── Publishing and public access ───────────────────────────────────

test('publish v1: public endpoints serve the current documents without signing in', async () => {
  const r = await publish(entry('terms', 1, 'terms-a.md'), entry('privacy', 1, 'privacy-a.md', { requiresAcceptance: true }));
  assert.equal(r.inserted, 2);

  const list = await ctx.request('GET', '/legal/policies');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.policies.map((p) => [p.policyId, p.version]).sort(), [['privacy', 1], ['terms', 1]]);
  assert.ok(list.body.policies.every((p) => p.content === undefined), 'the list carries no text');

  const terms = await ctx.request('GET', '/legal/policies/terms');
  assert.equal(terms.status, 200);
  assert.equal(terms.body.title, 'Terms and Conditions');
  assert.equal(terms.body.version, 1);
  assert.equal(terms.body.content, TEXT['terms-a.md']);
  assert.ok(terms.body.effectiveAt);
  assert.equal(terms.body._id, undefined, 'no internal ids');
  assert.match(terms.headers.get('cache-control'), /public/);

  const privacy = await ctx.request('GET', '/legal/policies/privacy');
  assert.equal(privacy.status, 200);
  assert.equal(privacy.body.requiresAcceptance, false, 'only the Terms can require acceptance');

  assert.equal((await ctx.request('GET', '/legal/policies/cookies')).status, 422);
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/1')).body.version, 1);
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/9')).status, 404);
});

test('public documents stay readable during maintenance', async () => {
  await ctx.models.PlatformState.updateOne({ _id: 'platform' }, { $set: { mode: 'maintenance' } }, { upsert: true });
  const { invalidatePlatformCache } = await import('../src/services/platformState.js');
  invalidatePlatformCache();
  try {
    assert.equal((await ctx.request('GET', '/legal/policies/privacy')).status, 200);
    assert.equal((await ctx.request('GET', '/legal/policies/terms')).status, 200);
    assert.equal((await ctx.request('GET', '/announcements')).status, 503, 'other public endpoints are closed');
  } finally {
    await ctx.models.PlatformState.updateOne({ _id: 'platform' }, { $set: { mode: 'normal' } });
    invalidatePlatformCache();
  }
});

// ── The gate ───────────────────────────────────────────────────────

test('first sign-in on mobile: user.legal says acceptance is required and protected APIs refuse', async () => {
  const s = await student();
  assert.equal(s.user.legal.termsRequired, true);
  assert.equal(s.user.legal.termsVersion, 1);
  assert.equal(s.user.legal.termsAcceptedVersion, null);
  assert.equal(s.user.legal.privacyVersion, 1);

  const res = await dashboard(s);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TERMS_ACCEPTANCE_REQUIRED');
  for (const path of ['/announcements', '/users', '/attendance/my', '/notifications', '/chat/conversations', '/super-admin/accounts']) {
    assert.equal((await ctx.request('GET', path, { token: s.token })).body?.code, 'TERMS_ACCEPTANCE_REQUIRED', path);
  }

  // Open while gated: identity, status, sessions, the documents, sign-out.
  assert.equal((await ctx.request('GET', '/auth/me', { token: s.token })).body.legal.termsRequired, true);
  assert.equal((await ctx.request('GET', '/legal/status', { token: s.token })).body.termsRequired, true);
  assert.equal((await ctx.request('GET', '/auth/sessions', { token: s.token })).status, 200);
  assert.equal((await ctx.request('GET', '/legal/policies/terms', { token: s.token })).status, 200);

  const mobileUser = await ctx.createUser({ role: 'faculty', department: 'CSE' });
  const m = await ctx.loginMobile(mobileUser);
  assert.equal(m.user.legal.termsRequired, true);
  const mres = await ctx.request('GET', '/dashboard', { token: m.token });
  assert.equal(mres.body.code, 'TERMS_ACCEPTANCE_REQUIRED');
  // A refreshed (existing) session is still gated: the token is not the record.
  const refreshed = await ctx.request('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken }, headers: { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' } });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.user.legal.termsRequired, true);
});

test('the web app is never asked: web sessions are not gated and legal.termsRequired is false', async () => {
  const w = await webStudent();
  assert.equal(w.user.legal.termsRequired, false);
  assert.equal(w.user.legal.termsVersion, 1, 'the documents are still versioned for display');
  assert.equal((await ctx.request('GET', '/dashboard', { token: w.token })).status, 200);
  assert.equal((await ctx.request('GET', '/auth/me', { token: w.token })).body.legal.termsRequired, false);
  assert.equal((await ctx.request('GET', '/legal/status', { token: w.token })).body.termsRequired, false);
  const socket = ioClient(ctx.base, { transports: ['websocket'], auth: { token: w.token }, reconnection: false, forceNew: true });
  try {
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const res = await new Promise((resolve) => socket.emit('chat:join', '64b000000000000000000001', resolve));
    assert.notEqual(res.error, 'terms_required');
  } finally { socket.disconnect(); }
  assert.equal(await ctx.models.PolicyAcceptance.countDocuments({ user: w.u._id }), 0);
});

test('every role is gated on mobile, including admins', async () => {
  for (const role of ['faculty', 'principal', 'hod']) {
    const u = await ctx.createUser({ role, department: role === 'hod' || role === 'faculty' ? 'CSE' : undefined });
    const s = { u, ...(await ctx.loginMobile(u)) };
    assert.equal((await dashboard(s)).body.code, 'TERMS_ACCEPTANCE_REQUIRED', role);
  }
});

test('acceptance input is validated and requires a signed-in user', async () => {
  const s = await student();
  assert.equal((await ctx.request('POST', '/legal/accept', { body: { policyId: 'terms', version: 1, agreed: true } })).status, 401);
  assert.equal((await accept(s, { policyId: 'terms', version: 1 })).status, 422, 'agreed is required');
  assert.equal((await accept(s, { policyId: 'terms', version: 1, agreed: 'true' })).status, 422, 'agreed must be literally true');
  assert.equal((await accept(s, { policyId: 'terms', version: 1, agreed: false })).status, 422);
  assert.equal((await accept(s, { policyId: 'privacy', version: 1, agreed: true })).status, 422);
  const stale = await accept(s, { policyId: 'terms', version: 7, agreed: true });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'POLICY_VERSION_CHANGED');
  assert.equal(stale.body.currentVersion, 1);
  assert.equal(await ctx.models.PolicyAcceptance.countDocuments({ user: s.u._id }), 0);
  assert.equal((await dashboard(s)).status, 403);
});

test('accepting unlocks the account, records the exact version server-side, and cannot target another user', async () => {
  const s = await student();
  const other = await student();
  const before = Date.now();
  const res = await accept(s, { policyId: 'terms', version: 1, agreed: true, user: String(other.u._id), userId: String(other.u._id), acceptedAt: '2000-01-01' });
  assert.equal(res.status, 200);
  assert.equal(res.body.termsRequired, false);
  assert.equal(res.body.termsAcceptedVersion, 1);

  assert.equal((await dashboard(s)).status, 200);
  assert.equal((await dashboard(other)).status, 403, 'the other user is still gated');
  assert.equal(await ctx.models.PolicyAcceptance.countDocuments({ user: other.u._id }), 0);

  const rec = await ctx.models.PolicyAcceptance.findOne({ user: s.u._id }).lean();
  const v1 = await ctx.models.PolicyVersion.findOne({ policyId: 'terms', version: 1 }).lean();
  assert.equal(rec.version, 1);
  assert.equal(String(rec.policyVersion), String(v1._id));
  assert.equal(rec.contentHash, v1.contentHash);
  assert.equal(rec.status, 'accepted');
  assert.equal(rec.method, 'checkbox');
  assert.match(rec.consentText, /read and agree/);
  assert.equal(rec.privacyVersionShown, 1);
  assert.equal(rec.client, 'mobile');
  assert.ok(rec.acceptedAt.getTime() >= before - 1000, 'server time, not the client-sent date');
  for (const k of ['password', 'token', 'accessToken', 'refreshToken', 'ip']) assert.equal(rec[k], undefined, k);

  // The next sign-in does not ask again.
  const again = await ctx.loginMobile(s.u);
  assert.equal(again.user.legal.termsRequired, false);
});

test('accepting twice, or concurrently from two devices, keeps one record', async () => {
  const s = await student();
  const s2 = { u: s.u, ...(await ctx.loginMobile(s.u)) };
  const results = await Promise.all([
    accept(s, { policyId: 'terms', version: 1, agreed: true }),
    accept(s2, { policyId: 'terms', version: 1, agreed: true }),
    accept(s, { policyId: 'terms', version: 1, agreed: true }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(await ctx.models.PolicyAcceptance.countDocuments({ user: s.u._id }), 1);
});

test('mobile acceptance records the mobile client', async () => {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A' });
  const m = await ctx.loginMobile(u);
  const headers = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };
  const res = await ctx.request('POST', '/legal/accept', { token: m.token, headers, body: { policyId: 'terms', version: 1, agreed: true } });
  assert.equal(res.status, 200);
  assert.equal((await ctx.models.PolicyAcceptance.findOne({ user: u._id }).lean()).client, 'mobile');
  assert.equal((await ctx.request('GET', '/dashboard', { token: m.token, headers })).status, 200);
});

test('sign-out and password change still work while acceptance is pending', async () => {
  const s = await student();
  assert.equal((await ctx.request('POST', '/auth/logout', { headers: MOBILE, body: { refreshToken: s.refreshToken } })).status, 200);

  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A', mustChangePassword: true });
  const t = await ctx.loginMobile(u);
  // The temporary password comes first, then the Terms.
  assert.equal((await dashboard(t)).body.code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await ctx.request('POST', '/auth/change-password', {
    token: t.token,
    headers: MOBILE,
    body: { currentPassword: PASSWORD, newPassword: 'NewPassw0rd!' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.legal.termsRequired, true);
  assert.equal((await ctx.request('GET', '/dashboard', { token: changed.body.accessToken })).body.code, 'TERMS_ACCEPTANCE_REQUIRED');
});

test('sockets: chat, discussion and bus rooms are refused until the Terms are accepted', async () => {
  const s = await student();
  const socket = ioClient(ctx.base, { transports: ['websocket'], auth: { token: s.token }, reconnection: false, forceNew: true });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const emit = (ev, arg) => new Promise((resolve) => socket.emit(ev, arg, resolve));
    const id = '64b000000000000000000001';
    assert.equal((await emit('chat:join', id)).error, 'terms_required');
    assert.equal((await emit('discussion:join', id)).error, 'terms_required');
    assert.equal((await emit('transport:subscribe', 'all')).error, 'terms_required');

    await accept(s, { policyId: 'terms', version: 1, agreed: true });
    // Same connection: now decided by the room's own rules.
    assert.notEqual((await emit('chat:join', id)).error, 'terms_required');
  } finally {
    socket.disconnect();
  }
});

// ── Versioning ─────────────────────────────────────────────────────

test('a material Terms update (requiresAcceptance) asks everyone again; a minor one does not', async () => {
  const s = await student();
  assert.equal((await accept(s, { policyId: 'terms', version: 1, agreed: true })).status, 200);

  await publish(entry('terms', 1, 'terms-a.md'), entry('terms', 2, 'terms-b.md', { requiresAcceptance: true }));
  const me = await ctx.request('GET', '/auth/me', { token: s.token });
  assert.equal(me.body.legal.termsRequired, true);
  assert.equal(me.body.legal.termsVersion, 2);
  assert.equal(me.body.legal.termsAcceptedVersion, 1);
  assert.equal((await dashboard(s)).body.code, 'TERMS_ACCEPTANCE_REQUIRED');
  assert.equal((await accept(s, { policyId: 'terms', version: 1, agreed: true })).status, 409, 'the old version cannot be accepted any more');
  assert.equal((await accept(s, { policyId: 'terms', version: 2, agreed: true })).status, 200);
  assert.equal((await dashboard(s)).status, 200);

  // The v1 text the user accepted is still stored and served unchanged.
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/1')).body.content, TEXT['terms-a.md']);
  assert.equal(await ctx.models.PolicyAcceptance.countDocuments({ user: s.u._id }), 2);

  // v3: a correction that does not require renewed acceptance.
  await publish(entry('terms', 3, 'terms-c.md', { requiresAcceptance: false }));
  const after3 = await ctx.request('GET', '/auth/me', { token: s.token });
  assert.equal(after3.body.legal.termsVersion, 3);
  assert.equal(after3.body.legal.termsRequired, false, 'acceptance of v2 still satisfies v3');
  assert.equal((await dashboard(s)).status, 200);
  assert.equal((await ctx.request('GET', '/legal/policies/terms')).body.version, 3);
});

test('a Privacy Policy update is independent and never gates anyone', async () => {
  const s = await student();
  await accept(s, { policyId: 'terms', version: 3, agreed: true });
  await publish(entry('privacy', 2, 'privacy-b.md', { requiresAcceptance: true }));
  const me = await ctx.request('GET', '/auth/me', { token: s.token });
  assert.equal(me.body.legal.privacyVersion, 2);
  assert.equal(me.body.legal.termsVersion, 3);
  assert.equal(me.body.legal.termsRequired, false);
  assert.equal((await dashboard(s)).status, 200);
  assert.equal((await ctx.request('GET', '/legal/policies/privacy')).body.content, TEXT['privacy-b.md']);
});

test('drafts and future versions are never current, public or acceptable', async () => {
  const s = await student();
  await accept(s, { policyId: 'terms', version: 3, agreed: true });
  await publish(
    entry('terms', 4, 'terms-draft.md', { status: 'draft', requiresAcceptance: true }),
    entry('terms', 5, 'terms-b.md', { effectiveAt: '2099-01-01T00:00:00.000Z', requiresAcceptance: true })
  );
  assert.equal((await ctx.request('GET', '/legal/policies/terms')).body.version, 3);
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/4')).status, 404);
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/5')).status, 404);
  assert.equal((await dashboard(s)).status, 200, 'an unpublished requirement gates nobody');
  assert.equal((await accept(s, { policyId: 'terms', version: 4, agreed: true })).status, 409);

  // Publishing the draft later makes it current (and, here, required).
  await publish(entry('terms', 4, 'terms-draft.md', { requiresAcceptance: true }));
  assert.equal((await ctx.request('GET', '/legal/policies/terms')).body.version, 4);
  assert.equal((await dashboard(s)).body.code, 'TERMS_ACCEPTANCE_REQUIRED');
});

test('published text is immutable: a changed file is refused (production) or ignored (development)', async () => {
  const changed = async (file) => (file === 'terms-a.md' ? '# Terms A — silently edited' : TEXT[file]);
  await assert.rejects(
    legal.syncPolicyVersions({ registry: [entry('terms', 1, 'terms-a.md')], readContent: changed, isProd: true }),
    /immutable/
  );
  const warnings = [];
  const r = await legal.syncPolicyVersions({ registry: [entry('terms', 1, 'terms-a.md')], readContent: changed, isProd: false, log: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(r.mismatched, ['terms v1']);
  assert.equal(warnings.length, 1);
  assert.equal((await ctx.request('GET', '/legal/policies/terms/versions/1')).body.content, TEXT['terms-a.md']);
});

test('two instances starting at once publish each version once and both start', async () => {
  const both = await Promise.all([
    publish(entry('terms', 6, 'terms-c.md', { requiresAcceptance: false, effectiveAt: '2099-01-01T00:00:00.000Z' })),
    publish(entry('terms', 6, 'terms-c.md', { requiresAcceptance: false, effectiveAt: '2099-01-01T00:00:00.000Z' })),
  ]);
  assert.equal(both.reduce((n, r) => n + r.inserted, 0), 1);
  assert.equal(await ctx.models.PolicyVersion.countDocuments({ policyId: 'terms', version: 6 }), 1);
});

test('stored versions and acceptance records cannot be altered or deleted through the models', async () => {
  const { PolicyVersion, PolicyAcceptance } = ctx.models;
  const v1 = await PolicyVersion.findOne({ policyId: 'terms', version: 1 });
  await PolicyVersion.updateOne({ _id: v1._id }, { $set: { content: 'tampered', requiresAcceptance: false } });
  await PolicyVersion.findOneAndUpdate({ _id: v1._id }, { $set: { content: 'tampered' } });
  assert.equal((await PolicyVersion.findById(v1._id).lean()).content, TEXT['terms-a.md']);
  v1.content = 'tampered';
  await assert.rejects(v1.save(), /cannot be modified/);
  await assert.rejects(PolicyVersion.deleteOne({ _id: v1._id }), /cannot be modified/);
  await assert.rejects(PolicyVersion.deleteMany({}), /cannot be modified/);
  await assert.rejects(PolicyVersion.updateMany({}, { $set: { status: 'draft' } }), /cannot be modified/);

  const rec = await PolicyAcceptance.findOne();
  const original = rec.toObject();
  await assert.rejects(PolicyAcceptance.updateOne({ _id: rec._id }, { $set: { version: 99 } }), /cannot be modified/);
  await assert.rejects(PolicyAcceptance.findOneAndUpdate({ _id: rec._id }, { $set: { user: rec._id } }), /cannot be modified/);
  await assert.rejects(PolicyAcceptance.deleteMany({}), /cannot be modified/);
  await assert.rejects(rec.deleteOne(), /cannot be modified/);
  rec.version = 99;
  await assert.rejects(rec.save(), /cannot be modified/);
  // A duplicate insert for the same user + version is refused by the unique index.
  await assert.rejects(
    PolicyAcceptance.create({ user: original.user, policyId: original.policyId, version: original.version, policyVersion: original.policyVersion, contentHash: original.contentHash, consentText: 'x', acceptedAt: new Date() }),
    (e) => e.code === 11000
  );
  assert.equal((await PolicyAcceptance.findById(original._id).lean()).version, original.version);
});

test('no API exposes acceptance history', async () => {
  const s = await student();
  for (const path of ['/legal/acceptances', '/legal/history', '/legal/status/history', '/users/me/acceptances']) {
    const res = await ctx.request('GET', path, { token: s.token });
    assert.ok([403, 404].includes(res.status), `${path} → ${res.status}`);
  }
  const status = await ctx.request('GET', '/legal/status', { token: s.token });
  assert.deepEqual(Object.keys(status.body).sort(), ['privacyVersion', 'termsAcceptedVersion', 'termsRequired', 'termsVersion']);
});
