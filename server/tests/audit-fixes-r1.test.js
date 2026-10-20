/**
 * Regression tests for the security audit fixes, round 1 (AUDIT_FIXES_R1.md).
 * Every test names its item (A1 … B12) and fails on the code before the fix.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { startServer } from './helpers.js';

const { invalidatePlatformCache } = await import('../src/services/platformState.js');
const { routeTemplate, redactObject } = await import('../src/services/soc/sanitize.js');
const capture = await import('../src/services/soc/capture.js');
const { captureRateLimited } = await import('../src/middleware/error.js');
const { sendPushToUsers } = await import('../src/services/pushService.js');

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');
const DAY = 86400000;
const TOKEN64 = 'ab12'.repeat(16);
const PARENT = '9876501234';

let ctx;
const letters = (n) => String(n).replace(/\d/g, (d) => 'abcdefghij'[d]);
const uniq = () => Math.random().toString(36).slice(2, 8);
async function login(overrides) {
  const u = await ctx.createUser({ name: `U ${uniq()}`, ...overrides });
  return { u, ...(await ctx.loginWeb(u)) };
}
const call = (method, p, who, body) => ctx.request(method, p, { token: who?.token, body });

before(async () => {
  ctx = await startServer();
});
after(async () => ctx?.stop());

// ── A1 ─────────────────────────────────────────────────────────────

test('A1 a policy-managed Admin is held to its module policies; a legacy Admin is not', async () => {
  const restricted = await login({ role: 'admin', employeeId: `A1-${uniq()}`, policyManaged: true, policies: [{ module: 'events', actions: ['view'], scope: 'campus' }] });
  const legacy = await login({ role: 'admin', employeeId: `A1-${uniq()}` });
  // Blocked module: Clubs is not granted.
  const blocked = await call('GET', '/clubs', restricted);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'POLICY_DENIED');
  // Granted read works; an ungranted write on the same module does not.
  assert.equal((await call('GET', '/events', restricted)).status, 200);
  assert.equal((await call('POST', '/events', restricted, { title: 'x' })).status, 403);
  // The legacy (unrestricted) Admin keeps everything.
  assert.equal((await call('GET', '/clubs', legacy)).status, 200);
  assert.equal((await call('GET', '/events', legacy)).status, 200);
});

test('A1 the department-scope DENY on role assignments applies to a department-scoped Admin', async () => {
  const deptAdmin = await login({
    role: 'admin',
    employeeId: `A1-${uniq()}`,
    policyManaged: true,
    policies: [{ module: 'staff_management', actions: ['edit', 'view'], scope: 'department', department: 'CSE' }],
  });
  const res = await call('POST', '/admin/role-assignments/assign-class-in-charge', deptAdmin, { department: 'ECE', year: 2, section: 'A', semester: 3, facultyId: deptAdmin.u._id });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'POLICY_DENIED');
});

test('A1 an Admin created by the Super Admin is policy-managed, so it holds only the policies given', async () => {
  const sa = await login({ role: 'super_admin', name: 'A1 Owner' });
  assert.equal((await call('POST', '/super-admin/reauth', sa, { password: 'Password@123' })).status, 200);
  const email = `a1.ops.${uniq()}@test.edu`;
  const made = await call('POST', '/super-admin/admins', sa, { name: 'A1 Ops', email, employeeId: `E-${uniq()}`, password: 'Password@123', policies: [{ module: 'events', actions: ['view'] }] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const saved = await ctx.models.User.findOne({ email }).lean();
  assert.equal(saved.policyManaged, true);
  // Signed in, it is held to that one policy.
  await ctx.models.User.updateOne({ _id: saved._id }, { $set: { mustChangePassword: false } });
  const ops = { u: saved, ...(await ctx.loginWeb(saved)) };
  assert.equal((await call('GET', '/clubs', ops)).status, 403);
  assert.equal((await call('GET', '/events', ops)).status, 200);
});

// ── A2–A5: build, repository and deploy hygiene (static checks) ────

test('A2 release builds never fall back to the debug signing key', () => {
  const gradle = fs.readFileSync(path.join(REPO, 'mobile-kotlin', 'app', 'build.gradle.kts'), 'utf8');
  const release = gradle.slice(gradle.indexOf('release {'), gradle.indexOf('compileOptions'));
  assert.doesNotMatch(release, /signingConfigs\.getByName\("debug"\)/, 'release block must not use the debug key');
  assert.match(gradle, /VEXON_RELEASE_STORE_FILE/);
  assert.match(gradle, /checkReleaseSigning/);
  assert.match(gradle, /throw GradleException\(/);
});

test('A3 seed scripts refuse production / Atlas targets unless explicitly overridden', async () => {
  const { seedRefusalReason, SEED_OVERRIDE_VALUE } = await import('../src/utils/seedGuard.js');
  assert.equal(seedRefusalReason({ NODE_ENV: 'production' }), 'NODE_ENV is production');
  assert.equal(seedRefusalReason({ DB_TARGET: 'atlas' }), 'DB_TARGET is atlas');
  assert.equal(seedRefusalReason({}, 'mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/app'), 'the MongoDB URI points at Atlas');
  assert.equal(seedRefusalReason({}, 'mongodb://h1.mongodb.net:27017,h2.mongodb.net:27017/app'), 'the MongoDB URI points at Atlas');
  assert.equal(seedRefusalReason({}, 'mongodb://127.0.0.1:27017/campusconnect'), null);
  assert.equal(seedRefusalReason({ NODE_ENV: 'production', ALLOW_SEED_IN_PROD: SEED_OVERRIDE_VALUE }), null);
  assert.notEqual(seedRefusalReason({ NODE_ENV: 'production', ALLOW_SEED_IN_PROD: 'yes' }), null, 'only the exact phrase overrides');

  const env = { ...process.env, NODE_ENV: 'development', DB_TARGET: 'local', MONGO_URI: 'mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/app', ALLOW_SEED_IN_PROD: '' };
  for (const script of ['src/seed/seed.js', 'src/seed/academic.js', 'src/seed/alumniUsers.js']) {
    const r = spawnSync(process.execPath, [script], { cwd: SERVER, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 1, `${script} exits with an error`);
    assert.match(r.stderr, /Refusing to run .*the MongoDB URI points at Atlas/, `${script}: ${r.stderr.slice(0, 300)}`);
    assert.doesNotMatch(r.stdout + r.stderr, /MongoDB connected/, `${script} never connects`);
  }
  const atlas = spawnSync(process.execPath, ['src/seed/seed.js'], {
    cwd: SERVER,
    env: { ...env, DB_TARGET: 'atlas', MONGO_URI: 'mongodb://127.0.0.1:1/never', MONGO_URI_ATLAS: 'mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/app' },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(atlas.status, 1);
  assert.match(atlas.stderr, /Refusing to run .*DB_TARGET is atlas/);
});

test('A4 signing keys, certificates and the Firebase config are git-ignored', () => {
  const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  for (const p of ['*.jks', '*.keystore', '*.pem', '*.p12', '*.p8', '*.mobileprovision', 'mobile-kotlin/app/google-services.json']) {
    assert.ok(ignore.includes(p), `${p} is ignored`);
  }
});

test('A5 every GitHub Action is pinned to a full commit SHA; Render installs with npm ci', () => {
  const dir = path.join(REPO, '.github', 'workflows');
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(#.*)?$/);
      if (!m || m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ${m[1]} is pinned to a SHA`);
      assert.match(m[2] || '', /#\s*v\d/, `${f}: ${m[1]} names its version in a comment`);
    }
  }
  const render = fs.readFileSync(path.join(REPO, 'render.yaml'), 'utf8');
  const builds = render.split(/\r?\n/).filter((l) => /^\s*buildCommand:/.test(l));
  assert.ok(builds.length > 0);
  for (const b of builds) {
    assert.doesNotMatch(b, /npm install/, b);
    assert.match(b, /npm ci/, b);
  }
});

// ── B1 / B2: sign-in throttles ─────────────────────────────────────

test('B1 successful sign-ins do not reset or decay the per-IP failure counter', async () => {
  await ctx.models.LoginThrottle.deleteMany({});
  const good = await ctx.createUser({ name: 'B1 Good' });
  const fail = (i) => ctx.request('POST', '/auth/login', { body: { email: `b1-nobody-${i}@test.edu`, password: 'wrong-password' } });
  const ok = () => ctx.request('POST', '/auth/login', { body: { email: good.email, password: 'Password@123' } });
  // Interleave: 3 failures, a success, 3 failures, a success, 4 failures = 10 failures.
  for (let i = 0; i < 3; i += 1) assert.equal((await fail(i)).status, 401);
  assert.equal((await ok()).status, 200);
  for (let i = 3; i < 6; i += 1) assert.equal((await fail(i)).status, 401);
  assert.equal((await ok()).status, 200);
  for (let i = 6; i < 10; i += 1) await fail(i);
  // The tenth failure locked the network: even a correct password is now refused.
  const locked = await ok();
  assert.equal(locked.status, 423);
  assert.equal(locked.body.ipLocked, true);
  await ctx.models.LoginThrottle.deleteMany({});
});

test('B2 unknown and known accounts fail identically and keep their count for the same 24 hours', async () => {
  await ctx.models.LoginThrottle.deleteMany({});
  const real = await ctx.createUser({ name: 'B2 Real' });
  const attempt = (email) => ctx.request('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
  const known = [await attempt(real.email), await attempt(real.email)];
  const unknown = [await attempt('b2-nobody@test.edu'), await attempt('b2-nobody@test.edu')];
  for (let i = 0; i < 2; i += 1) {
    assert.equal(unknown[i].status, known[i].status);
    assert.equal(unknown[i].body.message, known[i].body.message);
    assert.deepEqual(Object.keys(unknown[i].body).sort(), Object.keys(known[i].body).sort());
  }
  // The unknown-email counter is per email (as an account's is) and lives 24 h,
  // the same cooldown after which an account's failure count starts over.
  const row = await ctx.models.LoginThrottle.findOne({ kind: 'anon' }).lean();
  assert.equal(row.count, 2);
  assert.ok(row.expiresAt.getTime() - Date.now() > 23 * 60 * 60 * 1000, 'kept as long as an account counter');
  assert.equal(await ctx.models.LoginThrottle.countDocuments({ kind: 'anon' }), 1);
  await ctx.models.LoginThrottle.deleteMany({});
});

// ── B3: platform lockdown gate ─────────────────────────────────────

test('B3 in lockdown a garbage (or any non-Super-Admin) bearer token does not open the public gate', async () => {
  const student = await login({ name: 'B3 Student' });
  const sa = await login({ role: 'super_admin', name: 'B3 Owner' });
  const gallery = (token) => ctx.request('GET', '/skill-wallet/public/gallery', { token });
  assert.equal((await gallery()).status, 200, 'normal mode: public gallery is open');

  await ctx.models.PlatformState.updateOne({ _id: 'platform' }, { $set: { mode: 'lockdown' } }, { upsert: true });
  invalidatePlatformCache();
  try {
    assert.equal((await gallery()).status, 503, 'anonymous is blocked');
    const garbage = await gallery('garbage.token.value');
    assert.ok([401, 503].includes(garbage.status), `garbage token blocked (${garbage.status})`);
    assert.equal(garbage.body.items, undefined, 'no gallery data');
    const forged = jwt.sign({ sub: String(sa.u._id), sid: '0123456789abcdef01234567' }, 'not-the-secret');
    assert.ok([401, 503].includes((await gallery(forged)).status), 'forged token blocked');
    assert.equal((await gallery(student.token)).status, 503, 'a valid ordinary session is still blocked');
    assert.equal((await gallery(sa.token)).status, 200, 'the Super Admin still gets through');
  } finally {
    await ctx.models.PlatformState.updateOne({ _id: 'platform' }, { $set: { mode: 'normal' } });
    invalidatePlatformCache();
  }
});

// ── B4: security-role gate-pass scope ──────────────────────────────

test('B4 security sees only approved / outside / returned passes, never pending ones or a full parent number', async () => {
  const security = await login({ role: 'security', name: 'B4 Guard', employeeId: `S-${uniq()}` });
  const st = await ctx.createUser({ name: 'B4 Student', department: 'CSE', section: 'A', year: 3, phone: '9000012345', parentPhone: PARENT });
  const base = {
    student: st._id, regarding: 'outing', description: 'Family visit for the weekend', parentPhone: PARENT,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' }, department: 'CSE', section: 'A',
    fromDate: new Date(Date.now() - DAY), toDate: new Date(Date.now() + DAY),
  };
  const [pending, active] = await ctx.models.GatePass.create([
    { ...base, status: 'pending_faculty' },
    { ...base, status: 'active', actualExit: new Date(Date.now() - 60000) },
  ]);

  assert.equal((await call('GET', `/gate-pass/${pending._id}`, security)).status, 403, 'cannot open a pending pass');
  const one = await call('GET', `/gate-pass/${active._id}`, security);
  assert.equal(one.status, 200);
  assert.notEqual(one.body.parentPhone, PARENT);
  assert.match(one.body.parentPhone, /^\*+1234$/);
  assert.equal(one.body.student.phone, undefined);
  assert.equal(one.body.student.email, undefined);

  const list = await call('GET', '/gate-pass', security);
  assert.ok(list.body.passes.every((p) => ['approved', 'active', 'completed'].includes(p.status)));
  assert.ok(!JSON.stringify(list.body).includes(PARENT), 'list never carries the full parent number');

  const dash = await call('GET', '/gate-pass/dashboard', security);
  assert.equal(dash.status, 200);
  assert.equal(dash.body.pending, 0);
  assert.deepEqual(dash.body.pendingStudents, []);
  assert.ok(!JSON.stringify(dash.body).includes(PARENT), 'dashboard never carries the full parent number');
  assert.ok(!JSON.stringify(dash.body).includes('9000012345'), 'nor the student phone');

  const sec = await call('GET', '/gate-pass/dashboard/security', security);
  assert.equal(sec.status, 200);
  assert.ok(sec.body.outsideStudents.length >= 1);
  assert.ok(!JSON.stringify(sec.body).includes(PARENT));
  assert.ok(!JSON.stringify(sec.body).includes('9000012345'));
});

// ── B5 / B6: SOC redaction and capture flooding ────────────────────

test('B5 high-entropy path tokens are stored (and sent to the AI) as :token', async () => {
  capture.resetCaptureForTests();
  const route = `/api/auth/alumni-claim/${TOKEN64}`;
  assert.equal(routeTemplate(route), '/api/auth/alumni-claim/:token');
  assert.equal(routeTemplate('/api/users/64f1a2b3c4d5e6f708192a3b/reset-password'), '/api/users/:id/reset-password', 'object ids stay :id');
  capture.captureError({ source: 'express', httpStatus: 500, route, err: { name: 'Error', message: `Claim ${route} failed for ${TOKEN64}` } });
  // The client error reporter's endpoint field gets the same template.
  const user = await login({ name: 'B5 Reporter' });
  assert.equal((await call('POST', '/client-errors', user, { kind: 'api', message: 'Server answered 500', status: 500, route: `/alumni/claim/${TOKEN64}`, endpoint: `/api/auth/alumni-claim/${TOKEN64}?x=1` })).status, 202);
  await capture.flushCaptureForTests();
  const events = await ctx.models.ErrorEvent.find({}).lean();
  const dump = JSON.stringify(events);
  assert.ok(!dump.includes(TOKEN64), `the raw token is stored nowhere: ${dump.slice(Math.max(0, dump.indexOf(TOKEN64) - 200), dump.indexOf(TOKEN64) + 80)}`);
  const server = events.find((e) => e.source === 'express');
  assert.equal(server.route, '/api/auth/alumni-claim/:token');
  const client = events.find((e) => e.source === 'client_web');
  assert.equal(client.sample.apiEndpoint, '/api/auth/alumni-claim/:token');
  assert.equal(client.route, 'client:/alumni/claim/:token');
  // A record stored before the fix is redacted again before the AI sees it.
  const facts = redactObject({ route, message: `GET ${route}` });
  assert.equal(facts.route, '/api/auth/alumni-claim/:token');
  assert.ok(!JSON.stringify(facts).includes(TOKEN64));
});

test('B6 anonymous 429s are one record whatever the path, and noise cannot use up the fault budget', async () => {
  capture.resetCaptureForTests();
  await ctx.models.ErrorEvent.deleteMany({});
  for (let i = 0; i < 40; i += 1) {
    const res = new EventEmitter();
    res.statusCode = 429;
    captureRateLimited({ originalUrl: `/api/random-${i}/${uniq()}`, path: `/random-${i}`, method: i % 2 ? 'GET' : 'POST', headers: {} }, res, () => {});
    res.emit('finish');
  }
  await capture.flushCaptureForTests();
  assert.equal(await ctx.models.ErrorEvent.countDocuments({ source: 'rate_limit' }), 1, 'one grouped record');

  // A flood of distinct authorization / rate-limit noise …
  capture.resetCaptureForTests();
  for (let i = 0; i < 320; i += 1) capture.captureError({ source: 'authorization', httpStatus: 403, route: `/api/noise/${letters(i)}`, err: { name: 'ApiError', message: 'nope' } });
  // … never drops a real server fault.
  capture.captureError({ source: 'express', httpStatus: 500, route: '/api/real/fault', err: { name: 'TypeError', message: 'boom' } });
  await capture.flushCaptureForTests();
  assert.equal(await ctx.models.ErrorEvent.countDocuments({ source: 'express', route: '/api/real/fault' }), 1);
  assert.ok(capture.captureStats().droppedNoise > 0);
  capture.resetCaptureForTests();
});

// ── B7: upload quota and orphan cleanup ────────────────────────────

const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#cc0000' } }).png().toBuffer();
async function uploadAs(who, buf = png, name = 'a.png') {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), name);
  const res = await fetch(`${ctx.base}/api/uploads?kind=image`, { method: 'POST', headers: { authorization: `Bearer ${who.token}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('B7 POST /uploads enforces a per-user daily quota and gives a failed upload back', async () => {
  const user = await login({ name: 'B7 Uploader' });
  assert.equal((await uploadAs(user)).status, 201);
  const day = new Date().toISOString().slice(0, 10);
  const row = await ctx.models.UploadQuota.findOne({ user: user.u._id, day }).lean();
  assert.equal(row.count, 1);
  assert.equal(row.bytes, png.length);
  // A rejected file (not an image) does not use up the quota.
  assert.equal((await uploadAs(user, Buffer.from('not an image'), 'x.png')).status, 415);
  assert.equal((await ctx.models.UploadQuota.findOne({ user: user.u._id, day }).lean()).count, 1);
  // Count limit reached.
  await ctx.models.UploadQuota.updateOne({ user: user.u._id, day }, { $set: { count: 60 } });
  const full = await uploadAs(user);
  assert.equal(full.status, 429);
  assert.equal(full.body.code, 'UPLOAD_QUOTA');
  // Byte limit reached (another user is unaffected).
  const other = await login({ name: 'B7 Other' });
  await ctx.models.UploadQuota.create({ user: other.u._id, day, count: 1, bytes: 150 * 1024 * 1024 - 1, expiresAt: new Date(Date.now() + 2 * DAY) });
  assert.equal((await uploadAs(other)).status, 429);
  const fresh = await login({ name: 'B7 Fresh' });
  assert.equal((await uploadAs(fresh)).status, 201);
});

test('B7 the orphan sweep deletes only unattached uploads older than 24 h', async () => {
  const { sweepOrphanUploads } = await import('../src/services/orphanUploads.js');
  const owner = await ctx.createUser({ name: 'B7 Owner' });
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const recent = new Date(Date.now() - 60 * 60 * 1000);
  const row = (filename, extra) => ({ filename, mimeType: 'image/png', data: png, size: png.length, attachedAt: null, createdAt: old, updatedAt: old, ...extra });
  await ctx.models.StoredFile.collection.insertMany([
    row('b7-orphan.png', { uploadedBy: owner._id }),
    row('b7-attached.png', { uploadedBy: owner._id }),
    row('b7-recent.png', { uploadedBy: owner._id, createdAt: recent }),
    row('b7-legacy.png', {}),
  ]);
  await ctx.createUser({ name: 'B7 Avatar', avatar: '/uploads/b7-attached.png' });
  const out = await sweepOrphanUploads();
  assert.equal(out.deleted, 1);
  const left = (await ctx.models.StoredFile.find({ filename: /^b7-/ }).select('filename attachedAt').lean()).map((f) => f.filename).sort();
  assert.deepEqual(left, ['b7-attached.png', 'b7-legacy.png', 'b7-recent.png']);
  const attached = await ctx.models.StoredFile.findOne({ filename: 'b7-attached.png' }).lean();
  assert.ok(attached.attachedAt, 'an attached file is marked and never checked again');
});

// ── B8: by-ID reads use the same scope as their lists ──────────────

test('B8 mentorship request by id: an HOD sees only their own department\'s students', async () => {
  const hodCse = await login({ role: 'hod', department: 'CSE', employeeId: `H-${uniq()}` });
  const hodEce = await login({ role: 'hod', department: 'ECE', employeeId: `H-${uniq()}` });
  const student = await ctx.createUser({ department: 'CSE', section: 'A', year: 3 });
  const alumnus = await ctx.createUser({ role: 'alumni', department: 'CSE' });
  const r = await ctx.models.MentorshipRequest.create({ student: student._id, alumni: alumnus._id, domain: 'cybersecurity', message: 'Please mentor me on security' });
  assert.equal((await call('GET', `/mentorship-requests/${r._id}`, hodCse)).status, 200);
  assert.equal((await call('GET', `/mentorship-requests/${r._id}`, hodEce)).status, 404);
});

test('B8 alumni events: unpublished proposals by id and their review follow the list scope', async () => {
  const hodEce = await login({ role: 'hod', department: 'ECE', employeeId: `H-${uniq()}` });
  const hodCse = await login({ role: 'hod', department: 'CSE', employeeId: `H-${uniq()}` });
  const student = await login({ department: 'ECE', section: 'A', year: 2 });
  const alumnus = await login({ role: 'alumni', department: 'CSE' });
  const mk = (extra) => ctx.models.AlumniEvent.create({ title: 'CSE meetup', description: 'Alumni meetup for CSE graduates', startsAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 5 * DAY + 3600000), createdBy: alumnus.u._id, audience: { departments: ['CSE'] }, ...extra });
  const proposal = await mk({ status: 'pending_approval' });
  assert.equal((await call('GET', `/alumni/events/${proposal._id}`, student)).status, 404, 'a student cannot open someone else\'s proposal');
  assert.equal((await call('GET', `/alumni/events/${proposal._id}`, hodEce)).status, 404, 'other-department HOD');
  assert.equal((await call('POST', `/alumni/events/${proposal._id}/approve`, hodEce)).status, 404);
  assert.equal((await call('POST', `/alumni/events/${proposal._id}/reject`, hodEce, { reason: 'Not for us' })).status, 404);
  assert.equal((await call('GET', `/alumni/events/${proposal._id}`, alumnus)).status, 200, 'the organizer');
  assert.equal((await call('GET', `/alumni/events/${proposal._id}`, hodCse)).status, 200);
  assert.equal((await call('POST', `/alumni/events/${proposal._id}/approve`, hodCse)).status, 200);
  assert.equal((await call('GET', `/alumni/events/${proposal._id}`, student)).status, 200, 'published: everyone');
});

test('B8 job applications: an HOD sees only applications from their own department', async () => {
  const hodCse = await login({ role: 'hod', department: 'CSE', employeeId: `H-${uniq()}` });
  const alumnus = await ctx.createUser({ role: 'alumni', department: 'CSE' });
  const cse = await ctx.createUser({ department: 'CSE', section: 'A', year: 4 });
  const ece = await ctx.createUser({ department: 'ECE', section: 'A', year: 4 });
  const job = await ctx.models.AlumniJob.create({ postedBy: alumnus._id, title: 'Backend intern', company: 'Acme', description: 'Work on our APIs and services.', type: 'internship', workMode: 'remote', location: 'Chennai', status: 'open' });
  await ctx.models.JobApplication.create([{ job: job._id, student: cse._id, poster: alumnus._id }, { job: job._id, student: ece._id, poster: alumnus._id }]);
  const res = await call('GET', `/alumni/jobs/${job._id}/applications`, hodCse);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((a) => String(a.student._id || a.student)), [String(cse._id)]);
});

test('B8 alumni import batches: an HOD reads and commits only their own department\'s batches', async () => {
  const hodCse = await login({ role: 'hod', department: 'CSE', employeeId: `H-${uniq()}` });
  const admin = await ctx.createUser({ role: 'admin' });
  const row = { rowNumber: 2, name: 'Old Grad', email: `grad-${uniq()}@mail.com`, department: 'ECE', gradYear: 2015, state: 'valid', errors: [] };
  const [ece, campus] = await ctx.models.AlumniImportBatch.create([
    { uploadedBy: admin._id, filename: 'ece.csv', department: 'ECE', rows: [row], totals: { rows: 1, valid: 1 } },
    { uploadedBy: admin._id, filename: 'all.csv', rows: [row], totals: { rows: 1, valid: 1 } },
  ]);
  for (const b of [ece, campus]) {
    assert.equal((await call('GET', `/alumni/import/${b._id}`, hodCse)).status, 404);
    assert.equal((await call('POST', `/alumni/import/${b._id}/commit`, hodCse, { sendEmails: false })).status, 404);
  }
  assert.equal(await ctx.models.AlumniInvite.countDocuments({ email: row.email }), 0, 'nothing was committed');
});

test('B8 role-assignment overview: a department-scoped Staff Management grant sees one department', async () => {
  const principal = await login({ role: 'principal', employeeId: `P-${uniq()}`, policies: [{ module: 'staff_management', actions: ['view'], scope: 'department', department: 'CSE' }] });
  const res = await call('GET', '/admin/role-assignments/overview', principal);
  assert.equal(res.status, 200);
  assert.deepEqual([...new Set(res.body.hods.map((h) => h.department))], ['CSE']);
  assert.ok(res.body.facultyList.every((f) => f.department === 'CSE'));
});

test('B8 faculty analytics and attendance corrections follow the timetable, not Subject.faculty', async () => {
  const faculty = await login({ role: 'faculty', department: 'CSE', employeeId: `F-${uniq()}` });
  const student = await login({ department: 'CSE', section: 'B', year: 3, semester: 5 });
  // Listed on the subject, but no timetable period: teaches no class of it.
  const subject = await ctx.models.Subject.create({ name: 'Compilers', code: `CS5${uniq().slice(0, 2)}`, department: 'CSE', semester: 5, year: 3, sections: ['B'], faculty: [faculty.u._id] });
  const date = new Date(new Date().toISOString().slice(0, 10));
  await ctx.models.AttendanceRecord.create({ student: student.u._id, subject: subject._id, date, period: 1, status: 'absent', section: 'B', department: 'CSE', markedBy: faculty.u._id });
  const corr = await ctx.models.AttendanceCorrectionRequest.create({ student: student.u._id, subject: subject._id, date, period: 1, currentStatus: 'absent', requestedStatus: 'present', reason: 'I was in class, please check' });

  const analytics = await call('GET', '/analytics/faculty', faculty);
  assert.equal(analytics.status, 200);
  assert.deepEqual(analytics.body.subjects, []);
  assert.equal(analytics.body.belowThreshold.length, 0);
  const list = await call('GET', '/attendance/corrections', faculty);
  assert.equal(list.status, 200);
  assert.equal(list.body.requests.length, 0);
  assert.equal((await call('PATCH', `/attendance/corrections/${corr._id}`, faculty, { action: 'approved' })).status, 403);

  // With a real timetable period for that class, both open up.
  await ctx.models.TimetableSlot.create({ department: 'CSE', year: 3, semester: 5, section: 'B', dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50', subject: subject._id, faculty: faculty.u._id, isActive: true });
  assert.equal((await call('GET', '/analytics/faculty', faculty)).body.subjects.length, 1);
  assert.equal((await call('GET', '/attendance/corrections', faculty)).body.requests.length, 1);
});

test('B8 OD / leave: a faculty member with no in-charge class gets no department-wide queue', async () => {
  const plain = await login({ role: 'faculty', department: 'CSE', employeeId: `F-${uniq()}` });
  const student = await ctx.createUser({ department: 'CSE', section: 'A', year: 2 });
  await ctx.models.ODLeaveRequest.create({ student: student._id, department: 'CSE', section: 'A', year: 2, requestType: 'leave', category: 'Medical', fromDate: new Date(Date.now() + 2 * DAY), toDate: new Date(Date.now() + 2 * DAY), daysCount: 1, description: 'Doctor appointment in town' });
  const res = await call('GET', '/attendance/od-leave/pending', plain);
  assert.equal(res.status, 200);
  const items = res.body.requests || res.body.items || [];
  assert.equal(items.length, 0);
});

test('B8 staff attendance student summaries: read-only oversight roles never receive parentPhone', async () => {
  const principal = await login({ role: 'principal', employeeId: `P-${uniq()}` });
  const hod = await login({ role: 'hod', department: 'CSE', employeeId: `H-${uniq()}` });
  await ctx.createUser({ name: 'B8 Phone', department: 'CSE', section: 'C', year: 3, parentPhone: '9811122233' });
  const p = await call('GET', '/attendance/summary/students?department=CSE', principal);
  assert.equal(p.status, 200);
  assert.ok(p.body.students.length > 0);
  assert.ok(p.body.students.every((s) => s.parentPhone === undefined));
  const b = await call('GET', '/attendance/summary/breakdown?department=CSE', principal);
  assert.ok(!JSON.stringify(b.body).includes('9811122233'));
  // The HOD's own view is unchanged.
  const h = await call('GET', '/attendance/summary/students', hod);
  assert.ok(h.body.students.some((s) => s.parentPhone === '9811122233'));
});

// ── B9: state-machine preconditions ────────────────────────────────

test('B9 a staff-removed job cannot be closed and reopened by its poster; reopen re-checks the deadline', async () => {
  const alumnus = await login({ role: 'alumni', department: 'CSE' });
  await ctx.models.AlumniProfile.create({ user: alumnus.u._id, gradYear: 2019, isVerified: true });
  const mk = (extra) => ctx.models.AlumniJob.create({ postedBy: alumnus.u._id, title: 'Data intern', company: 'Acme', description: 'Analyse data and build dashboards.', type: 'internship', workMode: 'remote', location: 'Chennai', ...extra });
  const removed = await mk({ status: 'removed', removeReason: 'Spam posting' });
  assert.equal((await call('PATCH', `/alumni/jobs/${removed._id}/close`, alumnus)).status, 409);
  assert.equal((await call('PATCH', `/alumni/jobs/${removed._id}/reopen`, alumnus)).status, 403);
  assert.equal((await ctx.models.AlumniJob.findById(removed._id).lean()).status, 'removed');

  const expired = await mk({ status: 'closed', deadline: new Date(Date.now() - DAY) });
  assert.equal((await call('PATCH', `/alumni/jobs/${expired._id}/reopen`, alumnus)).status, 422);
  const live = await mk({ status: 'closed', deadline: new Date(Date.now() + 10 * DAY) });
  assert.equal((await call('PATCH', `/alumni/jobs/${live._id}/reopen`, alumnus)).status, 200);
  // A poster who lost verification can no longer reopen.
  await ctx.models.AlumniJob.updateOne({ _id: live._id }, { $set: { status: 'closed' } });
  await ctx.models.AlumniProfile.updateOne({ user: alumnus.u._id }, { $set: { isVerified: false } });
  assert.equal((await call('PATCH', `/alumni/jobs/${live._id}/reopen`, alumnus)).status, 403);
});

test('B9 a withdrawn application cannot be changed by the poster', async () => {
  const alumnus = await login({ role: 'alumni', department: 'CSE' });
  const student = await ctx.createUser({ department: 'CSE', section: 'A', year: 4 });
  const job = await ctx.models.AlumniJob.create({ postedBy: alumnus.u._id, title: 'QA intern', company: 'Acme', description: 'Test our mobile applications.', type: 'internship', workMode: 'remote', location: 'Chennai', status: 'open' });
  const app = await ctx.models.JobApplication.create({ job: job._id, student: student._id, poster: alumnus.u._id, status: 'withdrawn' });
  assert.equal((await call('PATCH', `/alumni/job-applications/${app._id}`, alumnus, { status: 'shortlisted' })).status, 409);
  assert.equal((await ctx.models.JobApplication.findById(app._id).lean()).status, 'withdrawn');
});

test('B9 a terminal alumni event cannot be cancelled again', async () => {
  const alumnus = await login({ role: 'alumni', department: 'CSE' });
  for (const status of ['cancelled', 'completed', 'rejected']) {
    const ev = await ctx.models.AlumniEvent.create({ title: `Event ${status}`, startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - DAY), createdBy: alumnus.u._id, status, cancelReason: 'original' });
    assert.equal((await call('POST', `/alumni/events/${ev._id}/cancel`, alumnus, { reason: 'again' })).status, 409, status);
    const after = await ctx.models.AlumniEvent.findById(ev._id).lean();
    assert.equal(after.status, status);
  }
});

test('B9 a cancelled grievance cannot be closed; a staff "returned" lost-found record cannot be overwritten', async () => {
  const student = await login({ department: 'CSE', section: 'A', year: 3 });
  const complaint = await ctx.models.Complaint.create({ student: student.u._id, category: 'academics', description: 'Lab computers are not working', initialEscalationTarget: 'hod', escalationChain: ['hod'], department: 'CSE', status: 'CANCELLED' });
  assert.equal((await call('PATCH', `/complaints/${complaint._id}/resolved`, student)).status, 422);
  assert.equal((await ctx.models.Complaint.findById(complaint._id).lean()).status, 'CANCELLED');

  const item = await ctx.models.LostFoundItem.create({ type: 'lost', reporter: student.u._id, itemName: 'Blue bottle', category: 'accessories', location: 'Library', dateTime: new Date(), status: 'returned' });
  assert.equal((await call('PATCH', `/lost-found/${item._id}/status`, student, { status: 'closed' })).status, 409);
  assert.equal((await ctx.models.LostFoundItem.findById(item._id).lean()).status, 'returned');
});

// ── B10: URL validation on edit ────────────────────────────────────

test('B10 job edits, club social links and mentorship meeting links accept web links only', async () => {
  const alumnus = await login({ role: 'alumni', department: 'CSE' });
  const job = await ctx.models.AlumniJob.create({ postedBy: alumnus.u._id, title: 'Ops intern', company: 'Acme', description: 'Keep our servers healthy.', type: 'internship', workMode: 'remote', location: 'Chennai', status: 'open', applyMode: 'referral' });
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://files.example.com/x', 'example.com/no-protocol']) {
    assert.equal((await call('PATCH', `/alumni/jobs/${job._id}`, alumnus, { applyMode: 'external_link', externalUrl: bad })).status, 422, bad);
  }
  assert.equal((await call('PATCH', `/alumni/jobs/${job._id}`, alumnus, { applyMode: 'external_link' })).status, 422, 'external link needs a URL');
  assert.equal((await call('PATCH', `/alumni/jobs/${job._id}`, alumnus, { applyMode: 'external_link', externalUrl: 'https://careers.example.com/apply' })).status, 200);

  const admin = await login({ role: 'admin' });
  const club = { name: `Club ${uniq()}`, description: 'A club for people who like building robots together.' };
  for (const bad of ['javascript:alert(1)', 'http://insecure.example.com']) {
    assert.equal((await call('POST', '/clubs', admin, { ...club, socialLinks: { website: bad } })).status, 422, bad);
  }
  assert.equal((await call('POST', '/clubs', admin, { ...club, socialLinks: { website: 'https://robots.example.com' } })).status, 201);

  await ctx.models.AlumniProfile.create({ user: alumnus.u._id, gradYear: 2018, isVerified: true, mentorshipAvailable: true });
  const slot = (meetingLink) => call('POST', '/mentorship/slots', alumnus, { slots: [{ startsAt: new Date(Date.now() + 3 * DAY).toISOString(), durationMin: 30, mode: 'video', meetingLink }] });
  assert.equal((await slot('javascript:alert(1)')).status, 422);
  assert.equal((await slot('http://meet.example.com/x')).status, 422);
});

// ── B12: Expo push tokens bound to sessions ────────────────────────

test('B12 an Expo push token is bound to its session and dropped when that session ends', async () => {
  const student = await ctx.createUser({ name: 'B12 Phone' });
  const phone = await ctx.loginMobile(student);
  const other = await ctx.loginWeb(student);
  const token = `ExponentPushToken[b12-${uniq()}]`;
  assert.equal((await ctx.request('POST', '/auth/push-token', { token: phone.token, body: { token }, headers: { 'x-client-platform': 'mobile' } })).status, 200);
  const { sid } = jwt.decode(phone.token);
  let u = await ctx.models.User.findById(student._id).select('+pushTokens').lean();
  assert.equal(String(u.pushTokens[0].session), sid);

  // Only tokens of live sessions get a push (a legacy, unbound token does not).
  await ctx.models.User.updateOne({ _id: student._id }, { $push: { pushTokens: { token: 'ExponentPushToken[legacy-unbound]', addedAt: new Date() } } });
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://exp.host/')) {
      sent.push(...JSON.parse(init.body).map((m) => m.to));
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  try {
    await sendPushToUsers([student._id], { title: 'Hi', body: 'There' });
    assert.deepEqual(sent, [token]);

    // Revoking that session (from another one) removes its token.
    assert.equal((await ctx.request('DELETE', `/auth/sessions/${sid}`, { token: other.token })).status, 200);
    u = await ctx.models.User.findById(student._id).select('+pushTokens').lean();
    assert.ok(!u.pushTokens.some((t) => t.token === token), 'token dropped with its session');
    sent.length = 0;
    await sendPushToUsers([student._id], { title: 'Hi', body: 'Again' });
    assert.deepEqual(sent, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
