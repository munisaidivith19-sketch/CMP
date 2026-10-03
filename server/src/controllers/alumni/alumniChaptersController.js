import Chapter from '../../models/Chapter.js';
import ChapterMember from '../../models/ChapterMember.js';
import ChapterPost from '../../models/ChapterPost.js';
import ChapterComment from '../../models/ChapterComment.js';
import AlumniProfile from '../../models/AlumniProfile.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler, pageMeta, paginate, pick } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { notifyUsers } from '../../utils/notify.js';
import { emitTo } from '../../config/socket.js';
import { sameId } from '../../utils/permissions.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar designation';

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── GET /api/alumni/chapters ───────────────────────────────────────
export const listChapters = asyncHandler(async (req, res) => {
  const { type, mine } = req.query;
  const user = req.user;
  const filter = { archived: false };

  if (type) filter.type = type;

  if (mine === 'true') {
    const myChapterIds = await ChapterMember.find({ user: user._id, status: 'active' }).distinct('chapter');
    filter._id = { $in: myChapterIds };
  } else if (!['admin', 'hod', 'principal'].includes(user.role)) {
    // If not staff, show public chapters + private ones user belongs to
    const myChapterIds = await ChapterMember.find({ user: user._id, status: 'active' }).distinct('chapter');
    filter.$or = [{ isPrivate: false }, { _id: { $in: myChapterIds } }];
  }

  const chapters = await Chapter.find(filter).sort({ memberCount: -1, createdAt: -1 }).lean();

  if (chapters.length) {
    const chapterIds = chapters.map((c) => c._id);
    const memberships = await ChapterMember.find({ chapter: { $in: chapterIds }, user: user._id }).lean();
    const memMap = Object.fromEntries(memberships.map((m) => [String(m.chapter), m]));

    for (const ch of chapters) {
      const membership = memMap[String(ch._id)];
      ch.isMember = membership?.status === 'active';
      ch.membershipRole = membership?.role || null;
      ch.membershipStatus = membership?.status || null;
    }
  }

  res.json(chapters);
});

// ── POST /api/alumni/chapters ──────────────────────────────────────
export const createChapter = asyncHandler(async (req, res) => {
  const user = req.user;
  const allowed = ['name', 'type', 'gradYear', 'department', 'city', 'description', 'cover', 'isPrivate'];
  const body = pick(req.body, allowed);

  if (!body.name || body.name.trim().length < 3) {
    throw new ApiError(422, 'Chapter name must be at least 3 characters');
  }

  let slug = slugify(body.name);
  let count = 1;
  while (await Chapter.findOne({ slug })) {
    slug = `${slugify(body.name)}-${count++}`;
  }

  const chapter = await Chapter.create({
    createdBy: user._id,
    slug,
    ...body,
  });

  // Creator is moderator
  await ChapterMember.create({
    chapter: chapter._id,
    user: user._id,
    role: 'moderator',
    status: 'active',
  });
  await Chapter.updateOne({ _id: chapter._id }, { $inc: { memberCount: 1 } });

  // Optional: Backfill members for batch or department chapters
  if (req.body.autoJoin) {
    let alumniUsers = [];
    if (chapter.type === 'batch' && chapter.gradYear) {
      const profiles = await AlumniProfile.find({ gradYear: chapter.gradYear, isVerified: true }).distinct('user');
      alumniUsers = profiles;
    } else if (chapter.type === 'department' && chapter.department) {
      alumniUsers = await User.find({ role: 'alumni', department: chapter.department, isActive: true }).distinct('_id');
    }

    if (alumniUsers.length > 0) {
      const members = alumniUsers
        .filter((uid) => !sameId(uid, user._id))
        .map((uid) => ({
          chapter: chapter._id,
          user: uid,
          role: 'member',
          status: 'active',
        }));
      await ChapterMember.insertMany(members, { ordered: false }).catch(() => {});
      const actualCount = await ChapterMember.countDocuments({ chapter: chapter._id, status: 'active' });
      await Chapter.updateOne({ _id: chapter._id }, { memberCount: actualCount });
    }
  }

  logActivity(req, 'alumni.chapter_created', { entityType: 'chapter', entityId: chapter._id });
  res.status(201).json(chapter);
});

// ── GET /api/alumni/chapters/:slug ─────────────────────────────────
export const getChapterBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug, archived: false }).populate('createdBy', PUBLIC_USER_FIELDS);
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const user = req.user;
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);
  const membership = await ChapterMember.findOne({ chapter: chapter._id, user: user._id });

  if (chapter.isPrivate && !isStaff && membership?.status !== 'active') {
    return res.json({
      _id: chapter._id,
      name: chapter.name,
      slug: chapter.slug,
      type: chapter.type,
      description: chapter.description,
      isPrivate: true,
      memberCount: chapter.memberCount,
      membershipStatus: membership?.status || null,
      restricted: true,
    });
  }

  const out = chapter.toObject();
  out.isMember = membership?.status === 'active';
  out.membershipRole = membership?.role || null;
  out.membershipStatus = membership?.status || null;

  res.json(out);
});

// ── PATCH /api/alumni/chapters/:slug ───────────────────────────────
export const updateChapter = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const user = req.user;
  const membership = await ChapterMember.findOne({ chapter: chapter._id, user: user._id, status: 'active' });
  const isModerator = membership?.role === 'moderator';
  const isAdmin = user.role === 'admin';

  if (!isModerator && !isAdmin) throw new ApiError(403, 'Permission denied');

  const allowed = ['name', 'description', 'cover', 'isPrivate'];
  Object.assign(chapter, pick(req.body, allowed));
  await chapter.save();

  res.json(chapter);
});

// ── DELETE /api/alumni/chapters/:slug (Archive) ────────────────────
export const archiveChapter = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  if (req.user.role !== 'admin') throw new ApiError(403, 'Only admins can archive chapters');

  chapter.archived = true;
  await chapter.save();

  res.json({ ok: true, message: 'Chapter archived' });
});

// ── POST /api/alumni/chapters/:slug/join ───────────────────────────
export const joinChapter = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug, archived: false });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const user = req.user;
  if (['student', 'club_admin'].includes(user.role)) {
    throw new ApiError(403, 'Students have read-only access to alumni chapters');
  }

  let membership = await ChapterMember.findOne({ chapter: chapter._id, user: user._id });
  if (membership && membership.status === 'active') {
    return res.json(membership);
  }

  const assignedStatus = chapter.isPrivate ? 'pending' : 'active';

  if (membership) {
    membership.status = assignedStatus;
    await membership.save();
  } else {
    membership = await ChapterMember.create({
      chapter: chapter._id,
      user: user._id,
      status: assignedStatus,
    });
  }

  if (assignedStatus === 'active') {
    await Chapter.updateOne({ _id: chapter._id }, { $inc: { memberCount: 1 } });
  }

  res.status(201).json(membership);
});

// ── DELETE /api/alumni/chapters/:slug/join (Leave) ─────────────────
export const leaveChapter = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const membership = await ChapterMember.findOneAndDelete({ chapter: chapter._id, user: req.user._id });
  if (membership && membership.status === 'active') {
    await Chapter.updateOne({ _id: chapter._id, memberCount: { $gt: 0 } }, { $inc: { memberCount: -1 } });
  }

  res.json({ ok: true, message: 'Left chapter' });
});

// ── PATCH /api/alumni/chapters/:slug/members/:userId ───────────────
export const approveMember = asyncHandler(async (req, res) => {
  const { slug, userId } = req.params;
  const { status, role } = req.body;
  const chapter = await Chapter.findOne({ slug });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const myMem = await ChapterMember.findOne({ chapter: chapter._id, user: req.user._id, status: 'active' });
  if (myMem?.role !== 'moderator' && req.user.role !== 'admin') {
    throw new ApiError(403, 'Permission denied');
  }

  const target = await ChapterMember.findOne({ chapter: chapter._id, user: userId });
  if (!target) throw new ApiError(404, 'Membership request not found');

  const wasPending = target.status === 'pending';
  if (status) target.status = status;
  if (role) target.role = role;
  await target.save();

  if (wasPending && status === 'active') {
    await Chapter.updateOne({ _id: chapter._id }, { $inc: { memberCount: 1 } });

    await notifyUsers([userId], {
      type: 'alumni',
      title: 'Chapter Membership Approved! 🎉',
      message: `You are now a member of ${chapter.name}.`,
      link: `/alumni/chapters/${chapter.slug}`,
    });
  }

  res.json(target);
});

// ── GET /api/alumni/chapters/:slug/members ─────────────────────────
export const listMembers = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const chapter = await Chapter.findOne({ slug });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const members = await ChapterMember.find({ chapter: chapter._id, status: 'active' })
    .populate('user', PUBLIC_USER_FIELDS)
    .sort({ role: -1, createdAt: 1 })
    .lean();

  res.json(members);
});

// ── GET /api/alumni/chapters/:slug/posts ───────────────────────────
export const listPosts = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page, limit, skip } = paginate(req, 15, 50);

  const chapter = await Chapter.findOne({ slug, archived: false });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const filter = { chapter: chapter._id, deletedAt: null };

  const [items, total] = await Promise.all([
    ChapterPost.find(filter)
      .populate('author', PUBLIC_USER_FIELDS)
      .sort({ pinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ChapterPost.countDocuments(filter),
  ]);

  const user = req.user;
  const withLikes = items.map((p) => {
    p.hasLiked = p.likes?.some((id) => sameId(id, user._id)) || false;
    delete p.likes;
    return p;
  });

  res.json({
    items: withLikes,
    ...pageMeta(total, page, limit),
  });
});

// ── POST /api/alumni/chapters/:slug/posts ──────────────────────────
export const createPost = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { body, images, kind = 'post' } = req.body;
  const user = req.user;

  const chapter = await Chapter.findOne({ slug, archived: false });
  if (!chapter) throw new ApiError(404, 'Chapter not found');

  const membership = await ChapterMember.findOne({ chapter: chapter._id, user: user._id, status: 'active' });
  const isModerator = membership?.role === 'moderator' || user.role === 'admin';

  if (!membership && user.role !== 'admin') {
    throw new ApiError(403, 'Must be an active chapter member to post');
  }

  if (kind === 'announcement' && !isModerator) {
    throw new ApiError(403, 'Only chapter moderators can post announcements');
  }

  const post = await ChapterPost.create({
    chapter: chapter._id,
    author: user._id,
    kind,
    body: body.trim(),
    images: Array.isArray(images) ? images.slice(0, 4) : [],
  });

  await Chapter.updateOne({ _id: chapter._id }, { $inc: { postCount: 1 } });
  await post.populate('author', PUBLIC_USER_FIELDS);

  emitTo(`chapter:${chapter._id}`, 'alumni:chapter_post', post.toJSON());

  res.status(201).json(post);
});

// ── DELETE /api/alumni/chapters/posts/:id ──────────────────────────
export const deletePost = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const post = await ChapterPost.findById(id);
  if (!post || post.deletedAt) throw new ApiError(404, 'Post not found');

  const user = req.user;
  const isAuthor = sameId(post.author, user._id);
  let isModerator = user.role === 'admin';

  if (!isModerator) {
    const mem = await ChapterMember.findOne({ chapter: post.chapter, user: user._id, status: 'active' });
    if (mem?.role === 'moderator') isModerator = true;
  }

  if (!isAuthor && !isModerator) throw new ApiError(403, 'Permission denied');

  post.deletedAt = new Date();
  post.deletedBy = user._id;
  await post.save();

  await Chapter.updateOne({ _id: post.chapter, postCount: { $gt: 0 } }, { $inc: { postCount: -1 } });

  res.json({ ok: true, message: 'Post deleted' });
});

// ── PATCH /api/alumni/chapters/posts/:id/pin ───────────────────────
export const pinPost = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const post = await ChapterPost.findById(id);
  if (!post || post.deletedAt) throw new ApiError(404, 'Post not found');

  const user = req.user;
  let isModerator = user.role === 'admin';
  if (!isModerator) {
    const mem = await ChapterMember.findOne({ chapter: post.chapter, user: user._id, status: 'active' });
    if (mem?.role === 'moderator') isModerator = true;
  }

  if (!isModerator) throw new ApiError(403, 'Permission denied');

  post.pinned = !post.pinned;
  await post.save();

  res.json({ ok: true, pinned: post.pinned });
});

// ── POST /api/alumni/chapters/posts/:id/like ───────────────────────
export const toggleLikePost = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const post = await ChapterPost.findById(id);
  if (!post || post.deletedAt) throw new ApiError(404, 'Post not found');

  const hasLiked = post.likes.some((uid) => sameId(uid, user._id));

  if (hasLiked) {
    await ChapterPost.updateOne(
      { _id: post._id },
      { $pull: { likes: user._id }, $inc: { likeCount: -1 } }
    );
  } else {
    await ChapterPost.updateOne(
      { _id: post._id },
      { $addToSet: { likes: user._id }, $inc: { likeCount: 1 } }
    );
  }

  res.json({ ok: true, hasLiked: !hasLiked });
});

// ── Comments ───────────────────────────────────────────────────────
export const listComments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const comments = await ChapterComment.find({ post: id, deletedAt: null })
    .populate('author', PUBLIC_USER_FIELDS)
    .sort({ createdAt: 1 })
    .lean();

  res.json(comments);
});

export const addComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const user = req.user;

  const post = await ChapterPost.findById(id);
  if (!post || post.deletedAt) throw new ApiError(404, 'Post not found');

  const comment = await ChapterComment.create({
    post: post._id,
    author: user._id,
    body: String(body).trim().slice(0, 600),
  });

  await ChapterPost.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
  await comment.populate('author', PUBLIC_USER_FIELDS);

  res.status(201).json(comment);
});

export const deleteComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const comment = await ChapterComment.findById(id);
  if (!comment || comment.deletedAt) throw new ApiError(404, 'Comment not found');

  if (!sameId(comment.author, req.user._id) && req.user.role !== 'admin') {
    throw new ApiError(403, 'Permission denied');
  }

  comment.deletedAt = new Date();
  await comment.save();

  await ChapterPost.updateOne({ _id: comment.post, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
  res.json({ ok: true, message: 'Comment deleted' });
});
