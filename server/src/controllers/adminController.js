import User from '../models/User.js';
import Club from '../models/Club.js';
import Event from '../models/Event.js';
import Announcement from '../models/Announcement.js';
import Discussion from '../models/Discussion.js';
import Report from '../models/Report.js';
import Activity from '../models/Activity.js';
import Session from '../models/Session.js';
import { disconnectSessions } from '../config/socket.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate } from '../utils/http.js';
import { ROLES, normalizePhoneDigits, yearOfSemester } from '../constants.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';
import { pick } from '../utils/http.js';
import { logSecurity } from '../utils/securityLog.js';

// Security-relevant snapshots of an account, for before/after audit records.
const SCOPE_KEYS = ['department', 'year', 'section', 'semester'];
const IN_CHARGE_KEYS = ['department', 'section', 'inChargeYear', 'inChargeSemester'];
const snapshot = (user, keys) => Object.fromEntries(keys.map((k) => [k, user[k] ?? null]));
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
// Never named in a USER_UPDATED record, even as a field name.
const UNLISTED_PATHS = new Set(['password', 'tokenVersion', 'failedLogins', 'lockUntil', 'lastFailedLoginAt', 'lockoutCount', 'resetTokenHash', 'resetTokenExpires', 'pushTokens', 'updatedAt']);

/** Last `n` months as 'YYYY-MM' keys, oldest first. */
function monthKeys(n) {
  const keys = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function dayKeys(n) {
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    keys.push(d.toLocaleDateString('en-CA', { timeZone: env.timezone })); // YYYY-MM-DD
  }
  return keys;
}

const fill = (keys, rows, field = 'count') => {
  const map = Object.fromEntries(rows.map((r) => [r._id, r[field]]));
  return keys.map((k) => ({ key: k, value: map[k] || 0 }));
};

/** Campus-wide participation trend — shared with the user dashboard. */
export async function registrationTrend(months = 6) {
  const keys = monthKeys(months);
  const since = new Date(`${keys[0]}-01T00:00:00Z`);
  const [regs, events] = await Promise.all([
    Event.aggregate([
      { $unwind: '$registrations' },
      { $match: { 'registrations.registeredAt': { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$registrations.registeredAt', timezone: env.timezone } },
          count: { $sum: 1 },
        },
      },
    ]),
    Event.aggregate([
      { $match: { startDate: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$startDate', timezone: env.timezone } }, count: { $sum: 1 } } },
    ]),
  ]);
  const r = fill(keys, regs);
  const e = fill(keys, events);
  return keys.map((k, i) => ({ month: k, registrations: r[i].value, events: e[i].value }));
}

export async function participationByCategory() {
  return Event.aggregate([
    { $group: { _id: '$category', registrations: { $sum: '$registeredCount' }, events: { $sum: 1 } } },
    { $sort: { registrations: -1 } },
    { $project: { _id: 0, category: '$_id', registrations: 1, events: 1 } },
  ]);
}

export const analytics = asyncHandler(async (_req, res) => {
  const now = new Date();
  const days = dayKeys(14);
  const since14 = new Date(Date.now() - 14 * 86400000);

  const [
    usersByRole,
    clubsByStatus,
    totalEvents,
    upcomingEvents,
    totalAnnouncements,
    totalDiscussions,
    pendingReports,
    trend,
    byCategory,
    topEvents,
    topClubs,
    departments,
    activityDaily,
    topActions,
    attendance,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Club.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Event.countDocuments(),
    Event.countDocuments({ endDate: { $gte: now } }),
    Announcement.countDocuments(),
    Discussion.countDocuments(),
    Report.countDocuments({ status: 'pending' }),
    registrationTrend(6),
    participationByCategory(),
    Event.find()
      .sort({ registeredCount: -1 })
      .limit(5)
      .select('title registeredCount capacity startDate category')
      .lean(),
    Club.aggregate([
      { $match: { status: 'approved' } },
      { $project: { name: 1, slug: 1, logo: 1, category: 1, memberCount: { $size: '$members' } } },
      { $sort: { memberCount: -1 } },
      { $limit: 5 },
    ]),
    User.aggregate([
      { $match: { role: 'student', department: { $nin: [null, ''] } } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, department: '$_id', count: 1 } },
    ]),
    Activity.aggregate([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.timezone } }, count: { $sum: 1 } } },
    ]),
    Activity.aggregate([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { _id: 0, action: '$_id', count: 1 } },
    ]),
    Event.aggregate([
      { $match: { endDate: { $lt: now } } },
      { $unwind: '$registrations' },
      { $match: { 'registrations.status': { $ne: 'waitlisted' } } },
      {
        $group: {
          _id: null,
          confirmed: { $sum: 1 },
          attended: { $sum: { $cond: [{ $eq: ['$registrations.status', 'attended'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const roleCounts = Object.fromEntries(ROLES.map((r) => [r, 0]));
  usersByRole.forEach((r) => (roleCounts[r._id] = r.count));
  const clubCounts = { approved: 0, pending: 0, rejected: 0 };
  clubsByStatus.forEach((c) => (clubCounts[c._id] = c.count));
  const att = attendance[0] || { confirmed: 0, attended: 0 };

  res.json({
    totals: {
      users: Object.values(roleCounts).reduce((a, b) => a + b, 0),
      students: roleCounts.student,
      faculty: roleCounts.faculty,
      clubs: clubCounts.approved,
      pendingClubs: clubCounts.pending,
      events: totalEvents,
      upcomingEvents,
      announcements: totalAnnouncements,
      discussions: totalDiscussions,
      pendingReports,
      attendanceRate: att.confirmed ? Math.round((att.attended / att.confirmed) * 100) : 0,
    },
    usersByRole: roleCounts,
    registrationTrend: trend,
    participationByCategory: byCategory,
    topEvents,
    topClubs,
    departments,
    activityDaily: fill(days, activityDaily).map(({ key, value }) => ({ day: key, count: value })),
    topActions,
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  const { q, role, status } = req.query;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { department: rx }, { rollNo: rx }, { section: rx }];
  }
  if (role) filter.role = role;
  if (status === 'active') filter.isActive = true;
  if (status === 'suspended') filter.isActive = false;

  const [items, total] = await Promise.all([
    User.find(filter)
      .select('name title gender email role department year section semester teachingYears teachingSections inChargeYear inChargeSemester rollNo employeeId stayType phone parentPhone avatar isActive lastLogin createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

// Fields an admin may set per role when provisioning a login. `email` + `password`
// are always required (see routes/index.js for the per-role validation chain);
// this list only controls which extra profile fields get copied from the body.
const CREATE_FIELDS = {
  student: ['rollNo', 'year', 'department', 'section', 'semester', 'stayType', 'phone', 'parentPhone'],
  faculty: ['employeeId', 'department', 'section', 'teachingYears', 'teachingSections', 'inChargeYear', 'inChargeSemester', 'designation', 'phone'],
  hod: ['employeeId', 'department', 'phone'],
  principal: ['employeeId', 'phone'],
  club_admin: ['rollNo', 'year', 'department', 'section', 'semester', 'stayType', 'phone', 'parentPhone'],
  admin: ['employeeId', 'phone'],
  security: ['employeeId', 'phone'],
  dean: ['employeeId', 'phone'],
  ao: ['employeeId', 'phone'],
  chairman: ['employeeId', 'phone'],
  warden: ['employeeId', 'phone'],
};

/**
 * Admin-provisioned login: no self-registration exists for staff, and students
 * are normally seeded/admin-created too so their college email is the username
 * from day one. Never accessible to anyone but an admin (see route guard).
 */
export const createUser = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const email = String(req.body.email).toLowerCase().trim();
  if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists');
  if (req.body.employeeId) {
    const dupe = await User.exists({ employeeId: String(req.body.employeeId).trim() });
    if (dupe) throw new ApiError(409, 'That employee ID is already in use');
  }
  if (req.body.rollNo) {
    const rollNo = String(req.body.rollNo).trim();
    const dupeRoll = await User.exists({ rollNo: { $regex: new RegExp(`^${rollNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
    if (dupeRoll) throw new ApiError(409, 'That register number is already in use by another student');
  }
  if (req.body.phone && req.body.parentPhone) {
    const p1 = normalizePhoneDigits(req.body.phone);
    const p2 = normalizePhoneDigits(req.body.parentPhone);
    if (p1 && p2 && p1 === p2) {
      throw new ApiError(422, 'Student mobile number and parent mobile number cannot be the same');
    }
  }

  const data = pick(req.body, CREATE_FIELDS[role] || []);
  const user = await User.create({ name: req.body.name, title: req.body.title, gender: req.body.gender, email, password: req.body.password, role, ...data });

  logActivity(req, 'admin.user_create', { entityType: 'user', entityId: user._id, summary: `${role}: ${user.email}` });
  logSecurity(req, 'USER_CREATED', {
    target: user,
    entityType: 'user',
    entityId: user._id,
    details: { role, ...snapshot(user, ['department', 'year', 'section', 'semester']), via: 'admin' },
  });
  notifyUsers([user._id], {
    type: 'system',
    title: 'Your Vexon account is ready',
    message: `Sign in with ${user.email} using the password your administrator gave you.`,
  }, { push: false });

  res.status(201).json(user);
});

export const updateUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw new ApiError(400, 'You cannot change your own role or status');
  }
  const user = await User.findById(req.params.id).select('+tokenVersion +lockUntil +failedLogins +lastFailedLoginAt +lockoutCount');
  if (!user) throw new ApiError(404, 'User not found');

  const { role, isActive, unlock, unlockAccount } = req.body;
  const changes = [];
  const before = { role: user.role, isActive: user.isActive, scope: snapshot(user, SCOPE_KEYS), inCharge: snapshot(user, IN_CHARGE_KEYS) };

  // Name and login email (the username). Email stays unique college-wide.
  if (req.body.name !== undefined && String(req.body.name).trim() !== user.name) user.name = String(req.body.name).trim();
  for (const key of ['title', 'gender']) if (req.body[key] !== undefined && req.body[key] !== user[key]) user[key] = req.body[key];
  if (req.body.email !== undefined) {
    const email = String(req.body.email).toLowerCase().trim();
    if (email !== user.email) {
      if (await User.exists({ email, _id: { $ne: user._id } })) throw new ApiError(409, 'An account with this email already exists');
      user.email = email;
    }
  }

  // Register number (rollNo) uniqueness check
  if (req.body.rollNo !== undefined) {
    const rawRoll = String(req.body.rollNo || '').trim();
    if (rawRoll) {
      const dupeRoll = await User.exists({
        rollNo: { $regex: new RegExp(`^${rawRoll.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        _id: { $ne: user._id },
      });
      if (dupeRoll) throw new ApiError(409, 'That register number is already in use by another student');
    }
  }

  // Student vs Parent mobile number uniqueness check
  const effPhone = req.body.phone !== undefined ? req.body.phone : user.phone;
  const effParentPhone = req.body.parentPhone !== undefined ? req.body.parentPhone : user.parentPhone;
  if (effPhone && effParentPhone) {
    const p1 = normalizePhoneDigits(effPhone);
    const p2 = normalizePhoneDigits(effParentPhone);
    if (p1 && p2 && p1 === p2) {
      throw new ApiError(422, 'Student mobile number and parent mobile number cannot be the same');
    }
  }

  // Manual admin unlock override
  if (unlock || unlockAccount) {
    user.lockUntil = undefined;
    user.failedLogins = 0;
    user.lastFailedLoginAt = undefined;
    user.lockoutCount = 0;
    changes.push('account_unlocked');
    logActivity(req, 'admin.user_unlock', { entityType: 'user', entityId: user._id, summary: `Manual unlock for ${user.email}` });
  }

  // Academic placement (drives timetable + attendance roster) — admin-assigned only.
  const academic = [];
  for (const key of ['department', 'year', 'section', 'semester', 'rollNo', 'employeeId', 'stayType', 'phone', 'parentPhone']) {
    if (req.body[key] === undefined) continue;
    const value = req.body[key] === '' || req.body[key] === null ? undefined : req.body[key];
    if (String(value ?? '') !== String(user[key] ?? '')) {
      user[key] = value;
      academic.push(`${key} → ${value ?? '—'}`);
    }
  }
  // Declared teaching scope is a faculty-only concept.
  for (const key of ['teachingYears', 'teachingSections']) {
    if (req.body[key] === undefined) continue;
    if ((role ?? user.role) !== 'faculty') throw new ApiError(422, 'Years/sections handled apply to faculty accounts only');
    if (String(req.body[key]) !== String(user[key] ?? '')) {
      user[key] = req.body[key];
      academic.push(`${key} → ${req.body[key].join(', ')}`);
    }
  }
  // Class In-Charge year + semester: faculty-only. The model enforces that they
  // come as a pair, need a section and that the semester belongs to the year.
  for (const key of ['inChargeYear', 'inChargeSemester']) {
    if (req.body[key] === undefined) continue;
    const value = req.body[key] === '' || req.body[key] === null ? undefined : Number(req.body[key]);
    if (value !== undefined && (role ?? user.role) !== 'faculty') {
      throw new ApiError(422, 'In-charge year and semester apply to faculty accounts only');
    }
    if (String(value ?? '') !== String(user[key] ?? '')) {
      user[key] = value;
      academic.push(`${key} → ${value ?? '—'}`);
    }
  }
  // Leaving the faculty role ends the Class In-Charge assignment with it.
  if (role !== undefined && role !== 'faculty' && (user.inChargeYear != null || user.inChargeSemester != null)) {
    user.inChargeYear = undefined;
    user.inChargeSemester = undefined;
    academic.push('class in-charge → cleared (no longer faculty)');
  }
  if (user.year && user.semester && yearOfSemester(user.semester) !== user.year) {
    throw new ApiError(422, `Semester ${user.semester} belongs to year ${yearOfSemester(user.semester)}, not year ${user.year}`);
  }
  if (role !== undefined && role !== user.role) {
    const oldRole = user.role;
    user.role = role;
    changes.push(`role → ${role}`);
    logActivity(req, 'admin.role_change', { entityType: 'user', entityId: user._id, summary: `${user.email}: ${oldRole} → ${role}` });
  }
  if (isActive !== undefined && Boolean(isActive) !== user.isActive) {
    user.isActive = Boolean(isActive);
    changes.push(isActive ? 'reactivated' : 'suspended');
    logActivity(req, isActive ? 'admin.user_reactivate' : 'admin.user_suspend', { entityType: 'user', entityId: user._id, summary: `${user.email}: ${isActive ? 'reactivated' : 'suspended'}` });
  }
  // Any privilege change forces re-authentication on every device, immediately.
  if (changes.length) user.tokenVersion = (user.tokenVersion || 0) + 1;
  const changedFields = user.modifiedPaths().filter((p) => !p.includes('.') && !UNLISTED_PATHS.has(p));
  await user.save({ validateModifiedOnly: true });
  let forced = 0;
  if (changes.length) {
    const live = await Session.find({ user: user._id, revokedAt: null }).distinct('_id');
    await Session.updateMany({ _id: { $in: live } }, { $set: { revokedAt: new Date(), revokedReason: 'admin_change' } });
    disconnectSessions(live);
    forced = live.length;
  }

  // Security & Logs: one record per kind of change, then the overall update.
  const sec = { target: user, entityType: 'user', entityId: user._id };
  if (before.role !== user.role) logSecurity(req, 'ROLE_CHANGED', { ...sec, details: { previousRole: before.role, newRole: user.role } });
  if (before.isActive !== user.isActive) logSecurity(req, user.isActive ? 'USER_ENABLED' : 'USER_DISABLED', sec);
  const scope = snapshot(user, SCOPE_KEYS);
  if (differs(before.scope, scope)) logSecurity(req, 'ACADEMIC_SCOPE_CHANGED', { ...sec, details: { previous: before.scope, new: scope } });
  const inCharge = snapshot(user, IN_CHARGE_KEYS);
  if ((before.role === 'faculty' || user.role === 'faculty') && differs(before.inCharge, inCharge)) {
    logSecurity(req, 'CLASS_IN_CHARGE_CHANGED', { ...sec, details: { previous: before.inCharge, new: inCharge } });
  }
  if (changedFields.length) logSecurity(req, 'USER_UPDATED', { ...sec, details: { fields: changedFields } });
  if (forced) logSecurity(req, 'FORCED_LOGOUT', { ...sec, reason: 'admin_change', details: { sessions: forced } });
  if (academic.length) {
    logActivity(req, 'admin.user_academic', { entityType: 'user', entityId: user._id, summary: `${user.email}: ${academic.join(', ')}` });
    if (!changes.length) notifyUsers([user._id], { type: 'system', title: 'Your class details were updated', message: academic.join(', '), link: '/timetable' });
  }

  if (changes.length) {
    if (user.isActive) {
      notifyUsers([user._id], { type: 'system', title: 'Your account was updated', message: changes.join(', ') });
    }
    logActivity(req, 'admin.user_update', { entityType: 'user', entityId: user._id, summary: `${user.email}: ${changes.join(', ')}` });
  }
  res.json(user);
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw new ApiError(400, 'You cannot delete your own account');
  }
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  const live = await Session.find({ user: user._id, revokedAt: null }).distinct('_id');
  if (live.length) {
    await Session.updateMany({ _id: { $in: live } }, { $set: { revokedAt: new Date(), revokedReason: 'admin_delete' } });
    disconnectSessions(live);
    logSecurity(req, 'FORCED_LOGOUT', { target: user, reason: 'admin_delete', details: { sessions: live.length } });
  }

  const { name, email, role } = user;
  await user.deleteOne();

  logActivity(req, 'admin.user_delete', { entityType: 'user', entityId: req.params.id, summary: `${role}: ${email} (${name})` });
  logSecurity(req, 'USER_DELETED', { target: { _id: req.params.id, role }, entityType: 'user', entityId: req.params.id, details: { name, email } });
  res.status(204).end();
});

export const listActivity = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 25, 100);
  const filter = {};
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(req.query.action)}`);
  if (req.query.user) filter.user = req.query.user;
  const [items, total] = await Promise.all([
    Activity.find(filter).populate('user', 'name avatar role').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Activity.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});
