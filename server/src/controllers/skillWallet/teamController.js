import InnovationProject from '../../models/InnovationProject.js';
import TeamMembership from '../../models/TeamMembership.js';
import TeamInvitation from '../../models/TeamInvitation.js';
import User from '../../models/User.js';
import { env } from '../../config/env.js';
import { ApiError, asyncHandler, pageMeta, paginate } from '../../utils/http.js';
import { withTransaction } from '../../utils/transaction.js';
import { logActivity } from '../../utils/activity.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import { SKILL_WALLET_STUDENT_ROLES } from '../../constants.js';
import { projectRelation, sameId } from '../../services/skillWallet/access.js';
import { assertObjectId, loadProject, logPublication, teamOf } from '../../services/skillWallet/projects.js';
import { saveOrConflict } from './projectController.js';

/**
 * Team invitations by college roll number, and team membership rules.
 *
 *  - The roll number is resolved on the server against active student
 *    accounts; only the invitee's name and class are echoed back.
 *  - An invitation addresses an internal user ID. Pending invitations grant
 *    no access at all — only an active TeamMembership row does.
 *  - Every state change is a conditional update on `status: 'pending'`, so
 *    answers are idempotent and parallel answers cannot both win; a unique
 *    index allows one pending invitation per project + invitee and one active
 *    membership per project + user.
 *  - Team size is enforced with a conditional $inc on project.memberCount.
 *
 * Owner rules: the owner invites, cancels invitations, removes members and
 * may transfer ownership to an active member; the owner cannot leave without
 * transferring first. A member may leave at any time.
 */

const INVITE_LINK = '/skill-wallet?tab=invitations';
const normaliseRoll = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');

const invitationView = (inv, { box }) => ({
  _id: inv._id,
  status: inv.status,
  message: inv.message || '',
  createdAt: inv.createdAt,
  expiresAt: inv.expiresAt,
  respondedAt: inv.respondedAt,
  expired: inv.status === 'pending' && new Date(inv.expiresAt) <= new Date(),
  project: inv.project ? { _id: inv.project._id, title: inv.project.title, mode: inv.project.mode, deleted: Boolean(inv.project.isDeleted) } : null,
  inviter: inv.inviter ? { name: inv.inviter.name, title: inv.inviter.title, department: inv.inviter.department } : null,
  ...(box === 'sent' ? { invitee: inv.invitee ? { name: inv.invitee.name, title: inv.invitee.title, department: inv.invitee.department, year: inv.invitee.year } : null } : {}),
});

/** Mark lapsed pending invitations expired (lazy, idempotent). */
async function expireStale(filter = {}) {
  await TeamInvitation.updateMany({ ...filter, status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } });
}

// ── Team ────────────────────────────────────────────────────────────

/** GET /skill-wallet/projects/:id/team — members; the owner also sees invitations. */
export const getTeam = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  const rel = await projectRelation(req.swActor, project);
  if (!rel.member && !rel.reviewer) throw new ApiError(404, 'Project not found');
  const team = await teamOf(project._id, { staffView: rel.reviewer && !rel.member });
  let invitations = [];
  if (rel.owner) {
    await expireStale({ project: project._id });
    const rows = await TeamInvitation.find({ project: project._id })
      .populate('invitee', 'name title department year')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    invitations = rows.map((r) => invitationView({ ...r, project: null }, { box: 'sent' }));
  }
  res.json({ mode: project.mode, memberCount: project.memberCount, maxTeamSize: env.skillWallet.maxTeamSize, team, invitations });
});

/** POST /skill-wallet/projects/:id/invitations { rollNo, message } — owner only. */
export const inviteByRollNo = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  if (!sameId(project.owner, req.user)) {
    const rel = await projectRelation(req.swActor, project);
    throw rel.member ? new ApiError(403, 'Only the project owner can invite teammates') : new ApiError(404, 'Project not found');
  }
  if (project.mode !== 'team') throw new ApiError(409, 'Switch the project to a team project before inviting teammates');

  const rollNo = normaliseRoll(req.body.rollNo);
  if (!/^[A-Z0-9/-]{2,30}$/.test(rollNo)) throw new ApiError(422, 'Enter a valid college roll number');
  const message = String(req.body.message || '').trim().slice(0, 300);

  // Same answer for "no such roll number" and "not an eligible student": no enumeration of staff / alumni accounts.
  const invitee = await User.findOne({ rollNo, role: { $in: SKILL_WALLET_STUDENT_ROLES }, isActive: true }).select('name title department year role').lean();
  if (!invitee) throw new ApiError(404, 'No eligible student was found with that roll number');
  if (sameId(invitee._id, req.user)) throw new ApiError(422, 'You cannot invite yourself');
  if (await TeamMembership.exists({ project: project._id, user: invitee._id, status: 'active' })) {
    throw new ApiError(409, 'That student is already on this team');
  }

  await expireStale({ project: project._id });
  const pending = await TeamInvitation.countDocuments({ project: project._id, status: 'pending' });
  if (project.memberCount + pending >= env.skillWallet.maxTeamSize) {
    throw new ApiError(409, `A team can have at most ${env.skillWallet.maxTeamSize} members (including pending invitations)`);
  }

  let inv;
  try {
    inv = await TeamInvitation.create({
      project: project._id,
      inviter: req.user._id,
      invitee: invitee._id,
      message,
      expiresAt: new Date(Date.now() + env.skillWallet.inviteExpiryDays * 86400000),
    });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'That student already has a pending invitation to this project');
    throw err;
  }

  // Generic text: no project title in push payloads (see services/skillWallet/notify.js).
  notifySkillWallet([invitee._id], {
    title: 'Team project invitation',
    message: `${req.user.name} invited you to join a team project.`,
    link: INVITE_LINK,
  }, { eventKey: `sw-invite:${inv._id}` });
  logActivity(req, 'skill_wallet.invite', { entityType: 'innovation_project', entityId: project._id, summary: 'Teammate invited' });

  res.status(201).json({
    _id: inv._id,
    status: inv.status,
    expiresAt: inv.expiresAt,
    invitee: { name: invitee.name, title: invitee.title, department: invitee.department, year: invitee.year },
  });
});

/** GET /skill-wallet/invitations?box=received|sent&status= */
export const listInvitations = asyncHandler(async (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'received';
  const { page, limit, skip } = paginate(req, 20, 50);
  const filter = box === 'sent' ? { inviter: req.user._id } : { invitee: req.user._id };
  await expireStale(filter);
  if (req.query.status) filter.status = String(req.query.status);
  let q = TeamInvitation.find(filter).populate('project', 'title mode isDeleted').populate('inviter', 'name title department');
  if (box === 'sent') q = q.populate('invitee', 'name title department year');
  const [rows, total, pendingCount] = await Promise.all([
    q.sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    TeamInvitation.countDocuments(filter),
    TeamInvitation.countDocuments({ invitee: req.user._id, status: 'pending' }),
  ]);
  res.json({ items: rows.map((r) => invitationView(r, { box })), pendingCount, ...pageMeta(total, page, limit) });
});

async function loadOwnInvitation(req) {
  assertObjectId(req.params.id, 'invitation id');
  const inv = await TeamInvitation.findById(req.params.id);
  // Someone else's invitation is reported as missing, never as forbidden.
  if (!inv || !sameId(inv.invitee, req.user)) throw new ApiError(404, 'Invitation not found');
  return inv;
}

const finished = (inv) => {
  const map = {
    declined: 'You already declined this invitation',
    cancelled: 'This invitation was cancelled',
    expired: 'This invitation has expired',
    accepted: 'You already accepted this invitation',
  };
  return new ApiError(inv.status === 'expired' ? 410 : 409, map[inv.status] || 'This invitation is no longer open', undefined, { status: inv.status });
};

/**
 * POST /skill-wallet/invitations/:id/accept — invitee only. Idempotent: a
 * repeated accept answers 200 with the same result and never adds a second
 * membership. The invitation is claimed with a conditional update, the team
 * seat with a conditional $inc; a failure after the claim rolls both back.
 */
export const acceptInvitation = asyncHandler(async (req, res) => {
  const inv = await loadOwnInvitation(req);
  if (inv.status === 'accepted') return res.json({ status: 'accepted', project: inv.project, alreadyAccepted: true });
  if (inv.status !== 'pending') throw finished(inv);
  if (inv.expiresAt <= new Date()) {
    await TeamInvitation.updateOne({ _id: inv._id, status: 'pending' }, { $set: { status: 'expired' } });
    throw new ApiError(410, 'This invitation has expired', undefined, { status: 'expired' });
  }

  const outcome = await withTransaction(async (session) => {
    const claimed = await TeamInvitation.findOneAndUpdate(
      { _id: inv._id, invitee: req.user._id, status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'accepted', respondedAt: new Date() } },
      { new: true, session }
    );
    if (!claimed) return { lost: true };

    const seat = await InnovationProject.findOneAndUpdate(
      { _id: inv.project, isDeleted: false, mode: 'team', memberCount: { $lt: env.skillWallet.maxTeamSize } },
      { $inc: { memberCount: 1 } },
      { new: true, session }
    );
    const rollback = async (status) => {
      // Without a transaction (standalone MongoDB) undo the claim by hand.
      if (!session) await TeamInvitation.updateOne({ _id: inv._id, status: 'accepted' }, { $set: { status } });
    };
    if (!seat) {
      const project = await InnovationProject.findById(inv.project).select('isDeleted mode').lean();
      const gone = !project || project.isDeleted || project.mode !== 'team';
      if (gone) {
        // Not retryable: the project no longer takes members.
        await TeamInvitation.updateOne({ _id: inv._id }, { $set: { status: 'cancelled' } }, { session });
        return { error: new ApiError(409, 'This project is no longer accepting team members', undefined, { status: 'cancelled' }) };
      }
      await rollback('pending');
      throw new ApiError(409, 'This team is already full');
    }
    try {
      await TeamMembership.create([{ project: inv.project, user: req.user._id, role: 'member', invitation: inv._id }], { session });
    } catch (err) {
      if (err.code === 11000) {
        // Already an active member: give the seat back, keep the acceptance.
        await InnovationProject.updateOne({ _id: inv.project }, { $inc: { memberCount: -1 } }, { session });
        return { accepted: true };
      }
      if (!session) {
        await InnovationProject.updateOne({ _id: inv.project }, { $inc: { memberCount: -1 } });
        await rollback('pending');
      }
      throw err;
    }
    return { accepted: true, project: seat };
  });

  if (outcome.error) throw outcome.error;
  if (outcome.lost) {
    // A parallel request answered first: report the settled state.
    const fresh = await TeamInvitation.findById(inv._id).lean();
    if (fresh?.status === 'accepted') return res.json({ status: 'accepted', project: fresh.project, alreadyAccepted: true });
    throw finished(fresh || inv);
  }

  if (outcome.project) {
    // A public project lists its team publicly. The new member never confirmed
    // that, so the project narrows to college-only until everyone confirms.
    if (outcome.project.visibility === 'public') {
      const narrowed = await InnovationProject.updateOne(
        { _id: inv.project, visibility: 'public' },
        { $set: { visibility: 'college', publicRequest: null }, $inc: { __v: 1 } }
      );
      if (narrowed.modifiedCount) {
        logPublication(outcome.project, req.user, 'unpublished', { from: 'public', to: 'college', note: 'New member joined; public publication needs every member to confirm' });
        notifySkillWallet([outcome.project.owner], {
          title: 'Project moved to college-only',
          message: 'A new member joined, so public publication needs every member to confirm again.',
          link: `/skill-wallet/projects/${inv.project}?tab=publication`,
        });
      }
    }
    notifySkillWallet([inv.inviter, outcome.project.owner], {
      title: 'Invitation accepted',
      message: `${req.user.name} joined your team project.`,
      link: `/skill-wallet/projects/${inv.project}`,
    }, { exclude: req.user._id, eventKey: `sw-invite-accepted:${inv._id}` });
  }
  logActivity(req, 'skill_wallet.invite.accept', { entityType: 'innovation_project', entityId: inv.project, summary: 'Invitation accepted' });
  res.json({ status: 'accepted', project: inv.project });
});

/** POST /skill-wallet/invitations/:id/decline — invitee only; creates no membership. Idempotent. */
export const declineInvitation = asyncHandler(async (req, res) => {
  const inv = await loadOwnInvitation(req);
  if (inv.status === 'declined') return res.json({ status: 'declined', alreadyDeclined: true });
  if (inv.status !== 'pending') throw finished(inv);
  const updated = await TeamInvitation.findOneAndUpdate(
    { _id: inv._id, invitee: req.user._id, status: 'pending' },
    { $set: { status: 'declined', respondedAt: new Date() } },
    { new: true }
  );
  if (!updated) {
    const fresh = await TeamInvitation.findById(inv._id).lean();
    if (fresh?.status === 'declined') return res.json({ status: 'declined', alreadyDeclined: true });
    throw finished(fresh || inv);
  }
  notifySkillWallet([inv.inviter], {
    title: 'Invitation declined',
    message: `${req.user.name} declined your team project invitation.`,
    link: `/skill-wallet/projects/${inv.project}`,
  }, { eventKey: `sw-invite-declined:${inv._id}` });
  res.json({ status: 'declined' });
});

/** DELETE /skill-wallet/invitations/:id — the inviter or the current owner cancels a pending invitation. */
export const cancelInvitation = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'invitation id');
  const inv = await TeamInvitation.findById(req.params.id);
  if (!inv) throw new ApiError(404, 'Invitation not found');
  const project = await InnovationProject.findById(inv.project).select('owner').lean();
  const allowed = sameId(inv.inviter, req.user) || (project && sameId(project.owner, req.user));
  if (!allowed) throw new ApiError(404, 'Invitation not found');
  if (inv.status === 'cancelled') return res.json({ status: 'cancelled' });
  const updated = await TeamInvitation.findOneAndUpdate(
    { _id: inv._id, status: 'pending' },
    { $set: { status: 'cancelled', cancelledBy: req.user._id, respondedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw finished(await TeamInvitation.findById(inv._id).lean());
  res.json({ status: 'cancelled' });
});

// ── Membership changes ──────────────────────────────────────────────

/** Ending a membership also ends the member's pending public-publication consent. */
async function endMembership(project, userId, status, actor) {
  const updated = await TeamMembership.findOneAndUpdate(
    { project: project._id, user: userId, status: 'active', role: 'member' },
    { $set: { status, endedAt: new Date(), endedBy: actor._id } },
    { new: true }
  );
  if (!updated) return false;
  await InnovationProject.updateOne({ _id: project._id }, { $inc: { memberCount: -1 } });
  // $pull cannot traverse a null publicRequest, so only touch an open request.
  await InnovationProject.updateOne(
    { _id: project._id, publicRequest: { $type: 'object' } },
    { $pull: { 'publicRequest.consents': { user: userId } } }
  );
  return true;
}

/** DELETE /skill-wallet/projects/:id/team/:userId — owner removes a member. */
export const removeMember = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  if (!sameId(project.owner, req.user)) throw new ApiError(404, 'Project not found');
  assertObjectId(req.params.userId, 'member id');
  if (sameId(req.params.userId, req.user)) throw new ApiError(422, 'Transfer ownership before leaving your own project');
  const ok = await endMembership(project, req.params.userId, 'removed', req.user);
  if (!ok) throw new ApiError(404, 'That student is not an active member of this team');
  notifySkillWallet([req.params.userId], { title: 'Removed from a team project', message: 'The project owner removed you from a team project.', link: '/skill-wallet?tab=projects' });
  logActivity(req, 'skill_wallet.team.remove', { entityType: 'innovation_project', entityId: project._id, summary: 'Member removed' });
  res.json({ ok: true });
});

/** POST /skill-wallet/projects/:id/team/leave — a member (not the owner) leaves. */
export const leaveTeam = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id, { lean: true });
  if (sameId(project.owner, req.user)) throw new ApiError(422, 'Transfer ownership to another member before leaving');
  const ok = await endMembership(project, req.user._id, 'left', req.user);
  if (!ok) throw new ApiError(404, 'Project not found');
  notifySkillWallet([project.owner], { title: 'A member left your team project', message: `${req.user.name} left a team project.`, link: `/skill-wallet/projects/${project._id}` });
  res.json({ ok: true });
});

/** POST /skill-wallet/projects/:id/team/transfer { userId } — owner hands ownership to an active member. */
export const transferOwnership = asyncHandler(async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!sameId(project.owner, req.user)) throw new ApiError(404, 'Project not found');
  assertObjectId(req.body.userId, 'member id');
  if (sameId(req.body.userId, req.user)) throw new ApiError(422, 'You already own this project');
  const target = await TeamMembership.findOne({ project: project._id, user: req.body.userId, status: 'active', role: 'member' }).populate('user', 'department year isActive role');
  if (!target || !target.user?.isActive || !SKILL_WALLET_STUDENT_ROLES.includes(target.user.role)) {
    throw new ApiError(422, 'Ownership can only go to an active student member of this team');
  }
  await withTransaction(async (session) => {
    project.owner = target.user._id;
    project.department = target.user.department;
    project.year = target.user.year;
    // A pending public request was the old owner's choice.
    if (project.publicRequest) {
      project.publicRequest = null;
      logPublication(project, req.user, 'public_request_cancelled', { note: 'Ownership transferred' });
    }
    await saveOrConflict(project, { session });
    await TeamMembership.updateOne({ project: project._id, user: req.user._id, status: 'active' }, { $set: { role: 'member' } }, { session });
    await TeamMembership.updateOne({ _id: target._id }, { $set: { role: 'owner' } }, { session });
    await TeamInvitation.updateMany({ project: project._id, status: 'pending' }, { $set: { status: 'cancelled', cancelledBy: req.user._id, respondedAt: new Date() } }, { session });
  });
  notifySkillWallet([target.user._id], { title: 'You now own a team project', message: `${req.user.name} transferred project ownership to you.`, link: `/skill-wallet/projects/${project._id}` });
  logActivity(req, 'skill_wallet.team.transfer', { entityType: 'innovation_project', entityId: project._id, summary: 'Ownership transferred' });
  res.json({ ok: true });
});
