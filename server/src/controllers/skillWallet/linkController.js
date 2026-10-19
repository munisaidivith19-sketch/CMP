import ProfileLink, { MAX_LINKS_PER_USER } from '../../models/ProfileLink.js';
import { ApiError, asyncHandler } from '../../utils/http.js';
import { PLATFORM_LABELS, profileLinkUrl } from '../../services/skillWallet/urls.js';
import { assertObjectId } from '../../services/skillWallet/projects.js';
import { SW_LINK_PLATFORMS, SW_VISIBILITY } from '../../constants.js';

/**
 * Links & Profiles. A student manages only their own links. The URL is
 * validated (https, real domain, the platform's own domain for known
 * platforms) and stored — never fetched, and never presented as verified.
 */

function parseLink(body, existing = null) {
  const b = body || {};
  const platform = b.platform ?? existing?.platform;
  if (!SW_LINK_PLATFORMS.includes(platform)) throw new ApiError(422, 'Choose a platform');
  const out = { platform };
  // A custom platform needs a name; known platforms default to their own label.
  const rawName = b.displayName !== undefined ? String(b.displayName).trim() : existing && existing.platform === platform ? existing.displayName : '';
  if (platform === 'other' && !rawName) throw new ApiError(422, 'Enter a name for this platform');
  const displayName = rawName || PLATFORM_LABELS[platform];
  if (displayName.length > 60) throw new ApiError(422, 'Platform name must be 60 characters or fewer');
  out.displayName = displayName;
  if (b.url !== undefined || !existing || platform !== existing.platform) out.url = profileLinkUrl(platform, b.url ?? existing?.url);
  if (b.description !== undefined) {
    const d = String(b.description || '').trim();
    if (d.length > 300) throw new ApiError(422, 'Description must be 300 characters or fewer');
    out.description = d;
  }
  if (b.visibility !== undefined) {
    if (!SW_VISIBILITY.includes(b.visibility)) throw new ApiError(422, 'Visibility must be private, college or public');
    out.visibility = b.visibility;
  }
  return out;
}

const view = (l) => ({ _id: l._id, platform: l.platform, displayName: l.displayName, url: l.url, description: l.description, visibility: l.visibility, createdAt: l.createdAt, updatedAt: l.updatedAt });

export const listLinks = asyncHandler(async (req, res) => {
  const items = await ProfileLink.find({ user: req.user._id }).sort({ createdAt: 1 }).lean();
  res.json({ items: items.map(view), max: MAX_LINKS_PER_USER });
});

export const createLink = asyncHandler(async (req, res) => {
  const data = parseLink(req.body);
  const count = await ProfileLink.countDocuments({ user: req.user._id });
  if (count >= MAX_LINKS_PER_USER) throw new ApiError(422, `You can add at most ${MAX_LINKS_PER_USER} links`);
  const link = await ProfileLink.create({ ...data, user: req.user._id });
  res.status(201).json(view(link));
});

export const updateLink = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'link id');
  const link = await ProfileLink.findOne({ _id: req.params.id, user: req.user._id });
  if (!link) throw new ApiError(404, 'Link not found');
  Object.assign(link, parseLink(req.body, link));
  await link.save();
  res.json(view(link));
});

export const deleteLink = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'link id');
  const r = await ProfileLink.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!r.deletedCount) throw new ApiError(404, 'Link not found');
  res.json({ ok: true });
});
