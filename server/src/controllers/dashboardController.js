import Event from '../models/Event.js';
import Club from '../models/Club.js';
import Announcement from '../models/Announcement.js';
import Discussion from '../models/Discussion.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/http.js';
import { announcementVisibility } from '../utils/visibility.js';
import { participationByCategory, registrationTrend } from './adminController.js';

/** Everything the home dashboard needs in a single round-trip. */
export const getDashboard = asyncHandler(async (req, res) => {
  const user = req.user;
  const uid = user._id;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const since30 = new Date(Date.now() - 30 * 86400000);

  const [
    myUpcoming,
    attendedCount,
    myDiscussions,
    unread,
    upcomingEvents,
    recommended,
    announcements,
    myClubs,
    trending,
    calendar,
    trend,
    byCategory,
    campus,
  ] = await Promise.all([
    Event.find({ 'registrations.user': uid, endDate: { $gte: now } })
      .select('title startDate endDate venue category poster registrations.$')
      .sort({ startDate: 1 })
      .limit(5)
      .lean(),
    Event.countDocuments({ registrations: { $elemMatch: { user: uid, status: 'attended' } } }),
    Discussion.countDocuments({ author: uid }),
    Notification.countDocuments({ user: uid, read: false }),
    Event.find({ endDate: { $gte: now } })
      .select('title startDate venue category poster capacity registeredCount club isFeatured')
      .populate('club', 'name slug')
      .sort({ isFeatured: -1, startDate: 1 })
      .limit(6)
      .lean(),
    Event.find({
      endDate: { $gte: now },
      'registrations.user': { $ne: uid },
      $or: [{ tags: { $in: user.interests || [] } }, { category: { $in: user.interests || [] } }, { club: { $in: user.clubs || [] } }],
    })
      .select('title startDate venue category poster capacity registeredCount')
      .sort({ startDate: 1 })
      .limit(4)
      .lean(),
    Announcement.find(announcementVisibility(user))
      .populate('author', 'name avatar role')
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(5)
      .lean(),
    Club.find({ members: uid, status: 'approved' }).select('name slug logo category members').limit(6).lean(),
    Discussion.aggregate([
      { $match: { isHidden: false, lastActivityAt: { $gte: since30 } } },
      { $addFields: { score: { $add: [{ $size: '$upvotes' }, { $multiply: [{ $size: '$replies' }, 2] }] } } },
      { $sort: { score: -1, lastActivityAt: -1 } },
      { $limit: 5 },
      { $project: { title: 1, category: 1, score: 1, replyCount: { $size: '$replies' }, upvoteCount: { $size: '$upvotes' } } },
    ]),
    Event.find({ startDate: { $gte: monthStart, $lte: nextMonthEnd } }).select('title startDate category').lean(),
    registrationTrend(6),
    participationByCategory(),
    Promise.all([
      User.countDocuments({ isActive: true, role: 'student' }),
      Club.countDocuments({ status: 'approved' }),
      Event.countDocuments({ endDate: { $gte: now } }),
    ]),
  ]);

  res.json({
    stats: {
      myClubs: myClubs.length,
      upcomingRegistrations: myUpcoming.length,
      attendedEvents: attendedCount,
      myDiscussions,
      unreadNotifications: unread,
    },
    campus: { students: campus[0], clubs: campus[1], upcomingEvents: campus[2] },
    myUpcoming: myUpcoming.map(({ registrations, ...e }) => ({ ...e, myStatus: registrations?.[0]?.status })),
    upcomingEvents,
    recommended,
    announcements,
    myClubs: myClubs.map(({ members, ...c }) => ({ ...c, memberCount: members.length })),
    trending,
    calendar,
    registrationTrend: trend,
    participationByCategory: byCategory,
  });
});
