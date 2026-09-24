import Report from '../models/Report.js';
import Discussion from '../models/Discussion.js';
import Event from '../models/Event.js';
import Announcement from '../models/Announcement.js';
import Club from '../models/Club.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, pageMeta, paginate } from '../utils/http.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

const MODELS = { discussion: Discussion, reply: Discussion, event: Event, announcement: Announcement, club: Club, user: User };

/** Load the reported content plus a readable preview and its owner. */
async function resolveTarget(report) {
  const Model = MODELS[report.targetType];
  const doc = await Model.findById(report.targetId);
  if (!doc) return { doc: null, preview: '[deleted]', ownerId: null };

  switch (report.targetType) {
    case 'reply': {
      const reply = doc.replies.id(report.replyId);
      return { doc, reply, preview: reply ? reply.body : '[deleted reply]', ownerId: reply?.author, link: `/discussions/${doc._id}` };
    }
    case 'discussion':
      return { doc, preview: `${doc.title} — ${doc.body.slice(0, 160)}`, ownerId: doc.author, link: `/discussions/${doc._id}` };
    case 'event':
      return { doc, preview: doc.title, ownerId: doc.organizer, link: `/events/${doc._id}` };
    case 'announcement':
      return { doc, preview: doc.title, ownerId: doc.author, link: '/announcements' };
    case 'club':
      return { doc, preview: doc.name, ownerId: doc.createdBy, link: `/clubs/${doc.slug}` };
    case 'user':
      return { doc, preview: `${doc.name} (${doc.email})`, ownerId: doc._id, link: `/people/${doc._id}` };
    default:
      return { doc, preview: '' };
  }
}

export const createReport = asyncHandler(async (req, res) => {
  const { targetType, targetId, replyId, reason, details } = req.body;
  const Model = MODELS[targetType];
  const target = await Model.findById(targetId);
  if (!target) throw new ApiError(404, 'Content not found');
  if (targetType === 'reply' && !target.replies.id(replyId)) throw new ApiError(404, 'Reply not found');

  const duplicate = await Report.exists({ reporter: req.user._id, targetType, targetId, replyId, status: 'pending' });
  if (duplicate) throw new ApiError(409, 'You have already reported this');

  const report = await Report.create({ targetType, targetId, replyId, reason, details, reporter: req.user._id });
  notifyRoles(['admin', 'faculty'], {
    type: 'report',
    title: `New ${targetType} report: ${reason}`,
    message: details?.slice(0, 120),
    link: '/admin/reports',
  });
  logActivity(req, 'report.create', { entityType: targetType, entityId: targetId, summary: reason });
  res.status(201).json({ message: 'Thanks — a moderator will review this shortly.', id: report._id });
});

export const listReports = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 15);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.targetType) filter.targetType = req.query.targetType;

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .populate('reporter', 'name avatar')
      .populate('resolution.by', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Report.countDocuments(filter),
  ]);

  const items = await Promise.all(
    reports.map(async (r) => {
      const { preview, link, ownerId } = await resolveTarget(r);
      return { ...r.toJSON(), preview, link, ownerId };
    })
  );
  res.json({ items, ...pageMeta(total, page, limit) });
});

/**
 * Resolve a report.
 * dismiss → no action · hide → hide content · delete → remove content
 * warn → notify owner · suspend → deactivate the owner's account (admin only)
 */
export const resolveReport = asyncHandler(async (req, res) => {
  const { action, note } = req.body;
  const report = await Report.findById(req.params.id);
  if (!report) throw new ApiError(404, 'Report not found');
  if (report.status !== 'pending') throw new ApiError(400, 'This report has already been handled');
  if (action === 'suspend' && req.user.role !== 'admin') throw new ApiError(403, 'Only administrators can suspend accounts');

  const { doc, reply, ownerId } = await resolveTarget(report);

  if (doc && action === 'hide') {
    if (report.targetType === 'reply' && reply) reply.isHidden = true;
    else if (doc.schema.path('isHidden')) doc.isHidden = true;
    else throw new ApiError(400, 'This content type cannot be hidden — choose delete instead');
    await doc.save();
  }
  if (doc && action === 'delete') {
    if (report.targetType === 'reply' && reply) {
      reply.deleteOne();
      await doc.save();
    } else if (report.targetType === 'user') {
      throw new ApiError(400, 'Use suspend for user accounts');
    } else {
      await doc.deleteOne();
    }
  }
  if (action === 'suspend' && ownerId) {
    if (String(ownerId) === String(req.user._id)) throw new ApiError(400, 'You cannot suspend yourself');
    await User.updateOne({ _id: ownerId }, { isActive: false, $inc: { tokenVersion: 1 } });
  }

  report.status = action === 'dismiss' ? 'dismissed' : 'resolved';
  report.resolution = { action, note, by: req.user._id, at: new Date() };
  await report.save();

  // Close other pending reports on the same content.
  if (action !== 'dismiss') {
    await Report.updateMany(
      { _id: { $ne: report._id }, targetType: report.targetType, targetId: report.targetId, replyId: report.replyId, status: 'pending' },
      { status: 'resolved', resolution: report.resolution }
    );
  }

  if (ownerId && ['hide', 'delete', 'warn'].includes(action)) {
    notifyUsers([ownerId], {
      type: 'report',
      title: action === 'warn' ? 'Community guidelines warning' : 'Your content was moderated',
      message: note || `A moderator took action (${action}) on content you posted.`,
    });
  }
  if (report.reporter && action !== 'dismiss') {
    notifyUsers([report.reporter], { type: 'report', title: 'Your report was reviewed', message: 'Thanks for keeping CampusConnect safe.' });
  }

  logActivity(req, `report.${action}`, { entityType: report.targetType, entityId: report.targetId, summary: note });
  res.json({ message: 'Report resolved', status: report.status });
});
