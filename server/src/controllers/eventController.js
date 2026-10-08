import Event from '../models/Event.js';
import Club from '../models/Club.js';
import User from '../models/User.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { canManageClub, canManageEvent, sameId } from '../utils/permissions.js';
import { notifyUsers } from '../utils/notify.js';
import { logActivity } from '../utils/activity.js';
import { dayKey, toDay, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { generateEventParticipantsPdfBuffer } from '../services/eventParticipantsPdf.js';

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
  'facultyCoordinators',
];

const PARTICIPANT_VIEW_ROLES = ['faculty', 'hod', 'principal', 'ao', 'dean', 'chairman', 'admin'];

export function canEditEvent(user, event, club) {
  if (!user || !event) return false;
  if (['admin', 'principal'].includes(user.role)) return true;
  if (user.role === 'hod' && sameId(event.organizer, user._id)) return true;
  return false;
}

export function canMarkEventAttendance(user, event) {
  if (!user || !event) return false;
  if (user.role === 'hod' && sameId(event.organizer, user._id)) return true;
  if (event.facultyCoordinators?.some((fc) => sameId(fc, user._id))) return true;
  return false;
}

export function canViewParticipants(user, event, club) {
  if (!user || !event) return false;
  if (PARTICIPANT_VIEW_ROLES.includes(user.role)) return true;
  if (sameId(event.organizer, user._id)) return true;
  if (event.facultyCoordinators?.some((fc) => sameId(fc, user._id))) return true;
  return club ? canManageClub(user, club) : false;
}

export const getFacultyCoordinatorsList = asyncHandler(async (req, res) => {
  const faculties = await User.find({ role: 'faculty', isActive: true })
    .select('name email avatar department designation employeeId')
    .sort({ department: 1, name: 1 })
    .lean();
  res.json(faculties);
});

/**
 * Coordinators gain attendance marking + participant access, so every ID must
 * be an active faculty account — never a student or another role.
 */
async function resolveFacultyCoordinators(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = [...new Set(raw.filter(Boolean).map(String))];
  if (ids.length === 0) return [];
  if (ids.length > 50) throw new ApiError(400, 'Too many faculty coordinators');
  const found = await User.countDocuments({ _id: { $in: ids }, role: 'faculty', isActive: true });
  if (found !== ids.length) throw new ApiError(400, 'Faculty coordinators must be active faculty members');
  return ids;
}

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
    .populate('facultyCoordinators', 'name email avatar department designation')
    .lean();
  if (!event) throw new ApiError(404, 'Event not found');

  const canEdit = canEditEvent(req.user, event, event.club);
  const canMarkAttendance = canMarkEventAttendance(req.user, event);
  const canViewParticipantsList = canViewParticipants(req.user, event, event.club);
  const shaped = shapeEvent(event, req.user);
  if (shaped.club) {
    delete shaped.club.admins;
    delete shaped.club.facultyAdvisor;
  }
  res.json({
    ...shaped,
    canEdit,
    canMarkAttendance,
    canViewParticipants: canViewParticipantsList,
    canManage: canEdit,
  });
});

export const createEvent = asyncHandler(async (req, res) => {
  // Only Principal, Admin, and all department HODs can create events (not faculties)
  if (!['hod', 'principal', 'admin'].includes(req.user.role)) {
    throw new ApiError(403, 'Only the Principal, Admin, and Department HODs can create events');
  }

  const data = pick(req.body, EDITABLE);
  let club = null;

  if (req.body.club) {
    club = await Club.findOne({ _id: req.body.club, status: 'approved' });
    if (!club) throw new ApiError(400, 'Club not found');
    if (!canManageClub(req.user, club)) throw new ApiError(403, 'Only admins of this club can create its events');
  }

  const facultyCoordinators = await resolveFacultyCoordinators(req.body.facultyCoordinators);

  const event = await Event.create({
    ...data,
    facultyCoordinators,
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
  if (!canEditEvent(req.user, event, club)) throw new ApiError(403, 'You cannot edit this event');

  const before = { start: String(event.startDate), venue: event.venue };
  const updates = pick(req.body, EDITABLE);
  if (updates.capacity !== undefined && updates.capacity > 0 && updates.capacity < event.registeredCount) {
    throw new ApiError(400, `Capacity cannot be lower than current registrations (${event.registeredCount})`);
  }
  if (req.body.facultyCoordinators !== undefined) {
    updates.facultyCoordinators = await resolveFacultyCoordinators(req.body.facultyCoordinators);
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
  const fresh = await Event.findById(event._id)
    .populate('club', 'name slug logo')
    .populate('facultyCoordinators', 'name email avatar department designation')
    .lean();
  res.json(shapeEvent(fresh, req.user));
});

export const deleteEvent = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canEditEvent(req.user, event, club)) throw new ApiError(403, 'You cannot delete this event');
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
  if (!canViewParticipants(req.user, event, club)) throw new ApiError(403, 'You do not have permission to view participants');
  await event.populate('registrations.user', 'name email avatar department year section rollNo');
  res.json(event.registrations);
});

export const getEventParticipantsPdf = asyncHandler(async (req, res) => {
  const { event, club } = await loadEvent(req.params.id);
  if (!canViewParticipants(req.user, event, club)) {
    throw new ApiError(403, 'You do not have permission to view or export participants');
  }

  await event.populate([
    { path: 'organizer', select: 'name email role department' },
    { path: 'facultyCoordinators', select: 'name email department designation' },
    { path: 'club', select: 'name' },
    { path: 'registrations.user', select: 'name email avatar department year rollNo section phone' },
  ]);

  const pdfBuffer = await generateEventParticipantsPdfBuffer(event);
  const safeTitle = (event.title || 'Event').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const filename = `Event_Participants_${safeTitle}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
});

export const markAttendance = asyncHandler(async (req, res) => {
  const { event } = await loadEvent(req.params.id);
  if (!canMarkEventAttendance(req.user, event)) {
    throw new ApiError(403, 'Only assigned faculty coordinators and the hosting HOD can mark attendance');
  }

  const reg = event.registrations.find((r) => sameId(r.user, req.params.userId));
  if (!reg || reg.status === 'waitlisted') {
    throw new ApiError(400, 'User is not a confirmed participant');
  }

  const attended = Boolean(req.body.attended);
  const now = clock.now();
  let targetDateStr = req.body.date ? String(req.body.date).trim().slice(0, 10) : dayKey(now);

  const targetDay = toDay(targetDateStr);
  const evStartDay = toDay(event.startDate);
  const evEndDay = toDay(event.endDate);

  if (targetDay < evStartDay || targetDay > evEndDay) {
    if (!req.body.date) {
      targetDateStr = dayKey(evStartDay);
    } else {
      throw new ApiError(422, 'The selected date is outside of the event schedule');
    }
  }

  if (!reg.attendanceDays) reg.attendanceDays = [];
  const dayIdx = reg.attendanceDays.findIndex((d) => d.date === targetDateStr);
  if (dayIdx >= 0) {
    reg.attendanceDays[dayIdx].attended = attended;
    reg.attendanceDays[dayIdx].markedBy = req.user._id;
    reg.attendanceDays[dayIdx].markedAt = new Date();
  } else {
    reg.attendanceDays.push({
      date: targetDateStr,
      attended,
      markedBy: req.user._id,
      markedAt: new Date(),
    });
  }

  const hasAttendedAny = reg.attendanceDays.some((d) => d.attended);
  reg.status = hasAttendedAny ? 'attended' : 'registered';
  await event.save();

  const student = await User.findById(req.params.userId).select('name rollNo department year section email').lean();

  if (student) {
    const studentDay = toDay(targetDateStr);
    const dayOfWeek = weekdayOf(studentDay);
    const studentSection = String(student.section || '').trim().toUpperCase();

    const scheduledSlots = await TimetableSlot.find({
      department: student.department,
      isActive: true,
      isBreak: { $ne: true },
      dayOfWeek,
      ...(studentSection ? { section: studentSection } : {}),
      ...(student.year ? { year: student.year } : {}),
    }).lean();

    const periods = scheduledSlots.map((s) => s.period);

    if (attended) {
      if (scheduledSlots.length > 0) {
        const ops = scheduledSlots.map((slot) => ({
          updateOne: {
            filter: { student: student._id, subject: slot.subject, date: studentDay, period: slot.period },
            update: {
              $setOnInsert: {
                student: student._id,
                subject: slot.subject,
                date: studentDay,
                period: slot.period,
                department: student.department,
                section: student.section,
              },
              $set: {
                status: 'od',
                markedBy: req.user._id,
                markedAt: new Date(),
                correctionReason: `Attended event: ${event.title}`,
              },
            },
            upsert: true,
          },
        }));
        await AttendanceRecord.bulkWrite(ops);
      }

      await notifyUsers([student._id], {
        type: 'attendance',
        title: 'Event Attendance Marked: Present',
        message: `You have been marked present (On Duty) for "${event.title}" on ${targetDateStr} by ${req.user.name}.`,
        link: '/attendance',
      });
    } else {
      if (periods.length > 0) {
        const existingRecords = await AttendanceRecord.find({
          student: student._id,
          date: studentDay,
          period: { $in: periods },
        });

        for (const rec of existingRecords) {
          const prevStatus = rec.status;
          rec.status = 'absent';
          rec.markedBy = req.user._id;
          rec.markedAt = new Date();
          rec.history.push({
            from: prevStatus,
            to: 'absent',
            by: req.user._id,
            at: new Date(),
            reason: `Did not attend registered event: ${event.title}`,
          });
          await rec.save();
        }

        const recordedPeriods = new Set(existingRecords.map((r) => r.period));
        const missingSlots = scheduledSlots.filter((s) => !recordedPeriods.has(s.period));
        if (missingSlots.length > 0) {
          const ops = missingSlots.map((slot) => ({
            updateOne: {
              filter: { student: student._id, subject: slot.subject, date: studentDay, period: slot.period },
              update: {
                $setOnInsert: {
                  student: student._id,
                  subject: slot.subject,
                  date: studentDay,
                  period: slot.period,
                  department: student.department,
                  section: student.section,
                },
                $set: {
                  status: 'absent',
                  markedBy: req.user._id,
                  markedAt: new Date(),
                  correctionReason: `Did not attend registered event: ${event.title}`,
                },
              },
              upsert: true,
            },
          }));
          await AttendanceRecord.bulkWrite(ops);
        }
      }

      const cic = await User.findOne({
        role: 'faculty',
        department: student.department,
        section: student.section,
        inChargeYear: student.year,
        isActive: true,
      }).select('_id name');

      if (cic) {
        await notifyUsers([cic._id], {
          type: 'attendance',
          title: `Event Absence Alert: ${student.name}`,
          message: `${student.name} (${student.rollNo || student.department}) did not attend registered event "${event.title}" on ${targetDateStr}. Academic attendance has been marked absent.`,
          link: '/attendance',
        });
      }

      await notifyUsers([student._id], {
        type: 'attendance',
        title: `Event Absence: ${event.title}`,
        message: `You were marked absent for the event "${event.title}" on ${targetDateStr}. Your academic attendance has been marked absent.`,
        link: '/attendance',
      });
    }
  }

  logActivity(req, 'event.attendance', {
    entityType: 'event',
    entityId: event._id,
    summary: `${event.title} - ${student?.name || 'Student'}: ${attended ? 'Attended' : 'Absent'} (${targetDateStr})`,
  });

  res.json({
    status: reg.status,
    attended,
    date: targetDateStr,
    attendanceDays: reg.attendanceDays,
  });
});
