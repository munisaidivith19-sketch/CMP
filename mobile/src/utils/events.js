// Pure event-attendance helpers (no React Native imports, so they can be unit-tested with node).
import { dateKey } from './dates.js';

/** Every calendar day the event runs (at most 30), as YYYY-MM-DD in the phone's time zone. */
export function eventDays(startDate, endDate) {
  if (!startDate) return [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate || startDate);
  end.setHours(0, 0, 0, 0);
  const days = [];
  for (const d = new Date(start); d <= end && days.length < 30; d.setDate(d.getDate() + 1)) days.push(dateKey(d));
  return days.length ? days : [dateKey(new Date(startDate))];
}

/** A participant's state on one event day: attended / absent / pending / waitlisted. */
export function statusOnDay(reg, day) {
  if (reg.status === 'waitlisted') return 'waitlisted';
  const rec = (reg.attendanceDays || []).find((d) => d.date === day);
  if (rec) return rec.attended ? 'attended' : 'absent';
  return reg.status === 'attended' ? 'attended' : 'pending';
}
