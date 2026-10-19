import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';

/**
 * Role-policy delegation: a Super Admin decides which roles each policy-managed
 * Admin may create and assign, and the most it may delegate to other Admins.
 * Every rule is checked against the API directly (no UI involved).
 */
let ctx;
let sa;
let legacyAdmin;
let n = 0;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const reauth = (who = sa) => req('POST', '/super-admin/reauth', who, { password: PASSWORD });
const settle = () => sleep(150);
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

async function login(overrides) {
  const u = await ctx.createUser(overrides);
  return { u, ...(await ctx.loginWeb(u)) };
}
const policyAdmin = (policies, extra = {}) => login({ role: 'admin', employeeId: `E-${uniq()}`, policyManaged: true, policies, ...extra });

async function setDelegation(target, delegation) {
  await reauth();
  return req('PUT', `/super-admin/admins/${target.u._id}/delegation`, sa, { delegation });
}

/** A valid create-user body for each role used here. */
function body(role, extra = {}) {
  const id = uniq();
  const base = { role, name: `New ${role} ${id}`, email: `${role}.${id}@test.edu`, password: 'Welcome123' };
  if (role === 'student' || role === 'club_admin') Object.assign(base, { rollNo: `R${id}`.toUpperCase(), department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111111' });
  else if (role === 'faculty') Object.assign(base, { employeeId: `F${id}`, department: 'CSE', teachingYears: [3], teachingSections: ['A'] });
  else if (role === 'hod') Object.assign(base, { employeeId: `H${id}`, department: 'CSE' });
  else Object.assign(base, { employeeId: `X${id}` });
  return { ...base, ...extra };
}
const create = (who, role, extra) => req('POST', '/admin/users', who, body(role, extra));

const CREATOR_POLICIES = [
  { module: 'user_management', actions: ['create', 'edit', 'roles', 'view'] },
  { module: 'staff_management', actions: ['create', 'edit', 'view'] },
];

before(async () => {
  ctx = await startServer();
  sa = await login({ role: 'super_admin', name: 'Platform Owner' });
  legacyAdmin = await login({ role: 'admin', name: 'Legacy Admin', employeeId: 'E-LEG' });
});
after(async () => ctx.stop());

test('1. Super Admin configures delegation: validated, re-auth protected, audited; nobody else can', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  // Re-auth is required (sensitive action).
  await ctx.models.Session.updateMany({ user: sa.u._id }, { $unset: { reauthAt: 1 } });
  const noReauth = await req('PUT', `/super-admin/admins/${admin.u._id}/delegation`, sa, { delegation: { createRoles: ['student'] } });
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.code, 'REAUTH_REQUIRED');

  const ok = await setDelegation(admin, { createRoles: ['student', 'faculty'], assignRoles: ['student', 'club_admin'], grantablePolicies: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.delegation.createRoles, ['faculty', 'student']);
  assert.deepEqual(ok.body.delegation.assignRoles, ['club_admin', 'student']);
  // Unknown, Admin and Super Admin roles, aliases and unknown fields are rejected.
  for (const bad of [{ createRoles: ['super_admin'] }, { createRoles: ['admin'] }, { createRoles: ['Super_Admin'] }, { assignRoles: ['wizard'] }, { createRoles: 'student' }, { isSuper: true }, { grantablePolicies: [{ module: 'root', actions: ['all'] }] }]) {
    assert.equal((await setDelegation(admin, bad)).status, 422, JSON.stringify(bad));
  }
  // Legacy (unrestricted) admins must be converted with policies first.
  assert.equal((await setDelegation(legacyAdmin, { createRoles: ['student'] })).status, 422);
  // Ordinary admins (even with every policy) cannot reach the Super Admin route.
  const strong = await policyAdmin([{ module: 'user_management', actions: ['policies', 'create', 'roles', 'view', 'edit'] }]);
  assert.equal((await req('PUT', `/super-admin/admins/${admin.u._id}/delegation`, strong, { delegation: { createRoles: null } })).status, 403);
  // Delegation cannot ride along on a profile edit (mass assignment).
  await reauth();
  assert.equal((await req('PATCH', `/super-admin/admins/${admin.u._id}`, sa, { name: 'Renamed', delegation: { createRoles: ['principal'] } })).status, 422);

  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'DELEGATION_CHANGED', targetUser: admin.u._id }));
  const stored = await ctx.models.User.findById(admin.u._id).lean();
  assert.deepEqual(stored.delegation.createRoles, ['faculty', 'student']);
  assert.equal(String(stored.delegation.updatedBy), String(sa.u._id));
});

test('2. users.create alone does not allow configuring role policies', async () => {
  const creator = await policyAdmin([{ module: 'user_management', actions: ['create', 'view'] }]);
  const target = await policyAdmin([{ module: 'clubs', actions: ['view'] }]);
  assert.equal((await req('PUT', `/admin/users/${target.u._id}/policies`, creator, { policies: [] })).status, 403);
  assert.equal((await req('GET', '/admin/policy-targets', creator)).status, 403);
  const mine = await req('GET', '/admin/my-policies', creator);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.delegation.canAssignPolicies, false);
  assert.deepEqual(mine.body.delegation.assignRoles, [], 'no roles action → cannot assign roles');
});

test('3 + 4. an Admin creates only the roles delegated to it', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  assert.equal((await setDelegation(admin, { createRoles: ['student', 'faculty'] })).status, 200);
  assert.equal((await create(admin, 'student')).status, 201);
  assert.equal((await create(admin, 'faculty')).status, 201);
  for (const role of ['hod', 'principal', 'security', 'club_admin']) {
    const res = await create(admin, role);
    assert.equal(res.status, 403, role);
    assert.equal(res.body.code, 'DELEGATION_EXCEEDED', role);
  }
  // Admin / Super Admin are never creatable here, delegation or not.
  assert.equal((await create(admin, 'admin')).status, 422);
  assert.equal((await create(admin, 'super_admin')).status, 422);
  const mine = await req('GET', '/admin/my-policies', admin);
  assert.deepEqual(mine.body.delegation.createRoles.sort(), ['faculty', 'student']);
});

test('5. an Admin cannot delegate beyond its own limit, nor through another Admin', async () => {
  const delegator = await policyAdmin([
    { module: 'user_management', actions: ['create', 'policies', 'view'] },
    { module: 'attendance', actions: ['export', 'view'] },
  ]);
  assert.equal((await setDelegation(delegator, {
    createRoles: ['student'],
    grantablePolicies: [{ module: 'user_management', actions: ['create', 'view'] }, { module: 'attendance', actions: ['view'] }],
  })).status, 200);
  const target = await policyAdmin([{ module: 'clubs', actions: ['view'] }]);
  const put = (policies, merge) => req('PUT', `/admin/users/${target.u._id}/policies`, delegator, { policies, ...(merge ? { merge } : {}) });
  const keep = { module: 'clubs', actions: ['view'] };

  assert.equal((await put([keep, { module: 'attendance', actions: ['view'] }])).status, 200);
  const tooMuch = await put([keep, { module: 'attendance', actions: ['export', 'view'] }]);
  assert.equal(tooMuch.status, 403, 'export is held but not delegatable');
  assert.equal(tooMuch.body.code, 'DELEGATION_EXCEEDED');
  assert.equal((await put([keep, { module: 'attendance', actions: ['view'] }, { module: 'user_management', actions: ['policies'] }])).status, 403, 'policies is outside the cap');

  // Granting "create" to an Admin with no create limit would hand it every
  // ordinary role: refused until a Super Admin sets one inside the delegator's.
  const grantCreate = [keep, { module: 'attendance', actions: ['view'] }, { module: 'user_management', actions: ['create', 'view'] }];
  assert.equal((await put(grantCreate)).status, 403);
  assert.equal((await setDelegation(target, { createRoles: ['student', 'club_admin'] })).status, 200);
  assert.equal((await put(grantCreate)).status, 403, 'club_admin is outside the delegator’s create roles');
  assert.equal((await setDelegation(target, { createRoles: ['student'] })).status, 200);
  assert.equal((await put(grantCreate)).status, 200);
  assert.equal((await create(target, 'student')).status, 201);
  assert.equal((await create(target, 'club_admin')).status, 403);

  // The merge mode keeps what the delegator cannot see (clubs) untouched.
  assert.equal((await put([{ module: 'attendance', actions: ['view'] }, { module: 'user_management', actions: ['create', 'view'] }], true)).status, 200);
  const t = await ctx.models.User.findById(target.u._id).lean();
  assert.deepEqual(t.policies.map((p) => `${p.module}:${p.actions.join('+')}`).sort(), ['attendance:view', 'clubs:view', 'user_management:create+view']);

  // The targets list never reveals modules outside the delegator's cap.
  const list = await req('GET', '/admin/policy-targets', delegator);
  assert.equal(list.status, 200);
  const row = list.body.items.find((a) => a._id === String(target.u._id));
  assert.ok(row);
  assert.ok(!row.policies.some((p) => p.module === 'clubs'));
  assert.equal(row.hiddenActions, 1);
  assert.ok(!list.body.items.some((a) => a._id === String(delegator.u._id)), 'never itself');
  assert.ok(!list.body.items.some((a) => a._id === String(legacyAdmin.u._id)), 'never a legacy admin');
  assert.ok(!list.body.items.some((a) => a._id === String(sa.u._id)), 'never a Super Admin');
  assert.equal((await req('PUT', `/admin/users/${legacyAdmin.u._id}/policies`, delegator, { policies: [] })).status, 403, 'legacy admins are restricted only by a Super Admin');
});

test('6. no Admin can promote itself or anyone to Admin / Super Admin, or raise its own powers', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  const kid = await ctx.createUser({ name: 'Promote Me', department: 'CSE', section: 'A', rollNo: `P${uniq()}`.toUpperCase() });
  for (const role of ['super_admin', 'admin', 'SUPER_ADMIN', 'super_admin ']) {
    const res = await req('PATCH', `/admin/users/${kid._id}`, admin, { role });
    assert.ok([403, 422].includes(res.status), `${role} → ${res.status}`);
  }
  assert.equal((await req('PATCH', `/admin/users/${admin.u._id}`, admin, { role: 'principal' })).status, 400, 'never its own account');
  assert.equal((await req('PATCH', `/admin/users/${sa.u._id}`, admin, { isActive: false })).status, 403);
  assert.equal((await req('PUT', `/admin/users/${admin.u._id}/policies`, admin, { policies: CREATOR_POLICIES })).status, 403);
  assert.equal((await req('PUT', `/super-admin/admins/${admin.u._id}/delegation`, admin, { delegation: { createRoles: null } })).status, 403);
  assert.equal((await ctx.models.User.findById(kid._id).lean()).role, 'student');
});

test('7. crafted requests cannot bypass the limits (mass assignment, hidden roles)', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  assert.equal((await setDelegation(admin, { createRoles: ['student'], assignRoles: ['student', 'club_admin'] })).status, 200);
  // Privilege fields on create are never copied.
  const res = await create(admin, 'student', { policyManaged: true, policies: [{ module: 'user_management', actions: ['policies'] }], delegation: { createRoles: ['principal'] }, isActive: true, tokenVersion: 9 });
  assert.equal(res.status, 201);
  const made = await ctx.models.User.findById(res.body._id).lean();
  assert.equal(made.role, 'student');
  assert.equal(made.policyManaged, false);
  assert.deepEqual(made.policies, []);
  assert.equal(made.delegation?.createRoles, undefined);
  // A role the UI never offers is refused by the server.
  assert.equal((await create(admin, 'principal')).status, 403);
  // Self-serve profile edits cannot write delegation or policies.
  await req('PUT', '/users/me', admin, { delegation: { createRoles: ['principal'] }, policies: [] });
  const me = await ctx.models.User.findById(admin.u._id).lean();
  assert.deepEqual(me.delegation.createRoles, ['student']);
  assert.equal(me.policies.length, 2);
});

test('8. role changes, HOD appointments and bulk import follow the same rules', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  assert.equal((await setDelegation(admin, { createRoles: ['student'], assignRoles: ['student', 'club_admin'] })).status, 200);
  const kid = await ctx.createUser({ name: 'Role Kid', department: 'CSE', section: 'A', rollNo: `K${uniq()}`.toUpperCase() });
  assert.equal((await req('PATCH', `/admin/users/${kid._id}`, admin, { role: 'club_admin' })).status, 200);
  const toFaculty = await req('PATCH', `/admin/users/${kid._id}`, admin, { role: 'faculty' });
  assert.equal(toFaculty.status, 403);
  assert.equal(toFaculty.body.code, 'DELEGATION_EXCEEDED');

  // Moving an account FROM a role outside the limit is refused too.
  const fac = await ctx.createUser({ role: 'faculty', name: 'Fac Demote', department: 'CSE', employeeId: `FD${uniq()}` });
  assert.equal((await req('PATCH', `/admin/users/${fac._id}`, admin, { role: 'student' })).status, 403);

  // Demoting a principal needs Staff Management authority, not only User Management.
  const umOnly = await policyAdmin([{ module: 'user_management', actions: ['edit', 'roles', 'view'] }]);
  const principal = await ctx.createUser({ role: 'principal', name: 'The Principal', employeeId: `PR${uniq()}` });
  assert.equal((await req('PATCH', `/admin/users/${principal._id}`, umOnly, { role: 'student' })).status, 403);
  assert.equal((await ctx.models.User.findById(principal._id).lean()).role, 'principal');

  // HOD appointment moves accounts between faculty and hod: refused outside the limit.
  const hodRes = await req('POST', '/admin/role-assignments/set-hod', admin, { department: 'CSE', facultyId: String(fac._id) });
  assert.equal(hodRes.status, 403);
  assert.equal((await ctx.models.User.findById(fac._id).lean()).role, 'faculty');

  // Bulk alumni import is not reachable for policy-managed admins at all.
  assert.equal((await req('POST', `/alumni/import/${fac._id}/commit`, admin, {})).status, 403);
  assert.equal((await req('GET', '/alumni/import', admin)).status, 403);
});

test('9. existing Admins keep exactly their current access until a limit is set', async () => {
  const before = await policyAdmin(CREATOR_POLICIES);
  // No delegation: the module policies decide, as before this feature.
  assert.equal((await create(before, 'student')).status, 201);
  assert.equal((await create(before, 'faculty')).status, 201);
  assert.equal((await create(before, 'hod')).status, 201);
  // Legacy admins are untouched.
  assert.equal((await create(legacyAdmin, 'principal')).status, 201);
  // Setting a delegation never touches the module policies.
  const policiesBefore = (await ctx.models.User.findById(before.u._id).lean()).policies;
  assert.equal((await setDelegation(before, { createRoles: ['student'] })).status, 200);
  assert.deepEqual((await ctx.models.User.findById(before.u._id).lean()).policies, policiesBefore);
  // Clearing a limit (null) restores the module-policy behaviour.
  assert.equal((await create(before, 'hod')).status, 403);
  assert.equal((await setDelegation(before, { createRoles: null })).status, 200);
  assert.equal((await create(before, 'hod')).status, 201);
});

test('10. changes apply to the very next request', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  assert.equal((await setDelegation(admin, { createRoles: ['student', 'faculty'] })).status, 200);
  assert.equal((await create(admin, 'faculty')).status, 201);
  assert.equal((await setDelegation(admin, { createRoles: ['student'] })).status, 200);
  assert.equal((await create(admin, 'faculty')).status, 403);
  const mine = await req('GET', '/admin/my-policies', admin);
  assert.deepEqual(mine.body.delegation.createRoles, ['student']);
  assert.deepEqual(mine.body.delegation.limits.createRoles, ['student']);
  assert.equal(mine.headers?.['cache-control'] ?? 'no-store', 'no-store');
});

test('11. refused requests are recorded in the protected audit trail and security log', async () => {
  const admin = await policyAdmin(CREATOR_POLICIES);
  assert.equal((await setDelegation(admin, { createRoles: ['student'] })).status, 200);
  const principals = await ctx.models.User.countDocuments({ role: 'principal' });
  assert.equal((await create(admin, 'principal')).status, 403);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'PRIVILEGE_ESCALATION_BLOCKED', actor: admin.u._id, reason: 'role_create_outside_delegation' }));
  assert.ok(await ctx.models.SecurityLog.exists({ event: 'POLICY_DENIED', actor: admin.u._id, reason: 'role_create_outside_delegation' }));
  assert.equal(await ctx.models.User.countDocuments({ role: 'principal' }), principals, 'nothing was created');
});
