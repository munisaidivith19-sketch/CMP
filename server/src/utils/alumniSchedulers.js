import MentorshipRequest from '../models/MentorshipRequest.js';
import AlumniProfile from '../models/AlumniProfile.js';
import MentorshipSession from '../models/MentorshipSession.js';
import AlumniEvent from '../models/AlumniEvent.js';
import AlumniEventRsvp from '../models/AlumniEventRsvp.js';
import AlumniJob from '../models/AlumniJob.js';
import AlumniInvite from '../models/AlumniInvite.js';
import { notifyUsers } from './notify.js';

export async function expireMentorshipRequests() {
  const now = new Date();
  const expired = await MentorshipRequest.find({
    status: 'pending',
    expiresAt: { $lt: now },
  });

  for (const req of expired) {
    req.status = 'expired';
    await req.save();
    await notifyUsers([req.student], {
      type: 'alumni',
      title: 'Mentorship request expired',
      message: 'Your mentorship request expired with no response from the mentor',
      link: '/alumni?tab=mentorship',
    });
  }
}

export async function reconcileMentorCounts() {
  const profiles = await AlumniProfile.find({}, 'user activeMenteeCount');
  for (const p of profiles) {
    const actual = await MentorshipRequest.countDocuments({
      alumni: p.user,
      status: 'accepted',
    });
    if (p.activeMenteeCount !== actual) {
      await AlumniProfile.updateOne({ _id: p._id }, { $set: { activeMenteeCount: actual } });
    }
  }
}

export async function sessionReminders() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24.5 * 60 * 60 * 1000);
  const in1h = new Date(now.getTime() + 1.2 * 60 * 60 * 1000);

  // 24-hour reminder
  const sessions24 = await MentorshipSession.find({
    status: 'confirmed',
    scheduledAt: { $gt: now, $lte: in24h },
    reminder24hSentAt: null,
  }).populate('student', 'name').populate('alumni', 'name');

  for (const s of sessions24) {
    s.reminder24hSentAt = now;
    await s.save();
    const dateStr = s.scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    await notifyUsers([s.student._id], {
      type: 'alumni',
      title: 'Upcoming Mentoring Session Tomorrow',
      message: `You have a session with ${s.alumni?.name || 'your mentor'} at ${dateStr}`,
      link: '/alumni?tab=mentorship',
    });
    await notifyUsers([s.alumni._id], {
      type: 'alumni',
      title: 'Upcoming Mentoring Session Tomorrow',
      message: `You have a session with ${s.student?.name || 'your mentee'} at ${dateStr}`,
      link: '/alumni?tab=mentorship',
    });
  }

  // 1-hour reminder
  const sessions1 = await MentorshipSession.find({
    status: 'confirmed',
    scheduledAt: { $gt: now, $lte: in1h },
    reminder1hSentAt: null,
  }).populate('student', 'name').populate('alumni', 'name');

  for (const s of sessions1) {
    s.reminder1hSentAt = now;
    await s.save();
    await notifyUsers([s.student._id], {
      type: 'alumni',
      title: 'Mentoring Session Starting in ~1 Hour',
      message: `Your mentoring session with ${s.alumni?.name || 'your mentor'} starts soon`,
      link: '/alumni?tab=mentorship',
    });
    await notifyUsers([s.alumni._id], {
      type: 'alumni',
      title: 'Mentoring Session Starting in ~1 Hour',
      message: `Your mentoring session with ${s.student?.name || 'your mentee'} starts soon`,
      link: '/alumni?tab=mentorship',
    });
  }
}

export async function eventReminders() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24.5 * 60 * 60 * 1000);
  const in1h = new Date(now.getTime() + 1.2 * 60 * 60 * 1000);

  // 24-hour reminder
  const events24 = await AlumniEvent.find({
    status: 'scheduled',
    startsAt: { $gt: now, $lte: in24h },
    reminder24hSentAt: null,
  });

  for (const e of events24) {
    e.reminder24hSentAt = now;
    await e.save();
    const rsvps = await AlumniEventRsvp.find({ event: e._id, status: 'going' }).select('user');
    const userIds = rsvps.map((r) => r.user);
    if (userIds.length) {
      await notifyUsers(userIds, {
        type: 'alumni',
        title: `Reminder: ${e.title} is tomorrow`,
        message: `Starts at ${e.startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        link: `/alumni?tab=events&id=${e._id}`,
      });
    }
  }

  // 1-hour reminder
  const events1 = await AlumniEvent.find({
    status: 'scheduled',
    startsAt: { $gt: now, $lte: in1h },
    reminder1hSentAt: null,
  });

  for (const e of events1) {
    e.reminder1hSentAt = now;
    await e.save();
    const rsvps = await AlumniEventRsvp.find({ event: e._id, status: 'going' }).select('user');
    const userIds = rsvps.map((r) => r.user);
    if (userIds.length) {
      await notifyUsers(userIds, {
        type: 'alumni',
        title: `Starting Soon: ${e.title}`,
        message: `The event begins in approximately 1 hour`,
        link: `/alumni?tab=events&id=${e._id}`,
      });
    }
  }
}

export async function expireJobs() {
  const now = new Date();
  await AlumniJob.updateMany(
    { status: 'open', deadline: { $lt: now } },
    { $set: { status: 'expired' } }
  );
}

export async function completeEvents() {
  const now = new Date();
  await AlumniEvent.updateMany(
    { status: 'scheduled', endsAt: { $lt: now } },
    { $set: { status: 'completed' } }
  );
}

export async function expireInvites() {
  const now = new Date();
  await AlumniInvite.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } }
  );
}

export function startAlumniSchedulers() {
  const safeRun = (fn, name) => {
    fn().catch((err) => console.error(`[alumni-scheduler] ${name} failed:`, err.message));
  };

  // Immediate kick-off on startup
  safeRun(expireMentorshipRequests, 'expireMentorshipRequests');
  safeRun(reconcileMentorCounts, 'reconcileMentorCounts');
  safeRun(expireJobs, 'expireJobs');
  safeRun(completeEvents, 'completeEvents');
  safeRun(expireInvites, 'expireInvites');
  safeRun(sessionReminders, 'sessionReminders');
  safeRun(eventReminders, 'eventReminders');

  // Reminders every 5 minutes
  const remindersInterval = setInterval(() => {
    safeRun(sessionReminders, 'sessionReminders');
    safeRun(eventReminders, 'eventReminders');
  }, 5 * 60 * 1000);
  remindersInterval.unref();

  // Housekeeping every 30 minutes
  const housekeepingInterval = setInterval(() => {
    safeRun(expireJobs, 'expireJobs');
    safeRun(completeEvents, 'completeEvents');
    safeRun(expireInvites, 'expireInvites');
  }, 30 * 60 * 1000);
  housekeepingInterval.unref();

  // Daily sweep (every 6 hours)
  const dailySweepInterval = setInterval(() => {
    safeRun(expireMentorshipRequests, 'expireMentorshipRequests');
    safeRun(reconcileMentorCounts, 'reconcileMentorCounts');
  }, 6 * 60 * 60 * 1000);
  dailySweepInterval.unref();

  console.log('[alumni-scheduler] Alumni Network background schedulers started');
}
