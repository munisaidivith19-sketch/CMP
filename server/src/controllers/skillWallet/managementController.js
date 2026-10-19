import InnovationProject from '../../models/InnovationProject.js';
import InnovationRecommendation from '../../models/InnovationRecommendation.js';
import ProjectMilestone from '../../models/ProjectMilestone.js';
import SkillWalletConfig from '../../models/SkillWalletConfig.js';
import SkillWalletDesignation from '../../models/SkillWalletDesignation.js';
import NptelCertification from '../../models/NptelCertification.js';
import User from '../../models/User.js';
import { ProjectComment, ProjectReport } from '../../models/ProjectInteraction.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate } from '../../utils/http.js';
import { logAudit } from '../../utils/auditLog.js';
import { getConfig, normaliseOptions, normaliseRubric } from '../../services/skillWallet/config.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import {
  activeMemberIds,
  coordinatorScope,
  isAnyCoordinator,
  isCoordinator,
  isReviewerEligible,
  sameId,
} from '../../services/skillWallet/access.js';
import { assertObjectId, loadProject, logPublication } from '../../services/skillWallet/projects.js';
import {
  DEPARTMENTS,
  SKILL_WALLET_CAPABILITIES,
  SKILL_WALLET_DESIGNATION_GRANTORS,
  SKILL_WALLET_STAFF_ROLES,
  SW_RECOMMENDATION_STATUSES,
} from '../../constants.js';

/**
 * Innovation Management (IIC / innovation coordinators) and Skill Wallet
 * administration.
 *
 *  - Designations: granted / revoked by the Principal only. Holding the
 *    Principal role does not by itself confer review or publication rights.
 *  - Coordinators (campus or department scope): reviewer assignment,
 *    recommendations, milestone verification, moderation, configuration
 *    (campus scope only).
 *  - Moderators hide content temporarily with a recorded reason; hiding
 *    never deletes and never publishes. Every action is audited.
 */

function requireCoordinator(req, department) {
  if (department === undefined ? !isAnyCoordinator(req.swActor) : !isCoordinator(req.swActor, department)) {
    throw new ApiError(403, 'Only innovation coordinators can do this');
  }
}

/** Department restriction for list queries of a department-scoped coordinator. */
function scopeFilter(req, field = 'department') {
  const scope = coordinatorScope(req.swActor);
  return scope === null ? {} : { [field]: { $in: scope } };
}

// ── Overview ───────────────────────────────────────────────────────

export const overview = asyncHandler(async (req, res) => {
  requireCoordinator(req);
  const dept = scopeFilter(req);
  const projectIds = Object.keys(dept).length ? await InnovationProject.find({ ...dept, isDeleted: false }).distinct('_id') : null;
  const byProject = projectIds ? { project: { $in: projectIds } } : {};
  const [awaitingReview, unassigned, recommendations, milestones, reports, hidden, published] = await Promise.all([
    InnovationProject.countDocuments({ ...dept, isDeleted: false, 'review.status': 'submitted' }),
    InnovationProject.countDocuments({ ...dept, isDeleted: false, 'review.status': 'submitted', 'review.reviewers.0': { $exists: false } }),
    InnovationRecommendation.countDocuments({ ...byProject, status: 'open' }),
    ProjectMilestone.countDocuments({ ...byProject, status: 'claimed' }),
    ProjectReport.countDocuments({ ...byProject, status: 'open' }),
    InnovationProject.countDocuments({ ...dept, isDeleted: false, 'moderation.hidden': true }),
    InnovationProject.countDocuments({ ...dept, isDeleted: false, published: { $ne: null }, visibility: { $ne: 'private' } }),
  ]);
  res.json({ awaitingReview, unassigned, recommendations, milestones, reports, hidden, published, scope: coordinatorScope(req.swActor) });
});

// ── Reviewer assignment ────────────────────────────────────────────

/** GET /skill-wallet/management/staff?q= — staff who may be assigned / designated. */
export const searchStaff = asyncHandler(async (req, res) => {
  if (!isAnyCoordinator(req.swActor) && !SKILL_WALLET_DESIGNATION_GRANTORS.includes(req.user.role)) {
    throw new ApiError(403, 'Only innovation coordinators can search staff');
  }
  const clauses = [{ role: { $in: SKILL_WALLET_STAFF_ROLES } }, { isActive: true }];
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    clauses.push({ $or: [{ name: rx }, { employeeId: rx }, { department: rx }] });
  }
  const items = await User.find({ $and: clauses }).select('name title role department designation').sort({ name: 1 }).limit(20).lean();
  res.json({ items });
});

/** PUT /skill-wallet/management/projects/:id/reviewers { reviewerIds: [] } */
export const assignReviewers = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  requireCoordinator(req, project.department);
  if (!project.review.submittedRevision) throw new ApiError(409, 'Reviewers can be assigned once the project is submitted');
  const ids = [...new Set((Array.isArray(req.body.reviewerIds) ? req.body.reviewerIds : []).map(String))];
  if (ids.length > 5) throw new ApiError(422, 'Assign at most 5 reviewers');
  ids.forEach((id) => assertObjectId(id, 'reviewer id'));
  const users = await User.find({ _id: { $in: ids } }).select('role isActive').lean();
  if (users.length !== ids.length || !users.every(isReviewerEligible)) throw new ApiError(422, 'Reviewers must be active faculty, HOD, Principal or Dean accounts');
  const members = (await activeMemberIds(project._id)).map(String);
  if (ids.some((id) => members.includes(id))) throw new ApiError(422, 'A team member cannot review their own project');

  const before = new Set(project.review.reviewers.map(String));
  project.review.reviewers = ids;
  await project.save();
  const added = ids.filter((id) => !before.has(id));
  notifySkillWallet(added, { title: 'Project assigned for review', message: 'You were assigned a Skill Wallet project to review.', link: `/skill-wallet/review/projects/${project._id}` });
  logAudit(req, 'SKILL_WALLET_REVIEWER_ASSIGNED', { target: project.owner, details: { project: String(project._id), reviewers: ids } });
  res.json({ reviewers: ids });
});

// ── Recommendations ────────────────────────────────────────────────

export const listRecommendations = asyncHandler(async (req, res) => {
  requireCoordinator(req);
  const { page, limit, skip } = paginate(req, 20, 50);
  const dept = scopeFilter(req);
  const filter = { status: SW_RECOMMENDATION_STATUSES.includes(req.query.status) ? req.query.status : 'open' };
  if (Object.keys(dept).length) filter.project = { $in: await InnovationProject.find(dept).distinct('_id') };
  const [items, total] = await Promise.all([
    InnovationRecommendation.find(filter)
      .populate('project', 'title department review.approvedRevision facultyScore')
      .populate('recommendedBy', 'name title')
      .populate('handledBy', 'name title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InnovationRecommendation.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

/** PATCH /skill-wallet/management/recommendations/:id { status, note } — tracking only; no funds move. */
export const updateRecommendation = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'recommendation id');
  const rec = await InnovationRecommendation.findById(req.params.id);
  if (!rec) throw new ApiError(404, 'Recommendation not found');
  const project = await InnovationProject.findById(rec.project).select('department owner').lean();
  requireCoordinator(req, project?.department);
  if (!['acknowledged', 'closed'].includes(req.body.status)) throw new ApiError(422, 'Status must be acknowledged or closed');
  rec.status = req.body.status;
  rec.handledBy = req.user._id;
  rec.handledAt = new Date();
  rec.handlingNote = String(req.body.note || '').trim().slice(0, 1000);
  await rec.save();
  logAudit(req, 'SKILL_WALLET_RECOMMENDATION', { target: project?.owner, details: { recommendation: String(rec._id), status: rec.status } });
  res.json(rec);
});

// ── Milestones ─────────────────────────────────────────────────────

export const listMilestones = asyncHandler(async (req, res) => {
  requireCoordinator(req);
  const { page, limit, skip } = paginate(req, 20, 50);
  const dept = scopeFilter(req);
  const filter = { status: ['claimed', 'verified', 'rejected'].includes(req.query.status) ? req.query.status : 'claimed' };
  if (Object.keys(dept).length) filter.project = { $in: await InnovationProject.find(dept).distinct('_id') };
  const [items, total] = await Promise.all([
    ProjectMilestone.find(filter).populate('project', 'title department').populate('claimedBy', 'name title').populate('decidedBy', 'name title').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    ProjectMilestone.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

/** PATCH /skill-wallet/management/milestones/:id { decision: verified|rejected, note } */
export const decideMilestone = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'milestone id');
  const m = await ProjectMilestone.findById(req.params.id);
  if (!m) throw new ApiError(404, 'Milestone not found');
  const project = await InnovationProject.findById(m.project).select('department owner').lean();
  requireCoordinator(req, project?.department);
  if (!['verified', 'rejected'].includes(req.body.decision)) throw new ApiError(422, 'Decision must be verified or rejected');
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (req.body.decision === 'rejected' && note.length < 5) throw new ApiError(422, 'Give a reason (at least 5 characters)');
  const updated = await ProjectMilestone.findOneAndUpdate(
    { _id: m._id, status: 'claimed' },
    { $set: { status: req.body.decision, decidedBy: req.user._id, decidedAt: new Date(), decisionNote: note } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This milestone was already decided');
  logAudit(req, 'SKILL_WALLET_MILESTONE_DECISION', { target: project?.owner, details: { milestone: String(m._id), decision: req.body.decision } });
  notifySkillWallet(await activeMemberIds(m.project), { title: 'Milestone reviewed', message: `A project milestone was ${req.body.decision}.`, link: `/skill-wallet/projects/${m.project}` });
  res.json(updated);
});

// ── Moderation ─────────────────────────────────────────────────────

export const listReports = asyncHandler(async (req, res) => {
  requireCoordinator(req);
  const { page, limit, skip } = paginate(req, 20, 50);
  const dept = scopeFilter(req);
  const filter = { status: ['open', 'dismissed', 'actioned'].includes(req.query.status) ? req.query.status : 'open' };
  if (Object.keys(dept).length) filter.project = { $in: await InnovationProject.find(dept).distinct('_id') };
  const [items, total] = await Promise.all([
    ProjectReport.find(filter)
      .populate('project', 'published.title title department moderation.hidden visibility')
      .populate('comment', 'body status')
      .populate('reporter', 'name title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProjectReport.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

async function setHidden(req, project, hidden, reason) {
  const was = Boolean(project.moderation?.hidden);
  if (was === hidden) return;
  project.moderation = hidden ? { hidden: true, reason, by: req.user._id, at: new Date() } : { hidden: false, reason: '', by: req.user._id, at: new Date() };
  await InnovationProject.updateOne({ _id: project._id }, { $set: { moderation: project.moderation }, $inc: { __v: 1 } });
  logPublication(project, req.user, hidden ? 'hidden' : 'unhidden', { from: project.visibility, to: project.visibility, note: reason });
  logAudit(req, 'SKILL_WALLET_MODERATION', { target: project.owner, reason, details: { project: String(project._id), action: hidden ? 'hide' : 'unhide' } });
  notifySkillWallet(await activeMemberIds(project._id), {
    title: hidden ? 'Project hidden by a moderator' : 'Project visible again',
    message: hidden ? 'A moderator temporarily hid your project from the gallery.' : 'A moderator restored your project in the gallery.',
    link: `/skill-wallet/projects/${project._id}?tab=publication`,
  });
}

/** PATCH /skill-wallet/management/reports/:id { action: dismiss|hide_project|hide_comment, note } */
export const resolveReport = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'report id');
  const report = await ProjectReport.findById(req.params.id);
  if (!report || report.status !== 'open') throw new ApiError(404, 'Report not found');
  const project = await InnovationProject.findById(report.project).lean();
  requireCoordinator(req, project?.department);
  const action = req.body.action;
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!['dismiss', 'hide_project', 'hide_comment'].includes(action)) throw new ApiError(422, 'Choose dismiss, hide project or hide comment');
  if (action !== 'dismiss' && note.length < 5) throw new ApiError(422, 'Record a reason (at least 5 characters)');
  if (action === 'hide_project' && project) await setHidden(req, project, true, note);
  if (action === 'hide_comment') {
    if (!report.comment) throw new ApiError(422, 'This report is not about a comment');
    const c = await ProjectComment.findOneAndUpdate({ _id: report.comment, status: 'visible' }, { $set: { status: 'hidden', moderatedBy: req.user._id } });
    if (c) await InnovationProject.updateOne({ _id: report.project, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
    logAudit(req, 'SKILL_WALLET_MODERATION', { target: project?.owner, reason: note, details: { comment: String(report.comment), action: 'hide_comment' } });
  }
  report.status = action === 'dismiss' ? 'dismissed' : 'actioned';
  report.action = action;
  report.resolvedBy = req.user._id;
  report.resolvedAt = new Date();
  await report.save();
  res.json({ status: report.status });
});

/** POST /skill-wallet/management/projects/:id/hide { reason } | /unhide */
export const hideProject = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  requireCoordinator(req, project.department);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (reason.length < 5) throw new ApiError(422, 'Record a reason (at least 5 characters)');
  await setHidden(req, project, true, reason);
  res.json({ hidden: true });
});

export const unhideProject = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  requireCoordinator(req, project.department);
  await setHidden(req, project, false, String(req.body.reason || '').trim().slice(0, 500));
  res.json({ hidden: false });
});

/** GET /skill-wallet/management/projects?q=&hidden=&page= — coordinators browse projects in scope (submitted or published only). */
export const listManagedProjects = asyncHandler(async (req, res) => {
  requireCoordinator(req);
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = {
    ...scopeFilter(req),
    isDeleted: false,
    // Drafts that were never submitted or published stay private to the team.
    $or: [{ 'review.submittedRevision': { $ne: null } }, { published: { $ne: null } }],
  };
  if (req.query.hidden === 'true') filter['moderation.hidden'] = true;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$and = [{ $or: [{ title: rx }, { 'published.title': rx }] }];
  }
  const [items, total] = await Promise.all([
    InnovationProject.find(filter)
      .select('title published.title department visibility moderation review facultyScore likeCount commentCount owner updatedAt')
      .populate('owner', 'name title department year')
      .populate('review.reviewers', 'name title')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InnovationProject.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

// ── Designations (Principal) ───────────────────────────────────────

function requireGrantor(req) {
  if (!SKILL_WALLET_DESIGNATION_GRANTORS.includes(req.user.role)) throw new ApiError(403, 'Only the Principal manages Skill Wallet designations');
}

export const listDesignations = asyncHandler(async (req, res) => {
  requireGrantor(req);
  const items = await SkillWalletDesignation.find({ revokedAt: null }).populate('user', 'name title role department').populate('grantedBy', 'name title').sort({ createdAt: -1 }).lean();
  res.json({ items });
});

/** POST /skill-wallet/management/designations { userId, capability, scope, department } */
export const grantDesignation = asyncHandler(async (req, res) => {
  requireGrantor(req);
  assertObjectId(req.body.userId, 'user id');
  const { capability } = req.body;
  if (!SKILL_WALLET_CAPABILITIES.includes(capability)) throw new ApiError(422, 'Unknown capability');
  const scope = req.body.scope === 'department' ? 'department' : 'campus';
  const department = scope === 'department' ? req.body.department : null;
  if (scope === 'department' && !DEPARTMENTS.includes(department)) throw new ApiError(422, 'Choose a department');
  const user = await User.findById(req.body.userId).select('role isActive name').lean();
  if (!user || !isReviewerEligible(user)) throw new ApiError(422, 'Designations can go to active faculty, HOD, Principal or Dean accounts only');
  if (sameId(user._id, req.user)) {
    // Least privilege: the grantor cannot give themselves any capability
    // (coordinator, reviewer or certificate verifier).
    throw new ApiError(422, 'Ask another authority to designate you; you cannot grant yourself this capability');
  }
  let d;
  try {
    d = await SkillWalletDesignation.create({ user: user._id, capability, scope, department, grantedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'This person already holds that designation');
    throw err;
  }
  logAudit(req, 'SKILL_WALLET_DESIGNATION_CHANGED', { target: user, details: { capability, scope, department, change: 'granted' } });
  notifySkillWallet([user._id], { title: 'Skill Wallet role granted', message: 'You were given a Skill Wallet staff role.', link: '/skill-wallet/review' });
  res.status(201).json(d);
});

export const revokeDesignation = asyncHandler(async (req, res) => {
  requireGrantor(req);
  assertObjectId(req.params.id, 'designation id');
  const d = await SkillWalletDesignation.findOneAndUpdate({ _id: req.params.id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedBy: req.user._id } }, { new: true });
  if (!d) throw new ApiError(404, 'Designation not found');
  logAudit(req, 'SKILL_WALLET_DESIGNATION_CHANGED', { target: d.user, details: { capability: d.capability, scope: d.scope, department: d.department, change: 'revoked' } });
  res.json({ ok: true });
});

// ── Configuration ──────────────────────────────────────────────────

/** GET /skill-wallet/config — options for forms (any Skill Wallet user). */
export const readConfig = asyncHandler(async (_req, res) => {
  const c = await getConfig();
  res.json({ domains: c.domains, institutions: c.institutions, rubric: c.rubric });
});

/** PUT /skill-wallet/config { domains?, institutions?, rubric? } — campus-wide coordinators only. */
export const updateConfig = asyncHandler(async (req, res) => {
  if (coordinatorScope(req.swActor) !== null || !isAnyCoordinator(req.swActor)) throw new ApiError(403, 'Only campus-wide innovation coordinators can change the configuration');
  const current = await getConfig();
  const set = {};
  if (req.body.domains !== undefined) {
    const used = await InnovationProject.distinct('domain', { isDeleted: false });
    set.domains = normaliseOptions(req.body.domains, 'Domains', { keep: used });
  }
  if (req.body.institutions !== undefined) {
    const used = await NptelCertification.distinct('institution', { isDeleted: false });
    set.institutions = normaliseOptions(req.body.institutions, 'Institutions', { keep: used });
  }
  if (req.body.rubric !== undefined) set.rubric = normaliseRubric(req.body.rubric, current.rubric);
  if (!Object.keys(set).length) throw new ApiError(422, 'Nothing to change');
  const updated = await SkillWalletConfig.findOneAndUpdate({ key: 'default' }, { $set: { ...set, updatedBy: req.user._id } }, { new: true }).lean();
  logAudit(req, 'SKILL_WALLET_CONFIG_CHANGED', { target: null, details: { changed: Object.keys(set), rubricVersion: updated.rubric.version } });
  res.json({ domains: updated.domains, institutions: updated.institutions, rubric: updated.rubric });
});
