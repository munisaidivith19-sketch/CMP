import AlumniEvent from '../../models/AlumniEvent.js';
import AlumniEventRsvp from '../../models/AlumniEventRsvp.js';
import AlumniProfile from '../../models/AlumniProfile.js';
import User from '../../models/User.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { notifyUsers } from '../../utils/notify.js';
import { emitToUsers } from '../../config/socket.js';
import { sameId } from '../../utils/permissions.js';
import { env } from '../../config/env.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar phone designation employeeId rollNo';

function checkAudienceMatch(event, user, profile) {
  const { gradYears = [], departments = [], roles = [] } = event.audience || {};

  if (roles.length > 0 && !roles.includes(user.role)) return false;
  if (departments.length > 0 && user.department && !departments.includes(user.department)) return false;
  if (gradYears.length > 0 && user.role === 'alumni') {
    if (!profile?.gradYear || !gradYears.includes(profile.gradYear)) return false;
  }
  return true;
}

// ── GET /api/alumni/events ─────────────────────────────────────────
export const listEvents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10, 50);
  const { when = 'upcoming', type, mode, search } = req.query;
  const user = req.user;
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);
  const now = new Date();

  const filter = {};

  if (when === 'pending' && isStaff) {
    filter.status = 'pending_approval';
    if (user.role === 'hod') {
      filter.$or = [
        { 'audience.departments': user.department },
        { 'audience.departments': { $size: 0 } },
      ];
    }
  } else if (when === 'mine') {
    filter.createdBy = user._id;
  } else if (when === 'past') {
    filter.status = { $in: ['scheduled', 'completed'] };
    filter.endsAt = { $lt: now };
  } else {
    // Upcoming
    if (isStaff) {
      filter.status = { $in: ['scheduled', 'completed'] };
    } else {
      filter.$or = [
        { status: { $in: ['scheduled', 'completed'] } },
        { createdBy: user._id },
      ];
    }
    filter.endsAt = { $gte: now };
  }

  if (type) filter.type = type;
  if (mode) filter.mode = mode;

  if (search && search.trim()) {
    const q = escapeRegex(search.trim());
    filter.$or = [
      { title: new RegExp(q, 'i') },
      { description: new RegExp(q, 'i') },
      { venue: new RegExp(q, 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    AlumniEvent.find(filter)
      .populate('createdBy', PUBLIC_USER_FIELDS)
      .sort({ startsAt: when === 'past' ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AlumniEvent.countDocuments(filter),
  ]);

  // Attach user RSVP status and spotsLeft
  if (items.length) {
    const eventIds = items.map((e) => e._id);
    const [userRsvps, myProfile] = await Promise.all([
      AlumniEventRsvp.find({ event: { $in: eventIds }, user: user._id }).lean(),
      user.role === 'alumni' ? AlumniProfile.findOne({ user: user._id }).lean() : null,
    ]);

    const rsvpMap = Object.fromEntries(userRsvps.map((r) => [String(r.event), r]));

    for (const item of items) {
      item.myRsvp = rsvpMap[String(item._id)] || null;
      item.spotsLeft = item.capacity > 0 ? Math.max(0, item.capacity - item.goingCount) : null;
      item.audienceMatch = checkAudienceMatch(item, user, myProfile);

      // Hide meetingLink from list unless attendee is going or organizer or staff
      const isOrganizer = sameId(item.createdBy?._id, user._id);
      const isGoing = item.myRsvp?.status === 'going';
      if (!isGoing && !isOrganizer && !isStaff) {
        delete item.meetingLink;
      }
    }
  }

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── POST /api/alumni/events ────────────────────────────────────────
export const createEvent = asyncHandler(async (req, res) => {
  const user = req.user;
  const isStaff = ['admin', 'hod'].includes(user.role);

  if (user.role === 'alumni') {
    const profile = await AlumniProfile.findOne({ user: user._id, isVerified: true });
    if (!profile) throw new ApiError(403, 'Verified alumni profile required to propose events');
  }

  const allowed = [
    'title', 'description', 'type', 'mode', 'venue', 'meetingLink',
    'startsAt', 'endsAt', 'registrationDeadline', 'capacity',
    'audience', 'cover', 'organizerName',
  ];
  const body = pick(req.body, allowed);

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  const now = new Date();

  if (isNaN(startsAt.getTime()) || startsAt <= now) {
    throw new ApiError(422, 'Start date must be in the future');
  }
  if (isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ApiError(422, 'End date must be after start date');
  }

  const status = isStaff || !env.alumni.eventsRequireApproval ? 'scheduled' : 'pending_approval';

  const event = await AlumniEvent.create({
    createdBy: user._id,
    ...body,
    startsAt,
    endsAt,
    capacity: Number(body.capacity) || 0,
    status,
  });

  await event.populate('createdBy', PUBLIC_USER_FIELDS);

  if (status === 'pending_approval') {
    await notifyRoles(['admin', 'hod'], {
      type: 'alumni',
      title: 'New Alumni Event Proposed',
      message: `${user.name} proposed an event "${event.title}" awaiting approval.`,
      link: '/alumni?tab=events&when=pending',
    });
  }

  logActivity(req, 'alumni.event_created', { entityType: 'alumni_event', entityId: event._id });
  res.status(201).json(event);
});

// ── GET /api/alumni/events/:id ─────────────────────────────────────
export const getEventById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await AlumniEvent.findById(id).populate('createdBy', PUBLIC_USER_FIELDS);
  if (!event) throw new ApiError(404, 'Event not found');

  const user = req.user;
  const isOrganizer = sameId(event.createdBy._id, user._id);
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);

  const myRsvp = await AlumniEventRsvp.findOne({ event: event._id, user: user._id });
  const isGoing = myRsvp?.status === 'going';

  const out = event.toObject();
  out.myRsvp = myRsvp;
  out.spotsLeft = event.capacity > 0 ? Math.max(0, event.capacity - event.goingCount) : null;

  // Reveal meeting link only to going attendees, organizer, or staff
  if (!isGoing && !isOrganizer && !isStaff) {
    delete out.meetingLink;
  }

  res.json(out);
});

// ── PATCH /api/alumni/events/:id ───────────────────────────────────
export const updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  const user = req.user;
  const isOrganizer = sameId(event.createdBy, user._id);
  const isAdmin = user.role === 'admin';

  if (!isOrganizer && !isAdmin) throw new ApiError(403, 'Permission denied');

  const allowed = [
    'title', 'description', 'type', 'mode', 'venue', 'meetingLink',
    'startsAt', 'endsAt', 'registrationDeadline', 'capacity',
    'audience', 'cover', 'organizerName',
  ];
  const patch = pick(req.body, allowed);

  const dateOrVenueChanged =
    (patch.startsAt && new Date(patch.startsAt).getTime() !== event.startsAt.getTime()) ||
    (patch.venue && patch.venue !== event.venue);

  Object.assign(event, patch);
  await event.save();

  if (dateOrVenueChanged && event.goingCount > 0) {
    // Notify going attendees about schedule change
    const goingAttendees = await AlumniEventRsvp.find({ event: event._id, status: 'going' }).distinct('user');
    await notifyUsers(goingAttendees, {
      type: 'alumni',
      title: `Event Updated: ${event.title}`,
      message: `The schedule or venue for "${event.title}" has been updated.`,
      link: `/alumni/events/${event._id}`,
    });
  }

  await event.populate('createdBy', PUBLIC_USER_FIELDS);
  res.json(event);
});

// ── POST /api/alumni/events/:id/approve & /reject ──────────────────
export const approveEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  event.status = 'scheduled';
  event.reviewedBy = req.user._id;
  await event.save();

  await notifyUsers([event.createdBy], {
    type: 'alumni',
    title: 'Event Approved! 🎉',
    message: `Your event "${event.title}" has been approved and is now public.`,
    link: `/alumni/events/${event._id}`,
  });

  emitToUsers([event.createdBy], 'alumni:event', event.toJSON());
  res.json({ ok: true, message: 'Event approved' });
});

export const rejectEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  event.status = 'rejected';
  event.reviewedBy = req.user._id;
  event.rejectReason = reason?.trim()?.slice(0, 300);
  await event.save();

  await notifyUsers([event.createdBy], {
    type: 'alumni',
    title: 'Event Proposal Rejected',
    message: `Your event proposal was not approved: ${event.rejectReason || 'No reason specified'}`,
    link: '/alumni?tab=events',
  });

  res.json({ ok: true, message: 'Event rejected' });
});

// ── POST /api/alumni/events/:id/cancel ─────────────────────────────
export const cancelEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  const user = req.user;
  const isOrganizer = sameId(event.createdBy, user._id);
  const isAdmin = user.role === 'admin';

  if (!isOrganizer && !isAdmin) throw new ApiError(403, 'Permission denied');

  event.status = 'cancelled';
  event.cancelReason = reason?.trim()?.slice(0, 300);
  await event.save();

  // Notify all RSVPs
  const rsvps = await AlumniEventRsvp.find({ event: event._id, status: { $in: ['going', 'waitlisted'] } }).distinct('user');
  if (rsvps.length > 0) {
    await notifyUsers(rsvps, {
      type: 'alumni',
      title: `Event Cancelled: ${event.title}`,
      message: `The event "${event.title}" has been cancelled: ${event.cancelReason || 'Cancelled by organizer'}`,
      link: '/alumni?tab=events',
    });
  }

  res.json({ ok: true, message: 'Event cancelled' });
});

// ── POST /api/alumni/events/:id/rsvp ───────────────────────────────
export const rsvpEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  if (event.status !== 'scheduled') {
    throw new ApiError(400, 'RSVPs are only accepted for scheduled events');
  }

  const now = new Date();
  if (event.registrationDeadline && now > event.registrationDeadline) {
    throw new ApiError(400, 'Registration deadline for this event has passed');
  }

  let profile = null;
  if (user.role === 'alumni') {
    profile = await AlumniProfile.findOne({ user: user._id });
  }

  if (!checkAudienceMatch(event, user, profile)) {
    throw new ApiError(403, 'This event is restricted to a specific audience');
  }

  let rsvp = await AlumniEventRsvp.findOne({ event: event._id, user: user._id });

  if (rsvp && rsvp.status !== 'cancelled') {
    return res.json(rsvp);
  }

  const isFull = event.capacity > 0 && event.goingCount >= event.capacity;
  const assignedStatus = isFull ? 'waitlisted' : 'going';

  if (rsvp) {
    rsvp.status = assignedStatus;
    await rsvp.save();
  } else {
    rsvp = await AlumniEventRsvp.create({
      event: event._id,
      user: user._id,
      status: assignedStatus,
    });
  }

  if (assignedStatus === 'going') {
    await AlumniEvent.updateOne({ _id: event._id }, { $inc: { goingCount: 1 } });
  } else {
    await AlumniEvent.updateOne({ _id: event._id }, { $inc: { waitlistCount: 1 } });
  }

  emitToUsers([user._id], 'alumni:event', { eventId: event._id, status: assignedStatus });
  res.status(201).json(rsvp);
});

// ── DELETE /api/alumni/events/:id/rsvp ─────────────────────────────
export const cancelRsvp = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const rsvp = await AlumniEventRsvp.findOne({ event: id, user: user._id });
  if (!rsvp || rsvp.status === 'cancelled') {
    throw new ApiError(404, 'Active RSVP not found');
  }

  const wasGoing = rsvp.status === 'going';
  rsvp.status = 'cancelled';
  await rsvp.save();

  if (wasGoing) {
    await AlumniEvent.updateOne({ _id: id, goingCount: { $gt: 0 } }, { $inc: { goingCount: -1 } });

    // Promote oldest waitlisted attendee atomically
    const waitlisted = await AlumniEventRsvp.findOneAndUpdate(
      { event: id, status: 'waitlisted' },
      { $set: { status: 'going' } },
      { sort: { createdAt: 1 }, new: true }
    ).populate('event', 'title');

    if (waitlisted) {
      await AlumniEvent.updateOne(
        { _id: id },
        { $inc: { goingCount: 1, waitlistCount: -1 } }
      );

      await notifyUsers([waitlisted.user], {
        type: 'alumni',
        title: 'You Got a Spot! 🎉',
        message: `A spot opened up for "${waitlisted.event.title}". You are now confirmed as going!`,
        link: `/alumni/events/${id}`,
      });
    }
  } else {
    await AlumniEvent.updateOne({ _id: id, waitlistCount: { $gt: 0 } }, { $inc: { waitlistCount: -1 } });
  }

  res.json({ ok: true, message: 'RSVP cancelled' });
});

// ── GET /api/alumni/events/:id/attendees ───────────────────────────
export const listAttendees = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { format } = req.query;

  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  const user = req.user;
  const isOrganizer = sameId(event.createdBy, user._id);
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);

  if (!isOrganizer && !isStaff) throw new ApiError(403, 'Permission denied');

  const rsvps = await AlumniEventRsvp.find({ event: id, status: 'going' })
    .populate('user', PUBLIC_USER_FIELDS)
    .sort({ createdAt: 1 })
    .lean();

  if (format === 'csv') {
    const headers = ['#', 'Name', 'Email', 'Role', 'Department', 'Phone', 'Checked In'];
    const rows = rsvps.map((r, i) => [
      i + 1,
      `"${r.user?.name || ''}"`,
      `"${r.user?.email || ''}"`,
      r.user?.role || '',
      `"${r.user?.department || ''}"`,
      `"${r.user?.phone || ''}"`,
      r.checkedInAt ? 'Yes' : 'No',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendees-${id}.csv"`);
    return res.send(csv);
  }

  res.json(rsvps);
});

// ── POST /api/alumni/events/:id/checkin ─────────────────────────────
export const checkInAttendee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const event = await AlumniEvent.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');

  const user = req.user;
  const isOrganizer = sameId(event.createdBy, user._id);
  const isStaff = ['admin', 'hod'].includes(user.role);

  if (!isOrganizer && !isStaff) throw new ApiError(403, 'Permission denied');

  // Verify event window +- 2 hours
  const now = new Date();
  const windowStart = new Date(event.startsAt.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(event.endsAt.getTime() + 2 * 60 * 60 * 1000);

  if (now < windowStart || now > windowEnd) {
    throw new ApiError(400, 'Check-in is only available within 2 hours of the event start/end time');
  }

  const rsvp = await AlumniEventRsvp.findOne({ event: id, user: userId, status: 'going' });
  if (!rsvp) throw new ApiError(404, 'Attendee not registered or not in going list');

  rsvp.checkedInAt = new Date();
  rsvp.checkedInBy = user._id;
  await rsvp.save();

  res.json({ ok: true, message: 'Attendee checked in successfully' });
});
