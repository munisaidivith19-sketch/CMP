import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';

/**
 * Super Admin, module policies (RBAC), protected audit and emergency control.
 * All against the throw-away test database; nothing here touches real infrastructure.
 */
let ctx;
let sa; // super admin (web session)
let legacyAdmin, faculty, student, hod;
let cseStudent, eceStudent;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const reauth = (who = sa) => req('POST', '/super-admin/reauth', who, { password: PASSWORD });
const settle = () => sleep(150);

async function login(overrides) {
  const u = await ctx.createUser(overrides);
  return { u, ...(await ctx.loginWeb(u)) };
}

/** Create a policy-managed admin directly in the DB with the given policies and sign in. */
async function policyAdmin(policies, extra = {}) {
  return login({ role: 'admin', employeeId: `E-${Math.random().toString(36).slice(2, 8)}`, policyManaged: true, policies, ...extra });
}

before(async () => {
  ctx = await startServer();
  sa = await login({ role: 'super_admin', name: 'Platform Owner' });
  legacyAdmin = await login({ role: 'admin', name: 'Legacy Admin', employeeId: 'E-LA' });
  faculty = await login({ role: 'faculty', department: 'CSE', employeeId: 'E-F1' });
  hod = await login({ role: 'hod', department: 'CSE', employeeId: 'E-H1' });
  student = await login({ department: 'CSE', section: 'A', rollNo: 'S-1' });
  cseStudent = await ctx.createUser({ name: 'Cse Kid', department: 'CSE', section: 'A', rollNo: 'S-CSE' });
  eceStudent = await ctx.createUser({ name: 'Ece Kid', department: 'ECE', section: 'A', rollNo: 'S-ECE' });
});
after(async () => {
  // Leave the platform in normal mode for any later test file.
  await ctx.models.PlatformState?.deleteMany({});
  await ctx.stop();
});

// ── Authentication and role protection ─────────────────────────────

test('Super Admin APIs: unauthenticated → 401; admin, faculty, HOD and student → 403', async () => {
  assert.equal((await ctx.request('GET', '/super-admin/overview')).status, 401);
  for (const who of [legacyAdmin, faculty, hod, student]) {
    for (const [m, p] of [['GET', '/super-admin/overview'], ['GET', '/super-admin/admins'], ['GET', '/super-admin/emergency/state'], ['POST', '/super-admin/emergency/transition'], ['POST', '/super-admin/reauth']]) {
      const r = await req(m, p, who, m === 'POST' ? { to: 'maintenance', expectedVersion: 0, confirm: 'CONFIRM MAINTENANCE', reason: 'try it on' } : undefined);
      assert.equal(r.status, 403, `${who.u.role} ${m} ${p}`);
    }
  }
  assert.equal((await req('GET', '/super-admin/overview', sa)).status, 200);
});

test('a frontend-supplied role cannot create or promote an Admin or Super Admin', async () => {
  for (const role of ['super_admin', 'admin']) {
    const create = await req('POST', '/admin/users', legacyAdmin, { role, name: 'Sneaky', email: `sneaky.${role}@test.edu`, password: 'Welcome123', employeeId: `X-${role}` });
    assert.equal(create.status, 422, role);
    assert.equal(await ctx.models.User.exists({ email: `sneaky.${role}@test.edu` }), null);
    const promote = await req('PATCH', `/admin/users/${faculty.u._id}`, legacyAdmin, { role });
    assert.equal(promote.status, 422, role);
  }
  assert.equal((await ctx.models.User.findById(faculty.u._id).lean()).role, 'faculty');
  // Self-service profile edits cannot carry a role or policies either.
  await req('PUT', '/users/me', student, { role: 'super_admin', policies: [{ module: 'attendance', actions: ['view'] }], policyManaged: true });
  const me = await ctx.models.User.findById(student.u._id).lean();
  assert.equal(me.role, 'student');
  assert.equal(me.policyManaged, false);
});

test('Super Admin: read-only attendance, gate passes and hostel; no other campus modules; no mobile sign-in', async () => {
  for (const p of ['/users', '/chat/conversations', '/timetable', '/announcements', '/complaints']) {
    assert.equal((await req('GET', p, sa)).status, 403, p);
  }
  for (const p of ['/attendance/summary', '/attendance/sessions', '/gate-pass', '/gate-pass/dashboard', '/hostel/summary', '/admin/users']) {
    assert.equal((await req('GET', p, sa)).status, 200, p);
  }
  // Read-only: no writes into attendance, gate passes or chat.
  assert.equal((await req('POST', '/attendance/mark', sa, {})).status, 403);
  assert.equal((await req('PATCH', `/gate-pass/${sa.u._id}/faculty-review`, sa, { action: 'forward' })).status, 403);
  assert.equal((await req('POST', '/chat/conversations', sa, { participantId: String(student.u._id) })).status, 403);
  const mobile = await ctx.request('POST', '/auth/login', {
    body: { email: sa.u.email, password: PASSWORD },
    headers: { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' },
  });
  assert.equal(mobile.status, 403);
});

// ── Admin account management ───────────────────────────────────────

test('sensitive actions need a recent password re-entry; wrong password is refused', async () => {
  const body = { name: 'New Admin', email: 'new.admin@test.edu', employeeId: 'E-NA', password: 'Temp#Pass1234' };
  // Fresh session: no re-auth yet.
  const fresh = await login({ role: 'super_admin', name: 'Second Owner' });
  const blocked = await req('POST', '/super-admin/admins', fresh, body);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'REAUTH_REQUIRED');
  assert.equal((await req('POST', '/super-admin/reauth', fresh, { password: 'wrong-password-1' })).status, 400);
  assert.equal((await req('POST', '/super-admin/admins', fresh, body)).status, 403);
  assert.equal((await reauth(fresh)).status, 200);
  assert.equal((await req('POST', '/super-admin/admins', fresh, body)).status, 201);
});

test('Super Admin creates an ordinary Admin: server-fixed role, forced password change, duplicates rejected', async () => {
  await reauth();
  const tampered = await req('POST', '/super-admin/admins', sa, { name: 'X', email: 'x.admin@test.edu', employeeId: 'E-X', password: 'Temp#Pass1234', role: 'super_admin' });
  assert.equal(tampered.status, 422);
  assert.equal(await ctx.models.User.exists({ email: 'x.admin@test.edu' }), null);

  const bad = await req('POST', '/super-admin/admins', sa, { name: 'Y', email: 'y.admin@test.edu', employeeId: 'E-Y', password: 'Temp#Pass1234', policies: [{ module: 'nuclear', actions: ['launch'] }] });
  assert.equal(bad.status, 422);
  assert.equal(await ctx.models.User.exists({ email: 'y.admin@test.edu' }), null, 'nothing half-created');

  const ok = await req('POST', '/super-admin/admins', sa, {
    name: 'Ops Admin', email: 'ops.admin@test.edu', employeeId: 'E-OPS', password: 'Temp#Pass1234',
    policies: [{ module: 'user_management', actions: ['view'] }],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.password, undefined);
  const saved = await ctx.models.User.findOne({ email: 'ops.admin@test.edu' }).lean();
  assert.equal(saved.role, 'admin');
  assert.equal(saved.policyManaged, true);
  assert.equal(saved.mustChangePassword, true);
  assert.deepEqual(saved.policies.map((p) => p.module), ['user_management']);

  assert.equal((await req('POST', '/super-admin/admins', sa, { name: 'Dup', email: 'ops.admin@test.edu', employeeId: 'E-DUP', password: 'Temp#Pass1234' })).status, 409);
  assert.equal((await req('POST', '/super-admin/admins', sa, { name: 'Dup', email: 'dup2@test.edu', employeeId: 'E-OPS', password: 'Temp#Pass1234' })).status, 409);

  // First sign-in: only the password change is allowed.
  const l = await ctx.request('POST', '/auth/login', { body: { email: 'ops.admin@test.edu', password: 'Temp#Pass1234' } });
  assert.equal(l.status, 200);
  const blocked = await ctx.request('GET', '/admin/users', { token: l.body.accessToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await ctx.request('POST', '/auth/change-password', { token: l.body.accessToken, body: { currentPassword: 'Temp#Pass1234', newPassword: 'MyOwnPass#789' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await ctx.request('GET', '/admin/users', { token: changed.body.accessToken })).status, 200);
});

test('admin profile edits reject protected fields (mass assignment)', async () => {
  await reauth();
  const target = await ctx.createUser({ role: 'admin', employeeId: 'E-MA', policyManaged: true });
  for (const field of [{ role: 'super_admin' }, { isActive: false }, { policies: [] }, { policyManaged: false }, { mustChangePassword: false }, { email: 'other@test.edu' }]) {
    const r = await req('PATCH', `/super-admin/admins/${target._id}`, sa, { name: 'Renamed', ...field });
    assert.equal(r.status, 422, JSON.stringify(field));
  }
  const ok = await req('PATCH', `/super-admin/admins/${target._id}`, sa, { name: 'Renamed Admin', phone: '9876543210' });
  assert.equal(ok.status, 200);
  const after = await ctx.models.User.findById(target._id).lean();
  assert.equal(after.name, 'Renamed Admin');
  assert.equal(after.role, 'admin');
  // Super Admin endpoints only manage ordinary Admins.
  assert.equal((await req('PATCH', `/super-admin/admins/${faculty.u._id}`, sa, { name: 'Nope' })).status, 404);
});

test('password reset never exposes the password, signs the Admin out and forces a change', async () => {
  const target = await login({ role: 'admin', employeeId: 'E-RS', policyManaged: true });
  await reauth();
  const r = await req('POST', `/super-admin/admins/${target.u._id}/reset-password`, sa, { newPassword: 'Fresh#Temp9876', confirmPassword: 'Fresh#Temp9876', reason: 'Lost access' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('Fresh#Temp9876'));
  assert.ok(r.body.sessionsRevoked >= 1);
  assert.equal((await req('GET', '/auth/me', target)).status, 401, 'old session is dead');
  assert.equal((await ctx.models.User.findById(target.u._id).lean()).mustChangePassword, true);
  await settle();
  const audits = await ctx.models.AuditLog.find({ action: 'ADMIN_PASSWORD_RESET', target: target.u._id }).lean();
  assert.equal(audits.length, 1);
  assert.equal(String(audits[0].actor), String(sa.u._id));
  const everything = JSON.stringify([...audits, ...(await ctx.models.SecurityLog.find({}).lean())]);
  assert.ok(!everything.includes('Fresh#Temp9876'), 'password never logged');
});

test('deactivation revokes sessions and blocks further use; reactivation restores sign-in', async () => {
  const target = await login({ role: 'admin', employeeId: 'E-DA', policyManaged: true, policies: [{ module: 'user_management', actions: ['view'] }] });
  await reauth();
  const off = await req('POST', `/super-admin/admins/${target.u._id}/status`, sa, { isActive: false, reason: 'Left the college' });
  assert.equal(off.status, 200);
  assert.equal((await req('GET', '/admin/users', target)).status, 401);
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: target.u.email, password: PASSWORD } })).status, 403);
  // Repeating is a recorded no-op.
  assert.equal((await req('POST', `/super-admin/admins/${target.u._id}/status`, sa, { isActive: false, reason: 'Left the college' })).body.unchanged, true);
  assert.equal((await req('POST', `/super-admin/admins/${target.u._id}/status`, sa, { isActive: true, reason: 'Returned to work' })).status, 200);
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: target.u.email, password: PASSWORD } })).status, 200);
});

test('ordinary Admins cannot edit, delete or reset Admin / Super Admin accounts', async () => {
  const other = await ctx.createUser({ role: 'admin', employeeId: 'E-OT' });
  for (const target of [other, sa.u]) {
    assert.equal((await req('PATCH', `/admin/users/${target._id}`, legacyAdmin, { name: 'Hijacked' })).status, 403);
    assert.equal((await req('DELETE', `/admin/users/${target._id}`, legacyAdmin)).status, 403);
    assert.equal((await req('POST', `/users/${target._id}/reset-password`, legacyAdmin, { newPassword: 'Hijack123', confirmPassword: 'Hijack123' })).status, 403);
  }
  assert.ok(await ctx.models.User.exists({ _id: sa.u._id, role: 'super_admin', isActive: true }));
});

test('Super Admin creates accounts of every ordinary and staff role, never Admin / Super Admin there', async () => {
  const mk = (role, extra) => req('POST', '/admin/users', sa, { role, name: `New ${role}`, email: `sa.${role}@test.edu`, password: 'Welcome123', ...extra });
  assert.equal((await mk('student', { rollNo: 'SA-S1', department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111112' })).status, 201);
  assert.equal((await mk('faculty', { employeeId: 'SA-F1', department: 'CSE', teachingYears: [3], teachingSections: ['A'] })).status, 201);
  assert.equal((await mk('principal', { employeeId: 'SA-P1' })).status, 201);
  assert.equal((await mk('security', { employeeId: 'SA-SEC1' })).status, 201);
  assert.equal((await mk('admin', { employeeId: 'SA-A1' })).status, 422, 'admins go through the Admin accounts console');
  assert.equal((await mk('super_admin', { employeeId: 'SA-SA1' })).status, 422);
  const list = await req('GET', '/admin/users?limit=100', sa);
  assert.ok(list.body.items.some((u) => u.email === 'sa.faculty@test.edu'));
});

test('Super Admin reads every chat but cannot send; each opened chat is audited', async () => {
  const { seal } = await import('../src/utils/cipher.js');
  const conv = await ctx.models.Conversation.create({ type: 'private', participants: [student.u._id, faculty.u._id] });
  await ctx.models.Message.create({ conversation: conv._id, sender: student.u._id, body: seal('Hello sir, about tomorrow') });
  const list = await req('GET', '/super-admin/chats', sa);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((c) => String(c._id) === String(conv._id)));
  const msgs = await req('GET', `/super-admin/chats/${conv._id}/messages`, sa);
  assert.equal(msgs.status, 200);
  assert.equal(msgs.body.items[0].body, 'Hello sir, about tomorrow');
  assert.equal((await req('POST', `/chat/conversations/${conv._id}/messages`, sa, { body: 'hi' })).status, 403);
  for (const who of [legacyAdmin, faculty, student]) assert.equal((await req('GET', '/super-admin/chats', who)).status, 403);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'CHAT_VIEWED', actor: sa.u._id }));
});

test('parent OTP cards moved from the Admin panel to the Super Admin console', async () => {
  assert.equal((await req('GET', '/admin/security/otps', legacyAdmin)).status, 404);
  const r = await req('GET', '/super-admin/security/otps', sa);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.items));
  assert.equal((await req('GET', '/super-admin/security/otps', legacyAdmin)).status, 403);
});

// ── RBAC policies ───────────────────────────────────────────────────

test('read policy permits reads only; no create, update, suspend, export or other modules', async () => {
  const reader = await policyAdmin([{ module: 'user_management', actions: ['view'] }]);
  const list = await req('GET', '/admin/users?limit=100', reader);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0);
  assert.ok(list.body.items.every((u) => ['student', 'club_admin', 'alumni'].includes(u.role)), 'only accounts this policy covers');
  assert.equal((await req('POST', '/admin/users', reader, { role: 'student', name: 'New', email: 'new.kid@test.edu', password: 'Welcome123', rollNo: 'NK1', department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111111' })).status, 403);
  assert.equal((await req('PATCH', `/admin/users/${cseStudent._id}`, reader, { isActive: false })).status, 403);
  assert.equal((await req('PATCH', `/admin/users/${cseStudent._id}`, reader, { name: 'Renamed Kid' })).status, 403);
  assert.equal((await req('DELETE', `/admin/users/${cseStudent._id}`, reader)).status, 403);
  assert.equal((await req('GET', '/users/export-pdf', reader)).status, 403);
  for (const p of ['/admin/security/logs', '/admin/activity', '/attendance/summary', '/timetable', '/gate-pass', '/events']) {
    assert.equal((await req('GET', p, reader)).status, 403, p);
  }
  assert.equal((await ctx.models.User.findById(cseStudent._id).lean()).isActive, true);
});

test('write policy works only within its department scope; changing the record ID does not leak', async () => {
  const scoped = await policyAdmin([{ module: 'user_management', actions: ['edit', 'view'], scope: 'department', department: 'CSE' }]);
  const list = await req('GET', '/admin/users?limit=100', scoped);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0);
  assert.ok(list.body.items.every((u) => u.department === 'CSE'));
  assert.ok(!list.body.items.some((u) => String(u._id) === String(eceStudent._id)));
  // Search cannot reach outside the scope either.
  assert.equal((await req('GET', '/admin/users?q=Ece%20Kid', scoped)).body.items.length, 0);
  assert.equal((await req('GET', `/users/${eceStudent._id}`, scoped)).status, 403);
  assert.equal((await req('GET', `/users/${cseStudent._id}`, scoped)).status, 200);
  assert.equal((await req('PATCH', `/admin/users/${eceStudent._id}`, scoped, { name: 'Hacked' })).status, 403);
  assert.equal((await req('PATCH', `/admin/users/${cseStudent._id}`, scoped, { name: 'Edited Kid' })).status, 200);
  // Moving a student out of the scope is refused.
  assert.equal((await req('PATCH', `/admin/users/${cseStudent._id}`, scoped, { department: 'ECE' })).status, 403);
  // Staff accounts belong to Staff Management, not User Management.
  assert.equal((await req('PATCH', `/admin/users/${faculty.u._id}`, scoped, { name: 'Nope' })).status, 403);
});

test('revoked policies stop authorizing the very next request', async () => {
  const admin = await policyAdmin([{ module: 'activity_logs', actions: ['view'] }]);
  assert.equal((await req('GET', '/admin/activity', admin)).status, 200);
  await reauth();
  assert.equal((await req('PUT', `/super-admin/admins/${admin.u._id}/policies`, sa, { policies: [] })).status, 200);
  assert.equal((await req('GET', '/admin/activity', admin)).status, 403);
});

test('policy changes cannot exceed the actor’s own authority or target oneself', async () => {
  const delegator = await policyAdmin([
    { module: 'user_management', actions: ['policies', 'view'] },
    { module: 'attendance', actions: ['view'] },
  ]);
  const target = await policyAdmin([{ module: 'clubs', actions: ['view'] }]);
  const put = (who, id, policies) => req('PUT', `/admin/users/${id}/policies`, who, { policies });

  assert.equal((await put(delegator, target.u._id, [{ module: 'clubs', actions: ['view'] }, { module: 'attendance', actions: ['view'] }])).status, 200);
  assert.equal((await put(delegator, target.u._id, [{ module: 'clubs', actions: ['view'] }, { module: 'attendance', actions: ['view', 'export'] }])).status, 403, 'export not held');
  assert.equal((await put(delegator, target.u._id, [{ module: 'attendance', actions: ['view'] }])).status, 403, 'cannot revoke clubs it does not hold');
  assert.equal((await put(delegator, delegator.u._id, [{ module: 'user_management', actions: ['policies', 'view', 'create'] }, { module: 'attendance', actions: ['view'] }])).status, 403, 'no self-grant');
  assert.equal((await put(delegator, sa.u._id, [])).status, 404, 'never a Super Admin');
  assert.equal((await put(legacyAdmin, target.u._id, [])).status, 403, 'legacy admins do not assign policies');
  assert.equal((await put(delegator, target.u._id, [{ module: 'attendance', actions: ['delete'] }])).status, 422);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'PRIVILEGE_ESCALATION_BLOCKED', actor: delegator.u._id }));
  const t = await ctx.models.User.findById(target.u._id).lean();
  assert.deepEqual(t.policies.map((p) => `${p.module}:${p.actions.join('+')}`).sort(), ['attendance:view', 'clubs:view']);
});

test('policy-managed admins are not in the all-admin socket room', async () => {
  const admin = await policyAdmin([{ module: 'clubs', actions: ['view'] }]);
  const socket = await ctx.connect(admin.token);
  const legacySocket = await ctx.connect(legacyAdmin.token);
  const { emitToRoles } = await import('../src/config/socket.js');
  const got = { policy: false, legacy: false };
  socket.on('od_leave:updated', () => (got.policy = true));
  legacySocket.on('od_leave:updated', () => (got.legacy = true));
  emitToRoles(['admin'], 'od_leave:updated', { requestId: 'x' });
  await sleep(300);
  assert.equal(got.legacy, true);
  assert.equal(got.policy, false);
  socket.disconnect();
  legacySocket.disconnect();
});

// ── Logs and privacy ────────────────────────────────────────────────

test('routine logs, directory and search never show Super Admin identities, whatever the filters', async () => {
  await settle();
  const email = encodeURIComponent(sa.u.email);
  for (const p of ['/admin/security/logs?limit=100', `/admin/security/logs?q=${email}`, '/admin/security/logs?role=super_admin', '/admin/security/logs?event=LOGIN_SUCCESS&limit=100']) {
    const r = await req('GET', p, legacyAdmin);
    assert.equal(r.status, 200, p);
    assert.ok(!JSON.stringify(r.body).includes(String(sa.u._id)), p);
  }
  const activity = await req('GET', `/admin/activity?limit=100&user=${sa.u._id}`, legacyAdmin);
  assert.equal(activity.body.items.length, 0);
  const dir = await req('GET', '/admin/users?limit=100&role=super_admin', legacyAdmin);
  assert.equal(dir.body.items.length, 0);
  const people = await req('GET', '/users?limit=100', legacyAdmin);
  assert.ok(!people.body.items.some((u) => u.role === 'super_admin'));
  assert.equal((await req('GET', `/users/${sa.u._id}`, legacyAdmin)).status, 403);
  // …while the protected audit trail keeps them, readable by the Super Admin only.
  const audit = await req('GET', '/super-admin/security/audit?limit=100', sa);
  assert.equal(audit.status, 200);
  assert.ok(audit.body.items.some((a) => String(a.actor?._id) === String(sa.u._id)));
});

test('protected audit records cannot be modified or deleted', async () => {
  const rec = await ctx.models.AuditLog.findOne().lean();
  assert.ok(rec);
  await assert.rejects(ctx.models.AuditLog.updateOne({ _id: rec._id }, { $set: { reason: 'tampered' } }));
  await assert.rejects(ctx.models.AuditLog.deleteOne({ _id: rec._id }));
  await assert.rejects(ctx.models.AuditLog.deleteMany({}));
  assert.ok(await ctx.models.AuditLog.exists({ _id: rec._id }));
});

// ── Emergency controls ──────────────────────────────────────────────

test('emergency: confirmation, re-auth, stale versions and concurrent requests are enforced', async () => {
  const state = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal(state.mode, 'normal');
  await reauth();
  const go = (body) => req('POST', '/super-admin/emergency/transition', sa, { to: 'maintenance', expectedVersion: state.version, reason: 'Planned upgrade', confirm: 'CONFIRM MAINTENANCE', ...body });
  assert.equal((await go({ confirm: 'yes' })).status, 422);
  assert.equal((await go({ expectedVersion: state.version + 5 })).status, 409);
  // Two simultaneous requests: exactly one switches the mode.
  const [a, b] = await Promise.all([go({}), go({})]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses[0] === 200, JSON.stringify([a.body, b.body]));
  const changed = [a, b].filter((r) => r.status === 200 && r.body.changed).length;
  assert.equal(changed, 1);
  const now = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal(now.mode, 'maintenance');
  assert.equal(now.version, state.version + 1);
  // Repeating the same request is a no-op.
  const again = await go({ expectedVersion: now.version });
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'EMERGENCY_TRANSITION', outcome: 'success', 'details.to': 'maintenance' }));
});

test('maintenance blocks ordinary access while the Super Admin recovery path stays open', async () => {
  assert.equal((await req('GET', '/auth/me', student)).status, 503);
  assert.equal((await req('GET', '/admin/users', legacyAdmin)).status, 503);
  const l = await ctx.request('POST', '/auth/login', { body: { email: faculty.u.email, password: PASSWORD } });
  assert.equal(l.status, 503);
  assert.equal(l.body.code, 'MAINTENANCE');
  const pub = await ctx.request('GET', '/platform/status');
  assert.equal(pub.body.mode, 'maintenance');
  await ctx.connect(student.token, { expectFail: true });
  // Super Admin: still in, and can sign in fresh.
  assert.equal((await req('GET', '/super-admin/overview', sa)).status, 200);
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: sa.u.email, password: PASSWORD } })).status, 200);
});

test('recovery cannot reopen without a passing health check; lockdown revokes ordinary sessions only', async () => {
  await reauth();
  let s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  const move = (to) => req('POST', '/super-admin/emergency/transition', sa, { to, expectedVersion: s.version, reason: `Incident drill → ${to}`, confirm: `CONFIRM ${to.toUpperCase()}` });

  const live = await login({ role: 'faculty', department: 'ECE', employeeId: 'E-LIVE' }).catch(() => null);
  assert.equal(live, null, 'no new ordinary sign-ins in maintenance');
  const before = await ctx.models.Session.countDocuments({ user: legacyAdmin.u._id, revokedAt: null });
  assert.ok(before >= 1);

  assert.equal((await move('lockdown')).status, 200);
  assert.equal(await ctx.models.Session.countDocuments({ user: legacyAdmin.u._id, revokedAt: null }), 0, 'ordinary sessions revoked');
  assert.ok((await ctx.models.Session.countDocuments({ user: sa.u._id, revokedAt: null })) >= 1, 'Super Admin kept');
  // During lockdown nobody but the Super Admin gets in.
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: faculty.u.email, password: PASSWORD } })).status, 503);
  assert.equal((await req('GET', '/super-admin/overview', sa)).status, 200);

  // Lifting the lockdown goes straight back to normal: the whole site works again.
  s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal((await move('normal')).status, 200);
  const relog = await ctx.loginWeb(faculty.u);
  assert.equal((await req('GET', '/auth/me', relog)).status, 200);
  assert.equal((await req('GET', '/attendance/summary', await ctx.loginWeb(hod.u))).status, 200);
  assert.equal((await ctx.request('GET', '/platform/status')).body.mode, 'normal');

  // Recovery path: closed until a passing health check.
  s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal((await move('maintenance')).status, 200);
  s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal((await move('recovery')).status, 200);
  s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal((await move('normal')).status, 422, 'health check required');
  const hc = await req('POST', '/super-admin/emergency/health-check', sa);
  assert.equal(hc.status, 200);
  assert.equal(hc.body.ok, true, JSON.stringify(hc.body));
  assert.ok(hc.body.checks.some((c) => c.name === 'database' && c.ok));
  s = (await req('GET', '/super-admin/emergency/state', sa)).body;
  assert.equal(s.mode, 'recovery', 'failed attempts left the state unchanged');
  assert.equal((await move('normal')).status, 200);
  // Everyone is back.
  const back = await ctx.request('POST', '/auth/login', { body: { email: faculty.u.email, password: PASSWORD } });
  assert.equal(back.status, 200);
  assert.equal((await ctx.request('GET', '/platform/status')).body.mode, 'normal');
  // No data was deleted along the way.
  assert.ok(await ctx.models.User.exists({ _id: eceStudent._id }));
});
