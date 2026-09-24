import User from '../models/User.js';
import Event from '../models/Event.js';
import Discussion from '../models/Discussion.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { persistFile } from '../utils/storage.js';
import { logActivity } from '../utils/activity.js';

const DIRECTORY_FIELDS = 'name role department year avatar designation skills interests bio';

/** Student / faculty directory with search and filters. */
export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 18);
  const filter = { isActive: true };
  const { q, department, role, skill, year } = req.query;

  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { department: rx }, { skills: rx }, { interests: rx }];
  }
  if (department) filter.department = department;
  if (role) filter.role = role;
  if (year) filter.year = Number(year);
  if (skill) filter.skills = String(skill).toLowerCase();

  const [items, total] = await Promise.all([
    User.find(filter).select(DIRECTORY_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isActive: true })
    .select(`${DIRECTORY_FIELDS} rollNo extracurriculars achievements clubs createdAt email phone`)
    .populate('clubs', 'name slug logo category')
    .lean();
  if (!user) throw new ApiError(404, 'User not found');

  // Contact details are private: visible to the owner, faculty and admins only.
  const canSeeContact = String(user._id) === String(req.user._id) || ['admin', 'faculty'].includes(req.user.role);
  if (!canSeeContact) {
    delete user.email;
    delete user.phone;
  }

  const [eventsJoined, eventsAttended, discussions] = await Promise.all([
    Event.countDocuments({ 'registrations.user': user._id }),
    Event.countDocuments({ registrations: { $elemMatch: { user: user._id, status: 'attended' } } }),
    Discussion.countDocuments({ author: user._id, isHidden: false }),
  ]);

  const recentEvents = await Event.find({ 'registrations.user': user._id })
    .select('title startDate category venue poster')
    .sort({ startDate: -1 })
    .limit(5)
    .lean();

  res.json({ ...user, stats: { eventsJoined, eventsAttended, discussions, clubs: user.clubs.length }, recentEvents });
});

const PROFILE_FIELDS = [
  'name',
  'department',
  'year',
  'rollNo',
  'designation',
  'bio',
  'phone',
  'interests',
  'skills',
  'extracurriculars',
  'achievements',
];

export const updateMe = asyncHandler(async (req, res) => {
  const updates = pick(req.body, PROFILE_FIELDS);
  Object.assign(req.user, updates);
  await req.user.save();
  logActivity(req, 'profile.update', { entityType: 'user', entityId: req.user._id });
  const user = await User.findById(req.user._id).populate('clubs', 'name slug logo');
  res.json(user);
});

export const uploadAvatar = asyncHandler(async (req, res) => {
  const file = await persistFile(req.file, 'image');
  req.user.avatar = file.url;
  await req.user.save({ validateModifiedOnly: true });
  const user = await User.findById(req.user._id).populate('clubs', 'name slug logo');
  res.json(user);
});
