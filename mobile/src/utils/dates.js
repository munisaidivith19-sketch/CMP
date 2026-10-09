// Pure calendar-date helpers (no React Native imports, so they can be unit-tested with node).

const pad = (n) => String(n).padStart(2, '0');

/**
 * "YYYY-MM-DD" for the calendar day the user sees on their phone.
 * Never use toISOString() for this: it converts to UTC, so a date picked
 * between midnight and 5:30 AM in India would be sent as the previous day.
 */
export const dateKey = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');

/**
 * OD / Leave cut-off hint, same rule as the server (which enforces it):
 * the start day must be at least tomorrow, and a request for tomorrow must
 * be sent before 5:00 PM today.
 */
export function odLeaveCutoff(fromKey, now = new Date()) {
  if (!fromKey) return null;
  const [y, m, d] = fromKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((start - todayStart) / 86400000);
  if (diffDays <= 0) return { type: 'danger', message: 'Requests cannot be made for today or past dates — apply at least 1 day in advance, before 5:00 PM.' };
  if (diffDays === 1) {
    return now.getHours() >= 17
      ? { type: 'danger', message: 'The 5:00 PM cut-off for tomorrow has passed.' }
      : { type: 'warning', message: 'Requests for tomorrow must be sent before 5:00 PM today.' };
  }
  return null;
}
