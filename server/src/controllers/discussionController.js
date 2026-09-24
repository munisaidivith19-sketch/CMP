import mongoose from 'mongoose';
import Discussion from '../models/Discussion.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { isModerator, sameId } from '../utils/permissions.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';
import { autoFlag, containsBlockedContent } from '../utils/moderation.js';
import { emitTo } from '../config/socket.js';

const AUTHOR = 'name avatar role department';

/** Aggregation-based listing: counts are computed in the database. */
export const listDiscussions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10);
  const { q, category, club, sort = 'latest', author } = req.query;
  const uid = req.user._id;
  const mod = isModerator(req.user);

  const match = {};
  if (!mod) match.isHidden = false;
  if (category) match.category = category;
  if (club && mongoose.isValidObjectId(club)) match.club = new mongoose.Types.ObjectId(club);
  if (author && mongoose.isValidObjectId(author)) match.author = new mongoose.Types.ObjectId(author);
  if (sort === 'unanswered') match['replies.0'] = { $exists: false };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    match.$or = [{ title: rx }, { body: rx }, { tags: rx }];
  }

  const sortStage =
    sort === 'top'
      ? { isPinned: -1, upvoteCount: -1, lastActivityAt: -1 }
      : { isPinned: -1, lastActivityAt: -1 };

  const [result] = await Discussion.aggregate([
    { $match: match },
    {
      $addFields: {
        upvoteCount: { $size: '$upvotes' },
        hasUpvoted: { $in: [uid, '$upvotes'] },
        replyCount: {
          $size: { $filter: { input: '$replies', as: 'r', cond: { $eq: ['$$r.isHidden', false] } } },
        },
        excerpt: { $substrCP: ['$body', 0, 220] },
      },
    },
    { $project: { replies: 0, upvotes: 0, body: 0 } },
    { $sort: sortStage },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'author',
              foreignField: '_id',
              as: 'author',
              pipeline: [{ $project: { name: 1, avatar: 1, role: 1, department: 1 } }],
            },
          },
          { $unwind: '$author' },
          {
            $lookup: {
              from: 'clubs',
              localField: 'club',
              foreignField: '_id',
              as: 'club',
              pipeline: [{ $project: { name: 1, slug: 1 } }],
            },
          },
          { $unwind: { path: '$club', preserveNullAndEmptyArrays: true } },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  const total = result.total[0]?.count || 0;
  res.json({ items: result.items, ...pageMeta(total, page, limit) });
});

async function findDiscussion(id, user) {
  const d = await Discussion.findById(id);
  if (!d || (d.isHidden && !isModerator(user) && !sameId(d.author, user))) {
    throw new ApiError(404, 'Discussion not found');
  }
  return d;
}

function shapeDiscussion(d, user) {
  const obj = d.toJSON();
  const mod = isModerator(user);
  return {
    ...obj,
    upvoteCount: obj.upvotes.length,
    hasUpvoted: obj.upvotes.some((u) => sameId(u, user)),
    upvotes: undefined,
    canEdit: sameId(obj.author, user),
    canModerate: mod,
    replies: obj.replies
      .filter((r) => mod || !r.isHidden)
      .map((r) => ({
        ...r,
        upvoteCount: r.upvotes.length,
        hasUpvoted: r.upvotes.some((u) => sameId(u, user)),
        upvotes: undefined,
        canDelete: mod || sameId(r.author, user),
      })),
  };
}

export const getDiscussion = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  await Discussion.updateOne({ _id: d._id }, { $inc: { views: 1 } });
  await d.populate([
    { path: 'author', select: AUTHOR },
    { path: 'replies.author', select: AUTHOR },
    { path: 'club', select: 'name slug' },
  ]);
  res.json(shapeDiscussion(d, req.user));
});

export const createDiscussion = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['title', 'body', 'category', 'tags', 'club']);
  const flagged = containsBlockedContent(data.title, data.body);
  const d = await Discussion.create({ ...data, author: req.user._id, flagged });
  if (flagged) autoFlag({ targetType: 'discussion', targetId: d._id, excerpt: data.title });
  logActivity(req, 'discussion.create', { entityType: 'discussion', entityId: d._id, summary: d.title });
  res.status(201).json(d);
});

export const updateDiscussion = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  if (!sameId(d.author, req.user)) throw new ApiError(403, 'You can only edit your own posts');
  if (d.isLocked) throw new ApiError(400, 'This discussion is locked');
  Object.assign(d, pick(req.body, ['title', 'body', 'category', 'tags']));
  if (containsBlockedContent(d.title, d.body)) {
    d.flagged = true;
    autoFlag({ targetType: 'discussion', targetId: d._id, excerpt: d.title });
  }
  await d.save();
  res.json(d);
});

export const deleteDiscussion = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  if (!sameId(d.author, req.user) && !isModerator(req.user)) throw new ApiError(403, 'Not allowed');
  await d.deleteOne();
  logActivity(req, 'discussion.delete', { entityType: 'discussion', entityId: d._id, summary: d.title });
  res.json({ message: 'Discussion deleted' });
});

export const addReply = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  if (d.isLocked) throw new ApiError(400, 'This discussion is locked');
  const body = String(req.body.body || '').trim();
  const flagged = containsBlockedContent(body);

  d.replies.push({ author: req.user._id, body, flagged });
  d.lastActivityAt = new Date();
  await d.save();
  const reply = d.replies[d.replies.length - 1];
  if (flagged) autoFlag({ targetType: 'reply', targetId: d._id, replyId: reply._id, excerpt: body });

  notifyUsers(
    [d.author],
    {
      type: 'discussion',
      title: `${req.user.name} replied to “${d.title.slice(0, 60)}”`,
      message: body.slice(0, 120),
      link: `/discussions/${d._id}`,
    },
    { exclude: req.user._id }
  );
  emitTo(`discussion:${d._id}`, 'discussion:reply', { discussionId: String(d._id) });
  logActivity(req, 'discussion.reply', { entityType: 'discussion', entityId: d._id, summary: d.title });
  res.status(201).json({ message: 'Reply posted' });
});

export const deleteReply = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  const reply = d.replies.id(req.params.replyId);
  if (!reply) throw new ApiError(404, 'Reply not found');
  if (!sameId(reply.author, req.user) && !isModerator(req.user)) throw new ApiError(403, 'Not allowed');
  reply.deleteOne();
  await d.save();
  emitTo(`discussion:${d._id}`, 'discussion:reply', { discussionId: String(d._id) });
  res.json({ message: 'Reply deleted' });
});

export const toggleUpvote = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  const has = d.upvotes.some((u) => sameId(u, req.user));
  await Discussion.updateOne({ _id: d._id }, has ? { $pull: { upvotes: req.user._id } } : { $addToSet: { upvotes: req.user._id } });
  res.json({ hasUpvoted: !has });
});

export const toggleReplyUpvote = asyncHandler(async (req, res) => {
  const d = await findDiscussion(req.params.id, req.user);
  const reply = d.replies.id(req.params.replyId);
  if (!reply) throw new ApiError(404, 'Reply not found');
  const has = reply.upvotes.some((u) => sameId(u, req.user));
  if (has) reply.upvotes.pull(req.user._id);
  else reply.upvotes.addToSet(req.user._id);
  await d.save();
  res.json({ hasUpvoted: !has });
});

/** Moderator actions: lock / pin / hide toggles. */
export const moderateDiscussion = asyncHandler(async (req, res) => {
  const d = await Discussion.findById(req.params.id);
  if (!d) throw new ApiError(404, 'Discussion not found');
  const field = { lock: 'isLocked', pin: 'isPinned', hide: 'isHidden' }[req.params.action];
  d[field] = !d[field];
  await d.save();
  logActivity(req, `discussion.${req.params.action}`, { entityType: 'discussion', entityId: d._id, summary: d.title });
  res.json({ [field]: d[field] });
});
