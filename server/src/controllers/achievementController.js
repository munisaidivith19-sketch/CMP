import Achievement from '../models/Achievement.js';
import Announcement from '../models/Announcement.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { sameId } from '../utils/permissions.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';
import { PdfDocument, asciiSafe, safeFilename } from '../utils/pdf.js';
import { ACHIEVEMENT_MODERATE_ROLES, ACHIEVEMENT_POST_ROLES } from '../constants.js';

/** Club admins are students with extra club permissions. */
const STUDENT_ROLES = ['student', 'club_admin'];
const MAX_STUDENTS = 20;
const STUDENT_FIELDS = 'name avatar department year section rollNo role';
const POPULATE = [
  { path: 'students', select: STUDENT_FIELDS },
  { path: 'postedBy', select: 'name avatar role designation department' },
];

const label = (s = '') => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const isPrincipal = (u) => u?.role === 'principal';
const isPoster = (u) => ACHIEVEMENT_POST_ROLES.includes(u?.role);
const isAdmin = (u) => ACHIEVEMENT_MODERATE_ROLES.includes(u?.role);
const idStr = (v) => String(v?._id || v);

/** Principal manages any post; an HOD only the ones they posted (and only in their department). */
function canManage(user, a) {
  if (!isPoster(user)) return false;
  if (isPrincipal(user)) return true;
  return sameId(a.postedBy, user) && (a.departments || []).every((d) => d === user.department);
}

/** Principal / HOD may feature; an HOD only an achievement made up of their own department. */
function canFeature(user, a) {
  if (!isPoster(user)) return false;
  if (isPrincipal(user)) return true;
  return (a.departments || []).length > 0 && a.departments.every((d) => d === user.department);
}

const canDelete = (user, a) => isAdmin(user) || canManage(user, a);

/** HOD scope: the server, not the picker, decides who an HOD may tag. */
function assertScope(actor, students) {
  if (isPrincipal(actor)) return;
  const outside = students.filter((s) => !actor.department || s.department !== actor.department);
  if (outside.length) {
    throw new ApiError(403, 'An HOD can only post achievements for students of their own department');
  }
}

async function loadStudents(ids = []) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) throw new ApiError(422, 'Select at least one student');
  if (unique.length > MAX_STUDENTS) throw new ApiError(422, `You can tag at most ${MAX_STUDENTS} students`);
  const students = await User.find({ _id: { $in: unique }, role: { $in: STUDENT_ROLES }, isActive: true }).select(STUDENT_FIELDS);
  if (students.length !== unique.length) throw new ApiError(422, 'Only active students can be tagged');
  return students;
}

function assertDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(422, 'Enter a valid achievement date');
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d > endOfToday) throw new ApiError(422, 'The achievement date cannot be in the future');
  return d;
}

const derived = (students) => ({
  students: students.map((s) => s._id),
  departments: [...new Set(students.map((s) => s.department).filter(Boolean))],
  years: [...new Set(students.map((s) => s.year).filter(Boolean))],
});

const nameList = (students) => students.map((s) => s.name).join(', ');

/** The feed entry. No mass notification: the featured students get their own. */
async function createFeedEntry(a, students) {
  const ann = await Announcement.create({
    title: `Achievement: ${nameList(students)} - ${a.title}`.slice(0, 160),
    content: `${a.description}`.slice(0, 5000),
    author: a.postedBy,
    audience: { scope: 'all' },
    priority: 'normal',
  });
  return ann._id;
}

function view(a, user) {
  const manager = canManage(user, a);
  const mine = (a.hideRequests || []).find((r) => sameId(r.student, user) && r.status === 'pending');
  const { hideRequests, congratulations, announcement, ...rest } = a;
  return {
    ...rest,
    congratulationCount: (congratulations || []).length,
    congratulated: (congratulations || []).some((c) => sameId(c, user)),
    canEdit: manager,
    canDelete: canDelete(user, a),
    canFeature: canFeature(user, a),
    canRestore: isAdmin(user) && a.isDeleted,
    isMine: (a.students || []).some((s) => sameId(s, user)),
    myHideRequest: mine ? mine.status : null,
    hideRequests: manager
      ? (hideRequests || []).filter((r) => r.status === 'pending')
      : [],
  };
}

/** Build the list filter. `scope` is the caller's own department when an HOD exports. */
function buildFilter(req, { scopeDepartment } = {}) {
  const { q, category, level, department, year, student, featured, mine, includeDeleted } = req.query;
  const and = [];
  and.push(includeDeleted === 'true' && isAdmin(req.user) ? {} : { isDeleted: false });
  if (category) and.push({ category });
  if (level) and.push({ level });
  if (department) and.push({ departments: String(department) });
  if (year) and.push({ years: Number(year) });
  if (student) and.push({ students: student });
  if (featured === 'true') and.push({ isFeatured: true });
  if (mine === 'true') and.push({ students: req.user._id });
  if (scopeDepartment) and.push({ departments: scopeDepartment });
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ title: rx }, { eventName: rx }, { description: rx }, { organizer: rx }] });
  }
  return { $and: and };
}

export const listAchievements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 12);
  const filter = buildFilter(req);
  const [items, total] = await Promise.all([
    Achievement.find(filter).populate(POPULATE).sort({ isFeatured: -1, achievedOn: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Achievement.countDocuments(filter),
  ]);
  res.json({ items: items.map((a) => view(a, req.user)), ...pageMeta(total, page, limit) });
});

/** Everything the student dashboard needs: my achievements + the campus carousel. */
export const dashboardAchievements = asyncHandler(async (req, res) => {
  const [mineCount, mine, campus] = await Promise.all([
    Achievement.countDocuments({ isDeleted: false, students: req.user._id }),
    Achievement.find({ isDeleted: false, students: req.user._id }).populate(POPULATE).sort({ achievedOn: -1 }).limit(3).lean(),
    Achievement.find({ isDeleted: false }).populate(POPULATE).sort({ isFeatured: -1, achievedOn: -1 }).limit(5).lean(),
  ]);
  res.json({
    mine: { count: mineCount, items: mine.map((a) => view(a, req.user)) },
    campus: campus.map((a) => view(a, req.user)),
  });
});

export const studentAchievements = asyncHandler(async (req, res) => {
  const items = await Achievement.find({ isDeleted: false, students: req.params.id })
    .populate(POPULATE)
    .sort({ isFeatured: -1, achievedOn: -1 })
    .limit(50)
    .lean();
  res.json({ items: items.map((a) => view(a, req.user)) });
});

export const getAchievement = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id).populate(POPULATE).lean();
  if (!a || (a.isDeleted && !isAdmin(req.user))) throw new ApiError(404, 'Achievement not found');
  res.json(view(a, req.user));
});

/** Student picker for the post form. An HOD only ever sees their own department. */
export const searchStudents = asyncHandler(async (req, res) => {
  const clauses = [{ role: { $in: STUDENT_ROLES } }, { isActive: true }];
  if (!isPrincipal(req.user)) clauses.push({ department: req.user.department || '__none__' });
  else if (req.query.department) clauses.push({ department: String(req.query.department) });
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    clauses.push({ $or: [{ name: rx }, { rollNo: rx }] });
  }
  const items = await User.find({ $and: clauses }).select(STUDENT_FIELDS).sort({ name: 1 }).limit(20).lean();
  res.json({ items });
});

export const createAchievement = asyncHandler(async (req, res) => {
  const data = pick(req.body, [
    'title', 'description', 'category', 'level', 'position', 'eventName', 'organizer', 'externalLink', 'images',
  ]);
  const students = await loadStudents(req.body.students);
  assertScope(req.user, students);
  const achievedOn = assertDate(req.body.achievedOn);

  const a = await Achievement.create({ ...data, achievedOn, ...derived(students), postedBy: req.user._id });
  const announcement = await createFeedEntry(a, students).catch((err) => {
    console.error('[achievement] feed entry failed:', err.message);
    return null;
  });
  if (announcement) await Achievement.updateOne({ _id: a._id }, { $set: { announcement } });

  notifyUsers(
    students.map((s) => s._id),
    {
      type: 'achievement',
      title: 'Congratulations! You were featured',
      message: `${a.title} (${label(a.level)} level)`.slice(0, 140),
      link: `/achievements/${a._id}`,
    },
    { exclude: req.user._id }
  );
  logActivity(req, 'achievement.create', { entityType: 'achievement', entityId: a._id, summary: `${a.title} - ${nameList(students)}` });

  const fresh = await Achievement.findById(a._id).populate(POPULATE).lean();
  res.status(201).json(view(fresh, req.user));
});

export const updateAchievement = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id);
  if (!a || a.isDeleted) throw new ApiError(404, 'Achievement not found');
  if (!canManage(req.user, a)) throw new ApiError(403, 'You cannot edit this achievement');

  Object.assign(
    a,
    pick(req.body, ['title', 'description', 'category', 'level', 'position', 'eventName', 'organizer', 'externalLink', 'images'])
  );
  if (req.body.achievedOn) a.achievedOn = assertDate(req.body.achievedOn);

  let added = [];
  if (req.body.students) {
    const students = await loadStudents(req.body.students);
    assertScope(req.user, students);
    const before = new Set(a.students.map(String));
    added = students.filter((s) => !before.has(String(s._id)));
    Object.assign(a, derived(students));
  }
  await a.save();

  if (added.length) {
    notifyUsers(
      added.map((s) => s._id),
      { type: 'achievement', title: 'Congratulations! You were featured', message: a.title.slice(0, 140), link: `/achievements/${a._id}` },
      { exclude: req.user._id }
    );
  }
  logActivity(req, 'achievement.update', { entityType: 'achievement', entityId: a._id, summary: a.title });
  const fresh = await Achievement.findById(a._id).populate(POPULATE).lean();
  res.json(view(fresh, req.user));
});

export const deleteAchievement = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id);
  if (!a || a.isDeleted) throw new ApiError(404, 'Achievement not found');
  if (!canDelete(req.user, a)) throw new ApiError(403, 'You cannot delete this achievement');
  a.isDeleted = true;
  a.deletedBy = req.user._id;
  a.deletedAt = new Date();
  a.isFeatured = false;
  await a.save();
  if (a.announcement) await Announcement.deleteOne({ _id: a.announcement });
  logActivity(req, 'achievement.delete', { entityType: 'achievement', entityId: a._id, summary: a.title });
  res.json({ ok: true });
});

export const restoreAchievement = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id);
  if (!a || !a.isDeleted) throw new ApiError(404, 'Achievement not found');
  a.isDeleted = false;
  a.deletedBy = undefined;
  a.deletedAt = undefined;
  await a.save();
  logActivity(req, 'achievement.restore', { entityType: 'achievement', entityId: a._id, summary: a.title });
  const fresh = await Achievement.findById(a._id).populate(POPULATE).lean();
  res.json(view(fresh, req.user));
});

export const toggleFeatured = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id);
  if (!a || a.isDeleted) throw new ApiError(404, 'Achievement not found');
  if (!canFeature(req.user, a)) throw new ApiError(403, 'You cannot feature this achievement');
  a.isFeatured = !a.isFeatured;
  await a.save();
  logActivity(req, a.isFeatured ? 'achievement.feature' : 'achievement.unfeature', {
    entityType: 'achievement', entityId: a._id, summary: a.title,
  });
  res.json({ isFeatured: a.isFeatured });
});

export const congratulate = asyncHandler(async (req, res) => {
  const existing = await Achievement.findOne({ _id: req.params.id, isDeleted: false }).select('congratulations');
  if (!existing) throw new ApiError(404, 'Achievement not found');
  const has = existing.congratulations.some((c) => sameId(c, req.user));
  const updated = await Achievement.findOneAndUpdate(
    { _id: req.params.id },
    has ? { $pull: { congratulations: req.user._id } } : { $addToSet: { congratulations: req.user._id } },
    { new: true }
  ).select('congratulations');
  res.json({ congratulated: !has, congratulationCount: updated.congratulations.length });
});

/** A featured student asks for the achievement to be hidden. A manager decides. */
export const requestHide = asyncHandler(async (req, res) => {
  const a = await Achievement.findOne({ _id: req.params.id, isDeleted: false });
  if (!a) throw new ApiError(404, 'Achievement not found');
  if (!a.students.some((s) => sameId(s, req.user))) throw new ApiError(403, 'You are not featured in this achievement');
  if (a.hideRequests.some((r) => sameId(r.student, req.user) && r.status === 'pending')) {
    throw new ApiError(409, 'You already have a pending request');
  }
  a.hideRequests.push({ student: req.user._id, reason: String(req.body.reason || '').slice(0, 300) });
  await a.save();
  notifyUsers([a.postedBy], {
    type: 'achievement',
    title: 'Hide request on an achievement',
    message: `${req.user.name} asked to be removed from "${a.title}"`.slice(0, 140),
    link: `/achievements/${a._id}`,
  });
  logActivity(req, 'achievement.hide_request', { entityType: 'achievement', entityId: a._id, summary: a.title });
  res.status(201).json({ ok: true });
});

export const resolveHideRequest = asyncHandler(async (req, res) => {
  const a = await Achievement.findById(req.params.id);
  if (!a || a.isDeleted) throw new ApiError(404, 'Achievement not found');
  if (!canManage(req.user, a)) throw new ApiError(403, 'You cannot resolve this request');
  const request = a.hideRequests.id(req.params.reqId);
  if (!request || request.status !== 'pending') throw new ApiError(404, 'Request not found');

  const approve = req.body.action === 'approve';
  request.status = approve ? 'approved' : 'rejected';
  if (approve) {
    a.students = a.students.filter((s) => !sameId(s, request.student));
    if (!a.students.length) {
      a.isDeleted = true;
      a.deletedBy = req.user._id;
      a.deletedAt = new Date();
      a.isFeatured = false;
    } else {
      const remaining = await User.find({ _id: { $in: a.students } }).select('department year');
      a.departments = [...new Set(remaining.map((s) => s.department).filter(Boolean))];
      a.years = [...new Set(remaining.map((s) => s.year).filter(Boolean))];
    }
  }
  await a.save();
  notifyUsers([request.student], {
    type: 'achievement',
    title: approve ? 'Your hide request was approved' : 'Your hide request was declined',
    message: a.title.slice(0, 140),
    link: approve ? '/achievements' : `/achievements/${a._id}`,
  });
  logActivity(req, `achievement.hide_${request.status}`, { entityType: 'achievement', entityId: a._id, summary: a.title });
  res.json({ ok: true, status: request.status });
});

/** Principal / HOD / Admin: totals for the current calendar year. An HOD sees their department only. */
export const achievementStats = asyncHandler(async (req, res) => {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const match = { isDeleted: false };
  if (req.user.role === 'hod') match.departments = req.user.department;
  const [total, thisYear, byCategory, byLevel, byDepartment] = await Promise.all([
    Achievement.countDocuments(match),
    Achievement.countDocuments({ ...match, achievedOn: { $gte: yearStart } }),
    Achievement.aggregate([{ $match: { ...match, achievedOn: { $gte: yearStart } } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Achievement.aggregate([{ $match: { ...match, achievedOn: { $gte: yearStart } } }, { $group: { _id: '$level', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Achievement.aggregate([
      { $match: { ...match, achievedOn: { $gte: yearStart } } },
      { $unwind: '$departments' },
      ...(req.user.role === 'hod' ? [{ $match: { departments: req.user.department } }] : []),
      { $group: { _id: '$departments', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);
  const rows = (list) => list.map((r) => ({ key: r._id, count: r.count }));
  res.json({ total, thisYear, byCategory: rows(byCategory), byLevel: rows(byLevel), byDepartment: rows(byDepartment) });
});

/** Spreadsheets treat a leading = + - @ as a formula, so neutralise it. */
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const exportAchievements = asyncHandler(async (req, res) => {
  const scopeDepartment = req.user.role === 'hod' ? req.user.department : undefined;
  const items = await Achievement.find(buildFilter(req, { scopeDepartment }))
    .populate({ path: 'students', select: 'name rollNo department year' })
    .sort({ achievedOn: -1 })
    .limit(2000)
    .lean();

  const rows = items.map((a) => ({
    date: new Date(a.achievedOn).toISOString().slice(0, 10),
    title: a.title,
    students: (a.students || []).map((s) => (s.rollNo ? `${s.name} (${s.rollNo})` : s.name)).join('; '),
    departments: (a.departments || []).join('; '),
    category: label(a.category),
    level: label(a.level),
    position: label(a.position),
    event: a.eventName || '',
  }));

  logActivity(req, 'achievement.export', { entityType: 'achievement', summary: `${req.query.format || 'csv'} export, ${rows.length} rows` });
  const base = safeFilename(`achievements-${new Date().toISOString().slice(0, 10)}`);

  if (req.query.format === 'pdf') {
    const doc = new PdfDocument({ title: 'Student Achievements', footer: 'Student Achievements' });
    doc.line('Student Achievements', { size: 18, bold: true });
    doc.line(`Generated ${new Date().toISOString().slice(0, 10)} - ${rows.length} record(s)`, { size: 9.5 });
    doc.hr();
    if (!rows.length) doc.line('No achievements match these filters.', { size: 10 });
    else {
      doc.table({
        columns: [
          { header: '#', width: 0.4, align: 'right' },
          { header: 'Date', width: 1 },
          { header: 'Achievement', width: 2.6 },
          { header: 'Students', width: 2.6 },
          { header: 'Dept', width: 1.5 },
          { header: 'Category', width: 1.2 },
          { header: 'Level', width: 1 },
          { header: 'Rank', width: 1 },
        ],
        rows: rows.map((r, i) => [String(i + 1), r.date, r.title, r.students, r.departments, r.category, r.level, r.position].map((c) => asciiSafe(c))),
      });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.send(doc.toBuffer());
  }

  const header = ['Date', 'Title', 'Students', 'Departments', 'Category', 'Level', 'Position', 'Event'];
  const csv = [header, ...rows.map((r) => [r.date, r.title, r.students, r.departments, r.category, r.level, r.position, r.event])]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
  return res.send(`\uFEFF${csv}`);
});


