/**
 * Role-policy delegation helpers for the admin UIs. These mirror the server's
 * rules in server/src/policies.js (rolesFor / policyCap) only to decide what
 * to show and to preview a Super Admin's change before it is saved: the
 * server re-checks every request and is the only authority.
 */

// Account roles an Admin may ever create or assign (never Admin / Super Admin).
export const DELEGATABLE_ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'security', 'dean', 'ao', 'chairman', 'warden', 'alumni', 'coe', 'office', 'transport'];
const ORDINARY_ROLES = ['student', 'club_admin', 'alumni'];
const SCOPE_RANK = { department: 1, campus: 2 };

export const moduleForRole = (role) => (ORDINARY_ROLES.includes(role) ? 'user_management' : 'staff_management');
const holds = (policies, module, action) => (policies || []).some((p) => p.module === module && p.actions.includes(action));

/**
 * Roles the signed-in admin may `kind` ('create' | 'assign'), from the
 * /admin/my-policies response. A legacy admin (no delegation in the response)
 * and a Super Admin keep every delegatable role.
 */
export function allowedRoles(myPolicies, kind) {
  const d = myPolicies?.delegation;
  if (!d) return DELEGATABLE_ROLES;
  return (kind === 'create' ? d.createRoles : d.assignRoles) || [];
}

function intersectGrant(a, b) {
  const actions = a.actions.filter((x) => b.actions.includes(x));
  if (!actions.length) return null;
  if (a.scope === 'department' && b.scope === 'department' && a.department !== b.department) return null;
  const dept = a.scope === 'department' ? a : b.scope === 'department' ? b : null;
  return dept ? { module: a.module, actions, scope: 'department', department: dept.department } : { module: a.module, actions, scope: 'campus' };
}

/**
 * Preview what a policy-managed Admin will effectively be able to do with the
 * given module policies and delegation limits (each limit null = not limited).
 */
export function previewDelegation(policies, delegation = {}) {
  const limit = (key) => (Array.isArray(delegation?.[key]) ? delegation[key] : null);
  const byModule = (action) => DELEGATABLE_ROLES.filter((r) => holds(policies, moduleForRole(r), action));
  const narrow = (roles, key) => (limit(key) ? roles.filter((r) => limit(key).includes(r)) : roles);
  const createRoles = narrow(byModule('create'), 'createRoles');
  const assignRoles = narrow(holds(policies, 'user_management', 'roles') ? byModule('edit') : [], 'assignRoles');
  const canAssignPolicies = holds(policies, 'user_management', 'policies');
  const capLimit = limit('grantablePolicies');
  const own = (policies || []).map((p) => ({ module: p.module, actions: [...p.actions], scope: p.scope || 'campus', department: p.department }));
  const grantablePolicies = !canAssignPolicies ? [] : capLimit
    ? own.map((g) => {
      const l = capLimit.find((p) => p.module === g.module);
      return l ? intersectGrant(g, l) : null;
    }).filter(Boolean)
    : own;
  // Limits that name something the module policies do not allow: shown as a warning.
  const unused = {
    createRoles: (limit('createRoles') || []).filter((r) => !createRoles.includes(r)),
    assignRoles: (limit('assignRoles') || []).filter((r) => !assignRoles.includes(r)),
  };
  return { createRoles, assignRoles, canAssignPolicies, grantablePolicies, unused };
}

/**
 * Narrow the policy catalogue to what a delegating admin may hand out, so the
 * policy editor shows only those modules, actions and scopes.
 */
export function restrictCatalogue(catalogue, cap) {
  const out = {};
  for (const grant of cap || []) {
    const def = catalogue?.[grant.module];
    if (!def) continue;
    const actions = Object.fromEntries(Object.entries(def.actions).filter(([a]) => grant.actions.includes(a)));
    if (!Object.keys(actions).length) continue;
    const scopes = def.scopes.filter((s) => SCOPE_RANK[s] <= SCOPE_RANK[grant.scope]);
    out[grant.module] = { ...def, actions, scopes, ...(grant.scope === 'department' ? { department: grant.department } : {}) };
  }
  return out;
}

/** "Student, Faculty" style summary for a role list (null = not limited). */
export function rolesSummary(roles, labels, unlimited = 'Not limited (module policies decide)') {
  if (!Array.isArray(roles)) return unlimited;
  if (!roles.length) return 'None';
  return roles.map((r) => labels?.[r] || r).join(', ');
}

// Staff accounts that may receive additional policies (server: policies.js → STAFF_GRANT_ROLES).
export const STAFF_GRANT_ROLES = ['faculty', 'hod', 'principal', 'dean', 'ao', 'chairman', 'office', 'coe'];

const PAGE_MODULES = {
  '/admin/users': ['user_management', 'staff_management'],
  '/admin/security': ['security_logs'],
  '/admin/activity': ['activity_logs'],
};

/** Admin pages a staff account's additional policies open (from /admin/my-policies). */
export function grantedPages(myPolicies) {
  if (!myPolicies?.staffGrants) return [];
  const held = new Set((myPolicies.policies || []).filter((p) => p.actions.includes('view') || p.actions.length).map((p) => p.module));
  return Object.entries(PAGE_MODULES).filter(([, mods]) => mods.some((m) => held.has(m))).map(([page]) => page);
}

/** Does this staff account hold module.action as an additional policy? */
export const holdsGrant = (myPolicies, module, action) => Boolean(myPolicies?.policies?.some((p) => p.module === module && p.actions.includes(action)));

/**
 * User Creation → Policy Assignment: may the signed-in account add policies
 * to a new `role` account in `department`, and from which catalogue? Mirrors
 * the server (services/adminPolicies.js → validateCreationPolicies) only to
 * shape the form; the server re-checks every request.
 *
 * Returns { eligible, allowed, reason, catalogue }:
 *   eligible — this account type can hold additional policies at all,
 *   allowed  — the signed-in account may assign them here.
 */
export function creationPolicyAccess(meRole, myPolicies, role, department) {
  const eligible = STAFF_GRANT_ROLES.includes(role);
  const no = (reason) => ({ eligible, allowed: false, reason, catalogue: {} });
  if (!eligible) return no('This account type uses its role\'s access only. Additional policies can be added to staff accounts (Faculty, HOD, Principal, Dean, AO, Chairman, Office, COE).');
  const staff = myPolicies?.staffCatalogue;
  if (!staff) return no('Loading your permissions…');
  if (meRole === 'super_admin') return { eligible, allowed: true, reason: null, catalogue: staff };
  const d = myPolicies?.delegation;
  if (meRole !== 'admin' || !myPolicies?.policyManaged || !d?.canAssignPolicies) {
    return no('You are not authorized to assign policies. A Super Admin must grant you User Management → policies.');
  }
  const edit = (myPolicies.policies || []).find((p) => p.module === 'staff_management' && p.actions.includes('edit'));
  if (!edit || (edit.scope === 'department' && edit.department !== department)) {
    return no(edit ? `You can assign policies to staff in ${edit.department} only.` : 'You need Staff Management → edit to assign policies to staff accounts.');
  }
  const catalogue = restrictCatalogue(staff, d.grantablePolicies);
  if (!Object.keys(catalogue).length) return no('None of the permissions you may delegate can be given to staff accounts.');
  return { eligible, allowed: true, reason: null, catalogue };
}

/** "Security Logs: view · User Management: create, view (CSE)" style lines for a policy list. */
export function policySummary(policies, catalogue) {
  return (policies || []).map((p) => {
    const label = catalogue?.[p.module]?.label || p.module;
    return `${label}: ${[...p.actions].sort().join(', ')}${p.scope === 'department' ? ` (${p.department})` : ''}`;
  });
}

/**
 * A staff account's additional Attendance policy (from /admin/my-policies), as
 * { view, create, department } (department null = campus-wide), or null.
 * Only shapes the attendance screens; the server enforces the grant and its scope.
 */
export function attendanceGrantOf(myPolicies) {
  if (!myPolicies?.staffGrants) return null;
  const g = (myPolicies.policies || []).find((p) => p.module === 'attendance');
  if (!g?.actions?.length) return null;
  return { view: g.actions.includes('view'), create: g.actions.includes('create'), department: g.scope === 'department' ? g.department : null };
}
