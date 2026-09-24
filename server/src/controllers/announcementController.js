import Announcement from '../models/Announcement.js';
import Club from '../models/Club.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { canManageClub, isModerator, sameId } from '../utils/permissions.js';
import { announcementVisibility, audienceUserIds } from '../utils/visibility.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

const POPULATE = [
  { path: 'author', select: 'name avatar role designation' },
  { path: 'audience.club', select: 'name slug logo' },
];

function canEdit(user, ann) {
  return user.role === 'admin' || sameId(ann.author, user);
}

/** Validate who may publish to the requested audience. */
async function checkAudience(user, audience = {}) {
  const scope = audience.scope || 'all';
  const clean = { scope };
  if (scope === 'club') {
    const club = await Club.findOne({ _id: audience.club, status: 'approved' });
    if (!club) throw new ApiError(400, 'Choose a valid club');
    if (!canManageClub(user, club) && !isModerator(user)) {
      throw new ApiError(403, 'Only club admins can post to this club');
    }
    clean.club = club._id;
    return clean;
  }
  if (!isModerator(user)) throw new ApiError(403, 'Only faculty and administrators can post campus-wide announcements');
  if (scope === 'department') {
    if (!audience.department) throw new ApiError(422, 'Department is required');
    clean.department = audience.department;
  }
  if (scope === 'year') {
    if (!audience.year) throw new ApiError(422, 'Year is required');
    clean.year = Number(audience.year);
  }
  return clean;
}

export const listAnnouncements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10);
  const { q, priority, club, scope } = req.query;
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
  const data = pick(req.body, ['title', 'content', 'priority', 'attachments', 'deadline']);
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
  Object.assign(ann, pick(req.body, ['title', 'content', 'priority', 'attachments', 'deadline']));
  if (req.body.audience) ann.audience = await checkAudience(req.user, req.body.audience);
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
  const ann = await Announcement.findById(req.params.id);
  if (!ann) throw new ApiError(404, 'Announcement not found');
  ann.isPinned = !ann.isPinned;
  await ann.save();
  res.json({ isPinned: ann.isPinned });
});
