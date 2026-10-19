/**
 * Per-student attendance totals (present / conducted periods) over a date
 * window, fast enough for live dashboards.
 *
 * Adding up a whole semester for the whole college reads hundreds of
 * thousands of records, and every live `attendance:updated` event makes each
 * open dashboard ask again. But only TODAY changes during the day, so:
 *
 *   totals = cached totals of the earlier days of the window
 *          + today's records, aggregated fresh on every call.
 *
 * The cached part is dropped whenever attendance is written for an earlier
 * date (admin edits, approved corrections, OD / leave, event marks — every
 * write path announces itself through attendanceLive), when the day rolls
 * over, and after PAST_TTL_MS at the latest (so a second server instance,
 * which cannot see this one's writes, is never stale for longer than that).
 * The result is therefore always exact on the instance that took the write.
 */
import AttendanceRecord from '../models/AttendanceRecord.js';
import { resolveRange, today } from '../utils/dates.js';

const PAST_TTL_MS = 5 * 60 * 1000;
const PRESENT = ['present', 'od'];
const attended = { $sum: { $cond: [{ $in: ['$status', PRESENT] }, 1, 0] } };

let past = null; // { key, at, promise }

/** Attendance for a date before today was written: the cached past totals are stale. */
export function pastAttendanceChanged(day) {
  if (!day || new Date(day).getTime() < today().getTime()) past = null;
}

async function aggregate(dateMatch) {
  const rows = await AttendanceRecord.aggregate([
    { $match: { date: dateMatch } },
    // Only indexed fields, so the student_date_status index can serve it.
    { $project: { _id: 0, student: 1, status: 1 } },
    { $group: { _id: '$student', total: { $sum: 1 }, present: attended } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total, present: r.present }]));
}

/** Build the semester cache in the background (server start); never throws. */
export function warmAttendanceTotals() {
  studentTotals(resolveRange({ range: 'semester' }).from).catch((err) => console.error('[attendance] totals warm-up failed:', err.message));
}

/**
 * Map of student id → { total, present } over `from`…today (class-day values),
 * for every student with records in it. Callers pick the students they need.
 */
export async function studentTotals(from) {
  const now = today();
  const key = `${from ? from.getTime() : 'all'}|${now.getTime()}`;
  if (!past || past.key !== key || Date.now() - past.at > PAST_TTL_MS) {
    const entry = { key, at: Date.now(), promise: null };
    entry.promise = aggregate({ ...(from ? { $gte: from } : {}), $lt: now }).catch((err) => {
      if (past === entry) past = null; // never cache a failure
      throw err;
    });
    past = entry;
  }
  const [before, todays] = await Promise.all([past.promise, aggregate(now)]);
  if (!todays.size) return before;
  const merged = new Map(before);
  for (const [id, t] of todays) {
    const b = merged.get(id);
    merged.set(id, b ? { total: b.total + t.total, present: b.present + t.present } : t);
  }
  return merged;
}
