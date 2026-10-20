/**
 * Authoritative journey state for bus trips (the server is the source of
 * truth; clients only display it):
 *
 *  - every accepted fix advances the trip's progress (journey.stepTracker)
 *    and records the stop arrivals / departures it proves;
 *  - trip start and end are recorded as events too;
 *  - the live journey view: stops in travel order with actual times,
 *    predictions for the stops ahead, next / following stop;
 *  - manual records and corrections by transport managers (audited by the caller).
 *
 * Concurrency: the trip's progress carries a revision; a write only lands on
 * the revision it was computed from (otherwise it is recomputed from the
 * fresh state). Events are additionally unique per trip, type and stop
 * position, so repeated fixes, retries, a second device or concurrent
 * requests can never record a stop twice.
 */
import BusRoute from '../../models/BusRoute.js';
import BusStopEvent from '../../models/BusStopEvent.js';
import BusTrip from '../../models/BusTrip.js';
import { emitToRooms } from '../../config/socket.js';
import { ApiError } from '../../utils/http.js';
import { campusDayStart, toDay } from '../../utils/dates.js';
import { freshness, transportConfig } from './config.js';
import { recentSpeed } from './eta.js';
import { historyFromEvents, initialTracker, nextStops, planFor, stepTracker, stopEtas, tripPath } from './journey.js';

const pathCache = new Map(); // `${tripId}:${route.updatedAt}` → path
const historyCache = new Map(); // `${routeId}:${direction}` → { at, value }
const HISTORY_TTL_MS = 10 * 60000;
const PREDICTION_RETRY_MS = 60000;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The trip plan for a bus's route in `direction`, or null when the bus has no usable route. */
export async function buildTripPlan(routeId, direction) {
  const route = routeId ? await BusRoute.findById(routeId).lean() : null;
  if (!route?.stops?.length) return null;
  const ret = route.returnRoute ? await BusRoute.findOne({ _id: route.returnRoute, isActive: true }).lean() : null;
  return { ...planFor(route, direction, ret), baseRouteId: route._id };
}

async function pathFor(trip) {
  const meta = await BusRoute.findById(trip.route).select('updatedAt').lean();
  const key = `${trip._id}:${meta?.updatedAt?.getTime() || 0}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const route = meta ? await BusRoute.findById(trip.route).select('geometry stops').lean() : null;
  const path = tripPath(route, trip.plan, trip.routeMode);
  if (pathCache.size > 200) pathCache.clear();
  pathCache.set(key, path);
  return path;
}

/** Measured segment / dwell times for a route and direction (cached; null until enough trips exist). */
export async function historyStats(routeId, direction, cfg = transportConfig(), now = Date.now()) {
  const key = `${routeId}:${direction}`;
  const hit = historyCache.get(key);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.value;
  const events = await BusStopEvent.find({ route: routeId, direction, source: 'gps', type: { $in: ['arrival', 'departure'] }, tripStartedAt: { $gte: new Date(now - 90 * 86400000) } })
    .select('trip order stop type at')
    .sort({ tripStartedAt: -1 })
    .limit(5000)
    .lean();
  const value = historyFromEvents(events, cfg.etaHistoryMinTrips);
  historyCache.set(key, { at: now, value });
  return value;
}

/** Scheduled time of a planned stop on the trip's campus day, when a real timetable exists. */
export function scheduledAtFor(trip, planStop) {
  if (!planStop?.scheduledTime) return null;
  return new Date(campusDayStart(toDay(new Date(trip.startedAt))).getTime() + minutesOf(planStop.scheduledTime) * 60000);
}

function eventDoc(trip, ev, extra = {}) {
  const p = ev.order >= 0 ? trip.plan[ev.order] : null;
  return {
    trip: trip._id,
    bus: trip.bus,
    route: trip.route,
    direction: trip.direction,
    type: ev.type,
    order: ev.order,
    ...(p ? { stop: p.stop, stopName: p.name, isCollege: Boolean(p.isCollege), isFinal: ev.order === trip.plan.length - 1, scheduledAt: scheduledAtFor(trip, p) || undefined } : {}),
    at: ev.at,
    detectedAt: ev.detectedAt,
    distanceM: ev.distanceM,
    accuracy: ev.accuracy ?? undefined,
    fixes: ev.fixes,
    tripStartedAt: trip.startedAt,
    ...extra,
  };
}

/** Insert events; an event already recorded (unique index) is left as it is. Returns the ones inserted. */
async function insertEvents(docs) {
  const inserted = [];
  for (const d of docs) {
    try {
      inserted.push(await BusStopEvent.create(d));
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return inserted;
}

function broadcast(trip, events, extra = {}) {
  if (!events.length && !extra.status) return;
  emitToRooms([`bus:${trip.bus}`, 'transport:all'], 'bus:journey', {
    busId: String(trip.bus),
    tripId: String(trip._id),
    events: events.map((e) => ({ type: e.type, order: e.order, stopName: e.stopName || null, at: e.at, source: e.source })),
    ...extra,
  });
}

/** Trip start, recorded as an event (idempotent). */
export async function recordTripStart(trip) {
  await insertEvents([eventDoc(trip, { type: 'trip_started', order: -1, at: trip.startedAt }, { source: 'system', recordedBy: trip.startedBy })]);
}

/** Trip end (completed / stopped / timeout), recorded as an event (idempotent). */
export async function recordTripEnd(trip) {
  if (!trip?.endedAt) return;
  const docs = await insertEvents([eventDoc(trip, { type: 'trip_ended', order: -1, at: trip.endedAt }, { source: 'system', endStatus: trip.status, reason: trip.endReason || undefined, recordedBy: trip.endedBy })]);
  broadcast(trip, docs, { status: trip.status });
}

async function completeAtFinalStop(trip, finalEvent) {
  const ended = await BusTrip.findOneAndUpdate(
    { _id: trip._id, status: 'active' },
    { $set: { status: 'completed', endedAt: new Date(finalEvent.detectedAt || finalEvent.at), endReason: 'Arrived at the final stop' } },
    { new: true }
  ).lean();
  if (!ended) return;
  emitToRooms([`bus:${ended.bus}`, 'transport:all'], 'bus:trip', { busId: String(ended.bus), tripId: String(ended._id), status: ended.status });
  await recordTripEnd(ended);
}

/**
 * Advance a trip by one ACCEPTED fix (called by the ingestion service after
 * the fix passed validation). Returns { state, events } or null when nothing applied.
 */
export async function processFix(busId, fix, tripId) {
  const cfg = transportConfig();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const trip = await BusTrip.findById(tripId).select('bus route direction routeMode plan tracker status startedAt').lean();
    if (!trip || trip.status !== 'active' || !trip.plan?.length) return null;
    const prev = trip.tracker || initialTracker();
    const path = await pathFor(trip);
    const { state, events, skipped } = stepTracker(prev, path, trip.plan, fix, cfg);
    if (skipped === 'out_of_order') return null;

    // Prediction for the stop that is now next — kept to compare with its actual arrival.
    const n = trip.plan.length;
    const fixMs = new Date(fix.at).getTime();
    const p = state.predicted;
    const needPrediction = state.nextOrder < n && state.alongM != null && !state.offRoute && !(p && p.order === state.nextOrder && (p.at || fixMs - new Date(p.madeAt).getTime() < PREDICTION_RETRY_MS));
    if (needPrediction) {
      const [speed, history] = await Promise.all([recentSpeed(busId, fixMs), historyStats(trip.route, trip.direction, cfg)]);
      const eta = stopEtas({ planStops: trip.plan, path, state, fresh: 'live', speed, history, now: fixMs, cfg }).get(state.nextOrder);
      state.predicted = { order: state.nextOrder, at: eta?.status === 'ok' ? new Date(eta.predictedArrivalAt) : null, madeAt: new Date(fixMs), method: eta?.method || null };
    }

    const set = { tracker: { ...state, rev: (prev.rev || 0) + 1 } };
    const finalArrival = events.find((e) => e.type === 'arrival' && e.order === n - 1);
    const collegeArrival = events.find((e) => e.type === 'arrival' && trip.plan[e.order]?.isCollege);
    if (finalArrival) set.finalArrivalAt = finalArrival.at;
    if (collegeArrival) set.collegeArrivedAt = collegeArrival.at;
    const res = await BusTrip.updateOne({ _id: trip._id, status: 'active', 'tracker.rev': prev.rev || 0 }, { $set: set });
    if (!res.modifiedCount) continue; // another request moved the trip on — recompute from its state

    const docs = events.map((ev) => {
      const pred = ev.type === 'arrival' && prev.predicted?.order === ev.order && prev.predicted.at ? { predictedArrivalAt: prev.predicted.at, predictedAt: prev.predicted.madeAt, predictionMethod: prev.predicted.method || undefined } : {};
      return eventDoc(trip, ev, { source: 'gps', ...pred });
    });
    const inserted = await insertEvents(docs);
    broadcast(trip, inserted);
    if (finalArrival && cfg.tripAutoComplete) await completeAtFinalStop(trip, finalArrival);
    return { state: set.tracker, events: inserted };
  }
  return null;
}

/**
 * Start-of-trip journey fields for a bus's route in `direction` (null
 * direction → towards_college, marked assumed). Empty when the bus has no route.
 */
export async function journeyFields(routeId, direction) {
  const assumed = !direction;
  const dir = direction || 'towards_college';
  const plan = await buildTripPlan(routeId, dir);
  if (!plan) return { direction: dir, directionAssumed: assumed };
  return { direction: dir, directionAssumed: assumed, route: plan.routeId, baseRoute: plan.baseRouteId, routeMode: plan.mode, plan: plan.stops, tracker: initialTracker() };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * The live journey of a trip, for any viewer allowed to see the bus: planned
 * stops in travel order with recorded (actual) times, predictions for the
 * stops still ahead, the next / following stop and the college. No
 * personal data and no GPS track.
 */
export async function journeyView(trip, bus, { now = Date.now() } = {}) {
  if (!trip?.plan?.length) return null;
  const cfg = transportConfig();
  const events = await BusStopEvent.find({ trip: trip._id }).sort({ at: 1 }).lean();
  const state = { ...initialTracker(), ...(trip.tracker || {}) };
  const active = trip.status === 'active';
  const fresh = active ? freshness(bus?.lastLocation?.at, now, cfg) : 'offline';
  let etas = new Map();
  if (active) {
    const path = await pathFor(trip);
    const speed = fresh === 'live' ? await recentSpeed(trip.bus, now) : null;
    const history = await historyStats(trip.route, trip.direction, cfg, now);
    etas = stopEtas({ planStops: trip.plan, path, state, fresh, speed, history, now, cfg });
  }
  const byKey = new Map(events.map((e) => [`${e.type}:${e.order}`, e]));
  const missed = new Map((state.missed || []).map((m) => [m.order, m.reason]));
  const stops = trip.plan.map((p, order) => {
    const arr = byKey.get(`arrival:${order}`);
    const dep = byKey.get(`departure:${order}`);
    let status = 'upcoming';
    if (dep) status = 'departed';
    else if (arr) status = state.atOrder === order || !active ? 'arrived' : 'departed';
    else if (missed.has(order) || order < state.nextOrder) status = 'not_recorded';
    const eta = !arr && order >= state.nextOrder ? etas.get(order) || null : null;
    return {
      order,
      stopId: p.stop,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      isCollege: Boolean(p.isCollege),
      scheduledTime: p.scheduledTime || null,
      scheduledAt: iso(scheduledAtFor(trip, p)),
      status,
      ...(status === 'not_recorded' ? { notRecordedReason: missed.get(order) || 'not_detected' } : {}),
      actualArrivalAt: iso(arr?.at),
      actualDepartureAt: iso(dep?.at),
      arrivalSource: arr?.source || null,
      departureSource: dep?.source || null,
      predictedArrivalAt: eta?.status === 'ok' ? eta.predictedArrivalAt : null,
      eta,
    };
  });
  const ns = active ? nextStops(state, trip.plan, fresh) : { currentOrder: null, nextOrder: null, followingOrder: null, uncertain: false, reason: null };
  const pick = (o) => (o == null ? null : stops[o]);
  const college = stops.find((s) => s.isCollege) || null;
  const started = events.find((e) => e.type === 'trip_started');
  const ended = events.find((e) => e.type === 'trip_ended');
  const endAt = trip.endedAt || ended?.at || null;
  return {
    tripId: trip._id,
    busId: trip.bus,
    status: trip.status,
    direction: trip.direction,
    directionAssumed: Boolean(trip.directionAssumed),
    routeId: trip.route,
    routeMode: trip.routeMode,
    tripStartedAt: iso(started?.at || trip.startedAt),
    tripCompletedAt: trip.status === 'completed' ? iso(endAt) : null,
    endedAt: iso(endAt),
    endReason: trip.endReason || null,
    durationMinutes: endAt ? Math.round((new Date(endAt) - new Date(trip.startedAt)) / 60000) : null,
    tracking: fresh,
    lastFixAt: iso(bus?.lastLocation?.at),
    currentStop: pick(ns.currentOrder),
    nextStop: pick(ns.nextOrder),
    followingStop: pick(ns.followingOrder),
    nextStopUncertain: ns.uncertain,
    uncertainReason: ns.reason,
    college: college ? { order: college.order, name: college.name, actualArrivalAt: college.actualArrivalAt, predictedArrivalAt: college.predictedArrivalAt, eta: college.eta } : null,
    stops,
    computedAt: new Date(now).toISOString(),
  };
}

/**
 * Change the direction of an ACTIVE trip before any stop has been recorded
 * (e.g. started from an older app that does not send one). Never touches an
 * ended trip.
 */
export async function changeDirection(tripId, direction) {
  const trip = await BusTrip.findById(tripId).lean();
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (trip.status !== 'active') throw new ApiError(409, 'This trip has ended — its direction can no longer change', undefined, { code: 'trip_not_active' });
  if (await BusStopEvent.exists({ trip: trip._id, type: { $in: ['arrival', 'departure'] } })) throw new ApiError(409, 'Stops have already been recorded on this trip — its direction can no longer change', undefined, { code: 'stops_recorded' });
  const fields = await journeyFields(trip.baseRoute || trip.route, direction);
  fields.directionAssumed = false;
  const updated = await BusTrip.findOneAndUpdate({ _id: trip._id, status: 'active' }, { $set: fields }, { new: true }).lean();
  if (!updated) throw new ApiError(409, 'This trip has ended', undefined, { code: 'trip_not_active' });
  await BusStopEvent.updateMany({ trip: trip._id, type: 'trip_started' }, { $set: { direction, route: updated.route } });
  emitToRooms([`bus:${updated.bus}`, 'transport:all'], 'bus:trip', { busId: String(updated.bus), tripId: String(updated._id), status: updated.status, direction });
  return updated;
}

/**
 * Record or correct a stop arrival / departure by hand (transport managers).
 * A missing event is created with source 'manual'; an existing one is
 * corrected, keeping what it said before. Times must fall within the trip.
 */
export async function recordManualEvent(user, tripId, { order, type, at, reason }, now = Date.now()) {
  const trip = await BusTrip.findById(tripId).lean();
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (!trip.plan?.length) throw new ApiError(422, 'This trip has no planned stops to record against');
  if (!Number.isInteger(order) || order < 0 || order >= trip.plan.length) throw new ApiError(422, 'Unknown stop on this trip');
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new ApiError(422, 'A valid time is required');
  const latest = Math.min(now, trip.endedAt ? new Date(trip.endedAt).getTime() + 60000 : now);
  if (when < new Date(trip.startedAt).getTime() - 60000 || when.getTime() > latest) throw new ApiError(422, 'The time must be within the trip (and not in the future)');
  const other = await BusStopEvent.findOne({ trip: trip._id, order, type: type === 'arrival' ? 'departure' : 'arrival' }).lean();
  if (other && (type === 'arrival' ? when > other.at : when < other.at)) throw new ApiError(422, 'A departure cannot be before the arrival at the same stop');

  const existing = await BusStopEvent.findOne({ trip: trip._id, order, type });
  if (existing) {
    const correction = existing.correction?.previousAt ? existing.correction : { previousAt: existing.at, previousSource: existing.source };
    existing.set({ at: when, source: 'manual', recordedBy: user._id, reason, correction: { ...correction, correctedBy: user._id, correctedAt: new Date(now) } });
    await existing.save();
    broadcast(trip, [existing]);
    return { event: existing, corrected: true };
  }
  const doc = eventDoc(trip, { type, order, at: when }, { source: 'manual', recordedBy: user._id, reason });
  const [created] = await insertEvents([doc]);
  if (!created) throw new ApiError(409, 'This stop was recorded at the same moment — reload and try again', undefined, { code: 'already_recorded' });
  broadcast(trip, [created]);
  return { event: created, corrected: false };
}

/** Test hook. */
export function resetJourneyState() {
  pathCache.clear();
  historyCache.clear();
}
