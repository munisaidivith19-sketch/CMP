import LostFoundItem from '../models/LostFoundItem.js';
import { ApiError, asyncHandler, paginate, pageMeta, pick, escapeRegex } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { notifyUsers, notifyRoles } from '../utils/notify.js';
import { sameId, isModerator } from '../utils/permissions.js';
import { broadcast } from '../config/socket.js';

const EDITABLE = ['itemName', 'category', 'description', 'photo', 'location', 'dateTime', 'additionalDetails', 'contactMethod'];
const OPEN_STATUSES = ['lost', 'found', 'possible_match', 'under_verification'];
const STOP_WORDS = new Set(['a', 'an', 'the', 'my', 'of', 'and', 'with', 'in', 'on', 'near', 'at', 'to', 'for', 'black', 'white', 'blue', 'red']);

const isOwner = (item, user) => sameId(item.reporter?._id || item.reporter, user);

/** Contact preferences and reporter contact details: owner + staff only. */
function sanitise(item, user) {
  if (!item) return item;
  const out = { ...item };
  if (!isOwner(out, user) && !isModerator(user)) {
    delete out.contactMethod;
    if (out.reporter && typeof out.reporter === 'object') {
      out.reporter = { ...out.reporter };
      delete out.reporter.email;
      delete out.reporter.phone;
    }
  }
  if (out.matchedWith && typeof out.matchedWith === 'object' && out.matchedWith._id) {
    out.matchedWith = sanitise(out.matchedWith, user);
  }
  out.canManage = isModerator(user);
  out.isMine = isOwner(out, user);
  return out;
}

function publish(item) {
  // Public feed event: ids + status only, never contact details.
  broadcast('lostfound:updated', { itemId: String(item._id), status: item.status, type: item.type });
}

// ── Report an item ─────────────────────────────────────────────────

export const reportItem = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['type', ...EDITABLE]);
  if (new Date(data.dateTime) > new Date(Date.now() + 5 * 60000)) throw new ApiError(422, 'Date/time cannot be in the future');
  data.reporter = req.user._id;

  const item = await LostFoundItem.create(data);
  logActivity(req, `lost_found.report_${data.type}`, { entityType: 'lost_found', entityId: item._id, summary: data.itemName });

  notifyRoles(['admin'], {
    type: 'lost_found',
    title: `New ${data.type} item reported`,
    message: `${data.itemName} · ${data.location}`,
    link: `/lost-found/${item._id}`,
  }, { exclude: req.user._id });
  publish(item);

  res.status(201).json(sanitise(item.toObject(), req.user));
});

// ── List items ─────────────────────────────────────────────────────

export const listItems = asyncHandler(async (req, res) => {
  const filter = {};
  if (['lost', 'found'].includes(req.query.type)) filter.type = req.query.type;
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.status === 'open') filter.status = { $in: OPEN_STATUSES };
  else if (req.query.status === 'resolved') filter.status = { $in: ['returned', 'closed'] };
  else if (req.query.status) filter.status = String(req.query.status);
  if (req.query.mine === 'true') filter.reporter = req.user._id;
  if (req.query.location) filter.location = { $regex: escapeRegex(req.query.location), $options: 'i' };
  if (req.query.from || req.query.to) {
    filter.dateTime = {};
    if (req.query.from) filter.dateTime.$gte = new Date(req.query.from);
    if (req.query.to) filter.dateTime.$lte = new Date(req.query.to);
  }
  if (req.query.search) {
    const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
    filter.$or = [{ itemName: rx }, { description: rx }, { location: rx }];
  }

  const { page, limit, skip } = paginate(req, 12);
  const [items, total, counts] = await Promise.all([
    LostFoundItem.find(filter)
      .populate('reporter', 'name avatar department')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LostFoundItem.countDocuments(filter),
    LostFoundItem.aggregate([{ $group: { _id: { type: '$type', open: { $in: ['$status', OPEN_STATUSES] } }, n: { $sum: 1 } } }]),
  ]);

  const summary = { lostOpen: 0, foundOpen: 0, resolved: 0 };
  counts.forEach(({ _id, n }) => {
    if (!_id.open) summary.resolved += n;
    else if (_id.type === 'lost') summary.lostOpen += n;
    else summary.foundOpen += n;
  });

  res.json({ items: items.map((i) => sanitise(i, req.user)), summary, pagination: pageMeta(total, page, limit) });
});

// ── Get single item ────────────────────────────────────────────────

export const getItem = asyncHandler(async (req, res) => {
  const item = await LostFoundItem.findById(req.params.id)
    .populate('reporter', 'name email avatar department phone')
    .populate('resolvedBy', 'name')
    .populate({ path: 'matchedWith', populate: { path: 'reporter', select: 'name email avatar department phone' } })
    .lean();
  if (!item) throw new ApiError(404, 'Item not found');
  res.json(sanitise(item, req.user));
});

// ── Update own report ──────────────────────────────────────────────

export const updateItem = asyncHandler(async (req, res) => {
  const item = await LostFoundItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found');
  if (!isOwner(item, req.user) && !isModerator(req.user)) throw new ApiError(403, 'You can only edit your own reports');
  if (['returned', 'closed'].includes(item.status) && !isModerator(req.user)) throw new ApiError(422, 'Cannot edit a resolved item');

  Object.assign(item, pick(req.body, EDITABLE));
  await item.save();
  logActivity(req, 'lost_found.update', { entityType: 'lost_found', entityId: item._id });
  publish(item);
  res.json(sanitise(item.toObject(), req.user));
});

/** Owners may withdraw an unresolved report; moderators may remove any. */
export const deleteItem = asyncHandler(async (req, res) => {
  const item = await LostFoundItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found');
  if (!isModerator(req.user)) {
    if (!isOwner(item, req.user)) throw new ApiError(403, 'You can only remove your own reports');
    if (!['lost', 'found'].includes(item.status)) throw new ApiError(422, 'This report is being handled by staff and can no longer be removed');
  }
  await LostFoundItem.updateMany({ matchedWith: item._id }, { $unset: { matchedWith: 1 } });
  await item.deleteOne();
  logActivity(req, 'lost_found.delete', { entityType: 'lost_found', entityId: item._id, summary: item.itemName });
  publish({ _id: item._id, status: 'deleted', type: item.type });
  res.json({ message: 'Report removed' });
});

// ── Status changes ─────────────────────────────────────────────────

/**
 * Staff: any status, optionally linking a *possible* match (never an automatic
 * ownership claim — handover happens only after staff verification).
 * Owner: may only close their own report.
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const item = await LostFoundItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found');
  const { status, matchedWith, resolutionNote } = req.body;
  const staff = isModerator(req.user);

  if (!staff) {
    if (!isOwner(item, req.user)) throw new ApiError(403, 'Only staff or the reporter can change this report');
    if (status !== 'closed') throw new ApiError(403, 'You can close your own report; other status changes are made by staff');
  }

  let match = null;
  if (matchedWith) {
    if (!staff) throw new ApiError(403, 'Only staff can link a possible match');
    match = await LostFoundItem.findById(matchedWith);
    if (!match || sameId(match._id, item._id)) throw new ApiError(404, 'Matching item not found');
    if (match.type === item.type) throw new ApiError(422, 'A lost item can only be matched with a found item');
  }

  item.status = status;
  if (match) item.matchedWith = match._id;
  if (resolutionNote) item.resolutionNote = resolutionNote;
  if (['returned', 'closed'].includes(status)) {
    item.resolvedBy = req.user._id;
    item.resolvedAt = new Date();
  }
  await item.save();

  // Keep the link symmetric and move the counterpart along with it.
  const counterpart = match || (item.matchedWith ? await LostFoundItem.findById(item.matchedWith) : null);
  if (staff && counterpart && ['possible_match', 'under_verification', 'returned'].includes(status) && !['returned', 'closed'].includes(counterpart.status)) {
    counterpart.matchedWith = item._id;
    counterpart.status = status;
    if (status === 'returned') {
      counterpart.resolvedBy = req.user._id;
      counterpart.resolvedAt = new Date();
    }
    await counterpart.save();
    publish(counterpart);
  }

  logActivity(req, `lost_found.status_${status}`, { entityType: 'lost_found', entityId: item._id });

  const label = status.replace(/_/g, ' ');
  const messages = {
    possible_match: 'Staff found a possible match. It is not confirmed yet — you may be contacted to verify ownership.',
    under_verification: 'Ownership is being verified by staff.',
    returned: 'The item has been handed over.',
    closed: 'This report was closed.',
  };
  const recipients = [item.reporter, ...(counterpart && staff ? [counterpart.reporter] : [])];
  notifyUsers(recipients, {
    type: 'lost_found',
    title: `${item.itemName}: ${label}`,
    message: messages[status] || `Status updated to "${label}"`,
    link: `/lost-found/${item._id}`,
  }, { exclude: req.user._id });
  publish(item);

  res.json(sanitise(item.toObject(), req.user));
});

// ── Possible matches ───────────────────────────────────────────────

const keywords = (text = '') =>
  String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 8);

/**
 * Suggest opposite-type items with the same category or shared keywords within
 * ±14 days, ranked by a simple similarity score. These are only suggestions.
 */
export const findMatches = asyncHandler(async (req, res) => {
  const item = await LostFoundItem.findById(req.params.id).lean();
  if (!item) throw new ApiError(404, 'Item not found');
  if (!isOwner(item, req.user) && !isModerator(req.user)) throw new ApiError(403, 'Only the reporter or staff can view possible matches');

  const words = keywords(`${item.itemName} ${item.description || ''}`);
  const placeWords = keywords(item.location);
  const window = 14 * 86400000;
  const or = [{ category: item.category }];
  if (words.length) or.push({ itemName: { $regex: words.map(escapeRegex).join('|'), $options: 'i' } });

  const candidates = await LostFoundItem.find({
    type: item.type === 'lost' ? 'found' : 'lost',
    _id: { $ne: item._id },
    status: { $in: OPEN_STATUSES },
    dateTime: { $gte: new Date(new Date(item.dateTime).getTime() - window), $lte: new Date(new Date(item.dateTime).getTime() + window) },
    $or: or,
  })
    .populate('reporter', 'name avatar department')
    .limit(50)
    .lean();

  const scored = candidates
    .map((c) => {
      const text = `${c.itemName} ${c.description || ''}`.toLowerCase();
      const place = String(c.location).toLowerCase();
      const reasons = [];
      let score = 0;
      if (c.category === item.category) {
        score += 3;
        reasons.push('same category');
      }
      const shared = words.filter((w) => text.includes(w));
      if (shared.length) {
        score += shared.length * 2;
        reasons.push(`similar description (${shared.slice(0, 3).join(', ')})`);
      }
      if (placeWords.some((w) => place.includes(w))) {
        score += 2;
        reasons.push('nearby location');
      }
      const days = Math.abs(new Date(c.dateTime) - new Date(item.dateTime)) / 86400000;
      if (days <= 2) {
        score += 1;
        reasons.push('close in time');
      }
      return { ...sanitise(c, req.user), matchScore: score, matchReasons: reasons };
    })
    .filter((c) => c.matchScore >= 3)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);

  res.json(scored);
});
