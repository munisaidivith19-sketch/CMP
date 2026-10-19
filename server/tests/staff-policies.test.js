import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, sleep } from './helpers.js';

/**
 * Additional policies for individual staff accounts (faculty, HOD, principal,
 * dean, AO, chairman, office, COE): they ADD admin-module access on top of the
 * role, are assigned by a Super Admin or by an Admin within its own limits, and
 * can never be used to escalate (no role changes, no policy assignment).
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
const staff = (role, extra = {}) => login({ role, name: `${role} ${uniq()}`, employeeId: `E${uniq()}`, ...extra });
const kid = (department = 'CSE') => ctx.createUser({ name: `Kid ${uniq()}`, department, section: 'A', rollNo: `K${uniq()}`.toUpperCase() });
const studentBody = (extra = {}) => {
  const id = uniq();
  return { role: 'student', name: `New ${id}`, email: `s.${id}@test.edu`, password: 'Welcome123', rollNo: `R${id}`.toUpperCase(), department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111111', ...extra };
};
// One password re-entry covers the Super Admin's 5-minute window (re-auth is rate-limited).
async function grant(who, target, policies) {
  return req('PUT', `/admin/users/${target.u?._id || target._id}/policies`, who, { policies });
}

before(async () => {
  ctx = await startServer();
  sa = await login({ role: 'super_admin', name: 'Platform Owner' });
  await reauth();
});
after(async () => ctx.stop());

test('Super Admin adds User Management access to one HOD; the role itself is unchanged', async () => {
  const hod = await staff('hod', { department: 'CSE' });
  const other = await staff('hod', { department: 'ECE' });
  await kid();
  assert.equal((await req('GET', '/admin/users', hod)).status, 403, 'nothing before the grant');

  const res = await grant(sa, hod, [{ module: 'user_management', actions: ['view', 'create'] }]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const list = await req('GET', '/admin/users?limit=100', hod);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0);
  assert.ok(list.body.items.every((u) => ['student', 'club_admin', 'alumni'].includes(u.role)), 'only accounts the grant covers');
  assert.equal((await req('POST', '/admin/users', hod, studentBody())).status, 201);
  assert.equal((await req('POST', '/admin/users', hod, { ...studentBody(), role: 'faculty', employeeId: `F${uniq()}`, teachingYears: [3], teachingSections: ['A'] })).status, 403, 'staff accounts are not covered');
  // The other HOD gained nothing.
  assert.equal((await req('GET', '/admin/users', other)).status, 403);
  const stored = await ctx.models.User.findById(hod.u._id).lean();
  assert.equal(stored.role, 'hod');
  assert.equal(stored.policyManaged, false, 'staff never become deny-by-default');
  const mine = await req('GET', '/admin/my-policies', hod);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.staffGrants, true);
  assert.deepEqual(mine.body.delegation.createRoles.sort(), ['alumni', 'club_admin', 'student']);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'POLICIES_CHANGED', targetUser: hod.u._id }));
});

test('only safe modules and actions can be given to staff; never delegating powers', async () => {
  const fac = await staff('faculty', { department: 'CSE' });
  for (const bad of [
    [{ module: 'attendance', actions: ['export'] }],
    [{ module: 'user_management', actions: ['policies'] }],
    [{ module: 'user_management', actions: ['roles'] }],
    [{ module: 'staff_management', actions: ['create'] }],
    [{ module: 'staff_management', actions: ['edit'] }],
    [{ module: 'user_management', actions: ['export'], scope: 'department', department: 'CSE' }],
    [{ module: 'root', actions: ['all'] }],
  ]) {
    assert.equal((await grant(sa, fac, bad)).status, 422, JSON.stringify(bad));
  }
  // Students, alumni and security/transport accounts cannot hold policies.
  const s = await kid();
  assert.equal((await grant(sa, s, [{ module: 'security_logs', actions: ['view'] }])).status, 404);
  const guard = await staff('security');
  assert.equal((await grant(sa, guard, [{ module: 'security_logs', actions: ['view'] }])).status, 404);
  // Super Admin changes need a recent password re-entry.
  await ctx.models.Session.updateMany({ user: sa.u._id }, { $unset: { reauthAt: 1 } });
  const noReauth = await req('PUT', `/admin/users/${fac.u._id}/policies`, sa, { policies: [] });
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.code, 'REAUTH_REQUIRED');
  assert.equal((await reauth()).status, 200);
});

test('confined roles (Office) get exactly the granted page, nothing else', async () => {
  const office = await staff('office');
  assert.equal((await req('GET', '/admin/security/logs', office)).status, 403);
  assert.equal((await grant(sa, office, [{ module: 'security_logs', actions: ['view'] }])).status, 200);
  const logs = await req('GET', '/admin/security/logs', office);
  assert.equal(logs.status, 200, JSON.stringify(logs.body));
  assert.equal((await req('GET', '/admin/activity', office)).status, 403, 'activity logs were not granted');
  assert.equal((await req('GET', '/events', office)).status, 403, 'still confined everywhere else');
  assert.equal((await req('GET', '/attendance/summary', office)).status === 403, false, 'its own attendance access is kept');
  // Revocation applies to the very next request.
  assert.equal((await grant(sa, office, [])).status, 200);
  assert.equal((await req('GET', '/admin/security/logs', office)).status, 403);
});

test('department scope holds for staff grants, including password resets', async () => {
  const fac = await staff('faculty', { department: 'CSE' });
  assert.equal((await grant(sa, fac, [{ module: 'user_management', actions: ['edit', 'view'], scope: 'department', department: 'CSE' }])).status, 200);
  const cse = await kid('CSE');
  const ece = await kid('ECE');
  const edit = await req('PATCH', `/admin/users/${cse._id}`, fac, { name: 'Edited Kid' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal((await req('PATCH', `/admin/users/${ece._id}`, fac, { name: 'Hacked' })).status, 403);
  assert.equal((await req('PATCH', `/admin/users/${cse._id}`, fac, { department: 'ECE' })).status, 403, 'cannot move out of scope');
  const reset = { newPassword: 'NewPass123!', confirmPassword: 'NewPass123!' };
  assert.equal((await req('POST', `/users/${cse._id}/reset-password`, fac, reset)).status, 200);
  assert.equal((await req('POST', `/users/${ece._id}/reset-password`, fac, reset)).status, 403);
});

test('a staff grant can never escalate: no role changes, deletes, suspensions or policy assignment', async () => {
  const hod = await staff('hod', { department: 'CSE' });
  assert.equal((await grant(sa, hod, [{ module: 'user_management', actions: ['edit', 'view'] }])).status, 200);
  const s = await kid();
  const other = await staff('faculty', { department: 'CSE' });
  for (const role of ['principal', 'admin', 'super_admin', 'club_admin']) {
    assert.ok([403, 422].includes((await req('PATCH', `/admin/users/${s._id}`, hod, { role })).status), role);
  }
  assert.equal((await req('PATCH', `/admin/users/${s._id}`, hod, { isActive: false })).status, 403, 'suspend not granted');
  assert.equal((await req('DELETE', `/admin/users/${s._id}`, hod)).status, 403);
  assert.equal((await req('PUT', `/admin/users/${other.u._id}/policies`, hod, { policies: [{ module: 'user_management', actions: ['view'] }] })).status, 403);
  assert.equal((await req('PUT', `/admin/users/${hod.u._id}/policies`, hod, { policies: [{ module: 'security_logs', actions: ['view'] }] })).status, 403, 'not even its own');
  assert.equal((await req('GET', '/super-admin/admins', hod)).status, 403);
  assert.equal((await req('GET', '/admin/policy-targets', hod)).status, 403);
  assert.equal((await ctx.models.User.findById(s._id).lean()).role, 'student');
});

test('Admins assign staff policies only within their own authority', async () => {
  const admin = await login({
    role: 'admin', employeeId: `A${uniq()}`, policyManaged: true,
    policies: [
      { module: 'user_management', actions: ['create', 'policies', 'view'] },
      { module: 'staff_management', actions: ['edit', 'view'], scope: 'department', department: 'CSE' },
    ],
  });
  const facCse = await staff('faculty', { department: 'CSE' });
  const facEce = await staff('faculty', { department: 'ECE' });
  const put = (target, policies) => req('PUT', `/admin/users/${target.u._id}/policies`, admin, { policies, merge: true });

  assert.equal((await put(facCse, [{ module: 'user_management', actions: ['view'] }])).status, 200);
  assert.equal((await put(facEce, [{ module: 'user_management', actions: ['view'] }])).status, 403, 'outside its staff scope');
  assert.equal((await put(facCse, [{ module: 'security_logs', actions: ['view'] }])).status, 403, 'does not hold it');
  assert.equal((await put(facCse, [{ module: 'user_management', actions: ['create', 'view'] }])).status, 200, 'can create every ordinary role itself');

  // Once its create roles are limited, it can no longer hand out account creation.
  assert.equal((await req('PUT', `/super-admin/admins/${admin.u._id}/delegation`, sa, { delegation: { createRoles: ['student'] } })).status, 200);
  assert.equal((await put(facCse, [{ module: 'user_management', actions: ['view'] }])).status, 200, 'revoking is fine');
  assert.equal((await put(facCse, [{ module: 'user_management', actions: ['create', 'view'] }])).status, 403);

  // The view endpoint shows only what this Admin may grant.
  const view = await req('GET', `/admin/users/${facCse.u._id}/policies`, admin);
  assert.equal(view.status, 200);
  assert.equal(view.body.kind, 'staff');
  assert.ok(view.body.cap.every((p) => ['user_management', 'staff_management'].includes(p.module)));
  assert.ok(!Object.keys(view.body.catalogue).includes('attendance'), 'staff catalogue only');

  // Admins without user_management.policies, and legacy Admins, cannot assign.
  const noPol = await login({ role: 'admin', employeeId: `A${uniq()}`, policyManaged: true, policies: [{ module: 'staff_management', actions: ['edit', 'view'] }] });
  assert.equal((await req('PUT', `/admin/users/${facCse.u._id}/policies`, noPol, { policies: [] })).status, 403);
  const legacy = await login({ role: 'admin', employeeId: `A${uniq()}` });
  assert.equal((await req('PUT', `/admin/users/${facCse.u._id}/policies`, legacy, { policies: [] })).status, 403);
  await settle();
  assert.ok(await ctx.models.AuditLog.exists({ action: 'PRIVILEGE_ESCALATION_BLOCKED', actor: admin.u._id }));
});
