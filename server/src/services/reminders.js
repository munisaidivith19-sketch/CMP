/**
 * Scheduled notifications (one tick a minute):
 *
 * 1. Next-period reminders for faculty: subject code and name, class
 *    (department, year, section), room and start time, N minutes before the
 *    class (N = the faculty member's preference, default 10). Computed from the
 *    CURRENT timetable on every tick, so an edited or deleted period simply
 *    reminds at its new time or not at all. Goes to the assigned substitute
 *    when there is one; nothing for a holiday, an exam-blocked period or a
 *    period recorded as not conducted. Each period reminds once (eventKey).
 *
 * 2. The daily attendance digest (once a day after DIGEST_TIME, default
 *    17:30 campus time): each HOD gets their department's staff who were
 *    scheduled but have no attendance record today and the students below
 *    75 %; the Principal and the Office get the college totals.
 */
import TimetableSlot from '../models/TimetableSlot.js';
import { registerJob, runJob } from './soc/monitors.js';
import PeriodCover from '../models/PeriodCover.js';
import FacultyAttendance from '../models/FacultyAttendance.js';
import User from '../models/User.js';
import { notifyUsers } from '../utils/notify.js';
import { campusParts, dayKey, resolveRange, toDay } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { appliesTo, holidaysBetween } from './holidays.js';
import { publishedExamsFor, timesOverlap, to12h } from './exams.js';
import { studentTotals } from './attendanceTotals.js';

const LOOKAHEAD = 30; // minutes — the largest reminder choice
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function runReminderTick(now = clock.now()) {
  const p = campusParts(now);
  const day = toDay(now);
  const t = minutes(p.time);
  if (t + 1 > 24 * 60) return 0;
  const slots = await TimetableSlot.find({
    dayOfWeek: p.weekday,
    isActive: true,
    isBreak: { $ne: true },
    startTime: { $gt: p.time, $lte: hhmm(Math.min(24 * 60 - 1, t + LOOKAHEAD)) },
  })
    .populate('subject', 'code name')
    .lean();
  if (!slots.length) return 0;

  const [covers, holidays] = await Promise.all([
    PeriodCover.find({ timetableSlot: { $in: slots.map((s) => s._id) }, date: day, status: 'active' }).lean(),
    holidaysBetween(day, day),
  ]);
  const coverOf = new Map(covers.map((c) => [String(c.timetableSlot), c]));
  // Published exams, once per class.
  const examsOf = new Map();
  const classKey = (s) => `${s.department}|${s.year}|${s.section}`;
  for (const s of slots) if (!examsOf.has(classKey(s))) examsOf.set(classKey(s), publishedExamsFor({ department: s.department, year: s.year, section: s.section }, day));

  const due = [];
  for (const s of slots) {
    const cover = coverOf.get(String(s._id));
    if (cover && cover.kind !== 'substitute') continue;
    if (holidays.some((h) => appliesTo(h, s, day))) continue;
    if ((await examsOf.get(classKey(s))).some((e) => timesOverlap(e, s))) continue;
    due.push({ slot: s, recipient: cover?.substitute || s.faculty, substitute: Boolean(cover) });
  }
  const people = await User.find({ _id: { $in: due.map((d) => d.recipient) }, isActive: true }).select('notificationPrefs').lean();
  const prefOf = new Map(people.map((u) => [String(u._id), u.notificationPrefs?.reminderMinutes || 10]));

  let sent = 0;
  for (const { slot: s, recipient, substitute } of due) {
    const lead = prefOf.get(String(recipient));
    if (lead == null) continue;
    const until = minutes(s.startTime) - t;
    if (until > lead) continue;
    const docs = await notifyUsers(
      [recipient],
      {
        type: 'timetable',
        title: `${substitute ? 'Substitute class' : 'Next class'} in ${until} min`,
        message: `P${s.period} · ${s.subject?.code || ''} – ${s.subject?.name || ''} · ${s.department} Year ${s.year}${s.section ? ` Sec ${s.section}` : ''}${s.room ? ` · ${s.room}` : ''} · ${to12h(s.startTime)}`,
        link: '/attendance',
      },
      { category: 'reminder', eventKey: `reminder:${s._id}:${dayKey(day)}` }
    );
    sent += docs.length;
  }
  return sent;
}

let digestDoneFor = null; // this instance already ran today's digest (eventKey also dedupes across instances)

export async function runDailyDigest(now = clock.now(), digestTime = process.env.DIGEST_TIME || '17:30', { force = false } = {}) {
  const p = campusParts(now);
  if (p.weekday === 'sunday' || p.time < digestTime) return false;
  const day = toDay(now);
  const key = dayKey(day);
  if (digestDoneFor === key && !force) return false;
  digestDoneFor = key;

  const [staff, daily, slotFaculty, totals, students] = await Promise.all([
    User.find({ role: { $in: ['faculty', 'hod'] }, isActive: true }).select('department').lean(),
    FacultyAttendance.find({ date: day }).distinct('faculty'),
    TimetableSlot.find({ dayOfWeek: p.weekday, isActive: true, isBreak: { $ne: true } }).distinct('faculty'),
    studentTotals(resolveRange({ range: 'semester' }).from),
    User.find({ role: { $in: ['student', 'club_admin'] }, isActive: true }).select('department year').lean(),
  ]);
  const marked = new Set(daily.map(String));
  const scheduled = new Set(slotFaculty.map(String));
  const unmarkedByDept = new Map();
  for (const s of staff) {
    if (!scheduled.has(String(s._id)) || marked.has(String(s._id))) continue;
    unmarkedByDept.set(s.department, (unmarkedByDept.get(s.department) || 0) + 1);
  }
  const lowByDept = new Map();
  for (const s of students) {
    const t = totals.get(String(s._id));
    if (!t || !t.total || (t.present / t.total) * 100 >= 75) continue;
    const k = s.year === 1 ? 'year1' : s.department;
    lowByDept.set(k, (lowByDept.get(k) || 0) + 1);
  }

  const hods = await User.find({ role: 'hod', isActive: true }).select('department').lean();
  for (const h of hods) {
    const fy = h.department === 'Science & Humanities';
    const unmarked = unmarkedByDept.get(h.department) || 0;
    const low = fy ? lowByDept.get('year1') || 0 : lowByDept.get(h.department) || 0;
    if (!unmarked && !low) continue;
    await notifyUsers([h._id], {
      type: 'attendance',
      title: 'Today’s attendance exceptions',
      message: `${unmarked} staff scheduled today have no attendance record · ${low} student(s) below 75 %.`,
      link: '/attendance?tab=staff',
    }, { category: 'staff', eventKey: `digest:${key}` });
  }
  const collegeUnmarked = [...unmarkedByDept.values()].reduce((a, b) => a + b, 0);
  const collegeLow = [...lowByDept.values()].reduce((a, b) => a + b, 0);
  const leaders = await User.find({ role: { $in: ['principal', 'office'] }, isActive: true }).distinct('_id');
  await notifyUsers(leaders, {
    type: 'attendance',
    title: 'College attendance summary',
    message: `${collegeLow} student(s) below 75 % · ${collegeUnmarked} scheduled staff without an attendance record today.`,
    link: '/attendance',
  }, { category: 'attendance', eventKey: `digest:${key}` });
  return true;
}

/** Start the minute ticker (server start). */
export function startReminders() {
  registerJob('reminders.tick', { intervalMs: 60_000, description: 'Next-period reminders' });
  registerJob('reminders.digest', { intervalMs: 60_000, description: 'Daily attendance digest check' });
  const tick = () => {
    runJob('reminders.tick', runReminderTick, { logTag: '[reminders] tick' });
    runJob('reminders.digest', runDailyDigest, { logTag: '[reminders] digest' });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return timer;
}
