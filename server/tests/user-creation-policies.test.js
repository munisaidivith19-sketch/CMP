import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

// Every request comes from one local IP: give each test a fresh write window,
// as in exam-timetable.test.js.
beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

/**
 * Policy Assignment at user creation (POST /admin/users → policyMode):
 *   "none"   — the role's own access, nothing extra stored (the default),
 *   "custom" — additional policies, only from a Super Admin or an Admin that
 *              may delegate them, validated before the account exists.
 * Every rule is exercised against the API directly (no UI involved).
 */
let ctx;
let sa;
let n = 0;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const reauth = () => req('POST', '/super-admin/reauth', sa, { password: PASSWORD });
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const settle = () => sleep(150);

async function login(overrides) {
  const u = await ctx.createUser(overrides);
  return { u, ...(await ctx.loginWeb(u)) };
}
const policyAdmin = (policies, extra = {}) => login({ role: 'admin', employeeId: `E-${uniq()}`, policyManaged: true, policies, ...extra });

/** A valid create-user body for each role used here (password = the test password, so the account can sign in). */
function body(role, extra = {}) {
  const id = uniq();
  const base = { role, name: `New ${role} ${id}`, email: `${role}.${id}@test.edu`, password: PASSWORD };
  if (role === 'student') Object.assign(base, { rollNo: `R${id}`.toUpperCase(), department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111111' });
  else if (role === 'faculty') Object.assign(base, { employeeId: `F${id}`, department: 'CSE', teachingYears: [3], teachingSections: ['A'] });
  else if (role === 'hod') Object.assign(base, { employeeId: `H${id}`, department: 'CSE' });
  else Object.assign(base, { employeeId: `X${id}` });
  return { ...base, ...extra };
}
const create = (who, role, extra) => req('POST', '/admin/users', who, body(role, extra));
const stored = (email) => ctx.models.User.findOne({ email }).lean();

const LOGS = [{ module: 'security_logs', actions: ['view'] }];
// A policy-managed Admin allowed to create staff and to delegate what it holds.
const DELEGATOR = [
  { module: 'user_management', actions: ['create', 'policies', 'view'] },
  { module: 'staff_management', actions: ['create', 'edit', 'view'] },
  { module: 'security_logs', actions: ['view'] },
];

before(async () => {
  ctx = await startServer();
  sa = await login({ role: 'super_admin', name: 'Platform Owner' });
  await reauth();
});
after(async () => ctx.stop());

test('1/11. No Additional Policies keeps the role access exactly as before and stores nothing extra', async () => {
  // Explicit "none" and the legacy body without policyMode behave the same.
  for (const extra of [{ policyMode: 'none' }, {}]) {
    const b = body('hod', extra);
    const res = await req('POST', '/admin/users', sa, b);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const u = await stored(b.email);
    assert.deepEqual(u.policies, []);
    assert.equal(u.policyManaged, false);
    const hod = await ctx.loginWeb(u);
    // The HOD dashboard and role routes still work; no admin module was added.
    assert.equal((await req('GET', '/dashboard', hod)).status, 200);
    assert.equal((await req('GET', '/admin/users', hod)).status, 403);
  }
  // Ordinary (non-staff) accounts keep working with the default too.
  assert.equal((await create(sa, 'student')).status, 201);
});

test('2/12. Super Admin adds policies at creation: re-auth protected, effective, persisted across sign-ins, audited', async () => {
  await ctx.models.Session.updateMany({ user: sa.u._id }, { $unset: { reauthAt: 1 } });
  const b = body('hod', { policyMode: 'custom', policies: LOGS });
  const noReauth = await req('POST', '/admin/users', sa, b);
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.code, 'REAUTH_REQUIRED');
  assert.equal(await stored(b.email), null, 'nothing created without re-auth');

  await reauth();
  const res = await req('POST', '/admin/users', sa, b);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const u = await stored(b.email);
  assert.deepEqual(u.policies.map((p) => [p.module, p.actions]), [['security_logs', ['view']]]);
  assert.equal(u.role, 'hod');
  assert.equal(u.policyManaged, false, 'staff keep their role access; never deny-by-default');

  // Effective on the new account, and still there after signing in again.
  for (let i = 0; i < 2; i += 1) {
    const hod = await ctx.loginWeb(u);
    assert.equal((await req('GET', '/admin/security/logs', hod)).status, 200);
    const mine = await req('GET', '/admin/my-policies', hod);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.policies.map((p) => p.module), ['security_logs']);
    assert.equal((await req('GET', '/dashboard', hod)).status, 200, 'role dashboard intact');
  }

  await settle();
  const audit = await ctx.models.AuditLog.findOne({ action: 'POLICIES_CHANGED', target: u._id }).lean();
  assert.ok(audit, 'protected audit record');
  assert.equal(audit.details.via, 'user_create');
  assert.ok(!JSON.stringify(audit).includes(PASSWORD), 'no password in the audit record');
});

test('3/8. A delegating Admin grants only what it holds, within its scope', async () => {
  const admin = await policyAdmin(DELEGATOR);
  const ok = await create(admin, 'hod', { policyMode: 'custom', policies: LOGS });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  // Activity logs: not held by this Admin. Outside its authority, so refused.
  const outside = body('hod', { policyMode: 'custom', policies: [{ module: 'activity_logs', actions: ['view'] }] });
  const r1 = await req('POST', '/admin/users', admin, outside);
  assert.equal(r1.status, 403);
  assert.equal(r1.body.code, 'DELEGATION_EXCEEDED');
  assert.equal(await stored(outside.email), null, '10. no account left behind');

  // A department-scoped Admin cannot hand out campus-wide access.
  const deptAdmin = await policyAdmin([
    { module: 'user_management', actions: ['policies', 'view'], scope: 'department', department: 'CSE' },
    { module: 'staff_management', actions: ['create', 'edit', 'view'], scope: 'department', department: 'CSE' },
  ]);
  const wide = body('hod', { policyMode: 'custom', policies: [{ module: 'user_management', actions: ['view'], scope: 'campus' }] });
  assert.equal((await req('POST', '/admin/users', deptAdmin, wide)).status, 403);
  assert.equal(await stored(wide.email), null);
  const narrow = await create(deptAdmin, 'hod', { policyMode: 'custom', policies: [{ module: 'user_management', actions: ['view'], scope: 'department', department: 'CSE' }] });
  assert.equal(narrow.status, 201, JSON.stringify(narrow.body));
  // …and not for an account outside its department, even when creation itself is in scope elsewhere.
  const other = body('hod', { department: 'ECE', policyMode: 'custom', policies: [{ module: 'user_management', actions: ['view'], scope: 'department', department: 'CSE' }] });
  assert.equal((await req('POST', '/admin/users', deptAdmin, other)).status, 403);
  assert.equal(await stored(other.email), null);
});

test('4. Admins without User Management → policies cannot add policies (legacy or policy-managed)', async () => {
  const noPolicies = await policyAdmin([{ module: 'staff_management', actions: ['create', 'edit', 'view'] }, ...LOGS]);
  const legacy = await login({ role: 'admin', employeeId: `E-${uniq()}` });
  for (const who of [noPolicies, legacy]) {
    const b = body('hod', { policyMode: 'custom', policies: LOGS });
    const res = await req('POST', '/admin/users', who, b);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(await stored(b.email), null);
    // They can still create the account with the role's own access.
    assert.equal((await create(who, 'hod', { policyMode: 'none' })).status, 201);
  }
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'PRIVILEGE_ESCALATION_BLOCKED', actor: noPolicies.u._id, reason: 'create_policies_not_authorized' }));
});

test('5. Institutional roles cannot create accounts with policies or assign themselves policies', async () => {
  const roles = ['faculty', 'hod', 'principal', 'chairman', 'dean', 'ao', 'coe', 'office', 'warden', 'transport', 'security', 'student'];
  for (const role of roles) {
    const extra = role === 'student' ? { rollNo: `S${uniq()}`.toUpperCase(), department: 'CSE', section: 'A' } : { employeeId: `E${uniq()}`, department: 'CSE' };
    const who = await login({ role, ...extra });
    const b = body('hod', { policyMode: 'custom', policies: LOGS });
    assert.equal((await req('POST', '/admin/users', who, b)).status, 403, `${role} create`);
    assert.equal((await req('PUT', `/admin/users/${who.u._id}/policies`, who, { policies: LOGS })).status, 403, `${role} self-assign`);
    const me = await ctx.models.User.findById(who.u._id).lean();
    assert.deepEqual(me.policies, [], `${role} unchanged`);
  }
  // A staff account using User Management through its own grant still cannot attach policies.
  const hod = await login({ role: 'hod', employeeId: `E${uniq()}`, department: 'CSE', policies: [{ module: 'user_management', actions: ['create', 'view'] }] });
  assert.equal((await create(hod, 'student')).status, 201, 'its grant works');
  assert.equal((await create(hod, 'student', { policyMode: 'custom', policies: LOGS })).status, 422, 'students cannot hold policies');
  assert.equal((await create(hod, 'hod', { policyMode: 'custom', policies: LOGS })).status, 403);
});

test('6/7/8. Crafted requests are rejected: no silent drops, no Super Admin, no mass assignment, catalogue only', async () => {
  const cases = [
    ['policies sent with "none"', body('hod', { policyMode: 'none', policies: LOGS }), 422],
    ['policies sent without a mode', body('hod', { policies: LOGS }), 422],
    ['unknown mode', body('hod', { policyMode: 'everything', policies: LOGS }), 422],
    ['empty custom', body('hod', { policyMode: 'custom', policies: [] }), 422],
    ['unknown module', body('hod', { policyMode: 'custom', policies: [{ module: 'root', actions: ['all'] }] }), 422],
    ['unknown action', body('hod', { policyMode: 'custom', policies: [{ module: 'security_logs', actions: ['delete'] }] }), 422],
    ['admin-only action for staff', body('hod', { policyMode: 'custom', policies: [{ module: 'user_management', actions: ['roles'] }] }), 422],
    ['policy assignment for staff', body('hod', { policyMode: 'custom', policies: [{ module: 'user_management', actions: ['policies'] }] }), 422],
    ['bad department scope', body('hod', { policyMode: 'custom', policies: [{ module: 'user_management', actions: ['view'], scope: 'department', department: 'NOPE' }] }), 422],
    ['not a list', body('hod', { policyMode: 'custom', policies: { module: 'security_logs' } }), 422],
    ['role without policies', body('student', { policyMode: 'custom', policies: LOGS }), 422],
    ['Super Admin role', body('principal', { role: 'super_admin', policyMode: 'custom', policies: LOGS }), 422],
    ['Admin role', body('principal', { role: 'admin' }), 422],
  ];
  await reauth();
  for (const [label, b, status] of cases) {
    const res = await req('POST', '/admin/users', sa, b);
    assert.equal(res.status, status, `${label}: ${JSON.stringify(res.body)}`);
    assert.equal(await stored(b.email), null, `${label}: no account`);
  }
  // Privileged fields cannot ride along on the create body.
  const b = body('hod', { policyManaged: true, delegation: { createRoles: ['student'] }, policyMode: 'none' });
  assert.equal((await req('POST', '/admin/users', sa, b)).status, 201);
  const u = await stored(b.email);
  assert.equal(u.policyManaged, false);
  assert.equal(u.delegation?.createRoles ?? null, null);
  assert.equal(await ctx.models.User.countDocuments({ role: 'super_admin' }), 1, 'no new Super Admin');
});

test('9. Individual grants affect only the intended account', async () => {
  await reauth();
  const withB = body('hod', { policyMode: 'custom', policies: LOGS });
  const withoutB = body('hod', { policyMode: 'none' });
  assert.equal((await req('POST', '/admin/users', sa, withB)).status, 201);
  assert.equal((await req('POST', '/admin/users', sa, withoutB)).status, 201);
  const a = await ctx.loginWeb(await stored(withB.email));
  const b = await ctx.loginWeb(await stored(withoutB.email));
  assert.equal((await req('GET', '/admin/security/logs', a)).status, 200);
  assert.equal((await req('GET', '/admin/security/logs', b)).status, 403);
});

test('my-policies gives Admins the staff catalogue the create form offers', async () => {
  const mine = await req('GET', '/admin/my-policies', sa);
  assert.equal(mine.status, 200);
  assert.deepEqual(Object.keys(mine.body.staffCatalogue).sort(), ['activity_logs', 'attendance', 'security_logs', 'staff_management', 'user_management']);
  assert.equal(mine.body.staffCatalogue.user_management.actions.policies, undefined, 'never a delegating action');
});
