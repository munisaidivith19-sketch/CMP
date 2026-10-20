/**
 * Bus journeys: the live journey of a trip, its direction, manual stop
 * records, and journey history / reports.
 *
 * Who sees what:
 *  - live journey: anyone who may see the bus (services/transport/access.js),
 *    for its active trip or one that ended in the last few hours; no names,
 *    no GPS track;
 *  - history and reports: TRANSPORT_HISTORY_ROLES (transport managers,
 *    principal, dean, AO, chairman) for every bus; trip sharers for the trips
 *    they ran themselves. Students never;
 *  - manual stop records / corrections: transport managers only, with a
 *    reason, audited.
 * History holds stop-level times only — never the recorded GPS positions.
 * All times are UTC ISO strings; `timezone` names the campus zone clients
 * display them in.
 */
import mongoose from 'mongoose';
import Bus from '../models/Bus.js';
import BusStopEvent from '../models/BusStopEvent.js';
import BusTrip from '../models/BusTrip.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { sameId } from '../utils/permissions.js';
import { campusParts, campusTimezone, resolveRange, timestampFilter } from '../utils/dates.js';
import { TRANSPORT_HISTORY_ROLES, TRANSPORT_MANAGE_ROLES } from '../constants.js';
import { canViewBus } from '../services/transport/access.js';
import { transportConfig } from '../services/transport/config.js';
import { changeDirection, journeyView, recordManualEvent, scheduledAtFor } from '../services/transport/stopEvents.js';
import { tripApi } from '../services/transport/trips.js';

const RECENT_TRIP_MS = 6 * 3600000;
const isManager = (u) => TRANSPORT_MANAGE_ROLES.includes(u.role);
const seesAllHistory = (u) => TRANSPORT_HISTORY_ROLES.includes(u.role);
const ranTrip = (u, t) => sameId(t.sharedBy, u) || sameId(t.startedBy, u);
const minutesBetween = (a, b) => (a && b ? Math.round(((new Date(b) - new Date(a)) / 60000) * 10) / 10 : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

async function loadTrip(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(422, 'Invalid trip');
  const trip = await BusTrip.findById(id).lean();
  if (!trip) throw new ApiError(404, 'Trip not found');
  return trip;
}

// ── Live journey ───────────────────────────────────────────────────

export const getJourney = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);
  const privileged = seesAllHistory(req.user) || ranTrip(req.user, trip);
  const recent = trip.status === 'active' || (trip.endedAt && Date.now() - new Date(trip.endedAt) < RECENT_TRIP_MS);
  if (!(await canViewBus(req.user, trip.bus)) || (!recent && !privileged)) throw new ApiError(404, 'Trip not found');
  const bus = await Bus.findById(trip.bus).select('number lastLocation').lean();
  res.set('Cache-Control', 'no-store');
  res.json({ journey: await journeyView(trip, bus), bus: bus ? { _id: bus._id, number: bus.number } : null, timezone: campusTimezone(), serverTime: new Date().toISOString() });
});

/** Direction of an active trip, before any stop is recorded: the sharer, whoever started it, or a manager. */
export const setDirection = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);
  if (!ranTrip(req.user, trip) && !isManager(req.user)) throw new ApiError(403, 'You cannot change this trip');
  const updated = await changeDirection(trip._id, req.body.direction);
  logActivity(req, 'transport.trip_direction', { entityType: 'bus_trip', entityId: trip._id, summary: `${trip.direction || '—'} → ${updated.direction}` });
  res.json({ trip: tripApi(updated, req.user) });
});

/** Record a missing stop arrival / departure, or correct one (transport managers; reason required). */
export const recordStopEvent = asyncHandler(async (req, res) => {
  const { order, type, at, reason } = req.body;
  const { event, corrected } = await recordManualEvent(req.user, req.params.id, { order: Number(order), type, at, reason: String(reason).trim() });
  logActivity(req, corrected ? 'transport.stop_event_corrected' : 'transport.stop_event_recorded', {
    entityType: 'bus_trip',
    entityId: event.trip,
    summary: `${type} · stop ${event.order + 1} (${event.stopName || '—'}) at ${event.at.toISOString()}${corrected ? ` (was ${iso(event.correction?.previousAt)} ${event.correction?.previousSource})` : ''}`,
  });
  res.status(corrected ? 200 : 201).json({ event: eventApi(event, req.user), corrected });
});

// ── History ────────────────────────────────────────────────────────

function historyFilter(req) {
  const q = req.query;
  const filter = {};
  const range = timestampFilter(resolveRange(q, 'week'));
  if (range) filter.startedAt = range;
  if (q.bus) filter.bus = q.bus;
  if (q.route) filter.$or = [{ route: q.route }, { baseRoute: q.route }];
  if (q.direction) filter.direction = q.direction;
  if (q.status === 'interrupted') filter.status = { $in: ['stopped', 'timeout'] };
  else if (q.status) filter.status = q.status;
  // Sharers without history access: their own trips only.
  if (!seesAllHistory(req.user)) filter.$and = [{ $or: [{ sharedBy: req.user._id }, { startedBy: req.user._id }] }];
  return filter;
}

const operatorOf = (trip, viewer, names) => {
  const id = trip.sharedBy || trip.startedBy;
  if (sameId(id, viewer)) return { name: 'You', self: true };
  return seesAllHistory(viewer) ? { name: names.get(String(id)) || 'Unknown', role: null } : null;
};

function tripRow(t, viewer, names, counts) {
  const c = counts.get(String(t._id)) || { arrivals: 0, manual: 0 };
  const end = t.endedAt || null;
  return {
    _id: t._id,
    bus: t.bus ? { _id: t.bus._id, number: t.bus.number } : null,
    route: t.route ? { _id: t.route._id, name: t.route.name } : null,
    direction: t.direction || null,
    directionAssumed: Boolean(t.directionAssumed),
    status: t.status,
    interrupted: ['stopped', 'timeout'].includes(t.status) && !t.finalArrivalAt,
    source: t.source,
    campusDate: campusParts(new Date(t.startedAt)).dateKey,
    tripStartedAt: iso(t.startedAt),
    tripCompletedAt: t.status === 'completed' ? iso(end) : null,
    endedAt: iso(end),
    endReason: t.endReason || null,
    finalArrivalAt: iso(t.finalArrivalAt),
    collegeArrivedAt: iso(t.collegeArrivedAt),
    durationMinutes: minutesBetween(t.startedAt, end),
    stopsPlanned: t.plan?.length || 0,
    stopsRecorded: c.arrivals,
    manualRecords: c.manual,
    hasJourney: Boolean(t.plan?.length),
    operator: operatorOf(t, viewer, names),
  };
}

async function operatorNames(trips, viewer) {
  if (!seesAllHistory(viewer)) return new Map();
  const ids = [...new Set(trips.map((t) => String(t.sharedBy || t.startedBy)).filter(Boolean))];
  const users = await mongoose.model('User').find({ _id: { $in: ids } }).select('name').lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

export const listHistory = asyncHandler(async (req, res) => {
  const filter = historyFilter(req);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [total, trips] = await Promise.all([
    BusTrip.countDocuments(filter),
    BusTrip.find(filter).select('-tracker -deviceKeyHash').populate('bus', 'number').populate('route', 'name').sort({ startedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const agg = await BusStopEvent.aggregate([
    { $match: { trip: { $in: trips.map((t) => t._id) }, type: { $in: ['arrival', 'departure'] } } },
    { $group: { _id: '$trip', arrivals: { $sum: { $cond: [{ $eq: ['$type', 'arrival'] }, 1, 0] } }, manual: { $sum: { $cond: [{ $eq: ['$source', 'manual'] }, 1, 0] } } } },
  ]);
  const counts = new Map(agg.map((a) => [String(a._id), a]));
  const names = await operatorNames(trips, req.user);
  res.set('Cache-Control', 'no-store');
  res.json({ trips: trips.map((t) => tripRow(t, req.user, names, counts)), total, page, limit, timezone: campusTimezone(), scope: seesAllHistory(req.user) ? 'all' : 'own' });
});

function eventApi(e, viewer) {
  return {
    _id: e._id,
    type: e.type,
    order: e.order,
    stopName: e.stopName || null,
    at: iso(e.at),
    detectedAt: iso(e.detectedAt),
    source: e.source,
    ...(e.type === 'trip_ended' ? { endStatus: e.endStatus || null } : {}),
    gps: e.source === 'gps' ? { distanceM: e.distanceM ?? null, accuracyM: e.accuracy ?? null, fixes: e.fixes ?? null } : null,
    reason: e.source === 'manual' ? e.reason || null : null,
    corrected: Boolean(e.correction?.previousAt),
    ...(e.correction?.previousAt && (isManager(viewer) || seesAllHistory(viewer)) ? { previousAt: iso(e.correction.previousAt), previousSource: e.correction.previousSource } : {}),
  };
}

export const getHistoryTrip = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);
  if (!seesAllHistory(req.user) && !ranTrip(req.user, trip)) throw new ApiError(404, 'Trip not found');
  const [events, bus, route] = await Promise.all([
    BusStopEvent.find({ trip: trip._id }).sort({ at: 1 }).lean(),
    Bus.findById(trip.bus).select('number').lean(),
    trip.route ? mongoose.model('BusRoute').findById(trip.route).select('name').lean() : null,
  ]);
  const names = await operatorNames([trip], req.user);
  const byKey = new Map(events.map((e) => [`${e.type}:${e.order}`, e]));
  const missed = new Map((trip.tracker?.missed || []).map((m) => [m.order, m.reason]));
  let prevDeparture = null;
  const stops = (trip.plan || []).map((p, order) => {
    const arr = byKey.get(`arrival:${order}`);
    const dep = byKey.get(`departure:${order}`);
    const scheduledAt = arr?.scheduledAt || scheduledAtFor(trip, p);
    const row = {
      order,
      name: p.name,
      isCollege: Boolean(p.isCollege),
      scheduledAt: iso(scheduledAt),
      actualArrivalAt: iso(arr?.at),
      actualDepartureAt: iso(dep?.at),
      arrivalSource: arr?.source || null,
      departureSource: dep?.source || null,
      notRecorded: !arr ? missed.get(order) || (trip.status === 'active' ? 'pending' : 'not_detected') : null,
      // Measured: departure from the previous stop → arrival here; dwell at this stop.
      minutesFromPreviousStop: arr && prevDeparture ? minutesBetween(prevDeparture, arr.at) : null,
      dwellMinutes: arr && dep ? minutesBetween(arr.at, dep.at) : null,
      // The prediction in force before the arrival vs what happened (positive = later than predicted).
      predictedArrivalAt: iso(arr?.predictedArrivalAt),
      predictionErrorMinutes: arr?.predictedArrivalAt ? minutesBetween(arr.predictedArrivalAt, arr.at) : null,
      // Only against a real timetable (positive = late).
      delayMinutes: arr && scheduledAt ? minutesBetween(scheduledAt, arr.at) : null,
      arrival: arr ? eventApi(arr, req.user) : null,
      departure: dep ? eventApi(dep, req.user) : null,
    };
    if (dep) prevDeparture = dep.at;
    else if (arr) prevDeparture = null;
    return row;
  });
  const firstDeparture = events.find((e) => e.type === 'departure');
  const finalArrival = byKey.get(`arrival:${(trip.plan?.length || 0) - 1}`);
  res.set('Cache-Control', 'no-store');
  res.json({
    trip: {
      ...tripRow({ ...trip, bus, route }, req.user, names, new Map([[String(trip._id), { arrivals: events.filter((e) => e.type === 'arrival').length, manual: events.filter((e) => e.source === 'manual' && e.order >= 0).length }]])),
      routeMode: trip.routeMode || null,
      // Measured stop-to-stop journey: first departure → arrival at the final stop.
      journeyMinutes: firstDeparture && finalArrival ? minutesBetween(firstDeparture.at, finalArrival.at) : null,
    },
    stops,
    events: events.filter((e) => e.order < 0).map((e) => eventApi(e, req.user)),
    timezone: campusTimezone(),
  });
});

const average = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const medianOf = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

/**
 * Measured averages for a route / direction / period. A figure is shown only
 * when at least TRANSPORT_REPORT_MIN_TRIPS trips support it; otherwise the
 * sample count is returned with `sufficient: false`. Punctuality only for
 * stops with a real timetable. Nothing here is an estimate.
 */
export const historyReport = asyncHandler(async (req, res) => {
  const cfg = transportConfig();
  const filter = historyFilter(req);
  const trips = await BusTrip.find({ ...filter, plan: { $exists: true } }).select('status startedAt endedAt plan finalArrivalAt').limit(2000).lean();
  const events = await BusStopEvent.find({ trip: { $in: trips.map((t) => t._id) }, type: { $in: ['arrival', 'departure'] } }).select('trip order type at stopName stop scheduledAt').lean();
  const byTrip = new Map();
  for (const e of events) {
    const k = String(e.trip);
    if (!byTrip.has(k)) byTrip.set(k, new Map());
    byTrip.get(k).set(`${e.type}:${e.order}`, e);
  }
  const min = cfg.reportMinTrips;
  const journeys = [];
  const segments = new Map();
  const delays = [];
  for (const t of trips) {
    const m = byTrip.get(String(t._id));
    if (!m) continue;
    const last = (t.plan?.length || 0) - 1;
    const firstDep = [...m.values()].filter((e) => e.type === 'departure').sort((a, b) => a.at - b.at)[0];
    const finalArr = m.get(`arrival:${last}`);
    if (t.status === 'completed' && firstDep && finalArr && finalArr.at > firstDep.at) journeys.push((finalArr.at - firstDep.at) / 60000);
    for (let o = 1; o <= last; o += 1) {
      const dep = m.get(`departure:${o - 1}`);
      const arr = m.get(`arrival:${o}`);
      if (dep && arr && arr.at > dep.at) {
        const key = `${dep.stopName || o}→${arr.stopName || o + 1}`;
        if (!segments.has(key)) segments.set(key, { from: dep.stopName, to: arr.stopName, fromOrder: o - 1, toOrder: o, minutes: [] });
        segments.get(key).minutes.push((arr.at - dep.at) / 60000);
      }
    }
    for (const e of m.values()) if (e.type === 'arrival' && e.scheduledAt) delays.push((e.at - e.scheduledAt) / 60000);
  }
  const figure = (xs) => (xs.length >= min ? { sufficient: true, samples: xs.length, averageMinutes: average(xs), medianMinutes: medianOf(xs) } : { sufficient: false, samples: xs.length });
  res.set('Cache-Control', 'no-store');
  res.json({
    measured: true,
    minSamples: min,
    trips: { total: trips.length, completed: trips.filter((t) => t.status === 'completed').length, interrupted: trips.filter((t) => ['stopped', 'timeout'].includes(t.status) && !t.finalArrivalAt).length },
    journeyDuration: figure(journeys),
    segments: [...segments.values()].sort((a, b) => a.fromOrder - b.fromOrder).map((s) => ({ from: s.from, to: s.to, ...figure(s.minutes) })),
    punctuality: delays.length
      ? delays.length >= min
        ? { sufficient: true, samples: delays.length, toleranceMinutes: cfg.onTimeMinutes, onTimePercent: Math.round((delays.filter((d) => Math.abs(d) <= cfg.onTimeMinutes).length / delays.length) * 100), averageDelayMinutes: average(delays) }
        : { sufficient: false, samples: delays.length }
      : null, // no timetable on these stops
    timezone: campusTimezone(),
  });
});
