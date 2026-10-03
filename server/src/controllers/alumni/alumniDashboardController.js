import AlumniProfile from '../../models/AlumniProfile.js';
import MentorshipRequest from '../../models/MentorshipRequest.js';
import MentorshipSession from '../../models/MentorshipSession.js';
import AlumniJob from '../../models/AlumniJob.js';
import JobApplication from '../../models/JobApplication.js';
import AlumniEvent from '../../models/AlumniEvent.js';
import AlumniEventRsvp from '../../models/AlumniEventRsvp.js';
import ChapterMember from '../../models/ChapterMember.js';
import ChapterPost from '../../models/ChapterPost.js';
import { asyncHandler } from '../../utils/http.js';

const USER_FIELDS = 'name avatar department year designation';
const DAY = 24 * 60 * 60 * 1000;

function completeness(p, user) {
  if (!p) return user?.avatar ? 10 : 0;
  let s = 0;
  if (p.gradYear) s += 15;
  if (p.company) s += 15;
  if (p.designation) s += 10;
  if (p.location) s += 10;
  if (p.headline) s += 10;
  if (p.about) s += 10;
  if (p.linkedin) s += 10;
  if (p.skills?.length) s += 10;
  if (user?.avatar) s += 10;
  return Math.min(100, s);
}

// ── GET /api/alumni/dashboard (alumni only) ────────────────────────
// Alumni-scoped on purpose: no attendance, timetable, gate pass, complaints or
// study-material data is ever included.
export const getAlumniDashboard = asyncHandler(async (req, res) => {
  const me = req.user;
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * DAY);
  const ago7d = new Date(now.getTime() - 7 * DAY);

  const profile = await AlumniProfile.findOne({ user: me._id }).lean();

  const myMemberships = await ChapterMember.find({ user: me._id, status: 'active' }).distinct('chapter');
  const myJobIds = await AlumniJob.find({ postedBy: me._id, status: { $ne: 'removed' } }).distinct('_id');

  const [
    pendingRequests,
    pendingCount,
    activeMentees,
    upcomingSessions,
    upcomingSessionCount,
    myJobs,
    totalApplicants,
    referralRequests,
    hostingEvents,
    myRsvps,
    newOpportunities,
    chapterPosts,
    chapterPosts7d,
  ] = await Promise.all([
    MentorshipRequest.find({ alumni: me._id, status: 'pending' })
      .populate('student', USER_FIELDS)
      .sort({ expiresAt: 1, createdAt: -1 })
      .limit(5)
      .lean(),
    MentorshipRequest.countDocuments({ alumni: me._id, status: 'pending' }),
    MentorshipRequest.countDocuments({ alumni: me._id, status: 'accepted' }),
    MentorshipSession.find({ alumni: me._id, status: 'confirmed', scheduledAt: { $gte: now, $lte: in7d } })
      .populate('student', USER_FIELDS)
      .sort({ scheduledAt: 1 })
      .limit(5)
      .lean(),
    MentorshipSession.countDocuments({ alumni: me._id, status: 'confirmed', scheduledAt: { $gte: now, $lte: in7d } }),
    AlumniJob.find({ postedBy: me._id, status: { $in: ['open', 'pending_review', 'closed'] } })
      .sort({ createdAt: -1 })
      .limit(4)
      .select('title company status deadline applicationCount')
      .lean(),
    JobApplication.countDocuments({ poster: me._id, status: { $ne: 'withdrawn' } }),
    JobApplication.countDocuments({ poster: me._id, referralRequested: true, status: 'applied' }),
    AlumniEvent.find({ createdBy: me._id, status: { $in: ['scheduled', 'pending_approval'] }, endsAt: { $gte: now } })
      .sort({ startsAt: 1 })
      .limit(4)
      .select('title type mode startsAt status goingCount waitlistCount capacity')
      .lean(),
    AlumniEventRsvp.find({ user: me._id, status: { $in: ['going', 'waitlisted'] } }).distinct('event'),
    AlumniJob.find({ status: 'open', postedBy: { $ne: me._id }, createdAt: { $gte: ago7d } })
      .sort({ createdAt: -1 })
      .limit(4)
      .select('title company location type createdAt')
      .lean(),
    myMemberships.length
      ? ChapterPost.find({ chapter: { $in: myMemberships }, deletedAt: null })
          .populate('author', 'name avatar')
          .populate('chapter', 'name slug')
          .sort({ createdAt: -1 })
          .limit(3)
          .select('body createdAt author chapter likeCount commentCount')
          .lean()
      : [],
    myMemberships.length
      ? ChapterPost.countDocuments({ chapter: { $in: myMemberships }, deletedAt: null, createdAt: { $gte: ago7d } })
      : 0,
  ]);

  const rsvpEvents = myRsvps.length
    ? await AlumniEvent.find({ _id: { $in: myRsvps }, status: 'scheduled', startsAt: { $gte: now } })
        .sort({ startsAt: 1 })
        .limit(4)
        .select('title type mode startsAt')
        .lean()
    : [];

  const pct = completeness(profile, me);
  const attention = [];
  if (!profile) {
    attention.push({ level: 'warning', code: 'no_profile', message: 'Complete your alumni profile to appear in the directory.', link: '/alumni?tab=my_profile' });
  } else if (profile.rejectionReason && !profile.isVerified) {
    attention.push({ level: 'danger', code: 'rejected', message: `Verification was rejected: ${profile.rejectionReason}. Update your profile and resubmit.`, link: '/alumni?tab=my_profile' });
  } else if (!profile.isVerified) {
    attention.push({ level: 'warning', code: 'unverified', message: 'Your profile is awaiting verification. Mentoring and job posting unlock once verified.', link: '/alumni?tab=my_profile' });
  }
  if (profile && pct < 70) {
    attention.push({ level: 'info', code: 'incomplete', message: `Your profile is ${pct}% complete. Add the missing details to get more mentee requests.`, link: '/alumni?tab=my_profile' });
  }
  const expiring = pendingRequests.filter((r) => r.expiresAt && new Date(r.expiresAt).getTime() - now.getTime() < DAY).length;
  if (expiring > 0) {
    attention.push({ level: 'danger', code: 'expiring', message: `${expiring} mentorship request${expiring > 1 ? 's' : ''} will expire within 24 hours.`, link: '/alumni?tab=mentorship' });
  }

  res.json({
    generatedAt: now.toISOString(),
    profile: {
      isVerified: Boolean(profile?.isVerified),
      completeness: pct,
      mentorshipAvailable: Boolean(profile?.mentorshipAvailable),
      maxActiveMentees: profile?.maxActiveMentees ?? 3,
      activeMenteeCount: activeMentees,
      ratingAvg: profile?.ratingAvg || 0,
      ratingCount: profile?.ratingCount || 0,
    },
    attention,
    stats: {
      upcomingSessions: upcomingSessionCount,
      pendingRequests: pendingCount,
      referralRequests,
      eventsHosting: hostingEvents.length,
      eventsRsvped: rsvpEvents.length,
      activeMentees,
      menteeCapacity: profile?.maxActiveMentees ?? 3,
      chapterPosts7d,
      chapters: myMemberships.length,
      ratingAvg: profile?.ratingAvg || 0,
      ratingCount: profile?.ratingCount || 0,
      jobsPosted: myJobIds.length,
      applicants: totalApplicants,
      completeness: pct,
    },
    pendingRequests,
    upcomingSessions,
    myJobs,
    hostingEvents,
    rsvpEvents,
    newOpportunities,
    chapterPosts,
  });
});
