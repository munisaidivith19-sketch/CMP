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
import { ROLES } from '../constants.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

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
      .select('name email role department year section semester rollNo avatar isActive lastLogin createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const updateUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw new ApiError(400, 'You cannot change your own role or status');
  }
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw new ApiError(404, 'User not found');

  const { role, isActive } = req.body;
  const changes = [];
  // Academic placement (drives timetable + attendance roster) — admin-assigned only.
  const academic = [];
  for (const key of ['department', 'year', 'section', 'semester', 'rollNo']) {
    if (req.body[key] === undefined) continue;
    const value = req.body[key] === '' || req.body[key] === null ? undefined : req.body[key];
    if (String(value ?? '') !== String(user[key] ?? '')) {
      user[key] = value;
      academic.push(`${key} → ${value ?? '—'}`);
    }
  }
  if (role !== undefined && role !== user.role) {
    user.role = role;
    changes.push(`role → ${role}`);
  }
  if (isActive !== undefined && Boolean(isActive) !== user.isActive) {
    user.isActive = Boolean(isActive);
    changes.push(isActive ? 'reactivated' : 'suspended');
  }
  // Any privilege change forces re-authentication on every device, immediately.
  if (changes.length) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateModifiedOnly: true });
  if (changes.length) {
    const live = await Session.find({ user: user._id, revokedAt: null }).distinct('_id');
    await Session.updateMany({ _id: { $in: live } }, { $set: { revokedAt: new Date(), revokedReason: 'admin_change' } });
    disconnectSessions(live);
  }
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
