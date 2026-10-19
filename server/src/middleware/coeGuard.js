import { ApiError } from '../utils/http.js';
import { COE_ROLE, OFFICE_ROLE, SUPER_ADMIN_ROLE, TRANSPORT_ROLE } from '../constants.js';

/**
 * Confined roles. Many modules only check that a user is signed in, so
 * instead of adding a "not this role" clause to each of them this guard is
 * deny-by-default for the roles below: a request is let through only when it
 * matches one of that role's rules, whatever the route itself would allow.
 * Every other role passes straight through, unchanged.
 *
 * - COE: the Timetable dashboard only — Exam Timetable (manage), Class
 *   Timetable (read) and Attendance (read).
 * - Office: read-only attendance — students and faculty, history, summaries,
 *   reports, the low-attendance monitor and early-exit records.
 *
 * Rules are [path pattern, allowed methods] against the path below /api.
 */
const READ = ['GET'];
const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ACCOUNT = [
  // Own session and account: me, activity ping, sessions, password, push token.
  [/^\/auth\//, ANY],
  [/^\/users\/me(\/avatar)?$/, ['PUT']],
  [/^\/notifications(\/|$)/, ANY],
  [/^\/devices$/, ['POST', 'DELETE']],
  // Personal safety, not a dashboard: anyone signed in can raise an SOS.
  [/^\/sos$/, ['POST']],
  // Own effective permissions (additional policies, if any).
  [/^\/admin\/my-policies$/, READ],
  // Client error reports for the SOC (no data is read or changed).
  [/^\/client-errors$/, ['POST']],
];
const ALLOWED = {
  [COE_ROLE]: [
    ...ACCOUNT,
    [/^\/exams(\/|$)/, ANY],
    [/^\/timetable(\/|$)/, READ],
    [/^\/subjects$/, READ],
    [/^\/holidays$/, READ],
    [/^\/attendance(\/|$)/, READ],
    // Skill Wallet: NPTEL certificate verification only (examination staff).
    [/^\/skill-wallet\/(config|review\/me)$/, READ],
    [/^\/skill-wallet\/review\/certifications(\/[a-f0-9]{24})?$/, READ],
    [/^\/skill-wallet\/review\/certifications\/[a-f0-9]{24}\/decision$/, ['POST']],
  ],
  [OFFICE_ROLE]: [
    ...ACCOUNT,
    [/^\/attendance(\/|$)/, READ],
    [/^\/staff\/early-exits$/, READ],
  ],
  // Transport officer: the Bus Tracking module only (manage buses, routes,
  // stops, assignments; run trips).
  [TRANSPORT_ROLE]: [
    ...ACCOUNT,
    [/^\/transport(\/|$)/, ANY],
  ],
  // Super Admin: platform administration, account management for every role,
  // and READ-ONLY views of attendance, gate passes and the hostel. GET only
  // there, so it can never mark attendance or act on a gate pass. Chats are
  // read through /super-admin/chats (no send path exists for this role).
  [SUPER_ADMIN_ROLE]: [
    [/^\/auth\//, ANY],
    [/^\/users\/me(\/avatar)?$/, ['PUT']],
    [/^\/notifications(\/|$)/, ANY],
    [/^\/client-errors$/, ['POST']],
    [/^\/super-admin(\/|$)/, ANY],
    // User accounts (all ordinary and staff roles; Admin accounts via /super-admin/admins).
    [/^\/admin\/users(\/[^/]+)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
    // Additional policies for staff accounts (and own effective permissions).
    [/^\/admin\/users\/[^/]+\/policies$/, ['GET', 'PUT']],
    [/^\/admin\/my-policies$/, READ],
    [/^\/users\/[^/]+\/reset-password$/, ['POST']],
    [/^\/admin\/role-assignments\//, ANY],
    // Read-only campus views.
    [/^\/attendance(\/|$)/, READ],
    [/^\/staff\/early-exits$/, READ],
    [/^\/gate-pass(\/|$)/, READ],
    [/^\/hostel(\/|$)/, READ],
  ],
};
const MESSAGE = {
  [COE_ROLE]: 'The Controller of Examinations can only use the Timetable and Attendance dashboards',
  [OFFICE_ROLE]: 'The Office account can only view attendance and attendance reports',
  [TRANSPORT_ROLE]: 'The transport account can only use Bus Tracking',
  [SUPER_ADMIN_ROLE]: 'The Super Admin account can only use the Super Admin console',
};

export function confinedRoleGuard(req, _res, next) {
  const rules = ALLOWED[req.user?.role];
  if (!rules) return next();
  // An additional policy granted to this account (Office / COE) covers this admin route.
  if (req.policyGrant === true) return next();
  const path = req.path.replace(/\/+$/, '') || '/';
  const ok = rules.some(([re, methods]) => re.test(path) && methods.includes(req.method));
  return ok ? next() : next(new ApiError(403, MESSAGE[req.user.role]));
}

// Kept for existing imports.
export const coeRouteGuard = confinedRoleGuard;
