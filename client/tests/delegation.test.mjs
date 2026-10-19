import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELEGATABLE_ROLES, allowedRoles, previewDelegation, restrictCatalogue, rolesSummary } from '../src/utils/delegation.js';

const CREATOR = [
  { module: 'user_management', actions: ['create', 'edit', 'roles', 'view'], scope: 'campus' },
  { module: 'staff_management', actions: ['create', 'edit', 'view'], scope: 'campus' },
];

test('Admin and Super Admin are never delegatable roles', () => {
  assert.ok(!DELEGATABLE_ROLES.includes('admin'));
  assert.ok(!DELEGATABLE_ROLES.includes('super_admin'));
});

test('allowedRoles: legacy admins keep every role; policy-managed admins only the delegated ones', () => {
  assert.deepEqual(allowedRoles({ policyManaged: false, delegation: null }, 'create'), DELEGATABLE_ROLES);
  assert.deepEqual(allowedRoles({ policyManaged: true, delegation: { createRoles: ['student'], assignRoles: [] } }, 'create'), ['student']);
  assert.deepEqual(allowedRoles({ policyManaged: true, delegation: { createRoles: ['student'], assignRoles: [] } }, 'assign'), []);
});

test('previewDelegation narrows module policies by the limits and flags unusable limits', () => {
  const none = previewDelegation(CREATOR, {});
  assert.ok(none.createRoles.includes('hod') && none.createRoles.includes('student'));
  const limited = previewDelegation(CREATOR, { createRoles: ['student', 'faculty'], assignRoles: ['student', 'club_admin'] });
  assert.deepEqual(limited.createRoles, ['student', 'faculty']);
  assert.deepEqual(limited.assignRoles, ['student', 'club_admin']);
  const onlyUm = previewDelegation([{ module: 'user_management', actions: ['create'] }], { createRoles: ['student', 'faculty'] });
  assert.deepEqual(onlyUm.createRoles, ['student']);
  assert.deepEqual(onlyUm.unused.createRoles, ['faculty'], 'faculty needs Staff Management → create');
  assert.deepEqual(previewDelegation([{ module: 'user_management', actions: ['edit'] }], {}).assignRoles, [], 'no roles action, no assignment');
});

test('previewDelegation caps what may be delegated to the intersection of own policies and the limit', () => {
  const own = [{ module: 'user_management', actions: ['policies', 'view'], scope: 'campus' }, { module: 'attendance', actions: ['export', 'view'], scope: 'campus' }];
  assert.deepEqual(previewDelegation(own, {}).grantablePolicies.map((p) => p.module), ['user_management', 'attendance']);
  const capped = previewDelegation(own, { grantablePolicies: [{ module: 'attendance', actions: ['view'], scope: 'department', department: 'CSE' }] });
  assert.deepEqual(capped.grantablePolicies, [{ module: 'attendance', actions: ['view'], scope: 'department', department: 'CSE' }]);
  assert.deepEqual(previewDelegation([{ module: 'attendance', actions: ['view'] }], {}).grantablePolicies, [], 'no policies action, nothing to delegate');
});

test('restrictCatalogue shows only delegatable modules, actions and scopes', () => {
  const catalogue = {
    attendance: { label: 'Attendance', scopes: ['campus'], actions: { view: 'v', export: 'e' } },
    user_management: { label: 'Users', scopes: ['campus', 'department'], actions: { view: 'v', create: 'c', policies: 'p' } },
    security_logs: { label: 'Security', scopes: ['campus'], actions: { view: 'v' } },
  };
  const out = restrictCatalogue(catalogue, [
    { module: 'attendance', actions: ['view'], scope: 'campus' },
    { module: 'user_management', actions: ['create', 'view'], scope: 'department', department: 'CSE' },
  ]);
  assert.deepEqual(Object.keys(out), ['attendance', 'user_management']);
  assert.deepEqual(Object.keys(out.attendance.actions), ['view']);
  assert.deepEqual(out.user_management.scopes, ['department']);
  assert.equal(out.user_management.department, 'CSE');
  assert.ok(!out.security_logs);
});

test('rolesSummary', () => {
  assert.equal(rolesSummary(null, {}), 'Not limited (module policies decide)');
  assert.equal(rolesSummary([], {}), 'None');
  assert.equal(rolesSummary(['student', 'faculty'], { student: 'Student', faculty: 'Faculty' }), 'Student, Faculty');
});

test('grantedPages: staff additional policies open only the matching admin pages', async () => {
  const { grantedPages, holdsGrant, STAFF_GRANT_ROLES } = await import('../src/utils/delegation.js');
  assert.deepEqual(grantedPages({ policyManaged: true, policies: [{ module: 'security_logs', actions: ['view'] }] }), [], 'admins use their own navigation');
  const hod = { staffGrants: true, policies: [{ module: 'user_management', actions: ['view', 'create'] }, { module: 'security_logs', actions: ['view'] }] };
  assert.deepEqual(grantedPages(hod).sort(), ['/admin/security', '/admin/users']);
  assert.equal(holdsGrant(hod, 'user_management', 'create'), true);
  assert.equal(holdsGrant(hod, 'user_management', 'suspend'), false);
  assert.ok(!STAFF_GRANT_ROLES.includes('admin') && !STAFF_GRANT_ROLES.includes('student'));
});

// ── User Creation → Policy Assignment ─────────────────────────────────
const STAFF_CAT = {
  user_management: { label: 'User Management', scopes: ['campus', 'department'], actions: { view: 'v', create: 'c', edit: 'e', suspend: 's', export: 'x' } },
  staff_management: { label: 'Staff Management', scopes: ['campus', 'department'], actions: { view: 'v' } },
  security_logs: { label: 'Security Logs', scopes: ['campus'], actions: { view: 'v' } },
  activity_logs: { label: 'Activity Logs', scopes: ['campus'], actions: { view: 'v' } },
};
const delegator = (staffScope = { scope: 'campus' }) => ({
  policyManaged: true,
  staffCatalogue: STAFF_CAT,
  policies: [{ module: 'staff_management', actions: ['create', 'edit', 'view'], ...staffScope }, { module: 'security_logs', actions: ['view'], scope: 'campus' }],
  delegation: { canAssignPolicies: true, grantablePolicies: [{ module: 'staff_management', actions: ['create', 'edit', 'view'], scope: 'campus' }, { module: 'security_logs', actions: ['view'], scope: 'campus' }] },
});

test('creationPolicyAccess: only staff roles can hold additional policies', async () => {
  const { creationPolicyAccess } = await import('../src/utils/delegation.js');
  for (const role of ['student', 'club_admin', 'alumni', 'warden', 'security', 'transport']) {
    const r = creationPolicyAccess('super_admin', { staffCatalogue: STAFF_CAT }, role, 'CSE');
    assert.equal(r.eligible, false, role);
    assert.equal(r.allowed, false, role);
  }
  assert.equal(creationPolicyAccess('super_admin', { staffCatalogue: STAFF_CAT }, 'hod', 'CSE').allowed, true);
});

test('creationPolicyAccess: Super Admin sees the whole staff catalogue; a delegating Admin only its cap', async () => {
  const { creationPolicyAccess } = await import('../src/utils/delegation.js');
  assert.deepEqual(Object.keys(creationPolicyAccess('super_admin', { staffCatalogue: STAFF_CAT }, 'faculty', 'CSE').catalogue), Object.keys(STAFF_CAT));
  const r = creationPolicyAccess('admin', delegator(), 'hod', 'CSE');
  assert.equal(r.allowed, true);
  assert.deepEqual(Object.keys(r.catalogue).sort(), ['security_logs', 'staff_management']);
  assert.deepEqual(Object.keys(r.catalogue.staff_management.actions), ['view'], 'only staff-grantable actions survive');
});

test('creationPolicyAccess: refused without User Management → policies, Staff Management → edit, or outside the department', async () => {
  const { creationPolicyAccess } = await import('../src/utils/delegation.js');
  const legacy = { policyManaged: false, staffCatalogue: STAFF_CAT, delegation: null };
  assert.equal(creationPolicyAccess('admin', legacy, 'hod', 'CSE').allowed, false);
  const noPolicies = { ...delegator(), delegation: { canAssignPolicies: false, grantablePolicies: [] } };
  assert.equal(creationPolicyAccess('admin', noPolicies, 'hod', 'CSE').allowed, false);
  const noEdit = { ...delegator(), policies: [{ module: 'security_logs', actions: ['view'], scope: 'campus' }] };
  assert.match(creationPolicyAccess('admin', noEdit, 'hod', 'CSE').reason, /Staff Management → edit/);
  const dept = delegator({ scope: 'department', department: 'CSE' });
  assert.equal(creationPolicyAccess('admin', dept, 'hod', 'CSE').allowed, true);
  assert.equal(creationPolicyAccess('admin', dept, 'hod', 'ECE').allowed, false);
  for (const role of ['faculty', 'hod', 'principal', 'dean', 'ao', 'chairman', 'office', 'coe', 'student']) {
    assert.equal(creationPolicyAccess(role, delegator(), 'hod', 'CSE').allowed, false, `${role} cannot assign policies`);
  }
});

test('policySummary lists module labels, actions and department scope', async () => {
  const { policySummary } = await import('../src/utils/delegation.js');
  assert.deepEqual(
    policySummary([{ module: 'security_logs', actions: ['view'], scope: 'campus' }, { module: 'user_management', actions: ['view', 'create'], scope: 'department', department: 'CSE' }], STAFF_CAT),
    ['Security Logs: view', 'User Management: create, view (CSE)']
  );
});

test('attendanceGrantOf reads a staff account\'s Attendance policy and its department', async () => {
  const { attendanceGrantOf } = await import('../src/utils/delegation.js');
  assert.equal(attendanceGrantOf(null), null);
  assert.equal(attendanceGrantOf({ staffGrants: false, policies: [{ module: 'attendance', actions: ['view'] }] }), null, 'only staff grants');
  assert.equal(attendanceGrantOf({ staffGrants: true, policies: [{ module: 'security_logs', actions: ['view'] }] }), null);
  assert.deepEqual(attendanceGrantOf({ staffGrants: true, policies: [{ module: 'attendance', actions: ['view'], scope: 'campus' }] }), { view: true, create: false, department: null });
  assert.deepEqual(
    attendanceGrantOf({ staffGrants: true, policies: [{ module: 'attendance', actions: ['create', 'view'], scope: 'department', department: 'ECE' }] }),
    { view: true, create: true, department: 'ECE' }
  );
});
