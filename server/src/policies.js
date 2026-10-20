import { ADMIN_ASSIGNABLE_ROLES, DEPARTMENTS } from './constants.js';
import { ADMIN_MODULES, ADMIN_MODULE_KEYS } from './constants/adminModules.js';

/**
 * Module policy catalogue for policy-managed Admin accounts.
 *
 * Each module lists its own actions; nothing implies anything else:
 *   - `view` never implies a write,
 *   - a write (create / edit / …) never implies export, cancel, policy
 *     administration or any other action,
 *   - there is no "delete" action anywhere: historical records and audit logs
 *     cannot be removed through a module policy.
 *
 * `scopes` are the data scopes the module actually enforces today. A scope is
 * only offered where the server filters by it (see controllers/adminController.js
 * for user / staff management); every other module is campus-wide only.
 *
 * middleware/adminPolicy.js maps every admin-reachable route to one
 * (module, action) pair and refuses anything not granted (deny by default).
 */
export const POLICY_CATALOGUE = {
  attendance: {
    label: 'Attendance',
    scopes: ['campus'],
    actions: {
      view: 'View student attendance, sessions, summaries and the low-attendance monitor',
      create: 'Mark attendance for a class period',
      update: 'Update attendance records and send absence notifications',
      correct: 'Review attendance correction and OD / leave requests',
      export: 'Download attendance reports',
    },
  },
  timetable: {
    label: 'Timetable',
    scopes: ['campus'],
    actions: {
      view: 'View class timetables, subjects and faculty availability',
      create: 'Add timetable periods and subjects',
      edit: 'Edit existing timetable periods and subjects',
      cancel: 'Remove timetable periods and subjects',
    },
  },
  staff_attendance: {
    label: 'Staff Attendance',
    scopes: ['campus'],
    actions: {
      view: 'View faculty attendance, early exits and period cover',
      record: 'Mark faculty attendance',
      correct: 'Decide early exits and arrange or cancel period cover',
      export: 'Download the staff attendance report',
    },
  },
  staff_management: {
    label: 'Staff Management',
    scopes: ['campus', 'department'],
    actions: {
      view: 'View staff accounts (faculty, HOD and other staff roles — never Admin accounts)',
      create: 'Create staff accounts',
      edit: 'Edit staff profile fields, class in-charge and HOD assignments, reset staff passwords',
      suspend: 'Suspend or reactivate staff accounts',
    },
  },
  events: {
    label: 'Events',
    scopes: ['campus'],
    actions: {
      view: 'View events and participant lists',
      create: 'Create events',
      edit: 'Edit events and record event attendance',
      cancel: 'Cancel (remove) events',
    },
  },
  clubs: {
    label: 'Clubs',
    scopes: ['campus'],
    actions: {
      view: 'View clubs and membership requests',
      create: 'Create clubs',
      edit: 'Edit club details and approve or reject clubs',
      members: 'Manage club memberships and member roles',
      events: 'Create and edit events that belong to a club',
    },
  },
  user_management: {
    label: 'User Management',
    scopes: ['campus', 'department'],
    actions: {
      view: 'View student and alumni accounts and their assigned roles',
      create: 'Create ordinary (student / alumni) accounts',
      edit: 'Edit permitted profile fields and reset passwords',
      suspend: 'Suspend or reactivate accounts',
      roles: 'Change an account between ordinary and staff roles (never Admin or Super Admin)',
      policies: 'Assign or revoke module policies of other Admins — only policies this Admin holds',
      export: 'Download the profiles PDF',
    },
  },
  security_logs: {
    label: 'Security Logs',
    scopes: ['campus'],
    actions: {
      view: 'View routine security events (never parent OTPs or protected Super Admin audit records)',
    },
  },
  activity_logs: {
    label: 'Activity Logs',
    scopes: ['campus'],
    actions: {
      view: 'View routine activity events',
    },
  },
};

// Dashboard modules (constants/adminModules.js) with no fine-grained entry
// above get a single `use` action: ticking the module's checkbox opens that
// whole dashboard (middleware/adminPolicy.js guards its API prefixes with it).
for (const m of ADMIN_MODULES) {
  for (const p of m.policies) {
    if (!POLICY_CATALOGUE[p]) {
      POLICY_CATALOGUE[p] = { label: m.label, scopes: ['campus'], actions: { use: `Open and use ${m.label} with an Admin's access` } };
    }
  }
}

export const POLICY_MODULES = Object.keys(POLICY_CATALOGUE);
const SCOPE_RANK = { department: 1, campus: 2 };

/**
 * Validate and normalise a requested policy list. Throws a plain Error with a
 * user-facing message on anything outside the catalogue; never trusts the
 * shape it was sent.
 */
export function normalizePolicies(input, catalogue = POLICY_CATALOGUE) {
  if (!Array.isArray(input)) throw new Error('Policies must be a list');
  if (input.length > POLICY_MODULES.length) throw new Error('Too many policies');
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid policy');
    const module = String(raw.module || '');
    const def = Object.hasOwn(catalogue, module) ? catalogue[module] : null;
    if (!def) throw new Error(`Unknown module "${module.slice(0, 40)}"`);
    if (seen.has(module)) throw new Error(`Module "${module}" listed twice`);
    seen.add(module);
    if (!Array.isArray(raw.actions)) throw new Error(`Actions for ${def.label} must be a list`);
    const actions = [...new Set(raw.actions.map(String))];
    for (const a of actions) if (!def.actions[a]) throw new Error(`Unknown action "${a.slice(0, 20)}" for ${def.label}`);
    if (!actions.length) continue; // an empty grant is simply no grant
    const scope = raw.scope === undefined ? 'campus' : String(raw.scope);
    if (!def.scopes.includes(scope)) throw new Error(`${def.label} does not support the "${scope.slice(0, 20)}" scope`);
    const policy = { module, actions: actions.sort(), scope };
    if (scope === 'department') {
      if (!DEPARTMENTS.includes(raw.department)) throw new Error(`Choose a valid department for ${def.label}`);
      policy.department = raw.department;
    }
    out.push(policy);
  }
  return out;
}

/**
 * Is this an Admin account whose access a Super Admin restricted with module
 * policies? Such an admin is deny-by-default (middleware/adminPolicy.js): it
 * may use only the modules, actions and department scopes in `policies` (an
 * empty list grants nothing). Admins without the flag are legacy,
 * unrestricted admins; Super Admin and staff roles are never policy-managed
 * (staff use additional grants, isStaffGrantee). The flag is written only by
 * the policy service (services/adminPolicies.js).
 */
export const isPolicyManaged = (user) => user?.role === 'admin' && user?.policyManaged === true;

/** The grant for one module, or null. */
export function grantFor(user, module) {
  return (user?.policies || []).find((p) => p.module === module) || null;
}

/** Does this policy-managed admin hold `module.action`? */
export function hasPolicy(user, module, action) {
  const g = grantFor(user, module);
  return Boolean(g && g.actions.includes(action));
}

// ── Dashboard modules (one checkbox each, constants/adminModules.js) ──────

/**
 * The dashboard module keys this account may see and use, read from its
 * current policies (no cache): every module for a legacy Admin, exactly the
 * modules holding at least one granted action for a policy-managed Admin
 * (none ticked = none). Null for every other role: their access comes from
 * their role, not from module checkboxes.
 */
export function adminModulesFor(user) {
  if (user?.role !== 'admin') return null;
  if (!isPolicyManaged(user)) return [...ADMIN_MODULE_KEYS];
  return ADMIN_MODULES.filter((m) => m.policies.some((p) => grantFor(user, p)?.actions?.length)).map((m) => m.key);
}

/**
 * The policy list for exactly the ticked module keys. A module that stays
 * ticked keeps the grants it already has (so fine-tuned actions and
 * department scopes survive a checkbox save); a newly ticked module gets
 * every action, campus-wide; an unticked module loses its grants. Throws an
 * Error with a user-facing message on unknown keys.
 */
export function modulesToPolicies(keys, previous = []) {
  if (!Array.isArray(keys)) throw new Error('Modules must be a list');
  const wanted = new Set(keys.map(String));
  const unknown = [...wanted].find((k) => !ADMIN_MODULE_KEYS.includes(k));
  if (unknown) throw new Error(`Unknown module "${unknown.slice(0, 40)}"`);
  const out = [];
  for (const m of ADMIN_MODULES) {
    if (!wanted.has(m.key)) continue;
    const kept = m.policies.map((p) => (previous || []).find((g) => g.module === p && g.actions?.length)).filter(Boolean);
    if (kept.length) {
      out.push(...kept.map((g) => ({ module: g.module, actions: [...g.actions], scope: g.scope || 'campus', ...(g.department ? { department: g.department } : {}) })));
      continue;
    }
    out.push(...m.policies.map((p) => ({ module: p, actions: Object.keys(POLICY_CATALOGUE[p].actions), scope: 'campus' })));
  }
  return normalizePolicies(out);
}

// ── Additional policies for individual staff accounts ─────────────────
//
// A Super Admin (or an Admin holding user_management.policies, within its own
// limits) may give one faculty / HOD / principal / dean / AO / chairman /
// office / COE account extra access on top of its role. These grants only ADD
// access to admin modules; the account keeps everything its role allows.
//
// Only modules whose admin routes behave the same for any caller are offered,
// and never a delegating action (create staff, change roles, assign policies):
// a staff grant can never be used to escalate further.
export const STAFF_GRANT_ROLES = ['faculty', 'hod', 'principal', 'dean', 'ao', 'chairman', 'office', 'coe'];
export const STAFF_GRANTABLE = {
  // Attendance: enforced inside controllers/attendanceController.js
  // (staffScope / assertCanMark / assertCanWrite), on top of the role's own scope.
  attendance: ['view', 'create'],
  user_management: ['view', 'create', 'edit', 'suspend', 'export'],
  staff_management: ['view'],
  security_logs: ['view'],
  activity_logs: ['view'],
};
// Where a staff grant means something different from the Admin policy of the
// same name: its own wording and, for attendance, a department scope (the
// attendance controller filters a staff grant by department; Admin attendance
// policies stay campus-wide).
const STAFF_OVERRIDES = {
  attendance: {
    scopes: ['campus', 'department'],
    actions: {
      view: 'View attendance of every class in scope: sessions, students, subjects, sections and low attendance (adds to what the role already sees)',
      create: 'Mark and edit (re-mark) attendance for any class in scope, for today or an earlier date. Needs view.',
    },
  },
};
export const isStaffGrantee = (user) => STAFF_GRANT_ROLES.includes(user?.role);

/** Does this staff account hold `module.action` as an additional policy? */
export function staffHolds(user, module, action) {
  return isStaffGrantee(user) && Boolean(STAFF_GRANTABLE[module]?.includes(action)) && hasPolicy(user, module, action);
}

/** The policy catalogue narrowed to what may be granted to staff accounts. */
export function staffCatalogue() {
  const out = {};
  for (const [module, actions] of Object.entries(STAFF_GRANTABLE)) {
    const def = POLICY_CATALOGUE[module];
    const o = STAFF_OVERRIDES[module];
    out[module] = { ...def, scopes: o?.scopes || def.scopes, actions: Object.fromEntries(actions.map((a) => [a, o?.actions?.[a] || def.actions[a]])) };
  }
  return out;
}

// The full catalogue with the staff scope overrides: validates staff input so
// that an admin-only action still gets its explicit "Admin accounts only" error.
const STAFF_VALIDATION_CATALOGUE = Object.fromEntries(
  Object.entries(POLICY_CATALOGUE).map(([m, def]) => [m, { ...def, scopes: STAFF_OVERRIDES[m]?.scopes || def.scopes }])
);

/** Validate additional policies for a staff account (catalogue + staff subset). */
export function normalizeStaffPolicies(input) {
  const list = normalizePolicies(input, STAFF_VALIDATION_CATALOGUE);
  for (const p of list) {
    const allowed = STAFF_GRANTABLE[p.module];
    const label = POLICY_CATALOGUE[p.module].label;
    if (!allowed) throw new Error(`${label} can be granted to Admin accounts only`);
    const bad = p.actions.find((a) => !allowed.includes(a));
    if (bad) throw new Error(`${label} → ${bad} can be granted to Admin accounts only`);
    // The profiles PDF is campus-wide: it cannot be limited to one department.
    if (p.actions.includes('export') && p.scope !== 'campus') throw new Error(`${label} → export needs campus-wide scope`);
    // Marking needs the roster, which is a read: grant both explicitly (nothing implies view).
    if (p.module === 'attendance' && p.actions.includes('create') && !p.actions.includes('view')) throw new Error('Attendance → create also needs Attendance → view');
  }
  return list;
}

/**
 * A staff account's additional attendance grant for `action`, as the extra
 * records it opens: {} campus-wide, { department } for one department, or
 * null when the account holds no such grant.
 */
export function staffAttendanceGrant(user, action) {
  if (!staffHolds(user, 'attendance', action)) return null;
  const g = grantFor(user, 'attendance');
  return g.scope === 'department' ? { department: g.department } : {};
}

/** Does such a grant cover a record in `department`? */
export const grantCovers = (grant, department) => Boolean(grant) && (!grant.department || grant.department === department);

// Accounts handled by User Management; every other non-admin role is staff.
export const ORDINARY_ROLES = ['student', 'club_admin', 'alumni'];

/** Which module governs accounts of this role (null: Admin / Super Admin — Super Admin only). */
export function moduleForRole(role) {
  if (role === 'admin' || role === 'super_admin') return null;
  return ORDINARY_ROLES.includes(role) ? 'user_management' : 'staff_management';
}

/**
 * May this admin perform `module.action` on a record in `department`?
 * Legacy (non-policy-managed) admins keep their existing unrestricted access.
 */
export function adminAllows(user, module, action, department) {
  // The Super Admin manages accounts of every ordinary and staff role.
  if (user?.role === 'super_admin') return Boolean(module);
  if (isStaffGrantee(user)) {
    if (!staffHolds(user, module, action)) return false;
    const sg = grantFor(user, module);
    return sg.scope === 'campus' || (Boolean(department) && department === sg.department);
  }
  if (user?.role !== 'admin') return false;
  if (!isPolicyManaged(user)) return true;
  const g = grantFor(user, module);
  if (!g || !g.actions.includes(action)) return false;
  return g.scope === 'campus' || (Boolean(department) && department === g.department);
}

/**
 * Mongo filter limiting a user list to what this admin may `action` (view…):
 * the roles of the modules it holds, each within that module's scope.
 * Legacy admins: everything but Super Admin accounts.
 */
export function userListScope(user, action = 'view') {
  const staff = isStaffGrantee(user);
  if (!staff && !isPolicyManaged(user)) return { role: { $ne: 'super_admin' } };
  const parts = [];
  for (const module of ['user_management', 'staff_management']) {
    const g = grantFor(user, module);
    if (!g || !g.actions.includes(action) || (staff && !staffHolds(user, module, action))) continue;
    const roleClause = module === 'user_management' ? { $in: ORDINARY_ROLES } : { $nin: [...ORDINARY_ROLES, 'admin', 'super_admin'] };
    parts.push(g.scope === 'department' ? { role: roleClause, department: g.department } : { role: roleClause });
  }
  return parts.length ? { $or: parts } : { _id: null };
}

/**
 * Can `actor` change a target's policies from `previous` to `requested`?
 * A Super Admin may grant or revoke anything in the catalogue. A
 * policy-managed admin with user_management.policies may only touch modules
 * and actions it holds itself — granting or revoking — at a scope no wider
 * than its own (and inside its own department when department-scoped).
 * Returns a reason or null.
 */
export function exceedsAuthority(actor, previous, requested, target) {
  if (actor.role === 'super_admin') return null;
  if (!isPolicyManaged(actor) || !hasPolicy(actor, 'user_management', 'policies')) return 'You cannot assign policies';
  const cap = policyCap(actor);
  const byModule = (list) => Object.fromEntries((list || []).map((p) => [p.module, p]));
  const before = byModule(previous);
  const after = byModule(requested);
  for (const module of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const label = POLICY_CATALOGUE[module]?.label || module;
    const was = before[module];
    const now = after[module];
    const same = was && now && was.scope === now.scope && (was.department || null) === (now.department || null)
      && String([...was.actions].sort()) === String([...now.actions].sort());
    if (same) continue;
    const own = cap.find((p) => p.module === module);
    if (!own) return `You cannot delegate ${label} permissions`;
    const touched = new Set([...(was?.actions || []), ...(now?.actions || [])]);
    const extra = [...touched].find((a) => !own.actions.includes(a));
    if (extra) return `You cannot delegate ${label} → ${extra}`;
    for (const p of [was, now].filter(Boolean)) {
      if (SCOPE_RANK[p.scope] > SCOPE_RANK[own.scope]) return `${label}: scope is wider than your own`;
      if (own.scope === 'department' && p.department !== own.department) return `${label}: outside your department`;
    }
    // Handing out a delegating power (create accounts, change roles, assign
    // policies) needs the target's own limit for it to be set by a Super Admin
    // and to sit inside the actor's: otherwise an unlimited target would end up
    // with more than the actor could ever grant (escalation through a chain).
    const added = (now?.actions || []).filter((a) => !(was?.actions || []).includes(a));
    const reason = delegatingGrantProblem(actor, target, module, added);
    if (reason) return reason;
  }
  return null;
}

// ── Delegation limits (set by a Super Admin on a policy-managed Admin) ────
//
// `user.delegation` narrows, never widens, what the module policies already
// allow. Each field is either unset (null / missing: no extra limit, the
// module policies decide, exactly as before delegation existed) or a list:
//
//   createRoles        roles this Admin may create accounts for
//   assignRoles        roles this Admin may move existing accounts between
//   grantablePolicies  the most this Admin may hand to other Admins through
//                      user_management.policies (also capped by its own policies)
//
// Admin and Super Admin are never in any list: ADMIN_ASSIGNABLE_ROLES excludes
// them and every check below starts from it.

export const DELEGATABLE_ROLES = ADMIN_ASSIGNABLE_ROLES;
const isSet = (v) => Array.isArray(v);
const limitOf = (user, key) => (isSet(user?.delegation?.[key]) ? user.delegation[key] : null);

/** Validate a Super Admin's delegation input. Throws Error with a user-facing message. */
export function normalizeDelegation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Delegation must be an object');
  const allowed = ['createRoles', 'assignRoles', 'grantablePolicies'];
  const unknown = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new Error(`Unknown delegation field "${String(unknown[0]).slice(0, 40)}"`);
  const roles = (key, label) => {
    const v = input[key];
    if (v === null || v === undefined) return null;
    if (!Array.isArray(v)) throw new Error(`${label} must be a list or null`);
    if (v.length > DELEGATABLE_ROLES.length) throw new Error(`Too many roles in ${label}`);
    const out = [...new Set(v.map(String))];
    const bad = out.find((r) => !DELEGATABLE_ROLES.includes(r));
    if (bad) throw new Error(`"${bad.slice(0, 30)}" cannot be delegated`);
    return out.sort();
  };
  return {
    createRoles: roles('createRoles', 'Roles to create'),
    assignRoles: roles('assignRoles', 'Roles to assign'),
    grantablePolicies: input.grantablePolicies === null || input.grantablePolicies === undefined ? null : normalizePolicies(input.grantablePolicies),
  };
}

/** The intersection of two grants for the same module, or null when nothing is left. */
function intersectGrant(a, b) {
  const actions = a.actions.filter((x) => b.actions.includes(x));
  if (!actions.length) return null;
  if (a.scope === 'department' && b.scope === 'department' && a.department !== b.department) return null;
  const dept = a.scope === 'department' ? a : b.scope === 'department' ? b : null;
  return dept ? { module: a.module, actions, scope: 'department', department: dept.department } : { module: a.module, actions, scope: 'campus' };
}

/** The most this admin may hand to other Admins: its own policies, capped by grantablePolicies. */
export function policyCap(user) {
  if (user?.role === 'super_admin') return normalizePolicies(POLICY_MODULES.map((module) => ({ module, actions: Object.keys(POLICY_CATALOGUE[module].actions) })));
  if (!isPolicyManaged(user)) return [];
  const own = (user.policies || []).map((p) => ({ module: p.module, actions: [...p.actions], scope: p.scope || 'campus', department: p.department }));
  const limit = limitOf(user, 'grantablePolicies');
  if (!limit) return own;
  return own.map((g) => {
    const l = limit.find((p) => p.module === g.module);
    return l ? intersectGrant(g, l) : null;
  }).filter(Boolean);
}

/** Roles whose accounts the admin's module policies allow `action` on (department ignored). */
function moduleRoles(user, action) {
  return DELEGATABLE_ROLES.filter((r) => hasPolicy(user, moduleForRole(r), action));
}

/**
 * Roles this admin may create accounts for, or assign. Super Admin: every
 * delegatable role. Legacy admins: unchanged (every delegatable role). Policy-managed:
 * the module policies, narrowed by the delegation limit when one is set.
 */
export function rolesFor(user, kind) {
  if (user?.role === 'super_admin') return [...DELEGATABLE_ROLES];
  // Staff with additional policies: account creation only (never role changes).
  if (isStaffGrantee(user)) return kind === 'create' ? DELEGATABLE_ROLES.filter((r) => staffHolds(user, moduleForRole(r), 'create')) : [];
  if (user?.role !== 'admin') return [];
  if (!isPolicyManaged(user)) return [...DELEGATABLE_ROLES];
  let roles;
  if (kind === 'create') roles = moduleRoles(user, 'create');
  else if (kind === 'assign') roles = hasPolicy(user, 'user_management', 'roles') ? moduleRoles(user, 'edit') : [];
  else return [];
  const limit = limitOf(user, kind === 'create' ? 'createRoles' : 'assignRoles');
  return limit ? roles.filter((r) => limit.includes(r)) : roles;
}

/** Is `role` inside this admin's delegation limit for `kind`? (Module policies are checked separately.) */
export function withinRoleLimit(user, kind, role) {
  if (!isPolicyManaged(user)) return true;
  const limit = limitOf(user, kind === 'create' ? 'createRoles' : 'assignRoles');
  return !limit || limit.includes(role);
}

/** Everything the UI needs to show an admin what it may create, assign and delegate. */
export function effectiveDelegation(user) {
  if (isStaffGrantee(user)) {
    return { createRoles: rolesFor(user, 'create'), assignRoles: [], canAssignPolicies: false, grantablePolicies: [], limits: { createRoles: null, assignRoles: null, grantablePolicies: null } };
  }
  if (user?.role !== 'admin' && user?.role !== 'super_admin') return null;
  const managed = isPolicyManaged(user);
  return {
    createRoles: rolesFor(user, 'create'),
    assignRoles: rolesFor(user, 'assign'),
    canAssignPolicies: user.role === 'super_admin' || (managed && hasPolicy(user, 'user_management', 'policies')),
    grantablePolicies: managed || user.role === 'super_admin' ? policyCap(user) : [],
    limits: {
      createRoles: limitOf(user, 'createRoles'),
      assignRoles: limitOf(user, 'assignRoles'),
      grantablePolicies: limitOf(user, 'grantablePolicies'),
    },
  };
}

const DELEGATING = {
  user_management: { create: 'create', roles: 'assign', policies: 'policies' },
  staff_management: { create: 'create' },
};

/** Is `inner` (a policy list) entirely inside `outer` (a cap)? */
function policiesWithin(inner, outer) {
  return inner.every((p) => {
    const o = outer.find((x) => x.module === p.module);
    if (!o || p.actions.some((a) => !o.actions.includes(a))) return false;
    if (SCOPE_RANK[p.scope] > SCOPE_RANK[o.scope]) return false;
    return o.scope !== 'department' || p.department === o.department;
  });
}

function delegatingGrantProblem(actor, target, module, added) {
  const label = POLICY_CATALOGUE[module]?.label || module;
  for (const action of added) {
    const kind = DELEGATING[module]?.[action];
    if (!kind) continue;
    // Staff accounts carry no delegation limit: account creation (the only
    // delegating action they can hold) covers every ordinary role, so the
    // granting Admin must be able to create all of them itself.
    if (isStaffGrantee(target)) {
      const mine = rolesFor(actor, 'create');
      const missing = ORDINARY_ROLES.find((r) => !mine.includes(r));
      if (kind !== 'create' || missing) return `${label} → ${action}: you cannot delegate this to a staff account`;
      continue;
    }
    if (kind === 'policies') {
      const limit = limitOf(target, 'grantablePolicies');
      if (!limit) return `${label} → policies: a Super Admin must first set this Admin's delegation limit`;
      if (!policiesWithin(limit, policyCap(actor))) return `${label} → policies: this Admin's delegation limit is wider than yours`;
      continue;
    }
    const key = kind === 'create' ? 'createRoles' : 'assignRoles';
    const limit = limitOf(target, key);
    if (!limit) return `${label} → ${action}: a Super Admin must first set which roles this Admin may ${kind}`;
    const mine = rolesFor(actor, kind);
    const outside = limit.find((r) => !mine.includes(r));
    if (outside) return `${label} → ${action}: this Admin may ${kind} "${outside}", which you cannot`;
  }
  return null;
}
