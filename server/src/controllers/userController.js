import User from '../models/User.js';
import Event from '../models/Event.js';
import Discussion from '../models/Discussion.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { persistFile } from '../utils/storage.js';
import { logActivity } from '../utils/activity.js';
import { canViewProfile, peopleScopeFilter } from '../utils/peopleScope.js';
import { chatContactFilter } from '../utils/chatScope.js';
import { ownDepartment, STUDENT_ROLES } from '../utils/academicScope.js';
import { ACADEMIC_YEARS, COLLEGE_WIDE_ROLES, DEPARTMENTS } from '../constants.js';

const DIRECTORY_FIELDS = 'name role department year section semester avatar designation employeeId skills interests bio';

/**
 * Student / faculty directory with search and filters.
 * `context=picker` is for choosing a specific person for another feature
 * (starting a chat or group, picking a club's faculty advisor). It is scoped
 * by the chat contact rules (utils/chatScope.js): a student only ever finds
 * their own classmates and the academic staff, a faculty member the students
 * of the classes they handle or are in charge of, an HOD their department.
 * Picking a faculty advisor still works for everyone, as staff are in scope.
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
  clauses.push(context === 'picker' ? await chatContactFilter(req.user) : await peopleScopeFilter(req.user));
  const filter = clauses.length > 1 ? { $and: clauses } : clauses[0];

  const [items, total] = await Promise.all([
    User.find(filter).select(DIRECTORY_FIELDS).sort({ name: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

/**
 * Which People filters this account may use, and with which options — derived
 * from the authenticated role and department, never from the request.
 *
 * - Faculty: search only. Their academic scope is their teaching assignment,
 *   so a department or role selector could only ever narrow a roster they are
 *   already limited to; the UI shows neither.
 * - HOD: year, section and role (Faculty / Student only) inside their own
 *   department. The department is fixed and not offered as a filter, and the
 *   sections are the ones that actually exist in their department.
 * - Admin, Principal, Chairman, Dean and AO (COLLEGE_WIDE_ROLES): department
 *   and role, college-wide.
 *
 * This only decides what the UI offers. It is not the security boundary —
 * peopleScopeFilter enforces the same scope on every query regardless.
 */
export const peopleFilters = asyncHandler(async (req, res) => {
  const { role } = req.user;

  if (role === 'faculty') {
    return res.json({ scope: 'assignment', department: req.user.department || null, filters: ['search'] });
  }

  if (role === 'hod') {
    const department = ownDepartment(req.user);
    const [sections, years] = await Promise.all([
      User.find({ department, isActive: true, section: { $nin: [null, ''] } }).distinct('section'),
      User.find({ department, isActive: true, role: { $in: STUDENT_ROLES } }).distinct('year'),
    ]);
    return res.json({
      scope: 'department',
      department,
      filters: ['search', 'year', 'section', 'role'],
      years: (years.filter(Boolean).length ? years.filter(Boolean) : ACADEMIC_YEARS).sort((a, b) => a - b),
      sections: sections.filter(Boolean).sort(),
      roles: ['faculty', 'student'],
    });
  }

  if (!COLLEGE_WIDE_ROLES.includes(role)) {
    throw new ApiError(403, 'Your role is not authorized to browse the People directory');
  }
  res.json({
    scope: 'college',
    department: req.user.department || null,
    filters: ['search', 'department', 'role'],
    departments: DEPARTMENTS,
  });
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
