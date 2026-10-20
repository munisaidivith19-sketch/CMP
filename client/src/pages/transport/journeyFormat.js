/**
 * Display helpers for server-recorded bus journeys (pure — no DOM, no React;
 * tested in client/tests/journeyFormat.test.mjs).
 *
 * The server sends every time as UTC ISO; these show it on the CAMPUS clock
 * (Asia/Kolkata unless the server says otherwise), whatever timezone the
 * viewer's device is set to. Predictions and recorded (actual) times are
 * always labelled differently.
 */

export const CAMPUS_TZ = 'Asia/Kolkata';

const fmt = (opts, tz) => new Intl.DateTimeFormat('en-IN', { timeZone: tz || CAMPUS_TZ, ...opts });

/** "7:42 am" on the campus clock; '' for no time. */
export function campusTime(iso, tz) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt({ hour: 'numeric', minute: '2-digit', hour12: true }, tz).format(d).toLowerCase();
}

/** "20 Oct 2026" on the campus calendar. */
export function campusDate(iso, tz) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt({ day: '2-digit', month: 'short', year: 'numeric' }, tz).format(d);
}

/** "20 Oct 2026, 7:42 am". */
export const campusDateTime = (iso, tz) => (iso ? `${campusDate(iso, tz)}, ${campusTime(iso, tz)}` : '');

/** YYYY-MM-DD of "today" on the campus calendar (for date filters). */
export function campusDayKey(date = new Date(), tz) {
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const DIRECTION_LABEL = { towards_college: 'Towards college', towards_home: 'Towards home' };
export const directionText = (j) => (j?.direction ? `${DIRECTION_LABEL[j.direction] || j.direction}${j.directionAssumed ? ' (assumed)' : ''}` : '');

export const METHOD_LABEL = {
  history: 'from earlier recorded trips',
  recent_speed: 'from the bus’s recent speed',
  assumed_speed: 'assumed average speed — approximate',
};

/** "about 6 min · 7:48 am" (approximate when the server says so); the reason when unavailable. */
export function etaLine(eta, tz) {
  if (!eta) return '';
  if (eta.status !== 'ok') return eta.reason || 'ETA unavailable';
  const mins = eta.minutes <= 0 ? 'arriving now' : `about ${eta.minutes} min`;
  return `${eta.approximate ? '~' : ''}${mins} · ${eta.approximate ? '~' : ''}${campusTime(eta.predictedArrivalAt, tz)}`;
}

/** What a stop row says, keeping recorded and predicted times apart. */
export function stopLine(stop, tz) {
  switch (stop.status) {
    case 'departed':
      return stop.actualDepartureAt
        ? `Arrived ${campusTime(stop.actualArrivalAt, tz)} · left ${campusTime(stop.actualDepartureAt, tz)}`
        : `Arrived ${campusTime(stop.actualArrivalAt, tz)}`;
    case 'arrived':
      return `At the stop since ${campusTime(stop.actualArrivalAt, tz)}`;
    case 'not_recorded':
      return stop.notRecordedReason === 'before_tracking' ? 'Passed before tracking started' : 'Passed — arrival not detected';
    default:
      return stop.eta ? `Expected ${etaLine(stop.eta, tz)}` : 'Upcoming';
  }
}

export const SOURCE_LABEL = { gps: 'GPS', manual: 'Recorded by staff', system: 'System' };

/** "+3 min late" / "2 min early" / "on time" against a real timetable (null when there is none). */
export function delayText(minutes, toleranceMinutes = 0) {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const m = Math.round(minutes);
  if (Math.abs(m) <= toleranceMinutes) return 'on time';
  return m > 0 ? `${m} min late` : `${-m} min early`;
}

/** Passed stop sequences of the route drawn on the map, from the journey (by stop id). */
export function passedFromJourney(journey, routeStops) {
  if (!journey?.stops?.length || !routeStops?.length) return null;
  const done = new Set(journey.stops.filter((s) => ['departed', 'arrived', 'not_recorded'].includes(s.status)).map((s) => String(s.stopId)));
  return routeStops.filter((s) => done.has(String(s._id))).map((s) => s.sequence);
}

export const TRIP_STATUS_LABEL = { active: 'In progress', completed: 'Completed', stopped: 'Stopped early', timeout: 'Ended — no GPS' };

/**
 * A `datetime-local` value ("2026-10-20T07:42"), read as campus wall-clock
 * time, as a UTC ISO string — whatever timezone the browser is in.
 */
export function campusLocalToIso(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local || ''));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(
    fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz)
      .formatToParts(new Date(guess))
      .map((x) => [x.type, Number(x.value)])
  );
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offset).toISOString();
}
