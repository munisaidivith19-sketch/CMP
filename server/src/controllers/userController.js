import User from '../models/User.js';
import Event from '../models/Event.js';
import Discussion from '../models/Discussion.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { persistFile } from '../utils/storage.js';
import { logActivity } from '../utils/activity.js';
import { canViewProfile, peopleScopeFilter } from '../utils/peopleScope.js';

const DIRECTORY_FIELDS = 'name role department year section semester avatar designation employeeId skills interests bio';

/**
 * Student / faculty directory with search and filters.
 * `context=picker` is for choosing a specific person for another feature
 * (starting a chat, picking a club's faculty advisor) — that stays open to
 * everyone, unrestricted, exactly as before the People-directory lockdown.
 * Without it, this IS the People directory and is scoped/blocked per role;
 * the scope is applied at the query level, before pagination, so counts and
 * results never include anything outside the caller's authorization.
 */
export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 18);
  const { q, department, role, skill, year, section, semester, context } = req.query;

  const clauses = [{ isActive: true }];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    clauses.push({ $or: [{ name: rx }, { department: rx }, { skills: rx }, { interests: rx }] });
  }
  if (department) clauses.push({ department });
  if (role) clauses.push({ role });
  if (year) clauses.push({ year: Number(year) });
  if (section) clauses.push({ section: String(section).toUpperCase() });
  if (semester) clauses.push({ semester: Number(semester) });
  if (skill) clauses.push({ skills: String(skill).toLowerCase() });
  if (context !== 'picker') {
    clauses.push(await peopleScopeFilter(req.user));
  }
  const filter = clauses.length > 1 ? { $and: clauses } : clauses[0];

  const [items, total] = await Promise.all([
    User.find(filter).select(DIRECTORY_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const getUser = asyncHandler(async (req, res) => {
  if (!(await canViewProfile(req.user, req.params.id))) throw new ApiError(403, 'Not authorized to view this profile');

  const user = await User.findOne({ _id: req.params.id, isActive: true })
    .select(`${DIRECTORY_FIELDS} rollNo stayType extracurriculars achievements clubs createdAt email phone parentPhone`)
    .populate('clubs', 'name slug logo category')
    .lean();
  if (!user) throw new ApiError(404, 'User not found');

  // Contact details are private: visible to the owner and staff only.
  const canSeeContact = String(user._id) === String(req.user._id) || ['admin', 'faculty', 'hod', 'principal'].includes(req.user.role);
  if (!canSeeContact) {
    delete user.email;
    delete user.phone;
    delete user.parentPhone;
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
  'parentPhone',
  'stayType',
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
