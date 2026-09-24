import { format, formatDistanceToNowStrict, isSameDay, isToday, isTomorrow } from 'date-fns';

export const fmtDate = (d, pattern = 'dd MMM yyyy') => (d ? format(new Date(d), pattern) : '');
export const fmtTime = (d) => (d ? format(new Date(d), 'h:mm a') : '');
export const fmtDateTime = (d) => (d ? format(new Date(d), 'dd MMM yyyy · h:mm a') : '');

export const timeAgo = (d) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : '');

export function friendlyDay(d) {
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, dd MMM');
}

export function eventRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return isSameDay(s, e)
    ? `${format(s, 'EEE, dd MMM')} · ${format(s, 'h:mm a')} – ${format(e, 'h:mm a')}`
    : `${format(s, 'dd MMM, h:mm a')} → ${format(e, 'dd MMM, h:mm a')}`;
}

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

export const titleCase = (s = '') => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Extract a readable message from an RTK Query error. */
export const errMsg = (err, fallback = 'Something went wrong') =>
  err?.data?.message || err?.error || (err?.status === 'FETCH_ERROR' ? 'Cannot reach the server' : fallback);

/** Convert a Date to the value format <input type="datetime-local"> expects. */
export const toLocalInput = (d) => (d ? format(new Date(d), "yyyy-MM-dd'T'HH:mm") : '');

/** Class days (attendance dates) are calendar dates stored as UTC midnight — format the date itself, not a local instant. */
export const fmtClassDay = (d, pattern = 'dd MMM yyyy') => (d ? format(new Date(`${String(d).slice(0, 10)}T00:00:00`), pattern) : '');
export const todayKey = () => format(new Date(), 'yyyy-MM-dd');
