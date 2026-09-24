import User from '../models/User.js';
import Club from '../models/Club.js';
import Event from '../models/Event.js';
import Announcement from '../models/Announcement.js';
import Discussion from '../models/Discussion.js';
import { asyncHandler, escapeRegex } from '../utils/http.js';
import { announcementVisibility } from '../utils/visibility.js';
import { isModerator } from '../utils/permissions.js';

/**
 * Search one collection using its MongoDB text index (ranked by relevance).
 * Falls back to a case-insensitive prefix/partial match when the text index
 * finds nothing (e.g. partial words like "hack").
 */
async function searchCollection(Model, q, { filter = {}, select, regexFields, limit, populate }) {
  let query = Model.find({ ...filter, $text: { $search: q } }, { score: { $meta: 'textScore' } })
    .select(select)
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit);
  if (populate) query = query.populate(populate);
  let results = await query.lean();

  if (!results.length) {
    const rx = new RegExp(escapeRegex(q), 'i');
    let fallback = Model.find({ $and: [filter, { $or: regexFields.map((f) => ({ [f]: rx })) }] })
      .select(select)
      .limit(limit);
    if (populate) fallback = fallback.populate(populate);
    results = await fallback.lean();
  }
  return results;
}

export const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 64);
  const type = req.query.type;
  const limit = type ? 20 : 5;
  if (q.length < 2) return res.json({ q, users: [], clubs: [], events: [], announcements: [], discussions: [] });

  const want = (t) => !type || type === t;
  const empty = Promise.resolve([]);

  const [users, clubs, events, announcements, discussions] = await Promise.all([
    want('users')
      ? searchCollection(User, q, {
          filter: { isActive: true },
          select: 'name avatar role department year skills',
          regexFields: ['name', 'department', 'skills'],
          limit,
        })
      : empty,
    want('clubs')
      ? searchCollection(Club, q, {
          filter: { status: 'approved' },
          select: 'name slug logo tagline category members',
          regexFields: ['name', 'tagline', 'tags'],
          limit,
        })
      : empty,
    want('events')
      ? searchCollection(Event, q, {
          select: 'title startDate venue category poster club',
          regexFields: ['title', 'venue', 'tags'],
          populate: { path: 'club', select: 'name slug' },
          limit,
        })
      : empty,
    want('announcements')
      ? searchCollection(Announcement, q, {
          filter: announcementVisibility(req.user),
          select: 'title content priority createdAt',
          regexFields: ['title', 'content'],
          limit,
        })
      : empty,
    want('discussions')
      ? searchCollection(Discussion, q, {
          filter: isModerator(req.user) ? {} : { isHidden: false },
          select: 'title category createdAt replies',
          regexFields: ['title', 'tags'],
          limit,
        })
      : empty,
  ]);

  res.json({
    q,
    users,
    clubs: clubs.map(({ members, ...c }) => ({ ...c, memberCount: members?.length || 0 })),
    events,
    announcements: announcements.map((a) => ({ ...a, content: a.content.slice(0, 160) })),
    discussions: discussions.map(({ replies, ...d }) => ({ ...d, replyCount: replies?.length || 0 })),
  });
});
