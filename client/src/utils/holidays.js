import { fmtClassDay } from './format';

// Display helpers only. Which holidays apply to whom is decided by the server
// (GET /holidays already returns just the ones this viewer may see).

/** Holidays whose range (YYYY-MM-DD strings, inclusive) covers `key`. */
export const holidaysOn = (holidays = [], key) => holidays.filter((h) => h.startDate <= key && h.endDate >= key);

export const fmtHolidayDates = (h) =>
  h.startDate === h.endDate ? fmtClassDay(h.startDate) : `${fmtClassDay(h.startDate)} – ${fmtClassDay(h.endDate)}`;
