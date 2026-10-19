import InnovationProject from '../../models/InnovationProject.js';
import ProjectRevision from '../../models/ProjectRevision.js';
import TeamMembership from '../../models/TeamMembership.js';
import TeamInvitation from '../../models/TeamInvitation.js';
import SkillWalletAsset from '../../models/SkillWalletAsset.js';
import ProjectReview from '../../models/ProjectReview.js';
import ProjectPublicationEvent from '../../models/ProjectPublicationEvent.js';
import ProjectMilestone from '../../models/ProjectMilestone.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler, pageMeta, paginate } from '../../utils/http.js';
import { withTransaction } from '../../utils/transaction.js';
import { logActivity } from '../../utils/activity.js';
import { getConfig } from '../../services/skillWallet/config.js';
import { processProjectImage } from '../../services/skillWallet/imagePipeline.js';
import { assetUrl, deleteAsset, storeAsset } from '../../services/skillWallet/assets.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import {
  activeMemberIds,
  assertProjectAccess,
  projectRelation,
  sameId,
} from '../../services/skillWallet/access.js';
import {
  MAX_PROJECTS_PER_STUDENT,
  assertObjectId,
  contentOf,
  diffContent,
  loadProject,
  logPublication,
  memberView,
  parseProjectInput,
  teamOf,
} from '../../services/skillWallet/projects.js';
import { SW_MILESTONE_KINDS } from '../../constants.js';
import SkillWalletDesignation from '../../models/SkillWalletDesignation.js';

/** Save with optimistic concurrency: a parallel edit answers 409, never a silent overwrite. */
export async function saveOrConflict(doc, opts) {
  try {
    await doc.save(opts);
  } catch (err) {
    if (err.name === 'VersionError') throw new ApiError(409, 'This was changed by someone else in the meantime. Reload and try again.');
    throw err;
  }
}

async function viewFor(req, project) {
  const actor = req.swActor;
  const [config, relation, team] = await Promise.all([getConfig(), projectRelation(actor, project), teamOf(project._id)]);
  return memberView(project.toObject ? project.toObject() : project, { viewer: req.user, config, team, relation });
}

/** Resolve an uploaded project image the caller may attach (their own pending upload). */
async function claimImage(req, assetId, projectId = null) {
  if (assetId === undefined) return undefined;
  if (assetId === null || assetId === '') return null;
  assertObjectId(assetId, 'image');
  const asset = await SkillWalletAsset.findOne({ _id: assetId, owner: req.user._id, kind: 'project_image' });
  const ok = asset && (asset.status === 'pending' || (asset.status === 'attached' && projectId && sameId(asset.project, projectId)));
  if (!ok) throw new ApiError(422, 'Upload the project image again and retry');
  return asset;
}

// ── Lists ───────────────────────────────────────────────────────────

/** GET /skill-wallet/projects — projects I own or am an active member of. */
export const listMyProjects = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 12, 50);
  const ids = await TeamMembership.find({ user: req.user._id, status: 'active' }).distinct('project');
  const filter = { _id: { $in: ids }, isDeleted: false };
  if (req.query.stage) filter.stage = String(req.query.stage);
  const [items, total, config] = await Promise.all([
    InnovationProject.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    InnovationProject.countDocuments(filter),
    getConfig(),
  ]);
  const views = await Promise.all(
    items.map(async (p) =>
      memberView(p, { viewer: req.user, config, team: await teamOf(p._id), relation: { owner: sameId(p.owner, req.user), member: true } })
    )
  );
  res.json({ items: views, ...pageMeta(total, page, limit) });
});

/** GET /skill-wallet/projects/:id — members and authorized reviewers only. */
export const getProject = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  const rel = await assertProjectAccess(req.swActor, project);
  const view = await viewFor(req, project);
  const [reviews, milestones] = await Promise.all([
    ProjectReview.find({ project: project._id }).select('-internalNotes').populate('reviewer', 'name title designation').sort({ createdAt: -1 }).limit(50).lean(),
    ProjectMilestone.find({ project: project._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  res.json({ ...view, isReviewer: rel.reviewer && !rel.member, reviews, milestones });
});

/** GET /skill-wallet/projects/:id/history — revisions + publication events (members). */
export const projectHistory = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member && !rel.reviewer) throw new ApiError(404, 'Project not found');
  const [revisions, events] = await Promise.all([
    ProjectRevision.find({ project: project._id }).select('number changed editedBy createdAt').populate('editedBy', 'name title').sort({ number: -1 }).limit(100).lean(),
    ProjectPublicationEvent.find({ project: project._id }).populate('actor', 'name title').sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  res.json({ revisions, events });
});

// ── Create / update / delete ───────────────────────────────────────

export const createProject = asyncHandler(async (req, res) => {
  const config = await getConfig();
  const data = parseProjectInput(req.body, config, null);
  const owned = await InnovationProject.countDocuments({ owner: req.user._id, isDeleted: false });
  if (owned >= MAX_PROJECTS_PER_STUDENT) throw new ApiError(422, `You can keep at most ${MAX_PROJECTS_PER_STUDENT} projects`);
  const asset = await claimImage(req, req.body.imageAssetId);

  const project = await withTransaction(async (session) => {
    const [p] = await InnovationProject.create(
      [
        {
          ...data,
          image: asset?._id || null,
          owner: req.user._id,
          department: req.user.department,
          year: req.user.year,
        },
      ],
      { session }
    );
    await TeamMembership.create([{ project: p._id, user: req.user._id, role: 'owner' }], { session });
    await ProjectRevision.create([{ project: p._id, number: 1, content: contentOf(p), editedBy: req.user._id, changed: ['created'] }], { session });
    if (asset) await SkillWalletAsset.updateOne({ _id: asset._id }, { $set: { status: 'attached', project: p._id } }, { session });
    return p;
  });

  logActivity(req, 'skill_wallet.project.create', { entityType: 'innovation_project', entityId: project._id, summary: 'Project created' });
  res.status(201).json(await viewFor(req, project));
});

/**
 * PUT /skill-wallet/projects/:id — any active member edits content; only the
 * owner changes the mode. A material change starts a new revision, keeps the
 * gallery copy as it was, and sends an approved project back for review.
 */
export const updateProject = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member) throw new ApiError(rel.reviewer ? 403 : 404, rel.reviewer ? 'Reviewers cannot edit a project' : 'Project not found');

  const config = await getConfig();
  const next = parseProjectInput(req.body, config, project);
  const asset = await claimImage(req, req.body.imageAssetId, project._id);
  if (asset !== undefined) next.image = asset ? asset._id : null;

  // Mode change: owner only; solo needs an empty team (pending invitations are cancelled).
  let cancelInvites = false;
  if (req.body.mode !== undefined && req.body.mode !== project.mode) {
    if (!rel.owner) throw new ApiError(403, 'Only the project owner can change the project mode');
    if (!['solo', 'team'].includes(req.body.mode)) throw new ApiError(422, 'Project mode must be "solo" or "team"');
    if (req.body.mode === 'solo') {
      if (project.memberCount > 1) throw new ApiError(409, 'Remove the other team members before switching to a solo project');
      cancelInvites = true;
    }
    project.mode = req.body.mode;
  }

  const { changed, material } = diffContent(project, next);
  const previousImage = project.image;
  for (const k of changed) project[k] = next[k];

  if (material) {
    project.revision += 1;
    // Under review: the queue now reviews the new revision. Approved, rejected
    // or changes requested: the new revision needs a fresh submission.
    if (project.review.status === 'submitted') project.review.submittedRevision = project.revision;
    else if (project.review.status === 'approved') project.review.status = 'draft';
    // Consents were given for the old revision.
    if (project.publicRequest) {
      project.publicRequest = null;
      logPublication(project, req.user, 'public_request_cancelled', { note: 'Content changed', revision: project.revision - 1 });
    }
  }

  if (!changed.length && !cancelInvites && !project.isModified('mode')) return res.json(await viewFor(req, project));

  await withTransaction(async (session) => {
    await saveOrConflict(project, { session });
    if (material) {
      await ProjectRevision.create([{ project: project._id, number: project.revision, content: contentOf(project), editedBy: req.user._id, changed }], { session });
    }
    if (asset) await SkillWalletAsset.updateOne({ _id: asset._id }, { $set: { status: 'attached', project: project._id } }, { session });
    if (cancelInvites) {
      await TeamInvitation.updateMany({ project: project._id, status: 'pending' }, { $set: { status: 'cancelled', cancelledBy: req.user._id, respondedAt: new Date() } }, { session });
    }
  });

  // A replaced image is removed once neither the live nor the published copy uses it.
  if (changed.includes('image') && previousImage && !sameId(previousImage, project.published?.image)) await deleteAsset(previousImage);

  logActivity(req, 'skill_wallet.project.update', { entityType: 'innovation_project', entityId: project._id, summary: `Updated (${changed.join(', ') || 'mode'})` });
  res.json(await viewFor(req, project));
});

/** DELETE /skill-wallet/projects/:id — owner only; unpublishes and removes files. */
export const deleteProject = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!sameId(project.owner, req.user)) throw new ApiError(404, 'Project not found');
  const members = await activeMemberIds(project._id);
  const from = project.visibility;
  project.isDeleted = true;
  project.deletedAt = new Date();
  project.visibility = 'private';
  const images = [project.image, project.published?.image].filter(Boolean);
  project.published = null;
  project.publicRequest = null;
  await saveOrConflict(project);
  await TeamInvitation.updateMany({ project: project._id, status: 'pending' }, { $set: { status: 'cancelled', cancelledBy: req.user._id, respondedAt: new Date() } });
  for (const id of images) await deleteAsset(id);
  if (from !== 'private') logPublication(project, req.user, 'unpublished', { from, to: 'private', note: 'Project deleted' });
  notifySkillWallet(members, { title: 'A team project was deleted', message: 'The owner deleted a project you were part of.', link: '/skill-wallet?tab=projects' }, { exclude: req.user._id });
  logActivity(req, 'skill_wallet.project.delete', { entityType: 'innovation_project', entityId: project._id, summary: 'Project deleted' });
  res.json({ ok: true });
});

// ── Review submission ───────────────────────────────────────────────

/** POST /skill-wallet/projects/:id/submit — owner sends the current revision for faculty review. */
export const submitForReview = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!sameId(project.owner, req.user)) {
    const rel = await projectRelation(req.swActor, project);
    throw rel.member ? new ApiError(403, 'Only the project owner can submit it for review') : new ApiError(404, 'Project not found');
  }
  const { status, submittedRevision, approvedRevision } = project.review;
  if (status === 'submitted' && submittedRevision === project.revision) throw new ApiError(409, 'This revision is already waiting for review');
  if (approvedRevision === project.revision) throw new ApiError(409, 'This revision is already approved');
  if (status === 'rejected' && submittedRevision === project.revision) {
    throw new ApiError(409, 'This revision was rejected. Make changes before submitting again.');
  }
  project.review.status = 'submitted';
  project.review.submittedRevision = project.revision;
  project.review.submittedAt = new Date();
  await saveOrConflict(project);

  // Assigned reviewers, coordinators in scope and the department HOD hear about it.
  const coordinatorIds = await SkillWalletDesignation.find({
    capability: 'innovation_coordinator',
    revokedAt: null,
    $or: [{ scope: 'campus' }, { department: project.department }],
  }).distinct('user');
  const hodIds = project.department ? await User.find({ role: 'hod', department: project.department, isActive: true }).distinct('_id') : [];
  notifySkillWallet([...project.review.reviewers, ...coordinatorIds, ...hodIds], {
    title: 'Project submitted for review',
    message: 'A student project is waiting in the Skill Wallet review queue.',
    link: '/skill-wallet/review',
  });
  logActivity(req, 'skill_wallet.project.submit', { entityType: 'innovation_project', entityId: project._id, summary: `Revision ${project.revision} submitted` });
  res.json(await viewFor(req, project));
});

/** POST /skill-wallet/projects/:id/withdraw — owner takes a pending submission back. */
export const withdrawSubmission = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!sameId(project.owner, req.user)) throw new ApiError(404, 'Project not found');
  if (project.review.status !== 'submitted') throw new ApiError(409, 'The project is not waiting for review');
  project.review.status = 'draft';
  await saveOrConflict(project);
  res.json(await viewFor(req, project));
});

// ── Images ──────────────────────────────────────────────────────────

/**
 * POST /skill-wallet/assets/project-image (multipart "file"). Validated by
 * content, re-encoded in its own format with metadata stripped, stored
 * privately as a pending asset of the uploader.
 */
export const uploadProjectImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Choose an image file to upload');
  const image = await processProjectImage(req.file.buffer);
  const asset = await storeAsset({ owner: req.user._id, kind: 'project_image', image });
  res.status(201).json({ assetId: asset._id, url: assetUrl(asset._id, req.user), width: asset.width, height: asset.height, mimeType: asset.mimeType, size: asset.size });
});

// ── Milestones (claims; verified by coordinators only) ──────────────

export const addMilestone = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member) throw new ApiError(404, 'Project not found');
  const kind = String(req.body.kind || '');
  if (!SW_MILESTONE_KINDS.includes(kind)) throw new ApiError(422, 'Choose a milestone type');
  const title = String(req.body.title || '').trim();
  if (title.length < 3 || title.length > 160) throw new ApiError(422, 'Milestone title must be 3–160 characters');
  const reference = String(req.body.reference || '').trim().slice(0, 200);
  const count = await ProjectMilestone.countDocuments({ project: project._id });
  if (count >= 30) throw new ApiError(422, 'A project can list at most 30 milestones');
  const m = await ProjectMilestone.create({ project: project._id, kind, title, reference, claimedBy: req.user._id });
  res.status(201).json(m);
});
