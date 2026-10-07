import Announcement from '../models/Announcement.js';
import Club from '../models/Club.js';
import {
  ACADEMIC_YEARS,
  ANNOUNCEMENT_READ_ALL_ROLES,
  CLASS_ANNOUNCEMENT_ROLES,
  DEPARTMENTS,
  FIRST_YEAR_HOD_DEPT,
  MAIN_ANNOUNCEMENT_ROLES,
  SECTIONS,
  isFirstYearHod,
} from '../constants.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { canManageClub, isModerator, sameId } from '../utils/permissions.js';
import { announcementVisibility, audienceUserIds } from '../utils/visibility.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

const POPULATE = [
  { path: 'author', select: 'name title avatar role designation department' },
  { path: 'audience.club', select: 'name slug logo' },
];
const EDITABLE = ['title', 'content', 'priority', 'attachments', 'deadline', 'image'];

function canEdit(user, ann) {
  return user.role === 'admin' || sameId(ann.author, user);
}

/** An HOD posts only inside their own academic scope — never trust the client. */
function assertHodScope(user, a) {
  if (isFirstYearHod(user)) {
    if (a.scope === 'department') {
      if (a.department !== user.department) throw new ApiError(403, 'You can only post to your own department');
      return;
    }
    if (a.year !== 1) throw new ApiError(403, `The ${FIRST_YEAR_HOD_DEPT} HOD posts to 1st year students only`);
    return;
  }
  if (a.department !== user.department) throw new ApiError(403, 'You can only post announcements to your own department');
  if (a.year === 1) throw new ApiError(403, `1st year announcements are posted by the ${FIRST_YEAR_HOD_DEPT} HOD`);
}

/** Validate who may publish to the requested audience and return a clean copy of it. */
async function checkAudience(user, audience = {}) {
  const scope = audience.scope || 'all';
  if (scope === 'club') {
    const club = await Club.findOne({ _id: audience.club, status: 'approved' });
    if (!club) throw new ApiError(400, 'Choose a valid club');
    if (!canManageClub(user, club) && !isModerator(user)) {
      throw new ApiError(403, 'Only club admins can post to this club');
    }
    return { scope, club: club._id };
  }
  if (scope === 'all') {
    if (!MAIN_ANNOUNCEMENT_ROLES.includes(user.role)) {
      throw new ApiError(403, 'Only the Principal can publish the main campus announcement');
    }
    return { scope };
  }
  if (!CLASS_ANNOUNCEMENT_ROLES.includes(user.role)) {
    throw new ApiError(403, 'Only the Principal and HODs can publish department, year or section announcements');
  }

  const department = typeof audience.department === 'string' ? audience.department.trim() : '';
  if (department && !DEPARTMENTS.includes(department)) throw new ApiError(422, 'Choose a valid department');
  const clean = { scope };
  if (scope === 'department') {
    if (!department) throw new ApiError(422, 'Department is required');
    clean.department = department;
  } else {
    const year = Number(audience.year);
    if (!ACADEMIC_YEARS.includes(year)) throw new ApiError(422, 'Choose a valid year');
    clean.year = year;
    if (department) clean.department = department;
    if (scope === 'section') {
      if (!department) throw new ApiError(422, 'Choose a department for a section announcement');
      const section = typeof audience.section === 'string' ? audience.section.trim().toUpperCase() : '';
      if (!SECTIONS.includes(section)) throw new ApiError(422, 'Choose a valid section');
      clean.section = section;
    }
  }
  if (user.role === 'hod') assertHodScope(user, clean);
  return clean;
}

const audienceKey = (a = {}) =>
  [a.scope || 'all', a.department || '', a.year ? Number(a.year) : '', (a.section || '').toUpperCase(), a.club?._id || a.club || '']
    .map(String)
    .join('|');

export const listAnnouncements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10);
  const str = (v) => (v === undefined || v === '' ? undefined : String(v));
  const [q, priority, club, scope] = ['q', 'priority', 'club', 'scope'].map((k) => str(req.query[k]));
  const and = [announcementVisibility(req.user)];
  if (priority) and.push({ priority });
  if (club) and.push({ 'audience.club': club });
  if (scope) and.push({ 'audience.scope': scope });
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ title: rx }, { content: rx }] });
  }
  const filter = { $and: and };

  const [items, total] = await Promise.all([
    Announcement.find(filter).populate(POPULATE).sort({ isPinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Announcement.countDocuments(filter),
  ]);
  res.json({
    items: items.map((a) => ({ ...a, canEdit: canEdit(req.user, a) })),
    ...pageMeta(total, page, limit),
  });
});

export const createAnnouncement = asyncHandler(async (req, res) => {
  const data = pick(req.body, EDITABLE);
  if (!data.image) delete data.image;
  const audience = await checkAudience(req.user, req.body.audience);
  const ann = await Announcement.create({ ...data, audience, author: req.user._id });
  await ann.populate(POPULATE);

  audienceUserIds(audience).then((ids) =>
    notifyUsers(
      ids,
      {
        type: 'announcement',
        title: `${ann.priority === 'urgent' ? '🚨 ' : ''}${ann.title}`,
        message: ann.content.slice(0, 140),
        link: '/announcements',
      },
      { exclude: req.user._id }
    )
  ).catch((err) => console.error('[announcement] notify failed:', err.message));
  logActivity(req, 'announcement.create', { entityType: 'announcement', entityId: ann._id, summary: ann.title });
  res.status(201).json({ ...ann.toJSON(), canEdit: true });
});

export const updateAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id);
  if (!ann) throw new ApiError(404, 'Announcement not found');
  if (!canEdit(req.user, ann)) throw new ApiError(403, 'You cannot edit this announcement');
  const data = pick(req.body, EDITABLE);
  if (data.image === '' || data.image === null) data.image = undefined;
  Object.assign(ann, data);
  // Re-check the audience only when it changes, so authors can still fix the
  // text of an announcement whose audience predates the current posting rules.
  if (req.body.audience && audienceKey(req.body.audience) !== audienceKey(ann.audience)) {
    ann.audience = await checkAudience(req.user, req.body.audience);
  }
  await ann.save();
  await ann.populate(POPULATE);
  logActivity(req, 'announcement.update', { entityType: 'announcement', entityId: ann._id, summary: ann.title });
  res.json({ ...ann.toJSON(), canEdit: true });
});

export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const ann = await Announcement.findById(req.params.id);
  if (!ann) throw new ApiError(404, 'Announcement not found');
  if (!canEdit(req.user, ann)) throw new ApiError(403, 'You cannot delete this announcement');
  await ann.deleteOne();
  logActivity(req, 'announcement.delete', { entityType: 'announcement', entityId: ann._id, summary: ann.title });
  res.json({ message: 'Announcement deleted' });
});

export const togglePin = asyncHandler(async (req, res) => {
  const ann = await Announcement.findOne({ $and: [{ _id: req.params.id }, announcementVisibility(req.user)] });
  if (!ann) throw new ApiError(404, 'Announcement not found');
  // Pinning is campus-wide: Admin / Principal pin anything, everyone else only their own.
  if (!['admin', 'principal'].includes(req.user.role) && !sameId(ann.author, req.user)) {
    throw new ApiError(403, 'You can only pin your own announcements');
  }
  ann.isPinned = !ann.isPinned;
  await ann.save();
  res.json({ isPinned: ann.isPinned });
});
