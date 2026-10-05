import SecurityLog from '../models/SecurityLog.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { asyncHandler, escapeRegex, pageMeta, paginate } from '../utils/http.js';
import { addDays, resolveRange, timestampFilter, today } from '../utils/dates.js';
import { logSecurity } from '../utils/securityLog.js';
import * as otpService from '../services/otp/otpService.js';

/**
 * Admin → Security & Logs. Every route here is guarded by authorize('admin')
 * (routes/index.js); nothing in this file is reachable by any other role.
 * Read-only: records are written by the server as events happen and can be
 * searched and filtered, never edited or deleted.
 */

/** today | yesterday | 7d | 30d | custom (from/to YYYY-MM-DD) | all → a createdAt filter. */
function createdAtFilter(query) {
  const range = query.range || 'all';
  if (range === 'all') return undefined;
  if (range === 'yesterday') {
    const y = addDays(today(), -1);
    return timestampFilter({ from: y, to: y });
  }
  const mapped = { today: 'day', '7d': 'week', '30d': 'month', custom: 'custom' }[range] || range;
  return timestampFilter(resolveRange({ ...query, range: mapped }));
}

/** Users matching a name / email / roll number search, as ids. Capped so a vague search stays cheap. */
async function userIdsMatching(q, extra = {}) {
  const rx = new RegExp(escapeRegex(q), 'i');
  return User.find({ ...extra, $or: [{ name: rx }, { email: rx }, { rollNo: rx }, { employeeId: rx }] })
    .limit(500)
    .distinct('_id');
}

export const securitySummary = asyncHandler(async (_req, res) => {
  const day = timestampFilter({ from: today(), to: today() });
  const [loginsToday, failedLoginsToday, passwordResetsToday, activeSessions] = await Promise.all([
    SecurityLog.countDocuments({ event: 'LOGIN_SUCCESS', createdAt: day }),
    SecurityLog.countDocuments({ event: 'LOGIN_FAILED', createdAt: day }),
    SecurityLog.countDocuments({ event: 'PASSWORD_RESET', createdAt: day }),
    Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ loginsToday, failedLoginsToday, passwordResetsToday, activeSessions });
});

export const listSecurityLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 25, 100);
  const { q, event, role, success, client } = req.query;
  const clauses = [];
  if (event) clauses.push({ event });
  if (role) clauses.push({ $or: [{ actorRole: role }, { targetRole: role }] });
  if (success === 'true' || success === 'false') clauses.push({ success: success === 'true' });
  if (client) clauses.push({ client });
  const createdAt = createdAtFilter(req.query);
  if (createdAt) clauses.push({ createdAt });
  if (q) {
    const ids = await userIdsMatching(q);
    clauses.push({ $or: [{ actor: { $in: ids } }, { targetUser: { $in: ids } }, { identifier: new RegExp(escapeRegex(q), 'i') }] });
  }
  const filter = clauses.length ? { $and: clauses } : {};

  const people = 'name email role rollNo employeeId department year section';
  const [items, total] = await Promise.all([
    SecurityLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('actor', people).populate('targetUser', people).lean(),
    SecurityLog.countDocuments(filter),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ items, ...pageMeta(total, page, limit) });
});

/**
 * Admin-only OTP cards. Student filters (name / roll number / department /
 * year / section) resolve to student ids first. Every view is itself recorded
 * as OTP_VIEWED (without any code values).
 */
export const listOtps = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req, 24, 60);
  const { q, department, year, section, status } = req.query;

  let studentIds;
  if (q || department || year || section) {
    const placement = {};
    if (department) placement.department = department;
    if (year) placement.year = Number(year);
    if (section) placement.section = String(section).toUpperCase();
    studentIds = q
      ? await userIdsMatching(q, placement)
      : await User.find({ role: { $in: ['student', 'club_admin'] }, ...placement }).limit(5000).distinct('_id');
  }
  const created = createdAtFilter(req.query);
  const { items, total } = await otpService.listAdminOtps({
    studentIds,
    status,
    from: created?.$gte,
    to: created?.$lt,
    page,
    limit,
  });

  logSecurity(req, 'OTP_VIEWED', { details: { count: items.length, page } });
  res.set('Cache-Control', 'no-store');
  res.json({ items, smsEnabled: Boolean(otpService.getOtpProvider().delivers), ...pageMeta(total, page, limit) });
});
