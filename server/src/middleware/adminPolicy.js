import { ApiError } from '../utils/http.js';
import { grantFor, hasPolicy, isPolicyManaged, isStaffGrantee, staffHolds, withinRoleLimit } from '../policies.js';
import { logSecurity } from '../utils/securityLog.js';

/**
 * Module-policy enforcement for policy-managed Admin accounts (policies.js).
 *
 * Same shape as the confined-role guard: deny by default. A policy-managed
 * admin's request passes only when it matches a rule below AND the admin
 * holds at least one of the (module, action) pairs that rule names. Every
 * other role, and legacy (non-policy-managed) admins, pass straight through —
 * the route's own authorize() and the controllers still apply on top.
 *
 * The user's policies are read from the database on every request (protect
 * loads the user fresh), so a revoked policy stops working on the very next
 * request; nothing is cached.
 *
 * Rules are [path pattern, methods, requirement], where requirement is a list
 * of [module, action] alternatives or a function (req) → that list. An empty
 * list means "no policy needed" (account / baseline routes).
 */
const READ = ['GET'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ANY = [...READ, ...WRITE];
const NONE = [];
const DENY = [['__deny__', '__deny__']]; // a requirement nobody holds
const either = (action, ...modules) => modules.map((m) => [m, action]);
const anyOf = (pairs) => pairs;

const RULES = [
  // ── Baseline: own account, notifications, dashboard, effective permissions.
  [/^\/auth\//, ANY, NONE],
  [/^\/users\/me(\/avatar)?$/, ['PUT'], NONE],
  [/^\/notifications(\/|$)/, ANY, NONE],
  [/^\/devices$/, ['POST', 'DELETE'], NONE],
  [/^\/sos$/, ['POST'], NONE],
  [/^\/client-errors$/, ['POST'], NONE],
  [/^\/dashboard$/, READ, NONE],
  [/^\/admin\/analytics$/, READ, NONE],
  [/^\/admin\/my-policies$/, READ, NONE],
  [/^\/announcements$/, READ, NONE],
  [/^\/holidays$/, READ, NONE],

  // ── Staff attendance (matched before the general attendance rules).
  [/^\/attendance\/faculty\/mark$/, ['POST'], [['staff_attendance', 'record']]],
  [/^\/attendance\/(faculty\/|summary\/faculty$)/, READ, [['staff_attendance', 'view']]],
  [/^\/attendance\/staff-report$/, READ, [['staff_attendance', 'export']]],
  [/^\/staff(\/|$)/, READ, [['staff_attendance', 'view']]],
  [/^\/staff(\/|$)/, WRITE, [['staff_attendance', 'correct']]],

  // ── Attendance.
  [/^\/attendance\/reports\/options$/, READ, [['attendance', 'view']]],
  [/^\/attendance\/reports\//, READ, [['attendance', 'export']]],
  [/^\/attendance\/mark$/, ['POST'], [['attendance', 'create']]],
  [/^\/attendance\/(corrections|od-leave)(\/|$)/, WRITE, [['attendance', 'correct']]],
  [/^\/attendance(\/|$)/, WRITE, [['attendance', 'update']]],
  [/^\/attendance(\/|$)/, READ, [['attendance', 'view']]],

  // ── Timetable (periods and subjects).
  [/^\/(timetable|subjects)(\/|$)/, READ, [['timetable', 'view']]],
  [/^\/(timetable|subjects)(\/|$)/, ['POST'], [['timetable', 'create']]],
  [/^\/(timetable|subjects)(\/|$)/, ['PUT', 'PATCH'], [['timetable', 'edit']]],
  [/^\/(timetable|subjects)(\/|$)/, ['DELETE'], [['timetable', 'cancel']]],

  // ── Events. A club's event may be handled with Clubs → club events instead.
  [/^\/events(\/|$)/, READ, [['events', 'view']]],
  [/^\/events$/, ['POST'], (req) => (req.body?.club ? [['events', 'create'], ['clubs', 'events']] : [['events', 'create']])],
  [/^\/events\/[^/]+$/, ['PUT', 'PATCH'], (req) => (req.body?.club ? [['events', 'edit'], ['clubs', 'events']] : [['events', 'edit']])],
  [/^\/events\/[^/]+\/attendance\//, WRITE, [['events', 'edit']]],
  [/^\/events\/[^/]+$/, ['DELETE'], [['events', 'cancel']]],

  // ── Clubs (no delete action exists: removing a club stays with legacy admins).
  [/^\/clubs(\/|$)/, READ, [['clubs', 'view']]],
  [/^\/clubs$/, ['POST'], [['clubs', 'create']]],
  [/^\/clubs\/[^/]+(\/review)?$/, ['PUT', 'PATCH'], [['clubs', 'edit']]],
  [/^\/clubs\/[^/]+\/(members|requests)(\/|$)/, WRITE, [['clubs', 'members']]],

  // ── User & staff management. The controllers decide which of the two
  //    modules applies from the target account's role, and enforce scope.
  [/^\/admin\/users$/, READ, anyOf(either('view', 'user_management', 'staff_management'))],
  [/^\/admin\/users$/, ['POST'], anyOf(either('create', 'user_management', 'staff_management'))],
  [/^\/admin\/users\/[^/]+\/policies$/, ['GET', 'PUT'], [['user_management', 'policies']]],
  [/^\/admin\/users\/[^/]+$/, ['PATCH'], anyOf([...either('edit', 'user_management', 'staff_management'), ...either('suspend', 'user_management', 'staff_management'), ['user_management', 'roles']])],
  [/^\/users\/[^/]+\/reset-password$/, ['POST'], anyOf(either('edit', 'user_management', 'staff_management'))],
  [/^\/admin\/role-assignments\//, READ, [['staff_management', 'view']]],
  // Department-scoped staff managers may only assign within their department;
  // operations that carry no department (swap / unassign / demote) need campus scope.
  [/^\/admin\/role-assignments\//, ['POST'], (req) => {
    const g = grantFor(req.user, 'staff_management');
    if (g?.scope === 'department' && req.body?.department !== g.department) return DENY;
    // Appointing / demoting an HOD moves accounts between faculty and hod:
    // both must be inside the Admin's role-assignment delegation limit.
    if (/\/(set|demote)-hod$/.test(req.path) && !['faculty', 'hod'].every((r) => withinRoleLimit(req.user, 'assign', r))) return DENY;
    return [['staff_management', 'edit']];
  }],
  // Who this admin may assign policies to (only what it may delegate is shown).
  [/^\/admin\/policy-targets$/, READ, [['user_management', 'policies']]],
  [/^\/users\/export-pdf$/, READ, [['user_management', 'export']]],
  [/^\/users(\/people-filters|\/[^/]+)?$/, READ, anyOf(either('view', 'user_management', 'staff_management'))],

  // ── Logs.
  [/^\/admin\/security\//, READ, [['security_logs', 'view']]],
  [/^\/admin\/activity$/, READ, [['activity_logs', 'view']]],
];

const DENIED = 'Your administrator policies do not include this action';

/** The rule matching this request, with its requirement resolved (or null). */
function requirementFor(req) {
  const path = req.path.replace(/\/+$/, '') || '/';
  const rule = RULES.find(([re, methods]) => re.test(path) && methods.includes(req.method));
  if (!rule) return null;
  return typeof rule[2] === 'function' ? rule[2](req) : rule[2];
}

/**
 * Additional policies for staff accounts (policies.js → STAFF_GRANTABLE).
 * Marks the request as policy-authorized when it is an admin-module route
 * whose requirement this staff account holds; authorize() and the confined
 * role guard then accept it in place of the Admin role. Baseline routes (no
 * requirement) are never elevated, and nothing else about the role changes.
 * Grants are read from the database on every request (protect loads the user).
 */
export function staffGrantGuard(req, _res, next) {
  if (!isStaffGrantee(req.user) || !(req.user.policies || []).length) return next();
  const need = requirementFor(req);
  const path = req.path.replace(/\/+$/, '') || '/';
  if (need?.length && need.some(([m, a]) => staffHolds(req.user, m, a) && (m !== 'attendance' || elevatesAttendance(req.method, path)))) req.policyGrant = true;
  return next();
}

// Attendance grants are enforced inside the attendance controller, scope
// included (staffScope / assertCanMark / assertCanWrite). They elevate past
// the route's role list only where that controller checks the grant; every
// other attendance read already admits these roles and is scoped by
// staffScope, and admin-wide attendance screens (summaries, the low-attendance
// monitor, OD / leave queues) are never opened by a staff grant.
const ATTENDANCE_GRANT_ROUTES = [
  [/^\/attendance\/roster$/, 'GET'],
  [/^\/attendance\/mark$/, 'POST'],
];
const elevatesAttendance = (method, path) => ATTENDANCE_GRANT_ROUTES.some(([re, m]) => m === method && re.test(path));

export function adminPolicyGuard(req, _res, next) {
  if (!isPolicyManaged(req.user)) return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  const rule = RULES.find(([re, methods]) => re.test(path) && methods.includes(req.method));
  if (rule) {
    const need = typeof rule[2] === 'function' ? rule[2](req) : rule[2];
    if (!need.length || need.some(([m, a]) => hasPolicy(req.user, m, a))) return next();
  }
  logSecurity(req, 'POLICY_DENIED', {
    success: false,
    reason: rule ? 'policy_not_granted' : 'route_not_in_policy_catalogue',
    details: { method: req.method, path: path.slice(0, 120) },
  });
  return next(new ApiError(403, DENIED, undefined, { code: 'POLICY_DENIED' }));
}
