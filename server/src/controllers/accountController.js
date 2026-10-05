import User from '../models/User.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { logSecurity } from '../utils/securityLog.js';
import { notifyUsers } from '../utils/notify.js';
import { STUDENT_ROLES } from '../utils/academicScope.js';
import { yearOfSemester } from '../constants.js';
import { revokeSessions } from './authController.js';

/**
 * Student accounts managed by a faculty Class In-Charge, and authorized
 * password resets (Class In-Charge for their students, Admin college-wide).
 *
 * The Class In-Charge class is read only from the faculty's own account
 * (department + section + inChargeYear + inChargeSemester), never from the
 * request. Account management needs that exact, stored assignment: the
 * timetable-inferred fallback some read-only views accept is not enough to
 * create logins or reset passwords. General subject-handling assignments
 * (timetable, teachingYears/teachingSections) never grant either.
 */
export function exactClassInCharge(user) {
  if (user?.role !== 'faculty') return null;
  const section = String(user.section || '').trim().toUpperCase();
  const year = Number(user.inChargeYear);
  const semester = Number(user.inChargeSemester);
  if (!user.department || !section || !year || !semester || yearOfSemester(semester) !== year) return null;
  return { department: user.department, year, section, semester };
}

const inScope = (scope, student) =>
  Boolean(scope && student) &&
  STUDENT_ROLES.includes(student.role) &&
  student.department === scope.department &&
  Number(student.year) === scope.year &&
  String(student.section || '').toUpperCase() === scope.section &&
  Number(student.semester) === scope.semester;

// No phone numbers: the Class In-Charge screen does not need them.
const CLASS_STUDENT_FIELDS = 'name email role rollNo department year section semester stayType isActive lastLogin createdAt';

/** The faculty's own Class In-Charge class and its students. */
export const listClassStudents = asyncHandler(async (req, res) => {
  const scope = exactClassInCharge(req.user);
  res.set('Cache-Control', 'no-store');
  if (!scope) return res.json({ scope: null, items: [] });
  const items = await User.find({ role: { $in: STUDENT_ROLES }, ...scope })
    .select(CLASS_STUDENT_FIELDS)
    .sort({ rollNo: 1, name: 1 })
    .limit(500)
    .lean();
  res.json({ scope, items });
});

// What a Class In-Charge may set on a new student. Department, year, section
// and semester are NOT here: they are always taken from the faculty's scope.
const CLASS_STUDENT_INPUT = ['rollNo', 'stayType', 'phone', 'parentPhone'];
const SCOPE_FIELDS = ['department', 'year', 'section', 'semester'];

/**
 * Class In-Charge creates a student login in their own class. Any attempt to
 * name another department / year / section / semester, or another role, is
 * refused outright (not silently corrected) and recorded.
 */
export const createClassStudent = asyncHandler(async (req, res) => {
  const scope = exactClassInCharge(req.user);
  if (!scope) {
    logSecurity(req, 'USER_CREATED', { success: false, reason: 'no_class_in_charge_scope' });
    throw new ApiError(403, 'Only a Class In-Charge can create student accounts, and only for their own class');
  }

  const tampered = SCOPE_FIELDS.filter((k) => {
    const sent = req.body[k];
    if (sent === undefined || sent === null || sent === '') return false;
    return String(sent).trim().toUpperCase() !== String(scope[k]).toUpperCase();
  });
  if (req.body.role !== undefined && req.body.role !== 'student') tampered.push('role');
  if (tampered.length) {
    logSecurity(req, 'USER_CREATED', { success: false, reason: 'scope_tampering', details: { fields: tampered, classInCharge: scope } });
    throw new ApiError(403, 'You can only create student accounts for your own Class In-Charge class');
  }

  const email = String(req.body.email).toLowerCase().trim();
  if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists');

  const user = await User.create({
    name: req.body.name,
    email,
    password: req.body.password,
    role: 'student',
    ...pick(req.body, CLASS_STUDENT_INPUT),
    ...scope,
  });

  logActivity(req, 'class.student_create', { entityType: 'user', entityId: user._id, summary: `student: ${user.email}` });
  logSecurity(req, 'USER_CREATED', {
    target: user,
    entityType: 'user',
    entityId: user._id,
    details: { role: 'student', via: 'class_in_charge', ...scope },
  });
  notifyUsers([user._id], {
    type: 'system',
    title: 'Your Vexon account is ready',
    message: `Sign in with ${user.email} using the password your Class In-Charge gave you.`,
  }, { push: false });

  res.status(201).json(await User.findById(user._id).select(CLASS_STUDENT_FIELDS).lean());
});

/** Route guard: only Admin and Faculty reach the reset handler; anyone else gets a recorded 403. */
export function passwordResetRoles(req, _res, next) {
  if (['admin', 'faculty'].includes(req.user?.role)) return next();
  logSecurity(req, 'PASSWORD_RESET_FAILED', { success: false, reason: 'role_not_permitted', entityType: 'user', details: { targetId: req.params.id } });
  next(new ApiError(403, 'You do not have permission to reset passwords'));
}

/**
 * Authorized password reset — no current password needed, because the caller
 * is not the account owner:
 *   - Admin: any account except another Admin's (and not their own — that is
 *     a self-service change with the current password).
 *   - Faculty: students of their exact Class In-Charge class only.
 *   - Everyone else: refused.
 * Afterwards every session of the target is revoked and tokenVersion bumped,
 * so the user must sign in again everywhere. No password value is ever
 * logged, returned or stored anywhere but as the bcrypt hash.
 */
export const resetUserPassword = asyncHandler(async (req, res) => {
  const actor = req.user;
  const fail = (status, message, reason, target) => {
    logSecurity(req, 'PASSWORD_RESET_FAILED', { target, success: false, reason, entityType: 'user', entityId: target?._id });
    return new ApiError(status, message);
  };

  if (!['admin', 'faculty'].includes(actor.role)) throw fail(403, 'You do not have permission to reset passwords', 'role_not_permitted');

  const target = await User.findById(req.params.id).select('+password +tokenVersion +failedLogins +lockUntil +lastFailedLoginAt +lockoutCount');
  if (!target) throw fail(404, 'User not found', 'target_not_found');
  if (String(target._id) === String(actor._id)) {
    throw fail(400, 'Use Change password in Account security to change your own password', 'self_reset', target);
  }

  let scope = null;
  if (actor.role === 'admin') {
    if (target.role === 'admin') throw fail(403, 'Another administrator’s password cannot be reset here', 'target_is_admin', target);
  } else {
    scope = exactClassInCharge(actor);
    if (!scope) throw fail(403, 'Only a Class In-Charge can reset student passwords', 'no_class_in_charge_scope', target);
    if (!inScope(scope, target)) throw fail(403, 'You can only reset passwords for students in your own class', 'target_out_of_scope', target);
  }

  target.password = req.body.newPassword;
  target.tokenVersion = (target.tokenVersion || 0) + 1;
  target.failedLogins = 0;
  target.lockUntil = undefined;
  target.lastFailedLoginAt = undefined;
  target.lockoutCount = 0;
  await target.save();

  const signedOut = await revokeSessions({ user: target._id }, 'password_reset');
  const reason = typeof req.body.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : undefined;
  const sec = { target, entityType: 'user', entityId: target._id };
  logActivity(req, 'auth.password_reset_by_staff', { entityType: 'user', entityId: target._id, summary: `${target.email} by ${actor.role}` });
  logSecurity(req, 'PASSWORD_RESET', {
    ...sec,
    reason,
    details: { via: actor.role === 'admin' ? 'admin' : 'class_in_charge', ...(scope ? { classInCharge: scope } : {}), sessionsRevoked: signedOut },
  });
  if (signedOut) logSecurity(req, 'FORCED_LOGOUT', { ...sec, reason: 'password_reset', details: { sessions: signedOut } });
  notifyUsers([target._id], {
    type: 'system',
    title: 'Your password was reset',
    message: `Your password was reset by your ${actor.role === 'admin' ? 'administrator' : 'Class In-Charge'}. Sign in with the new password.`,
    link: '/settings/security',
  }, { push: false });

  res.set('Cache-Control', 'no-store');
  res.json({ message: 'Password reset. The user has been signed out everywhere and must sign in with the new password.', sessionsRevoked: signedOut });
});
