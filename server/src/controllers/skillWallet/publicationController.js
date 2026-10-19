import ProjectPublicationEvent from '../../models/ProjectPublicationEvent.js';
import { ApiError, asyncHandler } from '../../utils/http.js';
import { logAudit } from '../../utils/auditLog.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import { deleteAsset } from '../../services/skillWallet/assets.js';
import { activeMemberIds, projectRelation, sameId } from '../../services/skillWallet/access.js';
import { loadProject, logPublication, snapshotOf } from '../../services/skillWallet/projects.js';
import { saveOrConflict } from './projectController.js';

/**
 * Publication — always a separate, explicit step from review.
 *
 *   private → nothing is in the gallery.
 *   college → the owner's choice; the CURRENT content is snapshotted and shown
 *             to signed-in college users.
 *   public  → needs (1) the current revision approved by faculty, (2) the
 *             owner's explicit confirmation, and (3) the confirmation of every
 *             active team member for that same revision. The project goes
 *             public when the last confirmation arrives — never because a
 *             review was approved.
 *
 * Unpublishing is immediate: the owner may drop to college / private at any
 * time, and any member withdrawing consent drops a public project to
 * college-only at once. A material edit never reaches the gallery until the
 * owner publishes again (and, for public, the new revision is re-approved
 * and re-confirmed).
 */

const LINK = (p) => `/skill-wallet/projects/${p._id}?tab=publication`;

function audit(req, project, outcome, details) {
  return logAudit(req, 'SKILL_WALLET_PUBLICATION_CHANGED', { target: project.owner, details: { project: String(project._id), revision: project.revision, ...details }, outcome });
}

/** Replace the gallery copy; drop the previous published image if nothing else uses it. */
async function publishSnapshot(project) {
  const oldImage = project.published?.image;
  project.published = snapshotOf(project);
  return () => (oldImage && !sameId(oldImage, project.image) && !sameId(oldImage, project.published.image) ? deleteAsset(oldImage) : null);
}

async function publicationView(project) {
  const members = await activeMemberIds(project._id);
  const consented = new Set((project.publicRequest?.consents || []).map((c) => String(c.user)));
  const events = await ProjectPublicationEvent.find({ project: project._id }).populate('actor', 'name title').sort({ createdAt: -1 }).limit(50).lean();
  return {
    visibility: project.visibility,
    hidden: Boolean(project.moderation?.hidden),
    revision: project.revision,
    approvedRevision: project.review?.approvedRevision ?? null,
    canRequestPublic: project.review?.approvedRevision === project.revision,
    published: project.published ? { revision: project.published.revision, publishedAt: project.published.publishedAt, outdated: project.published.revision !== project.revision } : null,
    publicRequest: project.publicRequest
      ? {
          revision: project.publicRequest.revision,
          requestedAt: project.publicRequest.requestedAt,
          waitingFor: members.filter((m) => !consented.has(String(m))).length,
          consentedCount: consented.size,
          memberCount: members.length,
        }
      : null,
    events,
  };
}

/** GET /skill-wallet/projects/:id/publication — members. */
export const getPublication = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member) throw new ApiError(404, 'Project not found');
  const view = await publicationView(project);
  res.json({ ...view, isOwner: rel.owner, myConsent: (project.publicRequest?.consents || []).some((c) => sameId(c.user, req.user)) });
});

/**
 * PUT /skill-wallet/projects/:id/publication { audience, confirmPublic } — owner only.
 */
export const setPublication = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  const rel = await projectRelation(req.swActor, project);
  if (!rel.owner) throw rel.member ? new ApiError(403, 'Only the project owner can change publication') : new ApiError(404, 'Project not found');
  const audience = req.body.audience;
  if (!['private', 'college', 'public'].includes(audience)) throw new ApiError(422, 'Choose private, college-only or public');
  const from = project.visibility;
  let cleanup = null;
  let action;

  if (audience === 'private') {
    if (from === 'private' && !project.publicRequest && !project.published) return res.json(await publicationView(project));
    const oldImage = project.published?.image;
    project.visibility = 'private';
    project.published = null;
    project.publicRequest = null;
    if (oldImage && !sameId(oldImage, project.image)) cleanup = () => deleteAsset(oldImage);
    action = 'unpublished';
  } else if (audience === 'college') {
    project.publicRequest = null;
    if (from === 'public') {
      // Narrowing the audience keeps the approved copy; nothing new is shown.
      project.visibility = 'college';
      action = 'unpublished';
    } else {
      cleanup = await publishSnapshot(project);
      project.visibility = 'college';
      action = from === 'college' ? 'republished' : 'college_published';
    }
  } else {
    if (req.body.confirmPublic !== true) throw new ApiError(422, 'Confirm that the project may be shown publicly on the internet');
    if (project.review?.approvedRevision !== project.revision) {
      throw new ApiError(409, 'Public publication needs faculty approval of the current revision first');
    }
    if (project.moderation?.hidden) throw new ApiError(409, 'This project is hidden by a moderator and cannot be published right now');
    const members = await activeMemberIds(project._id);
    const others = members.filter((m) => !sameId(m, req.user));
    project.publicRequest = { revision: project.revision, requestedAt: new Date(), consents: [{ user: req.user._id, at: new Date() }] };
    if (!others.length) {
      cleanup = await publishSnapshot(project);
      project.visibility = 'public';
      project.publicRequest = null;
      action = from === 'public' ? 'republished' : 'public_published';
    } else {
      action = 'public_requested';
      notifySkillWallet(others, {
        title: 'Confirm public publication',
        message: 'Your team project owner wants to publish it publicly. Your confirmation is needed.',
        link: LINK(project),
      }, { eventKey: `sw-public-request:${project._id}:${project.revision}` });
    }
  }

  await saveOrConflict(project);
  if (cleanup) await cleanup();
  logPublication(project, req.user, action, { from, to: project.visibility });
  audit(req, project, 'success', { action, from, to: project.visibility });
  res.json(await publicationView(project));
});

/**
 * POST /skill-wallet/projects/:id/publication/consent { decision: grant|withdraw } — any active member.
 */
export const setConsent = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member) throw new ApiError(404, 'Project not found');
  const decision = req.body.decision;
  if (!['grant', 'withdraw'].includes(decision)) throw new ApiError(422, 'Decision must be grant or withdraw');
  const from = project.visibility;

  if (decision === 'grant') {
    const reqst = project.publicRequest;
    if (!reqst || reqst.revision !== project.revision) throw new ApiError(409, 'There is no public publication waiting for your confirmation');
    if (project.review?.approvedRevision !== project.revision) throw new ApiError(409, 'The current revision is no longer approved');
    if (!reqst.consents.some((c) => sameId(c.user, req.user))) reqst.consents.push({ user: req.user._id, at: new Date() });
    const members = await activeMemberIds(project._id);
    const consented = new Set(reqst.consents.map((c) => String(c.user)));
    const complete = members.every((m) => consented.has(String(m)));
    let cleanup = null;
    if (complete) {
      cleanup = await publishSnapshot(project);
      project.visibility = 'public';
      project.publicRequest = null;
    }
    await saveOrConflict(project);
    if (cleanup) await cleanup();
    logPublication(project, req.user, 'public_consent', { from, to: project.visibility });
    if (complete) {
      logPublication(project, req.user, from === 'public' ? 'republished' : 'public_published', { from, to: 'public' });
      audit(req, project, 'success', { action: 'public_published', from, to: 'public' });
      notifySkillWallet(members, { title: 'Project published publicly', message: 'Every team member confirmed — your project is now public.', link: LINK(project) }, { exclude: req.user._id });
    }
    return res.json(await publicationView(project));
  }

  // Withdraw: remove the pending consent; a public project drops to college-only at once.
  let changed = false;
  if (project.publicRequest) {
    const before = project.publicRequest.consents.length;
    project.publicRequest.consents = project.publicRequest.consents.filter((c) => !sameId(c.user, req.user));
    changed = project.publicRequest.consents.length !== before;
    if (rel.owner) project.publicRequest = null;
  }
  if (project.visibility === 'public') {
    project.visibility = 'college';
    changed = true;
  }
  if (!changed) return res.json(await publicationView(project));
  await saveOrConflict(project);
  logPublication(project, req.user, 'public_consent_withdrawn', { from, to: project.visibility });
  if (from === 'public') {
    audit(req, project, 'success', { action: 'public_consent_withdrawn', from, to: project.visibility });
    notifySkillWallet([project.owner], { title: 'Public publication withdrawn', message: 'A team member withdrew consent; the project is now college-only.', link: LINK(project) }, { exclude: req.user._id });
  }
  res.json(await publicationView(project));
});
