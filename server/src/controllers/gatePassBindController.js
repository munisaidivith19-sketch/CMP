import GatePass from '../models/GatePass.js';
import GatePassBindGroup from '../models/GatePassBindGroup.js';
import User from '../models/User.js';
import { isBranchHod, isFirstYearHod } from '../constants.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers } from '../utils/notify.js';
import { sameId } from '../utils/permissions.js';
import { emitToRoles } from '../config/socket.js';
import {
  GATE_STAFF,
  hodFilterFor,
  isClassFaculty,
  notifyStage,
  passSecurity,
  principalFilter,
  publish,
  verificationExpiryFor,
} from './gatePassController.js';
import { kickCodeQueue, queuedFields, scheduleSlots } from '../services/gatePassCodeQueue.js';

/**
 * Bulk gate-pass approval ("Bind").
 *
 *   Class in-charge: creates a group (name, title, reason) → after a student's
 *   parent OTP checks out, binds that request into the group → confirms and
 *   sends the group to the HOD.
 *   HOD: forwards the whole group to the principal, rejects the whole group,
 *   or rejects single students in it.
 *   Principal: approves or rejects the whole group, or rejects single students.
 *   On approval the codes are issued a few at a time by the code queue.
 *
 * Every check reads the database — nothing about the class, the group's
 * stage or the reviewer's scope is taken from the request.
 */

const MEMBER_STUDENT_FIELDS = 'name rollNo avatar department year section semester phone';
const MEMBER_PASS_FIELDS =
  'student status regarding subject description fromDate toDate destination parentPhone dayScholarOuting rejectedStage rejectedReason codeIssue.state codeIssue.scheduledAt codeIssue.issuedAt codeIssue.attempts createdAt';
const MAX_MEMBERS = 200;
const MAX_OPEN_GROUPS = 20;
const STAGE_STATUS = { hod: 'pending_hod', principal: 'pending_principal' };

const isAdmin = (user) => user.role === 'admin';

/** The HOD who decides this group's class: first-year HOD for year 1, else the branch HOD. */
function isGroupHod(group, user) {
  if (user.role !== 'hod') return false;
  if (isFirstYearHod(user)) return group.year === 1;
  return isBranchHod(user) && group.department === user.department && group.year !== 1;
}

function canViewGroup(group, user) {
  if (isAdmin(user)) return true;
  // A draft stays with its class in-charge until it is sent.
  if (user.role === 'principal') return group.status !== 'open';
  if (user.role === 'faculty') return sameId(group.createdBy, user);
  if (user.role === 'hod') return group.status !== 'open' && isGroupHod(group, user);
  return false;
}

/** Who may act on the group at its current stage. */
function canActOnGroup(group, user) {
  if (isAdmin(user)) return true;
  if (group.status === 'open') return user.role === 'faculty' && sameId(group.createdBy, user);
  if (group.status === 'pending_hod') return isGroupHod(group, user);
  if (group.status === 'pending_principal') return user.role === 'principal';
  return false;
}

async function loadGroup(id) {
  const group = await GatePassBindGroup.findById(id);
  if (!group) throw new ApiError(404, 'Bind group not found');
  return group;
}

const live = () => emitToRoles(GATE_STAFF, 'gatepass:updated', { bindGroup: true });

/** Groups with their students (name, department, year, section, mobile) and counts. */
async function withMembers(groups) {
  const ids = groups.map((g) => g._id);
  const passes = ids.length
    ? await GatePass.find({ bindGroup: { $in: ids } })
        .select(MEMBER_PASS_FIELDS + ' bindGroup')
        .populate('student', MEMBER_STUDENT_FIELDS)
        .sort({ createdAt: 1 })
        .lean()
    : [];
  const byGroup = new Map(ids.map((id) => [String(id), []]));
  passes.forEach((p) => byGroup.get(String(p.bindGroup))?.push(p));
  return groups.map((g) => {
    const plain = typeof g.toObject === 'function' ? g.toObject() : g;
    const members = (byGroup.get(String(plain._id)) || []).map(({ bindGroup, ...p }) => p);
    const count = (s) => members.filter((m) => m.status === s).length;
    return {
      ...plain,
      members,
      counts: {
        total: members.length,
        active: members.filter((m) => !['rejected', 'cancelled', 'revoked', 'expired'].includes(m.status)).length,
        rejected: count('rejected'),
        approved: members.filter((m) => ['approved', 'active', 'completed'].includes(m.status)).length,
        codesIssued: members.filter((m) => m.codeIssue?.state === 'issued').length,
        codesWaiting: members.filter((m) => m.status === 'approved' && ['queued', 'processing'].includes(m.codeIssue?.state)).length,
      },
    };
  });
}

const populateGroup = (q) => q.populate('createdBy', 'name role department').populate('hodReview.by', 'name role').populate('principalReview.by', 'name role');

async function sendGroup(res, id, status = 200) {
  const group = await populateGroup(GatePassBindGroup.findById(id)).lean();
  const [shaped] = await withMembers([group]);
  res.status(status).json(shaped);
}

// ── List / read ────────────────────────────────────────────────────

export const listBindGroups = asyncHandler(async (req, res) => {
  const { role } = req.user;
  let filter;
  if (role === 'admin') filter = {};
  else if (role === 'faculty') filter = { createdBy: req.user._id };
  else if (role === 'principal') filter = { $or: [{ status: 'pending_principal' }, { 'principalReview.by': req.user._id }] };
  else if (role === 'hod') {
    const scope = isFirstYearHod(req.user) ? { year: 1 } : isBranchHod(req.user) ? { department: req.user.department, year: { $ne: 1 } } : null;
    if (!scope) throw new ApiError(403, 'Not authorized');
    filter = { $or: [{ status: 'pending_hod', ...scope }, { 'hodReview.by': req.user._id }] };
  } else throw new ApiError(403, 'Not authorized');

  const want = req.query.status ? String(req.query.status).split(',') : null;
  if (want) filter = { $and: [filter, { status: { $in: want } }] };

  const groups = await populateGroup(GatePassBindGroup.find(filter)).sort({ updatedAt: -1 }).limit(50).lean();
  res.json(await withMembers(groups));
});

export const getBindGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  await sendGroup(res, group._id);
});

// ── Class in-charge: build the group ──────────────────────────────

export const createBindGroup = asyncHandler(async (req, res) => {
  const open = await GatePassBindGroup.countDocuments({ createdBy: req.user._id, status: 'open' });
  if (open >= MAX_OPEN_GROUPS) throw new ApiError(422, `You can have at most ${MAX_OPEN_GROUPS} open bind groups — send or delete one first`);
  const data = pick(req.body, ['name', 'title', 'reason']);
  const group = await GatePassBindGroup.create({ ...data, createdBy: req.user._id, status: 'open' });
  logActivity(req, 'gate_pass.bind_group_create', { entityType: 'gate_pass_bind_group', entityId: group._id, summary: group.name });
  live();
  await sendGroup(res, group._id, 201);
});

/** Delete a group that was never sent; its requests go back to the normal review queue. */
export const deleteBindGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  if (group.status !== 'open' || !canActOnGroup(group, req.user)) throw new ApiError(422, 'Only an open group can be deleted, by the faculty who created it');
  const removed = await GatePassBindGroup.findOneAndDelete({ _id: group._id, status: 'open' });
  if (!removed) throw new ApiError(422, 'This group was just sent on');
  await GatePass.updateMany({ bindGroup: group._id }, { $unset: { bindGroup: 1 } });
  logActivity(req, 'gate_pass.bind_group_delete', { entityType: 'gate_pass_bind_group', entityId: group._id, summary: group.name });
  live();
  res.json({ deleted: true });
});

/**
 * Bind one parent-verified request into an open group. The faculty must be
 * assigned to the student's class, and every student in a group is from the
 * same class (department + year + section + semester).
 */
export const bindGatePass = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('student status passType bindGroup department');
  if (!pass) throw new ApiError(404, 'Gate pass not found');
  if (!(await isClassFaculty(pass, req.user))) throw new ApiError(403, 'You can only bind requests from your own class');
  if (pass.passType !== 'normal') throw new ApiError(422, 'Emergency requests cannot be bound');
  if (pass.status !== 'parent_verified') throw new ApiError(422, "Verify the parent's OTP before binding this request");
  if (pass.bindGroup) throw new ApiError(409, 'This request is already in a bind group');

  const group = await loadGroup(req.body.groupId);
  if (!(isAdmin(req.user) || sameId(group.createdBy, req.user))) throw new ApiError(404, 'Bind group not found');
  if (group.status !== 'open') throw new ApiError(422, 'This group has already been sent — create a new group');
  if ((await GatePass.countDocuments({ bindGroup: group._id })) >= MAX_MEMBERS) throw new ApiError(422, `A bind group can hold at most ${MAX_MEMBERS} students`);

  const student = await User.findById(pass.student).select('department year section semester').lean();
  const cls = { department: student.department, year: student.year, section: String(student.section || '').toUpperCase(), semester: student.semester ?? null };
  if (group.department) {
    const same = group.department === cls.department && group.year === cls.year && group.section === cls.section && (group.semester == null || cls.semester == null || group.semester === cls.semester);
    if (!same) throw new ApiError(422, `This group is for ${group.department} · Year ${group.year} · Section ${group.section} — bind students of that class only`);
  } else {
    // First student fixes the group's class (atomic: two binds cannot set two classes).
    const claimed = await GatePassBindGroup.findOneAndUpdate(
      { _id: group._id, status: 'open', department: { $in: [null, ''] } },
      { $set: { department: cls.department, year: cls.year, section: cls.section, ...(cls.semester != null ? { semester: cls.semester } : {}) } },
      { new: true }
    );
    if (!claimed) {
      const fresh = await loadGroup(group._id);
      if (fresh.status !== 'open' || fresh.department !== cls.department || fresh.year !== cls.year || fresh.section !== cls.section) {
        throw new ApiError(422, 'This group is now set to another class');
      }
    }
  }

  const updated = await GatePass.findOneAndUpdate(
    { _id: pass._id, status: 'parent_verified', bindGroup: null },
    { $set: { bindGroup: group._id } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This request changed just now — refresh and try again');
  // The group may have been sent between the checks above and the bind.
  if (!(await GatePassBindGroup.exists({ _id: group._id, status: 'open' }))) {
    await GatePass.updateOne({ _id: pass._id, status: 'parent_verified', bindGroup: group._id }, { $unset: { bindGroup: 1 } });
    throw new ApiError(422, 'This group has already been sent — create a new group');
  }

  logActivity(req, 'gate_pass.bind', { entityType: 'gate_pass', entityId: pass._id, summary: group.name });
  publish(updated, { bindGroup: String(group._id) });
  await sendGroup(res, group._id);
});

/** Take a request back out of an open group (it returns to the normal review queue). */
export const unbindGatePass = asyncHandler(async (req, res) => {
  const pass = await GatePass.findById(req.params.id).select('student status bindGroup');
  if (!pass?.bindGroup) throw new ApiError(404, 'This request is not in a bind group');
  const group = await loadGroup(pass.bindGroup);
  if (!(isAdmin(req.user) || sameId(group.createdBy, req.user))) throw new ApiError(403, 'Only the faculty who created the group can change it');
  if (group.status !== 'open') throw new ApiError(422, 'The group has already been sent — the HOD or principal can reject single students instead');
  // Only a request still waiting with the faculty — never one the group already carried on.
  const updated = await GatePass.findOneAndUpdate({ _id: pass._id, bindGroup: group._id, status: { $in: ['pending_faculty', 'parent_verified'] } }, { $unset: { bindGroup: 1 } }, { new: true });
  if (!updated) throw new ApiError(409, 'This request changed just now — refresh and try again');
  // An empty group forgets its class so it can be reused for another one.
  if (!(await GatePass.exists({ bindGroup: group._id }))) {
    await GatePassBindGroup.updateOne({ _id: group._id, status: 'open' }, { $unset: { department: 1, year: 1, section: 1, semester: 1 } });
  }
  logActivity(req, 'gate_pass.unbind', { entityType: 'gate_pass', entityId: pass._id, summary: group.name });
  publish(updated);
  await sendGroup(res, group._id);
});

/** Confirm and send the group to the HOD: every parent-verified student in it moves on together. */
export const submitBindGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  if (group.status !== 'open') throw new ApiError(422, 'This group has already been sent');
  if (!canActOnGroup(group, req.user)) throw new ApiError(403, 'Only the faculty who created the group can send it');
  const ready = await GatePass.find({ bindGroup: group._id, status: 'parent_verified' }).select('student').lean();
  if (!ready.length) throw new ApiError(422, 'Bind at least one parent-verified student before sending the group');

  const now = new Date();
  const sent = await GatePassBindGroup.findOneAndUpdate(
    { _id: group._id, status: 'open' },
    { $set: { status: 'pending_hod', sentToHodAt: now } },
    { new: true }
  );
  if (!sent) throw new ApiError(422, 'This group was just sent');

  const review = { by: req.user._id, at: now, action: 'forwarded', reason: `Bind group: ${group.name}` };
  await GatePass.updateMany({ bindGroup: group._id, status: 'parent_verified' }, { $set: { status: 'pending_hod', facultyReview: review } });
  // Anything no longer parent-verified (withdrawn by the student, rejected by the
  // faculty, expired) leaves the group rather than travelling with it.
  await GatePass.updateMany({ bindGroup: group._id, status: { $ne: 'pending_hod' } }, { $unset: { bindGroup: 1 } });

  logActivity(req, 'gate_pass.bind_group_submit', { entityType: 'gate_pass_bind_group', entityId: group._id, summary: `${group.name} · ${ready.length} student(s)` });
  const studentIds = ready.map((p) => p.student);
  await notifyUsers(studentIds, { type: 'gate_pass', title: 'Gate pass forwarded to HOD', message: `Sent to the HOD with group “${group.name}”.`, link: '/gate-pass' }, { push: false });
  await notifyStage(hodFilterFor(sent.department, sent.year), {
    type: 'gate_pass',
    title: 'Bind group needs your review',
    message: `${group.name} · ${ready.length} student(s) · ${sent.department}${sent.year === 1 ? ' (1st Year)' : ` · Year ${sent.year}`} · Sec ${sent.section}`,
    link: '/gate-pass?tab=bind',
  });
  ready.forEach((p) => publish({ _id: p._id, student: p.student, status: 'pending_hod' }));
  live();
  await sendGroup(res, group._id);
});

// ── HOD / principal: decide the group ─────────────────────────────

/** Close a group whose every student has been rejected or withdrawn at this stage. */
async function closeIfEmpty(group, stage, user) {
  const left = await GatePass.exists({ bindGroup: group._id, status: STAGE_STATUS[stage] });
  if (left) return false;
  await GatePassBindGroup.updateOne(
    { _id: group._id, status: STAGE_STATUS[stage] },
    {
      $set: {
        status: 'rejected',
        rejectedStage: stage,
        rejectedReason: 'Every student in the group was rejected',
        [`${stage}Review`]: { by: user._id, at: new Date(), action: 'rejected', reason: 'Every student in the group was rejected' },
      },
    }
  );
  return true;
}

/** Reject every remaining student of a group at `stage`, and the group itself. */
async function rejectGroup(req, group, stage) {
  const reason = (req.body.reason || '').trim();
  const now = new Date();
  const review = { by: req.user._id, at: now, action: 'rejected', reason };
  const closed = await GatePassBindGroup.findOneAndUpdate(
    { _id: group._id, status: STAGE_STATUS[stage] },
    { $set: { status: 'rejected', rejectedStage: stage, rejectedReason: reason, [`${stage}Review`]: review } },
    { new: true }
  );
  if (!closed) throw new ApiError(422, 'This group was just decided by someone else');
  const members = await GatePass.find({ bindGroup: group._id, status: STAGE_STATUS[stage] }).select('student').lean();
  await GatePass.updateMany(
    { bindGroup: group._id, status: STAGE_STATUS[stage] },
    { $set: { status: 'rejected', rejectedStage: stage, rejectedReason: reason, [`${stage}Review`]: review } }
  );
  const by = stage === 'hod' ? 'HOD' : 'principal';
  await notifyUsers(members.map((m) => m.student), {
    type: 'gate_pass',
    title: 'Gate pass rejected',
    message: `Group “${group.name}” was rejected by the ${by}${reason ? `: ${reason}` : ''}`,
    link: '/gate-pass',
  });
  members.forEach((m) => {
    publish({ _id: m._id, student: m.student, status: 'rejected' });
    passSecurity(req, 'GATE_PASS_REJECTED', { _id: m._id, student: m.student }, { reason: reason || undefined, details: { stage, bindGroup: String(group._id) } });
  });
  logActivity(req, `gate_pass.bind_group_${stage}_reject`, { entityType: 'gate_pass_bind_group', entityId: group._id, summary: `${group.name} · ${members.length} student(s)` });
}

export const hodReviewBindGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  if (group.status !== 'pending_hod') throw new ApiError(422, 'This group is not waiting on HOD review');
  if (!canActOnGroup(group, req.user)) throw new ApiError(403, 'You are not the HOD for this class');

  if (req.body.action === 'reject') {
    await rejectGroup(req, group, 'hod');
  } else {
    const members = await GatePass.find({ bindGroup: group._id, status: 'pending_hod' }).select('student').lean();
    if (!members.length) throw new ApiError(422, 'No students are left in this group — reject it instead');
    const now = new Date();
    const review = { by: req.user._id, at: now, action: 'forwarded', reason: (req.body.reason || '').trim() };
    const moved = await GatePassBindGroup.findOneAndUpdate({ _id: group._id, status: 'pending_hod' }, { $set: { status: 'pending_principal', hodReview: review } }, { new: true });
    if (!moved) throw new ApiError(422, 'This group was just decided by someone else');
    await GatePass.updateMany({ bindGroup: group._id, status: 'pending_hod' }, { $set: { status: 'pending_principal', hodReview: review } });
    logActivity(req, 'gate_pass.bind_group_hod_forward', { entityType: 'gate_pass_bind_group', entityId: group._id, summary: `${group.name} · ${members.length} student(s)` });
    await notifyUsers(members.map((m) => m.student), { type: 'gate_pass', title: 'Gate pass forwarded to the principal', message: `Group “${group.name}” was forwarded by the HOD.`, link: '/gate-pass' }, { push: false });
    await notifyStage(principalFilter(), {
      type: 'gate_pass',
      title: 'Bind group needs your approval',
      message: `${group.name} · ${members.length} student(s) · ${group.department} · Year ${group.year} · Sec ${group.section}`,
      link: '/gate-pass?tab=bind',
    });
    members.forEach((m) => publish({ _id: m._id, student: m.student, status: 'pending_principal' }));
  }
  live();
  await sendGroup(res, group._id);
});

/**
 * Principal approves the group: every remaining student's pass is approved at
 * once, and their codes are queued — the queue issues them a few at a time,
 * and each student is told when their QR and code will be ready.
 */
export const principalReviewBindGroup = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  if (group.status !== 'pending_principal') throw new ApiError(422, 'This group is not waiting on principal approval');
  if (!canActOnGroup(group, req.user)) throw new ApiError(403, 'Only the principal can decide this group');

  if (req.body.action === 'reject') {
    await rejectGroup(req, group, 'principal');
    live();
    return sendGroup(res, group._id);
  }

  const members = await GatePass.find({ bindGroup: group._id, status: 'pending_principal' })
    .select('student toDate')
    .populate('student', 'name rollNo')
    .lean();
  if (!members.length) throw new ApiError(422, 'No students are left in this group — reject it instead');
  const now = new Date();
  const review = { by: req.user._id, at: now, action: 'approved', reason: (req.body.reason || '').trim() };
  const approved = await GatePassBindGroup.findOneAndUpdate({ _id: group._id, status: 'pending_principal' }, { $set: { status: 'approved', principalReview: review } }, { new: true });
  if (!approved) throw new ApiError(422, 'This group was just decided by someone else');

  // Roll-number order, so a class's codes come out in a predictable order.
  members.sort((a, b) => String(a.student?.rollNo || '').localeCompare(String(b.student?.rollNo || '')));
  const slots = await scheduleSlots(members.length, now);
  const result = await GatePass.bulkWrite(
    members.map((m, i) => ({
      updateOne: {
        filter: { _id: m._id, bindGroup: group._id, status: 'pending_principal' },
        update: {
          $set: { status: 'approved', principalReview: review, verificationExpiry: verificationExpiryFor(m.toDate), ...queuedFields(slots[i]) },
          $unset: { verificationCode: 1 },
        },
      },
    })),
    { ordered: false }
  );

  const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: env.timezone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  await Promise.all(
    members.map((m, i) =>
      notifyUsers([m.student._id], {
        type: 'gate_pass',
        title: 'Gate pass approved',
        message: `Approved with group “${group.name}”. Your QR code and code will be generated at ${fmt.format(slots[i])}.`,
        link: '/gate-pass',
      })
    )
  );
  members.forEach((m, i) => {
    publish({ _id: m._id, student: m.student._id, status: 'approved' }, { codeQueued: true, generateAt: slots[i] });
    passSecurity(req, 'GATE_PASS_APPROVED', { _id: m._id, student: m.student._id }, { details: { stage: 'principal', final: true, bindGroup: String(group._id) } });
  });
  logActivity(req, 'gate_pass.bind_group_approve', {
    entityType: 'gate_pass_bind_group',
    entityId: group._id,
    summary: `${group.name} · ${result.modifiedCount} student(s) · codes queued`,
  });
  live();
  kickCodeQueue();
  await sendGroup(res, group._id);
});

/** HOD (pending_hod) or principal (pending_principal) drops one student from the group. */
export const rejectBindMember = asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  if (!canViewGroup(group, req.user)) throw new ApiError(404, 'Bind group not found');
  const stage = group.status === 'pending_hod' ? 'hod' : group.status === 'pending_principal' ? 'principal' : null;
  if (!stage) throw new ApiError(422, 'Students can be rejected only while the group waits on the HOD or principal');
  if (!canActOnGroup(group, req.user)) throw new ApiError(403, `Only the ${stage === 'hod' ? 'HOD for this class' : 'principal'} can reject students now`);

  const reason = (req.body.reason || '').trim();
  const review = { by: req.user._id, at: new Date(), action: 'rejected', reason };
  const pass = await GatePass.findOneAndUpdate(
    { _id: req.params.passId, bindGroup: group._id, status: STAGE_STATUS[stage] },
    { $set: { status: 'rejected', rejectedStage: stage, rejectedReason: reason, [`${stage}Review`]: review } },
    { new: true }
  );
  if (!pass) throw new ApiError(404, 'That student is not waiting in this group');

  await notifyUsers([pass.student], {
    type: 'gate_pass',
    title: 'Gate pass rejected',
    message: `Rejected by the ${stage === 'hod' ? 'HOD' : 'principal'}${reason ? `: ${reason}` : ''}`,
    link: `/gate-pass/${pass._id}`,
  });
  passSecurity(req, 'GATE_PASS_REJECTED', pass, { reason: reason || undefined, details: { stage, bindGroup: String(group._id) } });
  logActivity(req, `gate_pass.bind_member_${stage}_reject`, { entityType: 'gate_pass', entityId: pass._id, summary: group.name });
  publish(pass);
  await closeIfEmpty(group, stage, req.user);
  live();
  await sendGroup(res, group._id);
});
