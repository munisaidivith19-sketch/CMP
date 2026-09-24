import Event from '../models/Event.js';
import Club from '../models/Club.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { canManageClub, canManageEvent, sameId } from '../utils/permissions.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';

const EDITABLE = [
  'title',
  'description',
  'category',
  'startDate',
  'endDate',
  'registrationDeadline',
  'venue',
  'poster',
  'tags',
  'capacity',
];

/** Strip the registrations array and expose counts + the viewer's own status. */
function shapeEvent(ev, user, { includeRegistrations = false } = {}) {
  const regs = ev.registrations || [];
  const mine = regs.find((r) => sameId(r.user, user));
  const { registrations, ...rest } = ev;
  return {
    ...rest,
    waitlistCount: regs.filter((r) => r.status === 'waitlisted').length,
    attendedCount: regs.filter((r) => r.status === 'attended').length,
    myStatus: mine?.status || null,
    spotsLeft: ev.capacity ? Math.max(0, ev.capacity - ev.registeredCount) : null,
    isPast: new Date(ev.endDate) < new Date(),
    ...(includeRegistrations ? { registrations } : {}),
  };
}

async function loadEvent(id) {
  const event = await Event.findById(id);
  if (!event) throw new ApiError(404, 'Event not found');
  const club = event.club ? await Club.findById(event.club).select('admins facultyAdvisor members name slug') : null;
  return { event, club };
}

export const listEvents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 12);
  const { q, category, club, from, to, when = 'upcoming', forYou, featured, mine } = req.query;
  const now = new Date();
  const filter = {};

  if (when === 'upcoming') filter.endDate = { $gte: now };
  if (when === 'past') filter.endDate = { $lt: now };
  if (from || to) {
    filter.startDate = {};
    if (from) filter.startDate.$gte = new Date(from);
    if (to) filter.startDate.$lte = new Date(to);
  }
  if (category) filter.category = { $in: String(category).split(',') };
  if (club) filter.club = club;
  if (featured === 'true') filter.isFeatured = true;
  if (mine === 'true') filter['registrations.user'] = req.user._id;
  if (forYou === 'true') {
    const interests = req.user.interests || [];
    filter.$or = [{ tags: { $in: interests } }, { category: { $in: interests } }, { club: { $in: req.user.clubs } }];
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$and = [{ $or: [{ title: rx }, { venue: rx }, { tags: rx }, { description: rx }] }];
  }

  const sort = when === 'past' ? { startDate: -1 } : { isFeatured: -1, startDate: 1 };
  const [events, total] = await Promise.all([
    Event.find(filter)
      .populate('club', 'name slug logo')
      .populate('organizer', 'name avatar')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ]);

  res.json({ items: events.map((e) => shapeEvent(e, req.user)), ...pageMeta(total, page, limit) });
});

export const getEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id)
    .populate('club', 'name slug logo admins facultyAdvisor')
    .populate('organizer', 'name avatar role department')
    .lean();
  if (!event) throw new ApiError(404, 'Event not found');

  const canManage = canManageEvent(req.user, event, event.club);
  const shaped = shapeEvent(event, req.user);
  if (shaped.club) {
    delete shaped.club.admins;
    delete shaped.club.facultyAdvisor;
  }
  res.json({ ...shaped, canManage });
});

export const createEvent = asyncHandler(async (req, res) => {
  const data = pick(req.body, EDITABLE);
  let club = null;

  if (req.body.club) {
    club = await Club.findOne({ _id: req.body.club, status: 'approved' });
    if (!club) throw new ApiError(400, 'Club not found');
    if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only admins of this club can create its events');
  } else if (!['faculty', 'hod', 'principal', 'admin'].includes(req.user.role)) {
    throw new ApiError(403, 'Select one of your clubs to host this event');
  }

  const event = await Event.create({
    ...data,
    club: club?._id,
    organizer: req.user._id,
    isFeatured: req.user.role === 'admin' ? Boolean(req.body.isFeatured) : false,
  });

  // Notify club members, or — for college-wide events — students whose interests match.
  let audience = [];
  if (club) audience = [...club.members, ...club.admins];
  else {
    const keys = [event.category, ...(event.tags || [])];
    audience = await User.find({ isActive: true, interests: { $in: keys } }).distinct('_id');
  }
  notifyUsers(
    audience,
    {
      type: 'event',
      title: `New event: ${event.title}`,
      message: `${new Date(event.startDate).toDateString()} · ${event.venue}`,
      link: `/events/${event._id}`,
    },
    { exclude: req.user._id }
  );

  logActivity(req, 'event.create', { entityType: 'event', entityId: event._id, summary: event.title });
  res.status(201).json(shapeEvent(event.toObject(), req.user));
});

export const updateEvent = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canManageEvent(req.user, event, club)) throw new ApiError(403, 'You cannot edit this event');

  const before = { start: String(event.startDate), venue: event.venue };
  const updates = pick(req.body, EDITABLE);
  if (updates.capacity !== undefined && updates.capacity > 0 && updates.capacity < event.registeredCount) {
    throw new ApiError(400, `Capacity cannot be lower than current registrations (${event.registeredCount})`);
  }
  Object.assign(event, updates);
  if (req.user.role === 'admin' && req.body.isFeatured !== undefined) event.isFeatured = Boolean(req.body.isFeatured);
  await event.save();

  await promoteWaitlist(event._id);

  if (before.start !== String(event.startDate) || before.venue !== event.venue) {
    notifyUsers(
      event.registrations.map((r) => r.user),
      {
        type: 'event',
        title: `Update: ${event.title}`,
        message: `Now on ${new Date(event.startDate).toDateString()} at ${event.venue}`,
        link: `/events/${event._id}`,
      },
      { exclude: req.user._id }
    );
  }
  logActivity(req, 'event.update', { entityType: 'event', entityId: event._id, summary: event.title });
  const fresh = await Event.findById(event._id).populate('club', 'name slug logo').lean();
  res.json(shapeEvent(fresh, req.user));
});

export const deleteEvent = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canManageEvent(req.user, event, club)) throw new ApiError(403, 'You cannot delete this event');
  await event.deleteOne();
  notifyUsers(
    event.registrations.map((r) => r.user),
    { type: 'event', title: `Cancelled: ${event.title}`, message: 'This event has been cancelled by the organiser.' },
    { exclude: req.user._id }
  );
  logActivity(req, 'event.delete', { entityType: 'event', entityId: event._id, summary: event.title });
  res.json({ message: 'Event deleted' });
});

/**
 * Register for an event. The capacity check and the insert happen in one
 * atomic update, so two students can never grab the last seat at once.
 * When the event is full the student joins the waitlist instead.
 */
export const registerForEvent = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const event = await Event.findById(req.params.id).select('title endDate registrationDeadline registrations.user');
  if (!event) throw new ApiError(404, 'Event not found');

  const now = new Date();
  if (event.endDate < now) throw new ApiError(400, 'This event has already ended');
  if (event.registrationDeadline && event.registrationDeadline < now) throw new ApiError(400, 'Registration has closed');
  if (event.registrations.some((r) => sameId(r.user, uid))) throw new ApiError(409, 'You are already registered');

  let status = 'registered';
  const seated = await Event.findOneAndUpdate(
    {
      _id: event._id,
      'registrations.user': { $ne: uid },
      $or: [{ capacity: 0 }, { $expr: { $lt: ['$registeredCount', '$capacity'] } }],
    },
    { $push: { registrations: { user: uid, status: 'registered' } }, $inc: { registeredCount: 1 } },
    { new: true }
  );

  if (!seated) {
    const waitlisted = await Event.findOneAndUpdate(
      { _id: event._id, 'registrations.user': { $ne: uid } },
      { $push: { registrations: { user: uid, status: 'waitlisted' } } },
      { new: true }
    );
    if (!waitlisted) throw new ApiError(409, 'You are already registered');
    status = 'waitlisted';
  }

  notifyUsers([uid], {
    type: 'event',
    title: status === 'registered' ? `You're in! ${event.title}` : `Waitlisted for ${event.title}`,
    message:
      status === 'registered'
        ? 'Your seat is confirmed.'
        : 'The event is full — we will notify you automatically if a seat opens up.',
    link: `/events/${event._id}`,
  });
  logActivity(req, `event.${status === 'registered' ? 'register' : 'waitlist'}`, {
    entityType: 'event',
    entityId: event._id,
    summary: event.title,
  });
  res.json({ status });
});

export const cancelRegistration = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const event = await Event.findById(req.params.id).select('title registrations');
  if (!event) throw new ApiError(404, 'Event not found');
  const reg = event.registrations.find((r) => sameId(r.user, uid));
  if (!reg) throw new ApiError(400, 'You are not registered for this event');

  const seatReleased = reg.status !== 'waitlisted';
  await Event.updateOne(
    { _id: event._id },
    { $pull: { registrations: { user: uid } }, ...(seatReleased ? { $inc: { registeredCount: -1 } } : {}) }
  );
  if (seatReleased) await promoteWaitlist(event._id);

  logActivity(req, 'event.unregister', { entityType: 'event', entityId: event._id, summary: event.title });
  res.json({ status: null });
});

/** Move waitlisted students into free seats, first come first served. */
async function promoteWaitlist(eventId) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ev = await Event.findById(eventId).select('title capacity registeredCount registrations').lean();
    if (!ev) return;
    const next = ev.registrations
      .filter((r) => r.status === 'waitlisted')
      .sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt))[0];
    if (!next) return;
    if (ev.capacity && ev.registeredCount >= ev.capacity) return;

    const promoted = await Event.findOneAndUpdate(
      {
        _id: eventId,
        registrations: { $elemMatch: { user: next.user, status: 'waitlisted' } },
        $or: [{ capacity: 0 }, { $expr: { $lt: ['$registeredCount', '$capacity'] } }],
      },
      { $set: { 'registrations.$.status': 'registered' }, $inc: { registeredCount: 1 } }
    );
    if (!promoted) return;
    notifyUsers([next.user], {
      type: 'event',
      title: `A seat opened up — you're in for ${ev.title}! 🎉`,
      link: `/events/${eventId}`,
    });
  }
}

export const getParticipants = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canManageEvent(req.user, event, club)) throw new ApiError(403, 'Only organisers can view participants');
  await event.populate('registrations.user', 'name email avatar department year rollNo');
  res.json(event.registrations);
});

export const markAttendance = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canManageEvent(req.user, event, club)) throw new ApiError(403, 'Only organisers can mark attendance');
  const reg = event.registrations.find((r) => sameId(r.user, req.params.userId));
  if (!reg || reg.status === 'waitlisted') throw new ApiError(400, 'User is not a confirmed participant');
  reg.status = req.body.attended ? 'attended' : 'registered';
  await event.save();
  logActivity(req, 'event.attendance', { entityType: 'event', entityId: event._id, summary: event.title });
  res.json({ status: reg.status });
});
