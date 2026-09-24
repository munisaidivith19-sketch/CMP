import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

export const fmtDate = (d, p = 'dd MMM yyyy') => (d ? format(new Date(d), p) : '');
export const fmtTime = (d) => (d ? format(new Date(d), 'h:mm a') : '');
export const fmtDateTime = (d) => (d ? format(new Date(d), 'dd MMM, h:mm a') : '');
export const timeAgo = (d) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : '');
/** Attendance days are calendar dates stored as UTC midnight. */
export const fmtClassDay = (d, p = 'EEE, dd MMM') => (d ? format(new Date(`${String(d).slice(0, 10)}T00:00:00`), p) : '');
export const titleCase = (s = '') => String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const listTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'dd MMM');
};
export const to12h = (t = '') => {
  const [h, m] = t.split(':').map(Number);
  return Number.isNaN(h) ? t : `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);
