import InnovationProject from '../../models/InnovationProject.js';
import ProjectReview from '../../models/ProjectReview.js';
import ProjectRevision from '../../models/ProjectRevision.js';
import ProjectMilestone from '../../models/ProjectMilestone.js';
import InnovationRecommendation from '../../models/InnovationRecommendation.js';
import SkillWalletDesignation from '../../models/SkillWalletDesignation.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate } from '../../utils/http.js';
import { logAudit } from '../../utils/auditLog.js';
import { getConfig, labelOf } from '../../services/skillWallet/config.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import { assetUrl } from '../../services/skillWallet/assets.js';
import {
  activeMemberIds,
  canDecideProject,
  canReviewProject,
  isAnyCoordinator,
  isCoordinator,
  reviewerQueueFilter,
  sameId,
  verifierQueueFilter,
} from '../../services/skillWallet/access.js';
import { loadProject, teamOf } from '../../services/skillWallet/projects.js';
import { SKILL_WALLET_DESIGNATION_GRANTORS, SW_REVIEW_DECISIONS, SW_REVIEW_STATUSES } from '../../constants.js';

/**
 * Faculty Review Workspace.
 *
 * Reviews are tied to the exact revision that was submitted. A decision sets
 * the project's review status; approval records approvedRevision and the
 * faculty score — and NOTHING about visibility: publication stays the
 * team's separate, explicit choice. Recommendations for funding / IIC are
 * notes to the innovation coordinators and allocate nothing.
 *
 * Internal notes are visible to reviewers and coordinators only.
 */

/** GET /skill-wallet/review/me — what this user can do in the workspace (drives the UI). */
export const myReviewerRoles = asyncHandler(async (req, res) => {
  const actor = req.swActor;
  res.json({
    canReviewProjects: Boolean(reviewerQueueFilter(actor)),
    canVerifyCertificates: Boolean(verifierQueueFilter(actor)),
    isCoordinator: isAnyCoordinator(actor),
    canManageDesignations: SKILL_WALLET_DESIGNATION_GRANTORS.includes(req.user.role),
    designations: actor.designations.map((d) => ({ capability: d.capability, scope: d.scope, department: d.department })),
  });
});

/** GET /skill-wallet/review/queue?status=&q=&mine=&page= */
export const reviewQueue = asyncHandler(async (req, res) => {
  const scope = reviewerQueueFilter(req.swActor);
  if (!scope) throw new ApiError(403, 'You do not have a Skill Wallet review role');
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = { ...scope, isDeleted: false };
  const status = SW_REVIEW_STATUSES.includes(req.query.status) ? req.query.status : 'submitted';
  if (status !== 'draft') filter['review.status'] = status;
  if (req.query.mine === 'true') filter['review.reviewers'] = req.user._id;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$and = [{ $or: [{ title: rx }, { description: rx }, { skills: rx }] }];
  }
  const [items, total, config] = await Promise.all([
    InnovationProject.find(filter).populate('owner', 'name title department year section rollNo').populate('review.reviewers', 'name title').sort({ 'review.submittedAt': 1 }).skip(skip).limit(limit).lean(),
    InnovationProject.countDocuments(filter),
    getConfig(),
  ]);
  const reviewedByMe = new Set(
    (await ProjectReview.find({ reviewer: req.user._id, project: { $in: items.map((p) => p._id) } }).select('project revision').lean())
      .map((r) => `${r.project}:${r.revision}`)
  );
  res.json({
    items: items.map((p) => ({
      _id: p._id,
      title: p.title,
      domain: { key: p.domain, label: labelOf(config.domains, p.domain) },
      stage: p.stage,
      mode: p.mode,
      memberCount: p.memberCount,
      owner: p.owner,
      department: p.department,
      revision: p.revision,
      review: { status: p.review.status, submittedRevision: p.review.submittedRevision, submittedAt: p.review.submittedAt, reviewers: p.review.reviewers },
      reviewedByMe: reviewedByMe.has(`${p._id}:${p.revision}`),
      assignedToMe: (p.review.reviewers || []).some((r) => sameId(r, req.user)),
    })),
    ...pageMeta(total, page, limit),
  });
});

/** GET /skill-wallet/review/projects/:id — full evidence for an authorized reviewer. */
export const reviewDetail = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  if (!canReviewProject(req.swActor, project)) throw new ApiError(404, 'Project not found');
  const [config, team, reviews, revisions, milestones, recommendations] = await Promise.all([
    getConfig(),
    teamOf(project._id, { staffView: true }),
    ProjectReview.find({ project: project._id }).populate('reviewer', 'name title designation department').sort({ createdAt: -1 }).limit(100).lean(),
    ProjectRevision.find({ project: project._id }).select('number changed createdAt editedBy').populate('editedBy', 'name title').sort({ number: -1 }).limit(50).lean(),
    ProjectMilestone.find({ project: project._id }).sort({ createdAt: -1 }).lean(),
    InnovationRecommendation.find({ project: project._id }).populate('recommendedBy', 'name title').lean(),
  ]);
  res.json({
    _id: project._id,
    title: project.title,
    domain: { key: project.domain, label: labelOf(config.domains, project.domain) },
    description: project.description,
    skills: project.skills,
    stage: project.stage,
    startedAt: project.startedAt,
    endedAt: project.endedAt,
    githubUrl: project.githubUrl,
    driveUrl: project.driveUrl,
    imageUrl: assetUrl(project.image, req.user),
    mode: project.mode,
    department: project.department,
    year: project.year,
    revision: project.revision,
    visibility: project.visibility,
    review: project.review,
    facultyScore: project.facultyScore,
    team,
    reviews,
    revisions,
    milestones,
    recommendations,
    rubric: config.rubric,
    canDecide: canDecideProject(req.swActor, project) && project.review.submittedRevision === project.revision,
    isCoordinator: isCoordinator(req.swActor, project.department),
  });
});

/**
 * POST /skill-wallet/review/projects/:id/reviews
 * { revision, scores: { [criterionKey]: 0–10 }, feedback, internalNotes, decision, reason, recommendFunding, recommendIncubation }
 */
export const submitReview = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  if (!canDecideProject(req.swActor, project)) throw new ApiError(404, 'Project not found');
  const revision = Number(req.body.revision);
  if (!Number.isInteger(revision) || revision !== project.revision || project.review.submittedRevision !== project.revision || project.review.status === 'draft') {
    throw new ApiError(409, 'The project changed or is no longer submitted for this revision. Reload before reviewing.');
  }
  const decision = req.body.decision;
  if (!SW_REVIEW_DECISIONS.includes(decision)) throw new ApiError(422, 'Choose approve, request changes or reject');
  const reason = String(req.body.reason || '').trim();
  if (decision !== 'approve' && reason.length < 5) throw new ApiError(422, 'Give the team a reason (at least 5 characters)');
  const feedback = String(req.body.feedback || '').trim();
  const internalNotes = String(req.body.internalNotes || '').trim();
  if (feedback.length > 3000 || internalNotes.length > 3000 || reason.length > 1000) throw new ApiError(422, 'Feedback is too long');

  const config = await getConfig();
  const scores = req.body.scores && typeof req.body.scores === 'object' ? req.body.scores : {};
  const criteria = config.rubric.criteria.map((c) => {
    const s = Number(scores[c.key]);
    if (!Number.isFinite(s) || s < 0 || s > 10) throw new ApiError(422, `Score "${c.label}" from 0 to 10`);
    return { key: c.key, label: c.label, weight: c.weight, score: Math.round(s * 10) / 10 };
  });
  const totalScore = Math.round(criteria.reduce((sum, c) => sum + (c.score / 10) * c.weight, 0) * 10) / 10;

  let review;
  try {
    review = await ProjectReview.create({
      project: project._id,
      revision,
      reviewer: req.user._id,
      rubricVersion: config.rubric.version,
      criteria,
      totalScore,
      feedback,
      internalNotes,
      decision,
      reason,
      recommendFunding: req.body.recommendFunding === true,
      recommendIncubation: req.body.recommendIncubation === true,
    });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'You already reviewed this revision');
    throw err;
  }

  const status = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected' }[decision];
  const set = { 'review.status': status, 'review.decidedAt': new Date() };
  if (decision === 'approve') {
    const approvals = await ProjectReview.find({ project: project._id, revision, decision: 'approve' }).select('totalScore').lean();
    set['review.approvedRevision'] = revision;
    set.facultyScore = Math.round((approvals.reduce((s, r) => s + r.totalScore, 0) / approvals.length) * 10) / 10;
  } else if (project.review.approvedRevision === revision) {
    // A later "reject" / "request changes" of the same revision withdraws its
    // approval, so it can no longer be published publicly on that approval.
    set['review.approvedRevision'] = null;
    set.facultyScore = null;
    set.publicRequest = null;
  }
  // Conditional on the revision still being the reviewed one; visibility is never touched.
  const updated = await InnovationProject.findOneAndUpdate(
    { _id: project._id, isDeleted: false, revision, 'review.submittedRevision': revision },
    { $set: set, $inc: { __v: 1 } },
    { new: true }
  );
  if (!updated) {
    await ProjectReview.deleteOne({ _id: review._id });
    throw new ApiError(409, 'The project changed while you were reviewing. Reload and review the new revision.');
  }

  const kinds = [review.recommendFunding && 'funding', review.recommendIncubation && 'incubation'].filter(Boolean);
  for (const kind of kinds) {
    await InnovationRecommendation.updateOne(
      { project: project._id, kind, recommendedBy: req.user._id },
      { $set: { review: review._id, revision, note: feedback.slice(0, 1000), status: 'open' } },
      { upsert: true }
    );
  }
  if (kinds.length) {
    const coordinators = await SkillWalletDesignation.find({ capability: 'innovation_coordinator', revokedAt: null, $or: [{ scope: 'campus' }, { department: project.department }] }).distinct('user');
    notifySkillWallet(coordinators, { title: 'New innovation recommendation', message: 'A reviewer recommended a project for funding or incubation.', link: '/skill-wallet/innovation' }, { exclude: req.user._id });
    logAudit(req, 'SKILL_WALLET_RECOMMENDATION', { target: project.owner, details: { project: String(project._id), revision, kinds } });
  }

  logAudit(req, 'SKILL_WALLET_REVIEW_DECISION', { target: project.owner, details: { project: String(project._id), revision, decision, totalScore, rubricVersion: config.rubric.version } });
  const members = await activeMemberIds(project._id);
  const words = { approve: 'approved', request_changes: 'needs changes', reject: 'was not approved' }[decision];
  notifySkillWallet(members, { title: 'Project review update', message: `Faculty review: your project ${words}.`, link: `/skill-wallet/projects/${project._id}?tab=reviews` }, { eventKey: `sw-review:${review._id}` });
  res.status(201).json({ review, status: updated.review.status, approvedRevision: updated.review.approvedRevision, visibility: updated.visibility });
});
