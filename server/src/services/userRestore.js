import User from '../models/User.js';
import SecurityLog from '../models/SecurityLog.js';
import { env } from '../config/env.js';
import { ApiError, escapeRegex } from '../utils/http.js';
import { logSecurity } from '../utils/securityLog.js';

/**
 * Deleted accounts: a 15-day safety window, then removal for good.
 *
 * Deleting a user soft-deletes it (models/User.js → deletedAt, purgeAt): the
 * document and its _id stay, so attendance, gate passes, Skill Wallet and every
 * other record that points at the account stay linked to it, and the account
 * is invisible to the app.
 *
 *  - Within the window (USER_DELETE_GRACE_DAYS, 15 days by default), creating
 *    an account again with the same email stops the deletion and brings that
 *    same account back exactly as it was — its role, its details and all of
 *    its records — whatever role or details the new form carried. Only the
 *    password comes from the new form, so the person can sign in again.
 *    This applies to every login that can be deleted (all roles except
 *    Admin and Super Admin, which are deactivated, never deleted).
 *  - When the window ends, purgeDeletedUsers() removes the account document
 *    for good (the old behaviour of Delete). Creating the email after that
 *    makes a brand-new, empty account.
 *
 * Accounts hard-deleted just before soft delete existed are gone from the
 * users collection, but their records still carry the old _id and the
 * security log kept the id and email (USER_DELETED). Re-creating such an email
 * within the window creates the account under that old _id, relinking them.
 */

export const graceMs = () => env.userDeleteGraceHours * 60 * 60 * 1000;
/** "15 days" / "36 hours": the restore window, for messages. */
export const graceLabel = (h = env.userDeleteGraceHours) =>
  h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;
export const purgeTimeFrom = (deletedAt = new Date()) => new Date(deletedAt.getTime() + graceMs());

// Extra access granted on top of the role (additional admin policies,
// delegation) and the old lock-out state are not brought back.
const RESET_ON_RESTORE = {
  policies: [],
  policyManaged: false,
  delegation: undefined,
  failedLogins: 0,
  lockoutCount: 0,
  lockUntil: undefined,
  lastFailedLoginAt: undefined,
  resetTokenHash: undefined,
  resetTokenExpires: undefined,
};

// Always counted from the deletion time with the current window, so changing
// USER_DELETE_GRACE_DAYS also applies to deletions already pending (purgeAt
// is stored for display and the security log).
const purgeDue = (user, now = new Date()) => purgeTimeFrom(new Date(user.deletedAt)) <= now;

/** Removes one deleted account for good and records it. */
async function purgeOne(user) {
  const { deletedCount } = await User.deleteOne({ _id: user._id, deletedAt: { $ne: null } });
  if (deletedCount) {
    logSecurity(null, 'USER_PURGED', {
      actor: null,
      target: { _id: user._id, role: user.role },
      entityType: 'user',
      entityId: user._id,
      reason: 'restore_window_ended',
      details: { name: user.name, email: user.email, deletedAt: user.deletedAt },
    });
  }
  return deletedCount;
}

/** Background job: removes every deleted account whose restore window has ended. */
export async function purgeDeletedUsers(now = new Date()) {
  const due = await User.find({
    deletedAt: { $ne: null, $lte: new Date(now.getTime() - graceMs()) },
  })
    .select('name email role deletedAt purgeAt')
    .limit(500)
    .lean();
  let purged = 0;
  for (const user of due) purged += await purgeOne(user);
  return { purged };
}

/**
 * The deleted account behind an email that can still be restored:
 *   { user, role }      — a soft-deleted account inside its window (restored in place)
 *   { legacyId, role }  — hard-deleted within the window before soft delete existed
 *   null                — nothing to restore: a brand-new account
 */
export async function findDeletedAccount(email) {
  const user = await User.findOne({ email, deletedAt: { $ne: null } }).select('+tokenVersion');
  if (user) {
    if (!purgeDue(user)) return { user, role: user.role };
    // Window over but the job has not run yet: finish the deletion now.
    await purgeOne(user);
    return null;
  }

  const log = await SecurityLog.findOne({
    event: 'USER_DELETED',
    success: true,
    'details.email': email,
    // Only hard deletions from before soft delete: a soft deletion records its
    // purgeAt, and once purged it must stay gone.
    'details.purgeAt': { $exists: false },
    createdAt: { $gte: new Date(Date.now() - graceMs()) },
  })
    .sort({ createdAt: -1 })
    .select('targetUser targetRole entityId')
    .lean();
  const id = log?.targetUser || log?.entityId;
  if (!id) return null;
  // The old id is free unless an account (live or deleted) already uses it.
  if (await User.exists({ _id: id }).setOptions({ withDeleted: true })) return null;
  return { legacyId: id, role: log.targetRole };
}

/**
 * A brand-new account may not take a register number / employee ID that still
 * belongs to a different deleted account inside its window (that account would
 * lose it on restore). Not checked when an account is being restored: the
 * restored account keeps its own identifiers and ignores the form's.
 */
export async function assertIdentifiersFree(prior, { rollNo, employeeId } = {}) {
  if (prior?.user) return;
  const held = [];
  if (rollNo) held.push({ rollNo: { $regex: new RegExp(`^${escapeRegex(String(rollNo).trim())}$`, 'i') } });
  if (employeeId) held.push({ employeeId: String(employeeId).trim() });
  if (!held.length) return;
  const holder = await User.findOne({
    deletedAt: { $ne: null },
    $or: held,
  })
    .select('name email role rollNo deletedAt purgeAt')
    .lean();
  if (!holder) return;
  if (purgeDue(holder)) {
    await purgeOne(holder);
    return;
  }
  const what = rollNo && holder.rollNo && holder.rollNo.toUpperCase() === String(rollNo).trim().toUpperCase() ? 'register number' : 'employee ID';
  const freeAt = purgeTimeFrom(new Date(holder.deletedAt)).toISOString();
  throw new ApiError(
    409,
    `That ${what} belongs to the deleted account ${holder.email}. Create that email again to restore it, or wait until it is removed for good (${freeAt}).`
  );
}

/**
 * Creates the account, or stops the pending deletion and brings the deleted
 * one back as it was (only the new password is applied). Returns
 * { user, restored }.
 */
export async function createOrRestoreUser(prior, fields) {
  if (prior?.user) {
    const { user } = prior;
    user.set({
      ...RESET_ON_RESTORE,
      password: fields.password,
      mustChangePassword: Boolean(fields.mustChangePassword),
      isActive: true,
      deletedAt: null,
      deletedBy: undefined,
      purgeAt: undefined,
    });
    // Any token issued before the deletion stays dead.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    return { user, restored: true };
  }
  // Hard-deleted before soft delete: the old document is gone, so the new
  // details are used — under the old id and the old role.
  const user = await User.create(prior?.legacyId ? { ...fields, _id: prior.legacyId, ...(prior.role ? { role: prior.role } : {}) } : fields);
  return { user, restored: Boolean(prior?.legacyId) };
}
