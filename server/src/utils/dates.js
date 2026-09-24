import { env } from '../config/env.js';
import { ApiError } from './http.js';

const DAY_MS = 86400000;
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Calendar parts of `date` as seen on the campus clock (APP_TIMEZONE). */
export function campusParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday.toLowerCase(),
  };
}

/**
 * A class day is stored as UTC midnight of its campus calendar date, so the
 * same day always maps to the same value whatever the server's timezone is.
 * Accepts 'YYYY-MM-DD' or any ISO timestamp.
 */
export function toDay(value) {
  if (value instanceof Date || /T/.test(String(value))) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ApiError(422, 'Invalid date');
    return new Date(`${campusParts(d).dateKey}T00:00:00.000Z`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) throw new ApiError(422, 'Invalid date');
  const d = new Date(`${m[0]}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(422, 'Invalid date');
  return d;
}

export const today = () => toDay(new Date());
export const addDays = (day, n) => new Date(day.getTime() + n * DAY_MS);
export const weekdayOf = (day) => WEEKDAY_NAMES[day.getUTCDay()];
export const dayKey = (day) => day.toISOString().slice(0, 10);

/**
 * Resolve a reporting window from query params.
 * range = day | week | month | semester | all | custom (with from / to).
 * Returns { from, to } as class-day values (inclusive), or {} for "all".
 */
export function resolveRange(query = {}, fallback = 'month') {
  const range = query.range || (query.from || query.to ? 'custom' : fallback);
  const end = today();
  switch (range) {
    case 'all':
      return {};
    case 'day':
      return { from: end, to: end, range };
    case 'week':
      return { from: addDays(end, -6), to: end, range };
    case 'month':
      return { from: addDays(end, -29), to: end, range };
    case 'semester':
      return { from: addDays(end, -179), to: end, range };
    case 'custom': {
      const from = query.from ? toDay(query.from) : undefined;
      const to = query.to ? toDay(query.to) : end;
      if (from && from > to) throw new ApiError(422, '"From" must be before "to"');
      return { from, to, range };
    }
    default:
      throw new ApiError(422, 'Unknown range');
  }
}

/** Mongo filter for a class-day field from resolveRange output. */
export function dayFilter({ from, to } = {}) {
  if (!from && !to) return undefined;
  const f = {};
  if (from) f.$gte = from;
  if (to) f.$lte = to;
  return f;
}

/** Milliseconds the campus clock is ahead of UTC at `instant`. */
function campusOffsetMs(instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: env.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((x) => [x.type, Number(x.value)])
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The real instant a campus class-day begins (e.g. 00:00 IST = 18:30 UTC the day before). */
export const campusDayStart = (day) => new Date(day.getTime() - campusOffsetMs(day));

/** Mongo filter for a timestamp field (createdAt etc.) covering whole campus days. */
export function timestampFilter({ from, to } = {}) {
  if (!from && !to) return undefined;
  const f = {};
  if (from) f.$gte = campusDayStart(from);
  if (to) f.$lt = campusDayStart(addDays(to, 1));
  return f;
}

/** Campus-timezone string for $dateToString / $dateTrunc on timestamp fields. */
export const campusTimezone = () => env.timezone;
