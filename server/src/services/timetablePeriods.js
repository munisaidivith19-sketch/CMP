import TimetableSlot from '../models/TimetableSlot.js';
import { ApiError } from '../utils/http.js';

/**
 * Period numbering for a class day (department + section + semester + weekday).
 *
 * Only classes are periods: P1, P2, P3… follow the start times of the day's
 * class slots. A break (lunch, recess) is never a period — it does not take a
 * number that a class would otherwise use, and nothing shows a number for it.
 *
 * The unique index on TimetableSlot still needs a `period` value on every
 * active slot, so a break is stored with a spare key counted down from the top
 * (12, 11, …). Those keys are internal and never displayed.
 */

export const MAX_PERIOD = 12;

const classDayOf = (slot) => ({
  isActive: true,
  department: slot.department,
  section: slot.section,
  semester: slot.semester,
  dayOfWeek: slot.dayOfWeek,
});

async function othersOnDay(slot, excludeId) {
  const filter = classDayOf(slot);
  if (excludeId) filter._id = { $ne: excludeId };
  return TimetableSlot.find(filter).select('period startTime endTime isBreak').lean();
}

/**
 * The spare key a break is stored under: the highest number nothing else on
 * the day uses. Whatever number the client sent is ignored, so a break can
 * never sit on a number the next class would take. An existing break (its
 * own id excluded) keeps its key when that is already the highest free one.
 */
export async function spareBreakPeriod(slot, excludeId) {
  const used = new Set((await othersOnDay(slot, excludeId)).map((s) => s.period));
  for (let p = MAX_PERIOD; p >= 1; p -= 1) if (!used.has(p)) return p;
  throw new ApiError(422, 'This day has no room for another break');
}

/**
 * The period number for a class slot that was sent without one: one more than
 * the last class before it. It must still fit below the next class, so an
 * existing free period (a gap in the numbers) is never renumbered.
 */
export async function suggestClassPeriod(slot, excludeId) {
  const classes = (await othersOnDay(slot, excludeId)).filter((s) => !s.isBreak);
  const before = classes.filter((s) => s.startTime < slot.startTime).map((s) => s.period);
  const after = classes.filter((s) => s.startTime > slot.startTime).map((s) => s.period);
  const period = Math.max(0, ...before) + 1;
  if (period > MAX_PERIOD || (after.length && period >= Math.min(...after))) {
    throw new ApiError(422, 'No period number is free at this time — enter the period number');
  }
  return period;
}

const label = (s) => `P${s.period} (${s.startTime}–${s.endTime})`;

/**
 * A class slot's number must be unique on its day and follow the time order:
 * an earlier class always has a smaller number. Breaks take no part.
 */
export async function assertPeriodOrder(slot, excludeId) {
  if (slot.isBreak) return;
  const classes = (await othersOnDay(slot, excludeId)).filter((s) => !s.isBreak);
  const day = slot.dayOfWeek.charAt(0).toUpperCase() + slot.dayOfWeek.slice(1);
  const same = classes.find((s) => s.period === slot.period);
  if (same) throw new ApiError(409, `Period ${slot.period} already exists on ${day} — ${label(same)}`);
  const outOfOrder = classes.find((s) => (s.startTime < slot.startTime) !== (s.period < slot.period));
  if (outOfOrder) {
    throw new ApiError(
      422,
      `Period numbers must follow the time order on ${day}: ${label(outOfOrder)} cannot come ${outOfOrder.period < slot.period ? 'before' : 'after'} P${slot.period} at ${slot.startTime}`
    );
  }
}

/**
 * Repair class days saved before breaks stopped counting as periods, e.g.
 * P1 P2 P3 [Break P4] P5 P6 → P1 P2 P3 [Break] P4 P5. A class loses one
 * number for every break that sits before it in both time and number; a
 * genuine free period (a number no slot uses) is left alone. Breaks move to
 * spare keys. Idempotent: an already-correct day is not touched.
 *
 * Writes go through updateOne in an order that never collides with the
 * unique index: breaks first (to keys no class uses before or after), then
 * classes from the earliest, each only ever moving down into a freed number.
 *
 * Returns { days, slots } — how many class days and slots were renumbered.
 */
export async function normaliseBreakPeriods({ dryRun = false, log = () => {} } = {}) {
  const breakDays = await TimetableSlot.aggregate([
    { $match: { isActive: true, isBreak: true } },
    { $group: { _id: { department: '$department', section: '$section', semester: '$semester', dayOfWeek: '$dayOfWeek' } } },
  ]);
  let days = 0;
  let moved = 0;
  for (const { _id: day } of breakDays) {
    const slots = await TimetableSlot.find({ isActive: true, ...day }).select('period startTime endTime isBreak').sort({ startTime: 1 }).lean();
    const breaks = slots.filter((s) => s.isBreak);
    const classes = slots.filter((s) => !s.isBreak);
    const target = new Map(
      classes.map((c) => [String(c._id), c.period - breaks.filter((b) => b.period < c.period && b.startTime < c.startTime).length])
    );
    const classNums = new Set([...classes.map((c) => c.period), ...target.values()]);
    const topClass = Math.max(0, ...target.values());
    const breakTarget = new Map();
    const taken = new Set([...classNums, ...breaks.map((b) => b.period)]);
    let ok = true;
    for (const b of breaks) {
      if (b.period > topClass && !classNums.has(b.period)) continue; // already a spare key
      let spare = MAX_PERIOD;
      while (spare >= 1 && taken.has(spare)) spare -= 1;
      if (spare < 1 || spare <= topClass) {
        ok = false;
        break;
      }
      taken.add(spare);
      breakTarget.set(String(b._id), spare);
    }
    const classMoves = classes.filter((c) => target.get(String(c._id)) !== c.period);
    if (!ok) {
      log(`[timetable] skipped ${day.department}-${day.section} sem ${day.semester} ${day.dayOfWeek}: no spare period key for its break(s)`);
      continue;
    }
    if (!breakTarget.size && !classMoves.length) continue;
    days += 1;
    moved += breakTarget.size + classMoves.length;
    const moves = classMoves.map((c) => `P${c.period}→P${target.get(String(c._id))}`).join(', ');
    log(`[timetable] ${day.department}-${day.section} sem ${day.semester} ${day.dayOfWeek}: ${moves || 'breaks re-keyed'}`);
    if (dryRun) continue;
    for (const [id, period] of breakTarget) await TimetableSlot.updateOne({ _id: id }, { $set: { period } });
    for (const c of classMoves) await TimetableSlot.updateOne({ _id: c._id }, { $set: { period: target.get(String(c._id)) } });
  }
  return { days, slots: moved };
}
