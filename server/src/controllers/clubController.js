import mongoose from 'mongoose';
import Club from '../models/Club.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Announcement from '../models/Announcement.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { canManageClub, sameId } from '../utils/permissions.js';
import { notifyRoles, notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

const MEMBER_FIELDS = 'name avatar department year role';
const EDITABLE = ['name', 'tagline', 'description', 'category', 'logo', 'coverImage', 'tags', 'contactEmail', 'socialLinks'];

async function findClub(idOrSlug) {
  const q = mongoose.isValidObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: String(idOrSlug).toLowerCase() };
  const club = await Club.findOne(q);
  if (!club) throw new ApiError(404, 'Club not found');
  return club;
}

function shapeClub(club, user) {
  const obj = club.toJSON ? club.toJSON() : club;
  return {
    ...obj,
    memberCount: club.members?.length || 0,
    pendingCount: club.pendingRequests?.length || 0,
    isMember: club.members?.some((m) => sameId(m, user)) || false,
    isManager: canManageClub(user, club),
    hasRequested: club.pendingRequests?.some((r) => sameId(r.user, user)) || false,
  };
}

export const listClubs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 12);
  const { q, category, mine, status } = req.query;
  const filter = {};

  // Only admins may browse pending / rejected clubs.
  filter.status = req.user.role === 'admin' && status ? status : 'approved';
  if (category) filter.category = category;
  if (mine === 'true') filter.$or = [{ members: req.user._id }, { admins: req.user._id }];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$and = [{ $or: [{ name: rx }, { tagline: rx }, { tags: rx }, { description: rx }] }];
  }

  const [clubs, total] = await Promise.all([
    Club.find(filter)
      .select('-pendingRequests.message')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Club.countDocuments(filter),
  ]);

  const items = clubs.map((c) => {
    const shaped = shapeClub(c, req.user);
    delete shaped.members;
    delete shaped.pendingRequests;
    return shaped;
  });
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const getClub = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (club.status !== 'approved' && req.user.role !== 'admin' && !sameId(club.createdBy, req.user)) {
    throw new ApiError(404, 'Club not found');
  }
  await club.populate([
    { path: 'admins', select: MEMBER_FIELDS },
    { path: 'members', select: MEMBER_FIELDS },
    { path: 'facultyAdvisor', select: MEMBER_FIELDS },
    { path: 'createdBy', select: 'name' },
  ]);

  const shaped = shapeClub(club, req.user);
  if (!shaped.isManager) delete shaped.pendingRequests;

  const now = new Date();
  const [upcomingEvents, announcements] = await Promise.all([
    Event.find({ club: club._id, endDate: { $gte: now } })
      .select('title startDate endDate venue category poster capacity registeredCount')
      .sort({ startDate: 1 })
      .limit(6)
      .lean(),
    Announcement.find({ 'audience.club': club._id })
      .select('title content priority createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  res.json({ ...shaped, upcomingEvents, announcements });
});

/** Admins create approved clubs directly; anyone else submits a request for approval. */
export const createClub = asyncHandler(async (req, res) => {
  const data = pick(req.body, EDITABLE);
  const isAdmin = req.user.role === 'admin';
  const advisor = req.body.facultyAdvisor;
  if (advisor) {
    const fac = await User.exists({ _id: advisor, role: 'faculty' });
    if (!fac) throw new ApiError(400, 'Faculty advisor must be a faculty member');
  }

  const club = await Club.create({
    ...data,
    facultyAdvisor: advisor || undefined,
    status: isAdmin ? 'approved' : 'pending',
    createdBy: req.user._id,
    admins: [req.user._id],
    members: [req.user._id],
  });

  await User.updateOne({ _id: req.user._id }, { $addToSet: { clubs: club._id } });
  logActivity(req, isAdmin ? 'club.create' : 'club.request', { entityType: 'club', entityId: club._id, summary: club.name });

  if (!isAdmin) {
    notifyRoles(['admin'], {
      type: 'club',
      title: 'New club awaiting approval',
      message: `${req.user.name} requested “${club.name}”`,
      link: '/admin/clubs',
    });
  }
  res.status(201).json(shapeClub(club, req.user));
});

export const updateClub = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only club admins can edit this club');
  Object.assign(club, pick(req.body, EDITABLE));
  if (req.user.role === 'admin' && req.body.facultyAdvisor !== undefined) {
    club.facultyAdvisor = req.body.facultyAdvisor || undefined;
  }
  await club.save();
  logActivity(req, 'club.update', { entityType: 'club', entityId: club._id, summary: club.name });
  res.json(shapeClub(club, req.user));
});

export const deleteClub = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  await Promise.all([
    User.updateMany({ clubs: club._id }, { $pull: { clubs: club._id } }),
    Event.updateMany({ club: club._id }, { $unset: { club: 1 } }),
    club.deleteOne(),
  ]);
  logActivity(req, 'club.delete', { entityType: 'club', entityId: club._id, summary: club.name });
  res.json({ message: 'Club deleted' });
});

/** Admin approves / rejects a club request. */
export const reviewClub = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const club = await findClub(req.params.id);
  club.status = status;
  club.reviewNote = note;
  await club.save();

  if (status === 'approved' && club.createdBy) {
    await User.updateOne({ _id: club.createdBy, role: 'student' }, { role: 'club_admin' });
  }
  notifyUsers([club.createdBy], {
    type: 'club',
    title: status === 'approved' ? `“${club.name}” was approved 🎉` : `“${club.name}” was not approved`,
    message: note || (status === 'approved' ? 'Your club is now live.' : 'Contact the administrator for details.'),
    link: `/clubs/${club.slug}`,
  });
  logActivity(req, `club.${status}`, { entityType: 'club', entityId: club._id, summary: club.name });
  res.json(shapeClub(club, req.user));
});

export const requestJoin = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (club.status !== 'approved') throw new ApiError(400, 'This club is not accepting members yet');
  if (club.members.some((m) => sameId(m, req.user))) throw new ApiError(400, 'You are already a member');
  if (club.pendingRequests.some((r) => sameId(r.user, req.user))) throw new ApiError(400, 'Request already sent');

  club.pendingRequests.push({ user: req.user._id, message: req.body.message });
  await club.save();

  notifyUsers(club.admins, {
    type: 'club',
    title: `New join request for ${club.name}`,
    message: `${req.user.name} wants to join`,
    link: `/clubs/${club.slug}?tab=requests`,
  });
  logActivity(req, 'club.join_request', { entityType: 'club', entityId: club._id, summary: club.name });
  res.json(shapeClub(club, req.user));
});

export const cancelRequest = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  club.pendingRequests = club.pendingRequests.filter((r) => !sameId(r.user, req.user));
  await club.save();
  res.json(shapeClub(club, req.user));
});

export const leaveClub = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  const isAdmin = club.admins.some((a) => sameId(a, req.user));
  if (isAdmin && club.admins.length === 1) {
    throw new ApiError(400, 'You are the only club admin. Promote another member before leaving.');
  }
  club.members.pull(req.user._id);
  club.admins.pull(req.user._id);
  await club.save();
  await User.updateOne({ _id: req.user._id }, { $pull: { clubs: club._id } });
  logActivity(req, 'club.leave', { entityType: 'club', entityId: club._id, summary: club.name });
  res.json(shapeClub(club, req.user));
});

export const listRequests = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only club admins can view requests');
  await club.populate('pendingRequests.user', MEMBER_FIELDS + ' skills interests');
  res.json(club.pendingRequests);
});

export const handleRequest = asyncHandler(async (req, res) => {
  const { userId, action } = req.params;
  const club = await findClub(req.params.id);
  if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only club admins can manage requests');

  const request = club.pendingRequests.find((r) => sameId(r.user, userId));
  if (!request) throw new ApiError(404, 'Request not found');
  club.pendingRequests = club.pendingRequests.filter((r) => !sameId(r.user, userId));

  if (action === 'approve') {
    club.members.addToSet(userId);
    await User.updateOne({ _id: userId }, { $addToSet: { clubs: club._id } });
  }
  await club.save();

  notifyUsers([userId], {
    type: 'club',
    title: action === 'approve' ? `Welcome to ${club.name}! 🎉` : `Your request to join ${club.name} was declined`,
    link: `/clubs/${club.slug}`,
  });
  logActivity(req, `club.request_${action}`, { entityType: 'club', entityId: club._id, summary: club.name });
  res.json({ message: action === 'approve' ? 'Member approved' : 'Request declined' });
});

export const removeMember = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only club admins can remove members');
  const { userId } = req.params;
  if (sameId(userId, req.user)) throw new ApiError(400, 'Use “Leave club” to remove yourself');
  club.members.pull(userId);
  club.admins.pull(userId);
  await club.save();
  await User.updateOne({ _id: userId }, { $pull: { clubs: club._id } });
  logActivity(req, 'club.member_remove', { entityType: 'club', entityId: club._id, summary: club.name });
  res.json({ message: 'Member removed' });
});

/** Promote a member to club admin (or demote). */
export const setMemberRole = asyncHandler(async (req, res) => {
  const club = await findClub(req.params.id);
  if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only club admins can change roles');
  const { userId } = req.params;
  if (!club.members.some((m) => sameId(m, userId))) throw new ApiError(400, 'User is not a member');

  if (req.body.makeAdmin) {
    club.admins.addToSet(userId);
    await User.updateOne({ _id: userId, role: 'student' }, { role: 'club_admin' });
  } else {
    if (club.admins.length === 1) throw new ApiError(400, 'A club needs at least one admin');
    club.admins.pull(userId);
  }
  await club.save();
  notifyUsers([userId], {
    type: 'club',
    title: req.body.makeAdmin ? `You are now an admin of ${club.name}` : `Your admin role in ${club.name} was removed`,
    link: `/clubs/${club.slug}`,
  });
  res.json({ message: 'Role updated' });
});
