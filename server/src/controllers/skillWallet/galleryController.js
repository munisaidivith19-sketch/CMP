import InnovationProject from '../../models/InnovationProject.js';
import TeamMembership from '../../models/TeamMembership.js';
import NptelCertification from '../../models/NptelCertification.js';
import ProfileLink from '../../models/ProfileLink.js';
import Achievement from '../../models/Achievement.js';
import User from '../../models/User.js';
import { ProjectComment, ProjectContactRequest, ProjectLike, ProjectReport } from '../../models/ProjectInteraction.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { getConfig, labelOf } from '../../services/skillWallet/config.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import { canViewPublished, galleryAudience, isAnyCoordinator, isCollegeUser, isCoordinator, sameId } from '../../services/skillWallet/access.js';
import { assertObjectId, galleryView, teamOf } from '../../services/skillWallet/projects.js';
import { DEPARTMENTS, REPORT_REASONS, SKILL_WALLET_STUDENT_ROLES, SW_PROJECT_STAGES } from '../../constants.js';

/**
 * Innovation Gallery. Every query here reads ONLY the published copy, and
 * every list, detail, interaction, leaderboard and portfolio applies the same
 * audience rule (access.canViewPublished / galleryAudience):
 *   internet visitor → public projects;
 *   signed-in college user → college-only + public projects.
 * Hidden (moderated) and deleted projects never appear.
 *
 * Popularity (likes, comments) is shown and ranked separately from the
 * faculty evaluation score; neither is presented as proof of the other.
 */

const TRENDING_DAYS = 14;
export const LEADERBOARD_CRITERIA = {
  popular: {
    label: 'Community popularity',
    formula: 'likes + 2 × comments',
    note: 'Reflects community engagement only. It is not a measure of technical merit.',
  },
  faculty: {
    label: 'Faculty evaluation',
    formula: 'mean weighted rubric score (0–100) of the faculty reviews that approved the published revision',
    note: 'Only projects with an approving faculty review appear. Likes and comments do not affect this ranking.',
  },
};

function baseFilter(user) {
  return { isDeleted: false, 'moderation.hidden': false, published: { $ne: null }, visibility: galleryAudience(user) };
}

function applyQuery(filter, query) {
  const and = [];
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q)), 'i');
    and.push({ $or: [{ 'published.title': rx }, { 'published.description': rx }, { 'published.skills': rx }, { 'published.domain': rx }] });
  }
  if (query.domain) filter['published.domain'] = String(query.domain).slice(0, 40);
  if (query.stage && SW_PROJECT_STAGES.includes(query.stage)) filter['published.stage'] = query.stage;
  if (query.department && DEPARTMENTS.includes(query.department)) filter.department = query.department;
  if (query.year && /^[1-6]$/.test(String(query.year))) filter.year = Number(query.year);
  if (and.length) filter.$and = and;
  return filter;
}

const SORTS = {
  newest: { 'published.publishedAt': -1, _id: -1 },
  popular: { popularity: -1, 'published.publishedAt': -1 },
  rating: { hasScore: -1, facultyScore: -1, 'published.publishedAt': -1 },
  trending: { trend: -1, popularity: -1, 'published.publishedAt': -1 },
};

async function teamsFor(ids) {
  const rows = await TeamMembership.find({ project: { $in: ids }, status: 'active' }).populate('user', 'name title department avatar').sort({ role: -1, joinedAt: 1 }).lean();
  const map = new Map();
  for (const r of rows) {
    if (!r.user) continue;
    const k = String(r.project);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ role: r.role, user: r.user });
  }
  return map;
}

async function listGallery(user, query, { publicView }) {
  const { page, limit, skip } = paginate({ query }, 12, 30);
  const filter = applyQuery(baseFilter(user), query);
  const sortKey = SORTS[query.sort] ? query.sort : 'newest';
  const pipeline = [
    { $match: filter },
    { $addFields: { popularity: { $add: ['$likeCount', { $multiply: [2, '$commentCount'] }] }, hasScore: { $cond: [{ $gt: ['$facultyScore', null] }, 1, 0] } } },
  ];
  if (sortKey === 'trending') {
    const since = new Date(Date.now() - TRENDING_DAYS * 86400000);
    pipeline.push(
      { $lookup: { from: 'projectlikes', let: { pid: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$project', '$$pid'] }, createdAt: { $gte: since } } }, { $count: 'n' }], as: 'recent' } },
      { $addFields: { trend: { $ifNull: [{ $arrayElemAt: ['$recent.n', 0] }, 0] } } }
    );
  }
  pipeline.push({ $sort: SORTS[sortKey] }, { $skip: skip }, { $limit: limit });
  const [items, total, config] = await Promise.all([InnovationProject.aggregate(pipeline), InnovationProject.countDocuments(filter), getConfig()]);
  const teams = await teamsFor(items.map((p) => p._id));
  const liked = !publicView && user && items.length
    ? new Set((await ProjectLike.find({ user: user._id, project: { $in: items.map((p) => p._id) } }).distinct('project')).map(String))
    : new Set();
  return {
    items: items.map((p) => galleryView(p, { viewer: user, config, team: teams.get(String(p._id)) || [], likedByMe: liked.has(String(p._id)), publicView })),
    ...pageMeta(total, page, limit),
  };
}

/** GET /skill-wallet/public/gallery — internet visitors (public projects only). */
export const publicGallery = asyncHandler(async (req, res) => {
  res.json(await listGallery(null, req.query, { publicView: true }));
});

/** GET /skill-wallet/gallery — signed-in users (college users also see college-only). */
export const gallery = asyncHandler(async (req, res) => {
  res.json(await listGallery(req.user, req.query, { publicView: !isCollegeUser(req.user) }));
});

async function loadVisible(id, user) {
  assertObjectId(id, 'project id');
  const p = await InnovationProject.findById(id).lean();
  // Same answer whether the project is private, hidden, unpublished or absent.
  if (!canViewPublished(user, p)) throw new ApiError(404, 'Project not found');
  return p;
}

async function detail(user, id, { publicView }) {
  const p = await loadVisible(id, user);
  const [config, team] = await Promise.all([getConfig(), teamOf(p._id)]);
  const likedByMe = !publicView && user ? Boolean(await ProjectLike.exists({ project: p._id, user: user._id })) : false;
  return galleryView(p, { viewer: user, config, team, likedByMe, publicView });
}

export const publicProjectDetail = asyncHandler(async (req, res) => {
  res.json(await detail(null, req.params.id, { publicView: true }));
});

export const galleryProjectDetail = asyncHandler(async (req, res) => {
  const view = await detail(req.user, req.params.id, { publicView: !isCollegeUser(req.user) });
  const p = await InnovationProject.findById(req.params.id).select('owner').lean();
  res.json({ ...view, isMine: Boolean(await TeamMembership.exists({ project: req.params.id, user: req.user._id, status: 'active' })), canContact: isCollegeUser(req.user) && !sameId(p.owner, req.user) });
});

// ── Interactions (signed-in college users on projects they can see) ──

async function interactable(req) {
  if (!isCollegeUser(req.user)) throw new ApiError(403, 'Only college members can interact with gallery projects');
  return loadVisible(req.params.id, req.user);
}

/** POST /skill-wallet/projects/:id/like — toggles. Counter kept consistent with the unique like rows. */
export const toggleLike = asyncHandler(async (req, res) => {
  const p = await interactable(req);
  const removed = await ProjectLike.findOneAndDelete({ project: p._id, user: req.user._id });
  if (removed) {
    await InnovationProject.updateOne({ _id: p._id, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
  } else {
    try {
      await ProjectLike.create({ project: p._id, user: req.user._id });
      await InnovationProject.updateOne({ _id: p._id }, { $inc: { likeCount: 1 } });
    } catch (err) {
      if (err.code !== 11000) throw err; // a parallel like already counted
    }
  }
  const fresh = await InnovationProject.findById(p._id).select('likeCount').lean();
  res.json({ liked: !removed, likeCount: fresh.likeCount });
});

const commentView = (c, user, actor) => ({
  _id: c._id,
  body: c.body,
  createdAt: c.createdAt,
  author: c.user ? { name: c.user.name, title: c.user.title, avatar: c.user.avatar, department: c.user.department } : null,
  canDelete: sameId(c.user?._id || c.user, user) || isAnyCoordinator(actor),
});

/** GET /skill-wallet/projects/:id/comments — college users only (never public visitors). */
export const listComments = asyncHandler(async (req, res) => {
  const p = await interactable(req);
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = { project: p._id, status: 'visible' };
  const [items, total] = await Promise.all([
    ProjectComment.find(filter).populate('user', 'name title avatar department').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ProjectComment.countDocuments(filter),
  ]);
  res.json({ items: items.map((c) => commentView(c, req.user, req.swActor)), ...pageMeta(total, page, limit) });
});

export const addComment = asyncHandler(async (req, res) => {
  const p = await interactable(req);
  const body = String(req.body.body || '').trim();
  if (body.length < 1 || body.length > 1000) throw new ApiError(422, 'Comments are 1–1000 characters');
  const c = await ProjectComment.create({ project: p._id, user: req.user._id, body });
  await InnovationProject.updateOne({ _id: p._id }, { $inc: { commentCount: 1 } });
  const members = await TeamMembership.find({ project: p._id, status: 'active' }).distinct('user');
  notifySkillWallet(members, { title: 'New comment on your project', message: `${req.user.name} commented on your gallery project.`, link: `/skill-wallet/gallery/${p._id}` }, { exclude: req.user._id });
  const fresh = await ProjectComment.findById(c._id).populate('user', 'name title avatar department').lean();
  res.status(201).json(commentView(fresh, req.user, req.swActor));
});

/** DELETE /skill-wallet/comments/:id — the author, or a coordinator (moderation). */
export const deleteComment = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'comment id');
  const c = await ProjectComment.findById(req.params.id);
  if (!c || c.status !== 'visible') throw new ApiError(404, 'Comment not found');
  const project = await InnovationProject.findById(c.project).select('department').lean();
  const mine = sameId(c.user, req.user);
  if (!mine && !isCoordinator(req.swActor, project?.department)) throw new ApiError(404, 'Comment not found');
  const updated = await ProjectComment.findOneAndUpdate({ _id: c._id, status: 'visible' }, { $set: { status: mine ? 'deleted' : 'hidden', moderatedBy: mine ? undefined : req.user._id } });
  if (updated) await InnovationProject.updateOne({ _id: c.project, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
  res.json({ ok: true });
});

/** POST /skill-wallet/projects/:id/report { reason, details, commentId? } */
export const reportContent = asyncHandler(async (req, res) => {
  const p = await interactable(req);
  if (!REPORT_REASONS.includes(req.body.reason)) throw new ApiError(422, 'Choose a reason for the report');
  let comment = null;
  if (req.body.commentId) {
    assertObjectId(req.body.commentId, 'comment id');
    const c = await ProjectComment.findOne({ _id: req.body.commentId, project: p._id, status: 'visible' }).select('_id').lean();
    if (!c) throw new ApiError(404, 'Comment not found');
    comment = c._id;
  }
  try {
    await ProjectReport.create({ project: p._id, comment, reporter: req.user._id, reason: req.body.reason, details: String(req.body.details || '').trim().slice(0, 500) });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'You already reported this');
    throw err;
  }
  res.status(201).json({ ok: true });
});

// ── Protected contact requests ──────────────────────────────────────

/** POST /skill-wallet/projects/:id/contact { message } — the owner decides whether to share contact details. */
export const requestContact = asyncHandler(async (req, res) => {
  const p = await interactable(req);
  if (await TeamMembership.exists({ project: p._id, user: req.user._id, status: 'active' })) throw new ApiError(422, 'You are on this team already');
  const message = String(req.body.message || '').trim();
  if (message.length < 10 || message.length > 500) throw new ApiError(422, 'Write a message of 10–500 characters');
  try {
    await ProjectContactRequest.create({ project: p._id, requester: req.user._id, owner: p.owner, message });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'You already have a pending contact request for this project');
    throw err;
  }
  notifySkillWallet([p.owner], { title: 'New contact request', message: 'Someone wants to get in touch about your gallery project.', link: '/skill-wallet?tab=invitations&box=contact' });
  res.status(201).json({ ok: true });
});

/** GET /skill-wallet/contact-requests?box=received|sent */
export const listContactRequests = asyncHandler(async (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'received';
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = box === 'sent' ? { requester: req.user._id } : { owner: req.user._id };
  const [rows, total] = await Promise.all([
    ProjectContactRequest.find(filter)
      .populate('project', 'published.title title')
      .populate('requester', 'name title department role email')
      .populate('owner', 'name title department email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProjectContactRequest.countDocuments(filter),
  ]);
  const items = rows.map((r) => {
    const accepted = r.status === 'accepted';
    const other = box === 'sent' ? r.owner : r.requester;
    return {
      _id: r._id,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
      project: r.project ? { _id: r.project._id, title: r.project.published?.title || r.project.title } : null,
      // The other side's college email is revealed only after the owner accepts.
      person: other ? { name: other.name, title: other.title, department: other.department, ...(accepted ? { email: other.email } : {}) } : null,
    };
  });
  res.json({ items, ...pageMeta(total, page, limit) });
});

/** POST /skill-wallet/contact-requests/:id/respond { decision: accept|decline } — project owner. */
export const respondContact = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'request id');
  if (!['accept', 'decline'].includes(req.body.decision)) throw new ApiError(422, 'Decision must be accept or decline');
  const status = req.body.decision === 'accept' ? 'accepted' : 'declined';
  const r = await ProjectContactRequest.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id, status: 'pending' },
    { $set: { status, respondedAt: new Date() } },
    { new: true }
  );
  if (!r) throw new ApiError(404, 'Contact request not found or already answered');
  notifySkillWallet([r.requester], {
    title: status === 'accepted' ? 'Contact request accepted' : 'Contact request declined',
    message: status === 'accepted' ? 'The project team shared their college email with you.' : 'The project team declined your contact request.',
    link: '/skill-wallet?tab=invitations&box=contact',
  });
  res.json({ status });
});

// ── Leaderboard ────────────────────────────────────────────────────

async function leaderboard(user, board, { publicView }) {
  const key = board === 'faculty' ? 'faculty' : 'popular';
  const match = baseFilter(user);
  if (key === 'faculty') match.facultyScore = { $ne: null };
  const rows = await InnovationProject.aggregate([
    { $match: match },
    { $addFields: { popularity: { $add: ['$likeCount', { $multiply: [2, '$commentCount'] }] } } },
    { $sort: key === 'faculty' ? { facultyScore: -1, 'published.publishedAt': 1 } : { popularity: -1, 'published.publishedAt': 1 } },
    { $limit: 20 },
  ]);
  const [config, teams] = await Promise.all([getConfig(), teamsFor(rows.map((r) => r._id))]);
  return {
    board: key,
    criteria: LEADERBOARD_CRITERIA[key],
    items: rows.map((p, i) => ({
      rank: i + 1,
      score: key === 'faculty' ? Math.round(p.facultyScore) : p.popularity,
      project: galleryView(p, { viewer: user, config, team: teams.get(String(p._id)) || [], publicView }),
    })),
  };
}

export const publicLeaderboard = asyncHandler(async (req, res) => res.json(await leaderboard(null, req.query.board, { publicView: true })));
export const getLeaderboard = asyncHandler(async (req, res) => res.json(await leaderboard(req.user, req.query.board, { publicView: !isCollegeUser(req.user) })));

// ── Portfolio ──────────────────────────────────────────────────────

/**
 * GET /skill-wallet/portfolio/me and /skill-wallet/portfolio/:userId.
 * Self: everything of mine. Others (college users only): published projects
 * they may see, VERIFIED certificates (no hall ticket), college / public
 * links, and the existing VEXON achievements.
 */
export const portfolio = asyncHandler(async (req, res) => {
  const self = !req.params.userId || req.params.userId === 'me' || sameId(req.params.userId, req.user);
  if (!self && !isCollegeUser(req.user)) throw new ApiError(403, 'Only college members can view portfolios');
  const userId = self ? req.user._id : req.params.userId;
  if (!self) assertObjectId(userId, 'student id');
  const student = await User.findOne({ _id: userId, role: { $in: SKILL_WALLET_STUDENT_ROLES }, isActive: true }).select('name title department year avatar bio').lean();
  if (!student) throw new ApiError(404, 'Student not found');

  const config = await getConfig();
  const memberOf = await TeamMembership.find({ user: userId, status: 'active' }).distinct('project');
  const projectFilter = self
    ? { _id: { $in: memberOf }, isDeleted: false }
    : { _id: { $in: memberOf }, ...baseFilter(req.user) };
  const [projects, certs, links, achievements] = await Promise.all([
    InnovationProject.find(projectFilter).sort({ updatedAt: -1 }).limit(50).lean(),
    NptelCertification.find({ student: userId, isDeleted: false, ...(self ? {} : { status: 'verified' }) }).sort({ endDate: -1 }).limit(100).lean(),
    ProfileLink.find({ user: userId, ...(self ? {} : { visibility: { $in: ['college', 'public'] } }) }).sort({ createdAt: 1 }).lean(),
    Achievement.find({ isDeleted: false, students: userId }).select('title category level position achievedOn eventName').sort({ achievedOn: -1 }).limit(50).lean(),
  ]);
  const teams = await teamsFor(projects.map((p) => p._id));

  res.json({
    self,
    student: { name: student.name, title: student.title, department: student.department, year: student.year, avatar: student.avatar, bio: student.bio },
    projects: projects.map((p) =>
      self
        ? {
            _id: p._id,
            title: p.title,
            domain: { key: p.domain, label: labelOf(config.domains, p.domain) },
            stage: p.stage,
            skills: p.skills,
            visibility: p.visibility,
            reviewStatus: p.review?.status,
            approved: p.review?.approvedRevision != null,
            facultyScore: p.facultyScore == null ? null : Math.round(p.facultyScore),
          }
        : galleryView(p, { viewer: req.user, config, team: teams.get(String(p._id)) || [] })
    ),
    certifications: certs.map((c) => ({
      _id: c._id,
      courseName: c.courseName,
      institution: c.institution === 'other' && c.institutionOther ? c.institutionOther : labelOf(config.institutions, c.institution),
      durationWeeks: c.durationWeeks,
      credits: c.credits,
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
    })),
    links: links.map((l) => ({ _id: l._id, platform: l.platform, displayName: l.displayName, url: l.url, description: l.description, ...(self ? { visibility: l.visibility } : {}) })),
    achievements,
    skills: [...new Set(projects.flatMap((p) => (self ? p.skills : p.published?.skills) || []))].slice(0, 40),
  });
});

