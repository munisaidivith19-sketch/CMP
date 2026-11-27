import AttendanceFlow, { ATTENDANCE_FLOWS } from '../models/AttendanceFlow.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import AttendanceSession from '../models/AttendanceSession.js';
import PeriodCover from '../models/PeriodCover.js';
import TimetableSlot from '../models/TimetableSlot.js';
import User from '../models/User.js';
import { ApiError } from '../utils/http.js';
import { addDays, campusParts, dayKey, toDay, weekdayOf } from '../utils/dates.js';
import { clock } from '../utils/clock.js';
import { examPlan, timesOverlap } from './exams.js';
import { ensureSession } from './attendanceSessions.js';
import { yearOfSemester } from '../constants.js';
import { STUDENT_ROLES } from '../utils/academicScope.js';

/**
 * Attendance flow (chosen college-wide by the Principal):
 *
 *  - PERIOD-WISE (default): unchanged — every period is taken by its own
 *    faculty while it runs.
 *  - DAY-WISE: the class's first held period of the day (the "morning
 *    period") is taken as usual, and every student's status is copied to all
 *    the class's other periods that day. Other periods cannot be taken live;
 *    each period's faculty can correct their own period from 3:00 PM on the
 *    class day until 3:00 PM the next day, and the HOD from the class day
 *    until 3:00 PM two days later. A corrected period is never overwritten
 *    by a later copy.
 *
 * A change made by the Principal starts on the next class day, so a day is
 * never half one flow and half the other.
 */

const DOC_ID = 'attendance-flow';
export const FLOWS = ATTENDANCE_FLOWS;
/** Corrections open at this campus time on the class day. */
export const DAY_WISE_EDIT_FROM = '15:00';
/** Source tag on a record copied from the morning period (still untouched by a person). */
export const DAY_WISE_COPY = 'DAY_WISE_COPY';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's campus class day and time ("HH:mm"). */
export function campusToday() {
  const now = clock.now();
  return { day: toDay(now), time: campusParts(now).time };
}

async function history() {
  const doc = await AttendanceFlow.findById(DOC_ID).lean();
  return [...(doc?.history || [])].sort((a, b) => new Date(a.from) - new Date(b.from) || new Date(a.setAt) - new Date(b.setAt));
}

/** The flow that applies to class day `day`, from a sorted history. */
export function flowOn(list, day) {
  let flow = 'period';
  for (const h of list) if (new Date(h.from).getTime() <= day.getTime()) flow = h.flow;
  return flow;
}

/** The flow that applies to class day `day`. */
export async function flowFor(day) {
  return flowOn(await history(), day);
}

/** What the Attendance Flow screen shows. */
export async function flowState() {
  const list = await history();
  const { day } = campusToday();
  const tomorrow = addDays(day, 1);
  const current = flowOn(list, day);
  const next = flowOn(list, tomorrow);
  const ids = [...new Set(list.map((h) => String(h.setBy || '')).filter(Boolean))];
  const names = Object.fromEntries((await User.find({ _id: { $in: ids } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  return {
    current,
    today: dayKey(day),
    // A change waiting to start tomorrow.
    upcoming: next !== current ? { flow: next, from: dayKey(tomorrow) } : null,
    rules: { editFrom: DAY_WISE_EDIT_FROM, facultyHours: 24, hodHours: 48 },
    history: list
      .slice(-10)
      .reverse()
      .map((h) => ({ flow: h.flow, from: dayKey(new Date(h.from)), setAt: h.setAt, setBy: h.setBy ? { _id: h.setBy, name: names[String(h.setBy)] || null } : null })),
  };
}

/**
 * Choose the flow. It starts on the next class day; choosing again the same
 * day replaces that pending choice. Returns whether anything changed.
 */
export async function setFlow(flow, user) {
  if (!FLOWS.includes(flow)) throw new ApiError(422, 'Choose period-wise or day-wise attendance');
  const list = await history();
  const { day } = campusToday();
  const from = addDays(day, 1);
  // Already what tomorrow will use: nothing to do.
  if (flowOn(list, from) === flow) return { changed: false, from };
  // Drop any pending (not yet started) choice; then add this one unless it is
  // simply going back to the flow that applies today.
  const kept = list.filter((h) => new Date(h.from).getTime() < from.getTime());
  const next = flowOn(kept, from) === flow ? kept : [...kept, { flow, from, setBy: user._id, setAt: new Date() }];
  await AttendanceFlow.updateOne({ _id: DOC_ID }, { $set: { history: next } }, { upsert: true });
  return { changed: true, from };
}

// ── Edit windows (day-wise only) ───────────────────────────────────

/** Whole class days between `day` and today (0 = today). */
export function daysSince(day, now = campusToday()) {
  return Math.round((now.day.getTime() - day.getTime()) / DAY_MS);
}

const fmt12 = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const EDIT_FROM_12 = fmt12(DAY_WISE_EDIT_FROM);

/** Faculty correction window: 3:00 PM on the class day → 3:00 PM the next day. */
export function facultyWindowOpen(day, now = campusToday()) {
  const d = daysSince(day, now);
  return (d === 0 && now.time >= DAY_WISE_EDIT_FROM) || (d === 1 && now.time < DAY_WISE_EDIT_FROM);
}

/** HOD window: the class day itself → 3:00 PM two days later (48 hours from 3:00 PM). */
export function hodWindowOpen(day, now = campusToday()) {
  const d = daysSince(day, now);
  return d === 0 || d === 1 || (d === 2 && now.time < DAY_WISE_EDIT_FROM);
}

export const dayWiseMessages = {
  waitForCorrection: `Day-wise attendance: this period is filled from the morning attendance. You can correct it from ${EDIT_FROM_12} today until ${EDIT_FROM_12} tomorrow.`,
  morningEnded: `The morning period has ended. You can correct today's attendance from ${EDIT_FROM_12} today until ${EDIT_FROM_12} tomorrow.`,
  facultyClosed: `The correction window for this day has closed (faculty can edit until ${EDIT_FROM_12} the next day).`,
  hodClosed: `The HOD correction window for this day has closed (until ${EDIT_FROM_12} two days after the class).`,
};

// ── The class's day: morning period and the periods it fills ───────

/**
 * The class's held periods on `day`, in time order, each with its window
 * (the session snapshot when one exists). Periods recorded as Class Not
 * Conducted and periods blocked by a published exam are not held. The
 * morning period(s) are the held ones at the earliest start time (more than
 * one when the class splits into parallel subjects, e.g. electives).
 */
export async function classDayPlan(cls, day) {
  const slots = await TimetableSlot.find({
    isActive: true,
    isBreak: { $ne: true },
    department: cls.department,
    section: String(cls.section || '').toUpperCase(),
    year: cls.year ?? yearOfSemester(cls.semester),
    ...(cls.semester != null ? { semester: cls.semester } : {}),
    dayOfWeek: weekdayOf(day),
  })
    .populate('subject', 'name code department semester year sections isActive')
    .lean();
  if (!slots.length) return { held: [], morning: [] };
  const ids = slots.map((s) => s._id);
  const [sessions, notConducted, plan] = await Promise.all([
    AttendanceSession.find({ timetableSlot: { $in: ids }, date: day }).lean(),
    PeriodCover.find({ timetableSlot: { $in: ids }, date: day, status: 'active', kind: 'not_conducted' }).distinct('timetableSlot'),
    examPlan(cls, day),
  ]);
  const sessionOf = Object.fromEntries(sessions.map((s) => [String(s.timetableSlot), s]));
  const nc = new Set(notConducted.map(String));
  const exams = plan.map((p) => p.exam);
  const held = slots
    .map((slot) => {
      const session = sessionOf[String(slot._id)] || null;
      const w = session || slot;
      return { slot, session, startTime: w.startTime, endTime: w.endTime, period: w.period };
    })
    .filter((p) => p.slot.subject && !nc.has(String(p.slot._id)) && !exams.some((e) => timesOverlap(e, p)))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.period - b.period);
  const first = held[0]?.startTime;
  return { held, morning: held.filter((p) => p.startTime === first) };
}

/** Is `slotId` one of the plan's morning periods? */
export const isMorningSlot = (plan, slotId) => plan.morning.some((p) => String(p.slot._id) === String(slotId));

function rosterOf(subject, section) {
  const filter = { role: { $in: STUDENT_ROLES }, isActive: true, department: subject.department };
  if (section) filter.section = section;
  if (subject.semester) {
    filter.year = subject.year ?? yearOfSemester(subject.semester);
    filter.semester = { $in: [subject.semester, null] };
  }
  return filter;
}

/**
 * Copy the morning attendance to every other held period of the class that
 * day. Each student gets their morning status in each period they belong to.
 * Only missing records and earlier copies are written: a period a person has
 * corrected is never overwritten. Sessions are created before the write;
 * `txn` (optional) is the caller's transaction for the record writes.
 *
 * Returns the number of records written and the student ids touched.
 */
export async function prepareDayWiseCopy(plan, day, user) {
  const morningIds = plan.morning.map((p) => p.session?._id).filter(Boolean);
  const morningSlotIds = new Set(plan.morning.map((p) => String(p.slot._id)));
  const targets = plan.held.filter((p) => !morningSlotIds.has(String(p.slot._id)));
  if (!targets.length) return null;
  return { targets, morningIds, day, user };
}

export async function applyDayWiseCopy(prepared, { txn } = {}) {
  if (!prepared) return { written: 0, students: [] };
  const { targets, day, user } = prepared;
  // The morning status of each student: the record of whichever morning
  // period they belong to (an elective student is in only one of them).
  const morningRecords = await AttendanceRecord.find({
    date: day,
    session: { $in: prepared.morningIds },
  })
    .select('student status session')
    .session(txn || null)
    .lean();
  if (!morningRecords.length) return { written: 0, students: [] };
  const statusOf = new Map(morningRecords.map((r) => [String(r.student), r.status]));
  const copiedFrom = new Map(morningRecords.map((r) => [String(r.student), r.session]));

  const now = new Date();
  const ops = [];
  const touched = new Set();
  for (const t of targets) {
    const subject = t.slot.subject;
    const section = t.session?.section || t.slot.section;
    const period = t.period;
    const session = await ensureSession({ slot: t.slot, session: t.session, subject, day }, user);
    const roster = (await User.find({ ...rosterOf(subject, section), _id: { $in: [...statusOf.keys()] } }).distinct('_id')).map(String);
    if (!roster.length) continue;
    const existing = await AttendanceRecord.find({ subject: subject._id, date: day, period, student: { $in: roster } })
      .select('student status source')
      .session(txn || null)
      .lean();
    const prev = new Map(existing.map((r) => [String(r.student), r]));
    for (const id of roster) {
      const status = statusOf.get(id);
      const rec = prev.get(id);
      if (rec && rec.source !== DAY_WISE_COPY) continue; // a person set this period — keep it
      if (rec && rec.status === status) continue;
      touched.add(id);
      if (rec) {
        ops.push({
          updateOne: {
            filter: { _id: rec._id, source: DAY_WISE_COPY },
            update: { $set: { status, markedBy: user._id, markedAt: now, copiedFrom: copiedFrom.get(id) } },
          },
        });
      } else {
        ops.push({
          updateOne: {
            filter: { student: id, subject: subject._id, date: day, period },
            // A record a person created meanwhile matches the filter and is left as is.
            update: {
              $setOnInsert: {
                student: id,
                subject: subject._id,
                date: day,
                period,
                department: subject.department,
                ...(section ? { section } : {}),
                ...(session ? { session: session._id } : {}),
                status,
                markedBy: user._id,
                markedAt: now,
                source: DAY_WISE_COPY,
                copiedFrom: copiedFrom.get(id),
              },
            },
            upsert: true,
          },
        });
      }
    }
  }
  if (ops.length) await AttendanceRecord.bulkWrite(ops, { ordered: false, session: txn || undefined });
  return { written: ops.length, students: [...touched], periods: targets.length };
}
