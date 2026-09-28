import Complaint, { generateComplaintCode } from '../models/Complaint.js';
import ComplaintHistory from '../models/ComplaintHistory.js';
import User from '../models/User.js';
import {
  COMPLAINT_SUBCATEGORIES,
  COMPLAINT_ESCALATE_TO,
  COMPLAINT_ESCALATION_CHAINS,
  COMPLAINT_CANCELLABLE_STATUSES,
  COMPLAINT_NOT_RESOLVED_WAIT_MS,
} from '../constants.js';
import { ApiError, asyncHandler, paginate, pageMeta, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToUsers } from '../config/socket.js';
import { timestampFilter, resolveRange } from '../utils/dates.js';

const STUDENT_FIELDS = 'name email rollNo avatar department year section phone';
const IDENTITY_ROLES = ['chairman', 'admin'];
// Everyone who can ever end up as the "current authority" of a complaint.
export const COMPLAINT_AUTHORITY_ROLES = ['faculty', 'hod', 'principal', 'dean', 'ao', 'warden'];

const isHighPrivacy = (viewer) => IDENTITY_ROLES.includes(viewer?.role);

/**
 * Never trust the frontend for who the recipient is — resolve the real
 * authority account(s) for a role from the database every time.
 */
const roleFilter = {
  faculty: (dept, section) => (section ? { role: 'faculty', department: dept, section, isActive: true } : { role: 'faculty', department: dept, isActive: true }),
  hod: (dept) => ({ role: 'hod', department: dept, isActive: true }),
  principal: () => ({ role: 'principal', isActive: true }),
  dean: () => ({ role: 'dean', isActive: true }),
  ao: () => ({ role: 'ao', isActive: true }),
  // No hostel/room model exists yet, so a warden is college-wide.
  warden: () => ({ role: 'warden', isActive: true }),
  chairman: () => ({ role: 'chairman', isActive: true }),
};

async function resolveAuthority(role, { department, section } = {}) {
  let filter = roleFilter[role]?.(department, section);
  if (!filter) throw new ApiError(422, `Unknown authority role: ${role}`);
  let ids = await User.find(filter).distinct('_id');
  // A class in-charge (section match) may not exist — fall back to the whole
  // department, same reasoning as the gate pass faculty fallback.
  if (!ids.length && role === 'faculty' && section) {
    ids = await User.find({ role: 'faculty', department, isActive: true }).distinct('_id');
  }
  return { recipientIds: ids, primaryUserId: ids[0] || null };
}

/**
 * The single choke point for anonymous-identity privacy. Applied to every
 * read path (get one, list many, dashboard). Never send `student` to an
 * unauthorized viewer and never rely on the frontend to hide it.
 */
function sanitizeComplaint(doc, viewer, req) {
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const isOwner = sameId(plain.student, viewer);
  const canSeeIdentity = !plain.anonymous || isOwner || isHighPrivacy(viewer);

  if (!canSeeIdentity) {
    delete plain.student;
    plain.identityHidden = true;
    return plain;
  }

  // Chairman/Admin viewing an anonymous complaint's identity is an explicitly
  // authorized, audited action — never a silent read.
  if (plain.anonymous && !isOwner && isHighPrivacy(viewer) && req) {
    logActivity(req, 'complaint.identity_access', { entityType: 'complaint', entityId: plain._id });
  }
  plain.identityHidden = false;
  return plain;
}

function canView(complaint, user) {
  if (sameId(complaint.student, user)) return true;
  if (isHighPrivacy(user)) return true;
  return sameId(complaint.currentAuthorityUserId, user);
}

/** Live update. Authority room gets a sanitized payload unless it IS chairman/admin/self. */
function publishComplaint(complaint, { toAuthority = true } = {}) {
  const base = { complaintId: String(complaint._id), status: complaint.status, currentAuthorityRole: complaint.currentAuthorityRole };
  emitToUsers([complaint.student], 'complaint:updated', { ...base, mine: true });
  if (toAuthority && complaint.currentAuthorityUserId) {
    emitToUsers([complaint.currentAuthorityUserId], 'complaint:updated', base);
  }
}

/** Notification text never names the student when the complaint is anonymous. */
async function notifyAuthority(complaint, recipientIds, { title, extra }) {
  if (!recipientIds.length) return;
  const who = complaint.anonymous ? 'An anonymous student' : 'A student';
  await notifyUsers(recipientIds, {
    type: 'complaint',
    title,
    message: `${who} raised a ${complaint.category.replace(/_/g, ' ')} complaint${extra ? ` · ${extra}` : ''}`,
    link: `/complaints/${complaint._id}`,
  });
}

async function writeHistory(complaintId, entry) {
  await ComplaintHistory.create({ complaint: complaintId, ...entry });
}

// ── Student creates a complaint ────────────────────────────────────

export const createComplaint = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') throw new ApiError(403, 'Only student accounts can register a complaint');

  const data = pick(req.body, ['anonymous', 'category', 'subCategory', 'description']);
  const escalateTo = String(req.body.escalateTo || '').toLowerCase();
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];

  const allowedTargets = COMPLAINT_ESCALATE_TO[data.category];
  if (!allowedTargets) throw new ApiError(422, 'Invalid complaint category');
  if (!allowedTargets.includes(escalateTo)) throw new ApiError(422, 'Invalid "escalate to" authority for this category');

  const allowedSub = COMPLAINT_SUBCATEGORIES[data.category] || [];
  if (allowedSub.length && !allowedSub.includes(data.subCategory)) throw new ApiError(422, 'Invalid subcategory for this category');
  if (!allowedSub.length) data.subCategory = undefined;

  const { department, section } = req.user;
  if (escalateTo === 'faculty' && !department) {
    throw new ApiError(422, 'Your account has no department on file — ask an admin to set it');
  }

  const { recipientIds, primaryUserId } = await resolveAuthority(escalateTo, { department, section });
  const escalationChain = COMPLAINT_ESCALATION_CHAINS[escalateTo];
  if (!escalationChain) throw new ApiError(422, 'Invalid escalation target');

  let complaint;
  for (let attempt = 0; attempt < 3 && !complaint; attempt += 1) {
    try {
      complaint = await Complaint.create({
        ...data,
        attachments,
        student: req.user._id,
        department,
        section,
        initialEscalationTarget: escalateTo,
        escalationChain,
        escalationLevel: 0,
        currentAuthorityRole: escalateTo,
        currentAuthorityUserId: primaryUserId,
        status: 'SUBMITTED',
        priority: data.category === 'ragging_harassment' ? 'high' : 'normal',
        notResolvedAvailableAt: new Date(Date.now() + COMPLAINT_NOT_RESOLVED_WAIT_MS),
        complaintCode: generateComplaintCode(),
      });
    } catch (err) {
      if (err.code !== 11000 || attempt === 2) throw err;
    }
  }

  await writeHistory(complaint._id, {
    action: 'submitted',
    actorUserId: req.user._id,
    actorRole: req.user.role,
    newStatus: 'SUBMITTED',
    newAuthority: escalateTo,
  });
  logActivity(req, 'complaint.create', { entityType: 'complaint', entityId: complaint._id, summary: complaint.category });

  await notifyAuthority(complaint, recipientIds, { title: 'New complaint assigned to you' });
  publishComplaint(complaint);

  res.status(201).json(sanitizeComplaint(complaint, req.user, req));
});

// ── List (role-scoped queue) ───────────────────────────────────────

export const listComplaints = asyncHandler(async (req, res) => {
  const { role } = req.user;
  let filter = {};

  if (role === 'student') {
    filter.student = req.user._id;
  } else if (isHighPrivacy(req.user) || role === 'admin') {
    if (req.query.department) filter.department = req.query.department;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.subCategory) filter.subCategory = req.query.subCategory;
    if (req.query.currentAuthorityRole) filter.currentAuthorityRole = req.query.currentAuthorityRole;
    if (req.query.anonymous !== undefined) filter.anonymous = req.query.anonymous === 'true';
    if (req.query.escalationLevel !== undefined) filter.escalationLevel = Number(req.query.escalationLevel);
    if (req.query.priority) filter.priority = req.query.priority;
  } else if (COMPLAINT_AUTHORITY_ROLES.includes(role)) {
    filter.currentAuthorityUserId = req.user._id;
  } else {
    throw new ApiError(403, 'Not authorized');
  }

  if (req.query.status) {
    filter.status = { $in: String(req.query.status).split(',') };
  }
  if (req.query.range || req.query.from || req.query.to) {
    const tf = timestampFilter(resolveRange(req.query, 'all'));
    if (tf) filter.createdAt = tf;
  }

  const { page, limit, skip } = paginate(req, 20);
  const [complaints, total] = await Promise.all([
    Complaint.find(filter).populate('student', STUDENT_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Complaint.countDocuments(filter),
  ]);

  res.json({
    complaints: complaints.map((c) => sanitizeComplaint(c, req.user, req)),
    pagination: pageMeta(total, page, limit),
  });
});

// ── Get one ─────────────────────────────────────────────────────────

export const getComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id).populate('student', STUDENT_FIELDS);
  if (!complaint) throw new ApiError(404, 'Complaint not found');
  if (!canView(complaint, req.user)) throw new ApiError(403, 'Not authorized');

  const history = await ComplaintHistory.find({ complaint: complaint._id }).sort({ timestamp: 1 }).lean();
  const safeHistory = history.map((h) => {
    if (complaint.anonymous && !sameId(complaint.student, req.user) && !isHighPrivacy(req.user)) {
      const { actorUserId, ...rest } = h;
      return rest;
    }
    return h;
  });

  res.json({ ...sanitizeComplaint(complaint, req.user, req), history: safeHistory });
});

// ── Authority updates status (in review / in progress / resolved) ──

export const authorityUpdate = asyncHandler(async (req, res) => {
  const { status, comment } = req.body;
  if (!['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED'].includes(status)) throw new ApiError(422, 'Invalid status');

  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw new ApiError(404, 'Complaint not found');
  if (req.user.role !== 'admin' && !sameId(complaint.currentAuthorityUserId, req.user)) {
    throw new ApiError(403, 'You are not the current authority for this complaint');
  }

  const updated = await Complaint.findOneAndUpdate(
    { _id: complaint._id, currentAuthorityUserId: complaint.currentAuthorityUserId },
    { $set: { status, ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}) } },
    { new: true }
  );
  if (!updated) throw new ApiError(422, 'This complaint was just updated by someone else');

  await writeHistory(complaint._id, {
    action: 'authority_update',
    actorUserId: req.user._id,
    actorRole: req.user.role,
    previousStatus: complaint.status,
    newStatus: status,
    comment,
  });
  logActivity(req, 'complaint.authority_update', { entityType: 'complaint', entityId: complaint._id, summary: status });

  await notifyUsers([updated.student], {
    type: 'complaint',
    title: status === 'RESOLVED' ? 'Your complaint was marked resolved' : 'Update on your complaint',
    message: comment || `Status changed to ${status.replace(/_/g, ' ').toLowerCase()}`,
    link: `/complaints/${updated._id}`,
  });
  publishComplaint(updated);
  const populated = await Complaint.findById(updated._id).populate('student', STUDENT_FIELDS);
  res.json(sanitizeComplaint(populated, req.user, req));
});

// ── Student: not resolved → escalate ───────────────────────────────

export const markNotResolved = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw new ApiError(404, 'Complaint not found');
  if (!sameId(complaint.student, req.user)) throw new ApiError(403, 'Only the complainant can do this');
  if (!['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED'].includes(complaint.status)) {
    throw new ApiError(422, `A ${complaint.status.toLowerCase()} complaint cannot be escalated`);
  }
  if (complaint.notResolvedAvailableAt && Date.now() < complaint.notResolvedAvailableAt.getTime()) {
    throw new ApiError(422, 'The waiting period for escalation has not elapsed yet');
  }

  const previousAuthority = complaint.currentAuthorityRole;
  const previousStatus = complaint.status;
  const hasNext = complaint.escalationLevel + 1 < complaint.escalationChain.length;

  if (!hasNext) {
    const updated = await Complaint.findOneAndUpdate(
      { _id: complaint._id, status: previousStatus },
      { $set: { status: 'NOT_RESOLVED' } },
      { new: true }
    );
    if (!updated) throw new ApiError(422, 'This complaint was just updated by someone else');
    await writeHistory(complaint._id, {
      action: 'not_resolved',
      actorUserId: req.user._id,
      actorRole: req.user.role,
      previousStatus,
      newStatus: 'NOT_RESOLVED',
      previousAuthority,
      newAuthority: previousAuthority,
      comment: 'Final authority reached — no further escalation available',
    });
    publishComplaint(updated);
    return res.json(sanitizeComplaint(await Complaint.findById(updated._id).populate('student', STUDENT_FIELDS), req.user, req));
  }

  const nextLevel = complaint.escalationLevel + 1;
  const nextRole = complaint.escalationChain[nextLevel];
  const { recipientIds, primaryUserId } = await resolveAuthority(nextRole, { department: complaint.department, section: complaint.section });

  const updated = await Complaint.findOneAndUpdate(
    { _id: complaint._id, status: previousStatus },
    {
      $set: {
        status: 'ESCALATED',
        escalationLevel: nextLevel,
        currentAuthorityRole: nextRole,
        currentAuthorityUserId: primaryUserId,
        notResolvedAvailableAt: new Date(Date.now() + COMPLAINT_NOT_RESOLVED_WAIT_MS),
      },
    },
    { new: true }
  );
  if (!updated) throw new ApiError(422, 'This complaint was just updated by someone else');

  await writeHistory(complaint._id, {
    action: 'escalated',
    actorUserId: req.user._id,
    actorRole: req.user.role,
    previousStatus,
    newStatus: 'ESCALATED',
    previousAuthority,
    newAuthority: nextRole,
  });
  logActivity(req, 'complaint.escalate', { entityType: 'complaint', entityId: complaint._id, summary: `${previousAuthority} -> ${nextRole}` });

  await notifyAuthority(updated, recipientIds, { title: 'Complaint escalated to you', extra: `escalated from ${previousAuthority}` });
  publishComplaint(updated);
  res.json(sanitizeComplaint(await Complaint.findById(updated._id).populate('student', STUDENT_FIELDS), req.user, req));
});

// ── Student confirms resolution (final close) ──────────────────────

export const markResolved = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findOneAndUpdate(
    { _id: req.params.id, student: req.user._id },
    { $set: { status: 'CLOSED', closedAt: new Date() } },
    { new: true }
  );
  if (!complaint) throw new ApiError(404, 'Complaint not found');

  await writeHistory(complaint._id, {
    action: 'closed',
    actorUserId: req.user._id,
    actorRole: req.user.role,
    newStatus: 'CLOSED',
  });
  logActivity(req, 'complaint.close', { entityType: 'complaint', entityId: complaint._id });
  publishComplaint(complaint);
  res.json(sanitizeComplaint(complaint, req.user, req));
});

// ── Student cancels ─────────────────────────────────────────────────

export const cancelComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findOneAndUpdate(
    { _id: req.params.id, student: req.user._id, status: { $in: COMPLAINT_CANCELLABLE_STATUSES } },
    { $set: { status: 'CANCELLED', cancelledAt: new Date() } },
    { new: true }
  );
  if (!complaint) {
    const exists = await Complaint.findById(req.params.id).select('student status').lean();
    if (!exists || !sameId(exists.student, req.user)) throw new ApiError(404, 'Complaint not found');
    throw new ApiError(422, `A ${exists.status.toLowerCase()} complaint cannot be cancelled`);
  }

  await writeHistory(complaint._id, {
    action: 'cancelled',
    actorUserId: req.user._id,
    actorRole: req.user.role,
    newStatus: 'CANCELLED',
  });
  logActivity(req, 'complaint.cancel', { entityType: 'complaint', entityId: complaint._id });
  publishComplaint(complaint);
  res.json(sanitizeComplaint(complaint, req.user, req));
});

// ── Admin / Chairman dashboard ──────────────────────────────────────

export const complaintDashboard = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.department) filter.department = req.query.department;
  if (req.query.category) filter.category = req.query.category;

  const [
    total, open, resolved, cancelled, escalated, pending,
    byCategory, byDepartment, resolutionTime,
  ] = await Promise.all([
    Complaint.countDocuments(filter),
    Complaint.countDocuments({ ...filter, status: { $in: ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'NOT_RESOLVED'] } }),
    Complaint.countDocuments({ ...filter, status: { $in: ['RESOLVED', 'CLOSED'] } }),
    Complaint.countDocuments({ ...filter, status: 'CANCELLED' }),
    Complaint.countDocuments({ ...filter, escalationLevel: { $gt: 0 } }),
    Complaint.countDocuments({ ...filter, status: { $in: ['SUBMITTED', 'IN_REVIEW'] } }),
    Complaint.aggregate([{ $match: filter }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    Complaint.aggregate([{ $match: filter }, { $group: { _id: '$department', count: { $sum: 1 } } }]),
    Complaint.aggregate([
      { $match: { ...filter, resolvedAt: { $ne: null } } },
      { $project: { hours: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3600000] } } },
      { $group: { _id: null, avgHours: { $avg: '$hours' } } },
    ]),
  ]);

  res.json({
    total,
    open,
    resolved,
    cancelled,
    escalated,
    pending,
    byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.count])),
    byDepartment: Object.fromEntries(byDepartment.filter((d) => d._id).map((d) => [d._id, d.count])),
    avgResolutionHours: resolutionTime[0]?.avgHours || 0,
  });
});
