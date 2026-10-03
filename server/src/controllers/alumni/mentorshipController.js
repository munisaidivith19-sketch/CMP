import mongoose from 'mongoose';
import MentorshipRequest from '../../models/MentorshipRequest.js';
import MentorshipSlot from '../../models/MentorshipSlot.js';
import MentorshipSession from '../../models/MentorshipSession.js';
import AlumniProfile from '../../models/AlumniProfile.js';
import User from '../../models/User.js';
import Conversation from '../../models/Conversation.js';
import { ApiError, asyncHandler, pageMeta, paginate } from '../../utils/http.js';
import { logActivity } from '../../utils/activity.js';
import { notifyUsers } from '../../utils/notify.js';
import { emitToUsers } from '../../config/socket.js';
import { sameId } from '../../utils/permissions.js';
import { env } from '../../config/env.js';

const PUBLIC_USER_FIELDS = 'name email role department year avatar phone designation employeeId rollNo';

// ── POST /api/mentorship-requests ──────────────────────────────────
export const createRequest = asyncHandler(async (req, res) => {
  const { alumni: alumniId, domain, message } = req.body;
  const studentId = req.user._id;

  if (sameId(alumniId, studentId)) {
    throw new ApiError(400, 'Cannot request mentorship from yourself');
  }

  const profile = await AlumniProfile.findOne({ user: alumniId, isVerified: true });
  if (!profile) throw new ApiError(404, 'Verified alumni profile not found');
  if (!profile.mentorshipAvailable) throw new ApiError(400, 'Alumnus is currently not accepting mentees');

  if (profile.activeMenteeCount >= profile.maxActiveMentees) {
    throw new ApiError(409, 'Alumnus has reached their active mentee capacity');
  }

  // Check student pending request limit
  const pendingCount = await MentorshipRequest.countDocuments({ student: studentId, status: 'pending' });
  if (pendingCount >= env.alumni.mentorshipMaxPendingPerStudent) {
    throw new ApiError(409, `You already have ${pendingCount} pending mentorship requests (maximum is ${env.alumni.mentorshipMaxPendingPerStudent})`);
  }

  // Check duplicate pending request
  const existingPending = await MentorshipRequest.findOne({ student: studentId, alumni: alumniId, status: 'pending' });
  if (existingPending) {
    throw new ApiError(409, 'You already have a pending request with this alumnus');
  }

  const expiresDays = env.alumni.mentorshipRequestExpiryDays || 14;
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);

  const request = await MentorshipRequest.create({
    student: studentId,
    alumni: alumniId,
    domain,
    message,
    expiresAt,
  });

  await request.populate([
    { path: 'student', select: PUBLIC_USER_FIELDS },
    { path: 'alumni', select: PUBLIC_USER_FIELDS },
  ]);

  await notifyUsers([alumniId], {
    type: 'alumni',
    title: 'New Mentorship Request',
    message: `${req.user.name} sent you a mentorship request in ${domain.replace('_', ' ')}.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([alumniId], 'alumni:request', request.toJSON());
  logActivity(req, 'mentorship.request_created', { entityType: 'mentorship', entityId: request._id });

  res.status(201).json(request);
});

// ── GET /api/mentorship-requests ───────────────────────────────────
export const listRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 10, 50);
  const { status } = req.query;
  const user = req.user;

  const filter = {};
  if (status) filter.status = status;

  if (user.role === 'alumni') {
    filter.alumni = user._id;
  } else if (['student', 'club_admin'].includes(user.role)) {
    filter.student = user._id;
  } else if (['admin', 'hod', 'principal'].includes(user.role)) {
    // Staff view: HOD scoped to own department's students
    if (user.role === 'hod') {
      const deptStudents = await User.find({ department: user.department }).distinct('_id');
      filter.student = { $in: deptStudents };
    }
  } else {
    filter.student = user._id;
  }

  const [items, total] = await Promise.all([
    MentorshipRequest.find(filter)
      .populate('student', PUBLIC_USER_FIELDS)
      .populate('alumni', PUBLIC_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MentorshipRequest.countDocuments(filter),
  ]);

  res.json({
    items,
    ...pageMeta(total, page, limit),
  });
});

// ── GET /api/mentorship-requests/:id ───────────────────────────────
export const getRequestById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const request = await MentorshipRequest.findById(id)
    .populate('student', PUBLIC_USER_FIELDS)
    .populate('alumni', PUBLIC_USER_FIELDS);

  if (!request) throw new ApiError(404, 'Mentorship request not found');

  const user = req.user;
  const isParticipant = sameId(request.student._id, user._id) || sameId(request.alumni._id, user._id);
  const isStaff = ['admin', 'hod', 'principal'].includes(user.role);

  if (!isParticipant && !isStaff) throw new ApiError(403, 'Access denied');

  const sessions = await MentorshipSession.find({ request: request._id })
    .sort({ scheduledAt: -1 })
    .lean();

  const out = request.toObject();
  out.sessions = sessions;

  res.json(out);
});

// ── PATCH /api/mentorship-requests/:id (or /respond) ───────────────
export const respondToRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, response } = req.body;
  const alumniId = req.user._id;

  if (!['accepted', 'declined'].includes(status)) {
    throw new ApiError(422, 'Status must be accepted or declined');
  }

  const now = new Date();

  if (status === 'accepted') {
    // Atomic transition from pending -> accepted
    const reqDoc = await MentorshipRequest.findOneAndUpdate(
      { _id: id, alumni: alumniId, status: 'pending' },
      { $set: { status: 'accepted', respondedAt: now, response: response?.trim() } },
      { new: true }
    );
    if (!reqDoc) throw new ApiError(409, 'Request is no longer pending or does not belong to you');

    // Atomic capacity increment with guard
    const profile = await AlumniProfile.findOneAndUpdate(
      { user: alumniId, $expr: { $lt: ['$activeMenteeCount', '$maxActiveMentees'] } },
      { $inc: { activeMenteeCount: 1 } }
    );

    if (!profile) {
      // Rollback request back to pending
      await MentorshipRequest.updateOne({ _id: id }, { status: 'pending', $unset: { respondedAt: 1 } });
      throw new ApiError(409, 'You have reached your maximum active mentee capacity');
    }

    await reqDoc.populate([
      { path: 'student', select: PUBLIC_USER_FIELDS },
      { path: 'alumni', select: PUBLIC_USER_FIELDS },
    ]);

    await notifyUsers([reqDoc.student._id], {
      type: 'alumni',
      title: 'Mentorship Request Accepted! 🎉',
      message: `${req.user.name} accepted your mentorship request.`,
      link: '/alumni?tab=mentorship',
    });

    emitToUsers([reqDoc.student._id], 'alumni:request_updated', reqDoc.toJSON());
    logActivity(req, 'mentorship.request_accepted', { entityType: 'mentorship', entityId: reqDoc._id });

    return res.json(reqDoc);
  }

  // Declined flow
  const reqDoc = await MentorshipRequest.findOneAndUpdate(
    { _id: id, alumni: alumniId, status: 'pending' },
    { $set: { status: 'declined', respondedAt: now, response: response?.trim() } },
    { new: true }
  );
  if (!reqDoc) throw new ApiError(409, 'Request is no longer pending or does not belong to you');

  await reqDoc.populate([
    { path: 'student', select: PUBLIC_USER_FIELDS },
    { path: 'alumni', select: PUBLIC_USER_FIELDS },
  ]);

  await notifyUsers([reqDoc.student._id], {
    type: 'alumni',
    title: 'Mentorship Request Declined',
    message: `${req.user.name} declined your mentorship request. ${response ? `Note: "${response}"` : ''}`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([reqDoc.student._id], 'alumni:request_updated', reqDoc.toJSON());
  logActivity(req, 'mentorship.request_declined', { entityType: 'mentorship', entityId: reqDoc._id });

  res.json(reqDoc);
});

// ── PATCH /api/mentorship-requests/:id/cancel ──────────────────────
export const cancelRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const studentId = req.user._id;

  const reqDoc = await MentorshipRequest.findOne({ _id: id, student: studentId });
  if (!reqDoc) throw new ApiError(404, 'Mentorship request not found');

  if (!['pending', 'accepted'].includes(reqDoc.status)) {
    throw new ApiError(409, `Cannot cancel a request that is ${reqDoc.status}`);
  }

  const previousStatus = reqDoc.status;
  reqDoc.status = 'cancelled';
  reqDoc.cancelledAt = new Date();
  reqDoc.cancelReason = reason?.trim()?.slice(0, 300);
  await reqDoc.save();

  if (previousStatus === 'accepted') {
    // Atomic capacity decrement
    await AlumniProfile.findOneAndUpdate(
      { user: reqDoc.alumni, activeMenteeCount: { $gt: 0 } },
      { $inc: { activeMenteeCount: -1 } }
    );
  }

  await notifyUsers([reqDoc.alumni], {
    type: 'alumni',
    title: 'Mentorship Request Cancelled',
    message: `${req.user.name} cancelled their mentorship request.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([reqDoc.alumni], 'alumni:request_updated', reqDoc.toJSON());
  res.json(reqDoc);
});

// ── PATCH /api/mentorship-requests/:id/complete ────────────────────
export const completeRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const alumniId = req.user._id;

  const reqDoc = await MentorshipRequest.findOne({ _id: id, alumni: alumniId, status: 'accepted' });
  if (!reqDoc) throw new ApiError(409, 'Request is not in active accepted status');

  reqDoc.status = 'completed';
  reqDoc.completedAt = new Date();
  await reqDoc.save();

  // Atomic capacity decrement
  await AlumniProfile.findOneAndUpdate(
    { user: alumniId, activeMenteeCount: { $gt: 0 } },
    { $inc: { activeMenteeCount: -1 } }
  );

  await notifyUsers([reqDoc.student], {
    type: 'alumni',
    title: 'Mentorship Completed! Please Rate ⭐️',
    message: `${req.user.name} marked your mentorship as completed. Please leave a review.`,
    link: `/alumni?tab=mentorship&rate=${reqDoc._id}`,
  });

  emitToUsers([reqDoc.student], 'alumni:request_updated', reqDoc.toJSON());
  res.json(reqDoc);
});

// ── PATCH /api/mentorship-requests/:id/rate ────────────────────────
export const rateRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rating, review, feedback } = req.body;
  const studentId = req.user._id;

  const numRating = Number(rating);
  if (!numRating || numRating < 1 || numRating > 5) {
    throw new ApiError(422, 'Rating must be an integer between 1 and 5');
  }

  const reqDoc = await MentorshipRequest.findOne({ _id: id, student: studentId, status: 'completed' });
  if (!reqDoc) throw new ApiError(404, 'Completed mentorship request not found');
  if (reqDoc.rating) throw new ApiError(409, 'You have already rated this mentorship');

  reqDoc.rating = numRating;
  reqDoc.review = (review || feedback || '').trim().slice(0, 500);
  reqDoc.ratedAt = new Date();
  await reqDoc.save();

  // Update cached rating stats on alumni profile
  const ratingAgg = await MentorshipRequest.aggregate([
    { $match: { alumni: reqDoc.alumni, status: 'completed', rating: { $exists: true, $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  if (ratingAgg.length) {
    await AlumniProfile.updateOne(
      { user: reqDoc.alumni },
      {
        $set: {
          ratingAvg: Math.round(ratingAgg[0].avg * 10) / 10,
          ratingCount: ratingAgg[0].count,
        },
      }
    );
  }

  await notifyUsers([reqDoc.alumni], {
    type: 'alumni',
    title: `New Mentorship Review (${numRating}★)`,
    message: `${req.user.name} rated their mentorship with you.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([reqDoc.alumni], 'alumni:request_updated', reqDoc.toJSON());
  res.json(reqDoc);
});

// ── PATCH /api/mentorship-requests/:id/goals ───────────────────────
export const updateGoals = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { goals } = req.body;
  const user = req.user;

  if (!Array.isArray(goals) || goals.length > 5) {
    throw new ApiError(422, 'Goals must be an array of at most 5 items');
  }

  const reqDoc = await MentorshipRequest.findOne({
    _id: id,
    $or: [{ student: user._id }, { alumni: user._id }],
    status: 'accepted',
  });
  if (!reqDoc) throw new ApiError(404, 'Active mentorship request not found');

  reqDoc.goals = goals.map((g) => ({
    text: String(g.text || '').trim().slice(0, 200),
    done: Boolean(g.done),
  }));

  await reqDoc.save();
  res.json(reqDoc);
});

// ── POST /api/mentorship/requests/:id/message ──────────────────────
export const messageMentor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const reqDoc = await MentorshipRequest.findOne({
    _id: id,
    $or: [{ student: user._id }, { alumni: user._id }],
    status: 'accepted',
  });
  if (!reqDoc) throw new ApiError(404, 'Active mentorship not found');

  const otherId = sameId(reqDoc.student, user._id) ? reqDoc.alumni : reqDoc.student;

  let conv = await Conversation.findOne({
    isGroup: false,
    participants: { $all: [user._id, otherId], $size: 2 },
  });

  if (!conv) {
    conv = await Conversation.create({
      participants: [user._id, otherId],
      isGroup: false,
    });
  }

  res.json({ conversationId: conv._id });
});

// ── Mentorship Slots ───────────────────────────────────────────────
export const listSlots = asyncHandler(async (req, res) => {
  const { alumni, from, to } = req.query;
  const filter = { status: 'open' };

  if (alumni) filter.alumni = alumni;
  const now = new Date();
  filter.startsAt = { $gte: now };

  if (from || to) {
    filter.startsAt = {};
    if (from) filter.startsAt.$gte = new Date(from);
    else filter.startsAt.$gte = now;
    if (to) filter.startsAt.$lte = new Date(to);
  }

  const slots = await MentorshipSlot.find(filter).sort({ startsAt: 1 }).lean();
  res.json(slots);
});

export const createSlots = asyncHandler(async (req, res) => {
  const { slots } = req.body;
  if (!Array.isArray(slots) || !slots.length || slots.length > 20) {
    throw new ApiError(422, 'Provide an array of between 1 and 20 slots');
  }

  const alumniId = req.user._id;
  const now = new Date();

  const toInsert = [];
  for (const s of slots) {
    const startsAt = new Date(s.startsAt);
    if (isNaN(startsAt.getTime()) || startsAt <= now) {
      throw new ApiError(422, 'Slot start time must be in the future');
    }
    toInsert.push({
      alumni: alumniId,
      startsAt,
      durationMin: Number(s.durationMin) || 30,
      mode: s.mode || 'video',
      meetingLink: s.meetingLink?.trim(),
      note: s.note?.trim(),
      status: 'open',
    });
  }

  const created = await MentorshipSlot.insertMany(toInsert);
  res.status(201).json(created);
});

export const deleteSlot = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const slot = await MentorshipSlot.findOneAndDelete({
    _id: id,
    alumni: req.user._id,
    status: 'open',
  });
  if (!slot) throw new ApiError(404, 'Open slot not found');
  res.json({ ok: true });
});

// ── Mentorship Sessions ────────────────────────────────────────────
export const bookSession = asyncHandler(async (req, res) => {
  const { request: requestId, slot: slotId, agenda } = req.body;
  const studentId = req.user._id;

  const mentReq = await MentorshipRequest.findOne({
    _id: requestId,
    student: studentId,
    status: 'accepted',
  });
  if (!mentReq) throw new ApiError(404, 'Active mentorship request not found');

  // Max 1 upcoming confirmed session per request
  const existingUpcoming = await MentorshipSession.findOne({
    request: requestId,
    status: 'confirmed',
    scheduledAt: { $gte: new Date() },
  });
  if (existingUpcoming) {
    throw new ApiError(409, 'You already have an upcoming session scheduled for this mentorship');
  }

  // Atomic slot reservation
  const slot = await MentorshipSlot.findOneAndUpdate(
    { _id: slotId, alumni: mentReq.alumni, status: 'open' },
    { $set: { status: 'booked', bookedBy: studentId } },
    { new: true }
  );
  if (!slot) throw new ApiError(409, 'This slot is no longer available');

  const session = await MentorshipSession.create({
    request: requestId,
    alumni: mentReq.alumni,
    student: studentId,
    slot: slot._id,
    agenda: agenda?.trim()?.slice(0, 300),
    scheduledAt: slot.startsAt,
    durationMin: slot.durationMin,
    mode: slot.mode,
    meetingLink: slot.meetingLink,
    status: 'confirmed',
  });

  slot.session = session._id;
  await slot.save();

  await session.populate([
    { path: 'alumni', select: PUBLIC_USER_FIELDS },
    { path: 'student', select: PUBLIC_USER_FIELDS },
  ]);

  await notifyUsers([mentReq.alumni], {
    type: 'alumni',
    title: 'Mentoring Session Booked 🗓️',
    message: `${req.user.name} booked a session on ${session.scheduledAt.toLocaleDateString()} at ${session.scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([mentReq.alumni], 'alumni:session', session.toJSON());
  res.status(201).json(session);
});

export const listSessions = asyncHandler(async (req, res) => {
  const { scope = 'upcoming' } = req.query;
  const user = req.user;
  const now = new Date();

  const filter = {
    $or: [{ alumni: user._id }, { student: user._id }],
  };

  if (scope === 'upcoming') {
    filter.scheduledAt = { $gte: now };
    filter.status = 'confirmed';
  } else {
    filter.$and = [
      { $or: [{ alumni: user._id }, { student: user._id }] },
      { $or: [{ status: { $in: ['completed', 'cancelled', 'no_show'] } }, { scheduledAt: { $lt: now } }] },
    ];
    delete filter.$or;
  }

  const sessions = await MentorshipSession.find(filter)
    .populate('alumni', PUBLIC_USER_FIELDS)
    .populate('student', PUBLIC_USER_FIELDS)
    .sort({ scheduledAt: scope === 'upcoming' ? 1 : -1 })
    .lean();

  // Strip alumni private notes for students
  const isAlumni = user.role === 'alumni';
  const out = sessions.map((s) => {
    if (!isAlumni && !sameId(s.alumni?._id, user._id)) {
      delete s.alumniPrivateNotes;
    }
    return s;
  });

  res.json(out);
});

export const rescheduleSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { slot: newSlotId } = req.body;
  const user = req.user;

  const session = await MentorshipSession.findOne({
    _id: id,
    $or: [{ student: user._id }, { alumni: user._id }],
    status: 'confirmed',
  });
  if (!session) throw new ApiError(404, 'Confirmed session not found');

  const now = new Date();
  if (session.scheduledAt.getTime() - now.getTime() < 2 * 60 * 60 * 1000) {
    throw new ApiError(400, 'Sessions cannot be rescheduled within 2 hours of start time');
  }

  // Atomically book the new slot
  const newSlot = await MentorshipSlot.findOneAndUpdate(
    { _id: newSlotId, alumni: session.alumni, status: 'open' },
    { $set: { status: 'booked', bookedBy: session.student } },
    { new: true }
  );
  if (!newSlot) throw new ApiError(409, 'New slot is no longer available');

  // Free old slot if still in future
  if (session.slot) {
    await MentorshipSlot.updateOne(
      { _id: session.slot, startsAt: { $gt: now } },
      { $set: { status: 'open' }, $unset: { bookedBy: 1, session: 1 } }
    );
  }

  session.slot = newSlot._id;
  session.scheduledAt = newSlot.startsAt;
  session.durationMin = newSlot.durationMin;
  session.mode = newSlot.mode;
  session.meetingLink = newSlot.meetingLink;
  session.reminder24hSentAt = undefined;
  session.reminder1hSentAt = undefined;
  await session.save();

  const otherId = sameId(session.student, user._id) ? session.alumni : session.student;
  await notifyUsers([otherId], {
    type: 'alumni',
    title: 'Mentoring Session Rescheduled',
    message: `${user.name} rescheduled the session to ${session.scheduledAt.toLocaleString()}.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([session.student, session.alumni], 'alumni:session', session.toJSON());
  res.json(session);
});

export const cancelSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const user = req.user;

  const session = await MentorshipSession.findOne({
    _id: id,
    $or: [{ student: user._id }, { alumni: user._id }],
    status: 'confirmed',
  });
  if (!session) throw new ApiError(404, 'Confirmed session not found');

  const now = new Date();
  if (sameId(session.student, user._id) && session.scheduledAt.getTime() - now.getTime() < 2 * 60 * 60 * 1000) {
    throw new ApiError(400, 'Students cannot cancel sessions within 2 hours of start time');
  }

  session.status = 'cancelled';
  session.cancelledBy = user._id;
  session.cancelReason = reason?.trim()?.slice(0, 300);
  await session.save();

  // Free slot if still in future
  if (session.slot) {
    await MentorshipSlot.updateOne(
      { _id: session.slot, startsAt: { $gt: now } },
      { $set: { status: 'open' }, $unset: { bookedBy: 1, session: 1 } }
    );
  }

  const otherId = sameId(session.student, user._id) ? session.alumni : session.student;
  await notifyUsers([otherId], {
    type: 'alumni',
    title: 'Mentoring Session Cancelled',
    message: `${user.name} cancelled the scheduled mentoring session.`,
    link: '/alumni?tab=mentorship',
  });

  emitToUsers([session.student, session.alumni], 'alumni:session', session.toJSON());
  res.json(session);
});

export const completeSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { outcome } = req.body;
  const alumniId = req.user._id;

  const session = await MentorshipSession.findOne({ _id: id, alumni: alumniId });
  if (!session) throw new ApiError(404, 'Session not found');

  session.status = outcome === 'no_show' ? 'no_show' : 'completed';
  session.completedAt = new Date();
  await session.save();

  res.json(session);
});

export const updateSessionNotes = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { sharedNotes, alumniPrivateNotes, actionItems } = req.body;
  const user = req.user;

  const session = await MentorshipSession.findOne({
    _id: id,
    $or: [{ student: user._id }, { alumni: user._id }],
  });
  if (!session) throw new ApiError(404, 'Session not found');

  if (sameId(session.alumni, user._id)) {
    if (sharedNotes !== undefined) session.sharedNotes = String(sharedNotes).slice(0, 2000);
    if (alumniPrivateNotes !== undefined) session.alumniPrivateNotes = String(alumniPrivateNotes).slice(0, 2000);
    if (Array.isArray(actionItems)) {
      session.actionItems = actionItems.map((a) => ({
        text: String(a.text || '').slice(0, 200),
        done: Boolean(a.done),
        dueDate: a.dueDate ? new Date(a.dueDate) : undefined,
      }));
    }
  } else {
    // Student can only toggle action item done states
    if (Array.isArray(actionItems) && session.actionItems) {
      for (const update of actionItems) {
        const item = session.actionItems.id(update._id);
        if (item) item.done = Boolean(update.done);
      }
    }
  }

  await session.save();
  res.json(session);
});
