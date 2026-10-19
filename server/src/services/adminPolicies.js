import User from '../models/User.js';
import { ApiError } from '../utils/http.js';
import { logSecurity } from '../utils/securityLog.js';
import { logAudit } from '../utils/auditLog.js';
import { notifyUsers } from '../utils/notify.js';
import {
  POLICY_CATALOGUE,
  adminAllows,
  exceedsAuthority,
  hasPolicy,
  isPolicyManaged,
  isStaffGrantee,
  normalizeDelegation,
  normalizePolicies,
  normalizeStaffPolicies,
  policyCap,
  staffCatalogue,
} from '../policies.js';

const asPlain = (list) => (list || []).map((p) => (p.toObject ? p.toObject() : p));

/**
 * For a delegated (non Super Admin) save that only shows the actor what it may
 * delegate: keep everything the actor cannot see exactly as it was. Modules
 * outside the actor's cap and actions outside it are carried over from the
 * target's current policies; nothing is ever added by the merge, and the result
 * still goes through exceedsAuthority.
 */
function keepUnmanaged(actor, previous, requested) {
  const cap = policyCap(actor);
  const byModule = Object.fromEntries(requested.map((p) => [p.module, p]));
  const out = [];
  const modules = new Set([...previous.map((p) => p.module), ...requested.map((p) => p.module)]);
  for (const module of modules) {
    const was = previous.find((p) => p.module === module);
    const now = byModule[module];
    const own = cap.find((p) => p.module === module);
    if (!own) {
      if (now) out.push(now); // an explicit change: exceedsAuthority judges it
      else if (was) out.push(was);
      continue;
    }
    const hidden = (was?.actions || []).filter((a) => !own.actions.includes(a));
    const actions = [...new Set([...hidden, ...(now?.actions || [])])].sort();
    if (!actions.length) continue;
    const base = now || was;
    out.push({ module, actions, scope: base.scope, ...(base.scope === 'department' ? { department: base.department } : {}) });
  }
  return out;
}

/**
 * The one writer of Admin module policies. Used by the Super Admin
 * (any catalogue policy) and by a policy-managed admin holding
 * user_management.policies (only within its own authority and delegation limit).
 *
 * - The target must be an ordinary Admin account; never yourself, never a
 *   Super Admin. A delegated actor may only change policy-managed Admins:
 *   restricting a legacy (unrestricted) Admin is a Super Admin decision.
 * - Input is validated against the catalogue; unknown modules, actions or
 *   scopes are rejected, never silently dropped.
 * - Saving marks the target policy-managed: from then on it is deny-by-default.
 * - Takes effect on the target's next request (policies are read from the
 *   database on every request); no cache to invalidate.
 */
export async function applyPolicies(req, targetId, rawPolicies, { merge = false } = {}) {
  const actor = req.user;
  if (String(targetId) === String(actor._id)) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', target: actor, reason: 'self_policy_change' });
    logSecurity(req, 'POLICY_DENIED', { success: false, target: actor, reason: 'self_policy_change' });
    throw new ApiError(403, 'You cannot change your own policies');
  }

  const target = await User.findById(targetId).select('role department policies policyManaged delegation isActive name email');
  const staffTarget = isStaffGrantee(target);
  if (!target || (target.role !== 'admin' && !staffTarget)) throw new ApiError(404, 'This account cannot hold policies');

  let policies;
  try {
    policies = staffTarget ? normalizeStaffPolicies(rawPolicies) : normalizePolicies(rawPolicies);
  } catch (err) {
    throw new ApiError(422, err.message);
  }

  const previous = asPlain(target.policies);
  const delegated = actor.role !== 'super_admin';
  // A staff account is changed only by an Admin that manages staff accounts in its department.
  if (delegated && staffTarget && !adminAllows(actor, 'staff_management', 'edit', target.department)) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', target, reason: 'staff_target_outside_scope' });
    throw new ApiError(403, 'You need Staff Management → edit for this account to change its policies', undefined, { code: 'DELEGATION_EXCEEDED' });
  }
  if (delegated && !staffTarget && isPolicyManaged(actor) && !target.policyManaged) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', target, reason: 'legacy_admin_target' });
    throw new ApiError(403, 'Only a Super Admin can restrict a legacy (unrestricted) Admin');
  }
  if (delegated && merge) policies = keepUnmanaged(actor, previous, policies);

  const tooMuch = exceedsAuthority(actor, previous, policies, target);
  if (tooMuch) {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', target, reason: tooMuch, details: { requested: policies } });
    logSecurity(req, 'POLICY_DENIED', { success: false, target, reason: 'exceeds_actor_authority' });
    throw new ApiError(403, tooMuch, undefined, { code: 'DELEGATION_EXCEEDED' });
  }

  // Conditional write: the target must still be an admin, and its delegation
  // limit (checked above for delegating grants) must not have changed meanwhile.
  // Staff accounts keep their role-based access: their policies are only
  // additions, so they are never marked policy-managed.
  const updated = await User.findOneAndUpdate(
    staffTarget ? { _id: target._id, role: target.role } : { _id: target._id, role: 'admin', 'delegation.updatedAt': target.delegation?.updatedAt ?? null },
    { $set: staffTarget ? { policies } : { policies, policyManaged: true } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'The account changed while saving. Reload and try again.');

  const details = { previous, new: policies, targetRole: target.role, ...(staffTarget ? { additional: true } : { wasPolicyManaged: Boolean(target.policyManaged) }) };
  await logAudit(req, 'POLICIES_CHANGED', { target: updated, details });
  // Delegated changes are also visible in the routine Security & Logs view.
  if (delegated) logSecurity(req, 'POLICIES_CHANGED', { target: updated, entityType: 'user', entityId: updated._id, details });
  notifyUsers([updated._id], {
    type: 'system',
    title: staffTarget ? 'Your additional permissions changed' : 'Your administrator permissions changed',
    message: staffTarget
      ? 'Extra access added to your role was updated. Some pages may now be available or no longer available.'
      : 'Your module policies were updated. Some pages may now be unavailable or newly available.',
  }, { push: false });
  return updated;
}

export const POLICY_MODES = ['none', 'custom'];

/**
 * Policy Assignment at user creation (POST /admin/users). Returns the
 * additional policies to store on the new account: [] for "No Additional
 * Policies" (the role's own access applies, nothing is written), or the
 * validated grants for "Add Policies". Runs every check applyPolicies runs
 * for an existing staff account — before anything is created, so a refused
 * policy never leaves a half-configured account behind.
 *
 * - Only staff roles that can hold additional policies (STAFF_GRANT_ROLES).
 * - Super Admin: anything in the staff catalogue. Admin: only a
 *   policy-managed Admin holding User Management → policies and Staff
 *   Management → edit for the new account's department, and only what it may
 *   delegate (exceedsAuthority). Everyone else is refused, whatever the UI showed.
 */
export function validateCreationPolicies(req, { role, department, policyMode, policies: raw }) {
  const mode = policyMode ?? 'none';
  const requested = Array.isArray(raw) ? raw : [];
  if (mode === 'none') {
    // Never silently drop policies sent with "No Additional Policies".
    if (requested.length) throw new ApiError(422, 'Choose "Add Policies" to assign additional permissions', [{ field: 'policies', message: 'Policies were sent with "No Additional Policies"' }]);
    return [];
  }
  const actor = req.user;
  const deny = (reason, message, code = 'DELEGATION_EXCEEDED') => {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', reason, details: { targetRole: role, via: 'user_create', requested } });
    logSecurity(req, 'POLICY_DENIED', { success: false, reason, details: { targetRole: role, via: 'user_create' } });
    throw new ApiError(403, message, undefined, { code });
  };
  if (!isStaffGrantee({ role })) throw new ApiError(422, 'This account type cannot hold additional policies; it uses its role\'s access', [{ field: 'policyMode', message: 'Not available for this role' }]);

  let policies;
  try {
    policies = normalizeStaffPolicies(requested);
  } catch (err) {
    throw new ApiError(422, err.message, [{ field: 'policies', message: err.message }]);
  }
  if (!policies.length) throw new ApiError(422, 'Choose at least one permission, or select "No Additional Policies"', [{ field: 'policies', message: 'No permissions selected' }]);

  if (actor.role !== 'super_admin') {
    if (!isPolicyManaged(actor) || !hasPolicy(actor, 'user_management', 'policies')) deny('create_policies_not_authorized', 'You are not authorized to assign policies. A Super Admin must grant you User Management → policies.');
    if (!adminAllows(actor, 'staff_management', 'edit', department)) deny('staff_target_outside_scope', 'You need Staff Management → edit for this department to assign policies to this account');
  }
  const tooMuch = exceedsAuthority(actor, [], policies, { role, department });
  if (tooMuch) deny('exceeds_actor_authority', tooMuch);
  return policies;
}

/** Record the policies a new account was created with (protected audit; routine log when delegated). */
export async function auditCreationPolicies(req, user, policies) {
  const details = { previous: [], new: policies, targetRole: user.role, additional: true, via: 'user_create' };
  await logAudit(req, 'POLICIES_CHANGED', { target: user, details });
  if (req.user.role !== 'super_admin') logSecurity(req, 'POLICIES_CHANGED', { target: user, entityType: 'user', entityId: user._id, details });
}

/**
 * One account's policies as far as `actor` may see and change them: the base
 * catalogue for that kind of account, the actor's cap (null = everything, for a
 * Super Admin), the visible grants and how many are hidden.
 */
export async function policyView(actor, targetId) {
  const target = await User.findById(targetId).select('name email role department policies policyManaged').lean();
  const staffTarget = isStaffGrantee(target);
  if (!target || (target.role !== 'admin' && !staffTarget)) throw new ApiError(404, 'This account cannot hold policies');
  if (String(target._id) === String(actor._id)) throw new ApiError(403, 'You cannot change your own policies');
  const base = staffTarget ? staffCatalogue() : POLICY_CATALOGUE;
  let cap = null;
  if (actor.role !== 'super_admin') {
    if (!isPolicyManaged(actor) || !hasPolicy(actor, 'user_management', 'policies')) throw new ApiError(403, 'Assigning policies needs a Super Admin to grant you User Management → policies');
    if (staffTarget && !adminAllows(actor, 'staff_management', 'edit', target.department)) throw new ApiError(403, 'You need Staff Management → edit for this account to change its policies');
    if (!staffTarget && !target.policyManaged) throw new ApiError(403, 'Only a Super Admin can restrict a legacy (unrestricted) Admin');
    cap = policyCap(actor)
      .filter((p) => base[p.module])
      .map((p) => ({ ...p, actions: p.actions.filter((a) => base[p.module].actions[a]) }))
      .filter((p) => p.actions.length);
  }
  let hidden = 0;
  const visible = [];
  for (const p of target.policies || []) {
    const own = cap ? cap.find((c) => c.module === p.module) : { actions: p.actions };
    const shown = own ? p.actions.filter((a) => own.actions.includes(a)) : [];
    hidden += p.actions.length - shown.length;
    if (shown.length) visible.push({ module: p.module, actions: shown, scope: p.scope, ...(p.scope === 'department' ? { department: p.department } : {}) });
  }
  return {
    target: { _id: target._id, name: target.name, email: target.email, role: target.role, department: target.department },
    kind: staffTarget ? 'staff' : 'admin',
    catalogue: base,
    cap,
    policies: visible,
    hiddenActions: hidden,
  };
}

const plainDelegation = (d) => {
  const src = d?.toObject ? d.toObject() : d || {};
  return {
    createRoles: Array.isArray(src.createRoles) ? src.createRoles : null,
    assignRoles: Array.isArray(src.assignRoles) ? src.assignRoles : null,
    grantablePolicies: Array.isArray(src.grantablePolicies) ? asPlain(src.grantablePolicies) : null,
  };
};

/**
 * Super Admin only: set an Admin's delegation limits (which roles it may
 * create / assign, and the most it may delegate to other Admins). The target
 * must already be policy-managed: a legacy Admin is unrestricted, so a limit
 * on it would mean nothing.
 */
export async function applyDelegation(req, targetId, rawDelegation) {
  const actor = req.user;
  if (actor.role !== 'super_admin') {
    logAudit(req, 'PRIVILEGE_ESCALATION_BLOCKED', { outcome: 'denied', reason: 'delegation_not_super_admin', details: { target: String(targetId) } });
    throw new ApiError(403, 'Only a Super Admin can change delegation limits');
  }
  const target = await User.findById(targetId).select('role policyManaged delegation name email');
  if (!target || target.role !== 'admin') throw new ApiError(404, 'Admin account not found');
  if (!target.policyManaged) throw new ApiError(422, 'Save module policies for this Admin first: a legacy Admin is unrestricted');

  let delegation;
  try {
    delegation = normalizeDelegation(rawDelegation);
  } catch (err) {
    throw new ApiError(422, err.message);
  }
  const previous = plainDelegation(target.delegation);
  const updated = await User.findOneAndUpdate(
    { _id: target._id, role: 'admin', policyManaged: true },
    { $set: { delegation: { ...delegation, updatedAt: new Date(), updatedBy: actor._id } } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'The account changed while saving. Reload and try again.');

  await logAudit(req, 'DELEGATION_CHANGED', { target: updated, details: { previous, new: delegation } });
  notifyUsers([updated._id], {
    type: 'system',
    title: 'Your administrator permissions changed',
    message: 'The roles you may create or assign, or the permissions you may delegate, were updated.',
  }, { push: false });
  return updated;
}

/**
 * Admins a delegated actor may assign policies to, showing only what the
 * actor may delegate: other modules and actions are summarised as a count,
 * never listed. Legacy and Super Admin accounts never appear.
 */
export async function listPolicyTargets(actor) {
  const cap = policyCap(actor);
  const admins = await User.find({ role: 'admin', policyManaged: true, _id: { $ne: actor._id } })
    .select('name email employeeId isActive policies delegation')
    .sort({ name: 1 })
    .limit(200)
    .lean();
  return admins.map((a) => {
    let hidden = 0;
    const visible = [];
    for (const p of a.policies || []) {
      const own = cap.find((c) => c.module === p.module);
      const shown = own ? p.actions.filter((x) => own.actions.includes(x)) : [];
      hidden += p.actions.length - shown.length;
      if (shown.length) visible.push({ module: p.module, actions: shown, scope: p.scope, ...(p.scope === 'department' ? { department: p.department } : {}) });
    }
    const d = plainDelegation(a.delegation);
    return {
      _id: a._id,
      name: a.name,
      email: a.email,
      employeeId: a.employeeId,
      isActive: a.isActive,
      policies: visible,
      hiddenActions: hidden,
      limits: { createRoles: d.createRoles, assignRoles: d.assignRoles, grantablePolicies: Boolean(d.grantablePolicies) },
    };
  });
}
