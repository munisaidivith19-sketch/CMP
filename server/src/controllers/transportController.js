/**
 * College bus tracking API.
 *
 * Viewing: every endpoint is scoped by services/transport/access.js (the same
 * rules as the Socket.IO rooms). Viewers get transport data only — bus,
 * route, stops, the latest valid position and its age, ETA. No passenger
 * lists, phone numbers or other personal data; who is sharing a trip is shown
 * only to transport managers and the sharer.
 *
 * Writing: buses, routes, stops and assignments — transport managers
 * (admin, transport officer) only, audited. Trips — assigned staff / managers.
 * Locations — the phone that started the trip, or the signed tracker webhook.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Bus from '../models/Bus.js';
import BusLocation from '../models/BusLocation.js';
import BusRoute from '../models/BusRoute.js';
import BusTrip from '../models/BusTrip.js';
import TransportAssignment from '../models/TransportAssignment.js';
import User from '../models/User.js';
import { ApiError, asyncHandler, escapeRegex } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { sameId } from '../utils/permissions.js';
import { campusParts, campusTimezone } from '../utils/dates.js';
import { TRANSPORT_HISTORY_ROLES, TRANSPORT_MANAGE_ROLES, TRANSPORT_VIEW_ROLES, TRIP_SHARER_ROLES } from '../constants.js';
import { busFilter, canViewBus, viewerScope } from '../services/transport/access.js';
import { freshness, transportConfig } from '../services/transport/config.js';
import { computeEta, progress, recentSpeed } from '../services/transport/eta.js';
import { FixRejected, ingestFix } from '../services/transport/ingest.js';
import { deviceKeyMatches, startTrip, stopTrip, tripApi } from '../services/transport/trips.js';
import { cumulative, project, validLatLng } from '../services/transport/geo.js';
import { generateRoadGeometry, MAX_GEOMETRY_POINTS, RoutingError, stopsKey } from '../services/transport/routing.js';
import { journeyView, recordTripEnd } from '../services/transport/stopEvents.js';

const isManager = (u) => TRANSPORT_MANAGE_ROLES.includes(u.role);
const nowMinutes = () => {
  const t = campusParts(new Date()).time;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

const locationApi = (loc) =>
  loc?.at
    ? {
        lat: loc.lat,
        lng: loc.lng,
        at: loc.at,
        accuracy: loc.accuracy ?? null,
        speed: loc.speed ?? null,
        heading: loc.heading != null && (loc.speed ?? 0) >= 2 ? loc.heading : null,
        source: loc.source,
      }
    : null;

function busApi(bus, viewer, trip) {
  const cfg = transportConfig();
  return {
    _id: bus._id,
    number: bus.number,
    isActive: bus.isActive,
    gpsSource: bus.gpsSource,
    route: bus.route && typeof bus.route === 'object' && bus.route.name ? { _id: bus.route._id, name: bus.route.name, code: bus.route.code || null } : bus.route || null,
    location: locationApi(bus.lastLocation),
    tracking: freshness(bus.lastLocation?.at, Date.now(), cfg),
    trip: trip ? tripApi(trip, viewer) : null,
    ...(isManager(viewer) ? { registrationNumber: bus.registrationNumber || null, trackerDeviceId: bus.trackerDeviceId || null, trackingStaff: bus.trackingStaff } : {}),
  };
}

async function requireScope(user) {
  const scope = await viewerScope(user);
  if (!scope) throw new ApiError(403, 'You do not have access to bus tracking');
  return scope;
}

// ── Viewing ────────────────────────────────────────────────────────

export const getConfig = asyncHandler(async (req, res) => {
  await requireScope(req.user);
  const cfg = transportConfig();
  res.json({
    mapStyleUrl: cfg.mapStyleUrl,
    mapAttribution: cfg.mapAttribution,
    studentVisibility: cfg.studentVisibility,
    liveSeconds: cfg.liveSeconds,
    staleSeconds: cfg.staleSeconds,
    canManage: isManager(req.user),
    canShare: TRIP_SHARER_ROLES.includes(req.user.role),
    // Journey history: every bus, or (trip sharers) the trips they ran; reports for history roles only.
    canViewHistory: TRANSPORT_HISTORY_ROLES.includes(req.user.role) || TRIP_SHARER_ROLES.includes(req.user.role),
    canViewReports: TRANSPORT_HISTORY_ROLES.includes(req.user.role),
    // Times are UTC on the wire; clients show them in the campus zone.
    timezone: campusTimezone(),
  });
});

export const listBuses = asyncHandler(async (req, res) => {
  const scope = await requireScope(req.user);
  let q = Bus.find(busFilter(scope, req.user)).populate('route', 'name code').sort({ number: 1 });
  // Managers see who may share each bus (names only); everyone else never gets this field.
  if (isManager(req.user)) q = q.populate('trackingStaff', 'name');
  const buses = await q.lean();
  const trips = await BusTrip.find({ bus: { $in: buses.map((b) => b._id) }, status: 'active' }).lean();
  const tripOf = new Map(trips.map((t) => [String(t.bus), t]));
  res.set('Cache-Control', 'no-store');
  res.json({ buses: buses.map((b) => busApi(b, req.user, tripOf.get(String(b._id)))), serverTime: new Date().toISOString() });
});

async function loadVisibleBus(user, id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(422, 'Invalid bus');
  if (!(await canViewBus(user, id))) throw new ApiError(404, 'Bus not found');
  return Bus.findById(id).lean();
}

export const getBus = asyncHandler(async (req, res) => {
  const bus = await loadVisibleBus(req.user, req.params.id);
  const [route, trip, assignment] = await Promise.all([
    bus.route ? BusRoute.findById(bus.route).lean() : null,
    BusTrip.findOne({ bus: bus._id, status: 'active' }).lean(),
    TransportAssignment.findOne({ user: req.user._id }).lean(),
  ]);
  const myStop = assignment && route && sameId(assignment.route, route._id) ? assignment.stop : null;
  const stopId = req.query.stopId || myStop || undefined;
  const speed = bus.lastLocation?.at ? await recentSpeed(bus._id) : null;
  const eta = computeEta({ route, location: bus.lastLocation, stopId, speed, campusMinutesNow: nowMinutes() });
  // The path travelled on this trip (thinned history), for the "travelled" line.
  const path = trip ? await BusLocation.find({ trip: trip._id }).sort({ at: 1 }).limit(1000).select('lat lng at -_id').lean() : [];
  // A trip on a separately configured return route follows THAT route's stops and road line.
  const followed = trip?.route && route && !sameId(trip.route, route._id) ? await BusRoute.findById(trip.route).lean() : null;
  res.set('Cache-Control', 'no-store');
  res.json({
    bus: busApi({ ...bus, route: route ? { _id: route._id, name: route.name, code: route.code } : null }, req.user, trip),
    // geometryExact false = no road geometry: the line is straight stop-to-stop and labelled approximate.
    route: route ? { _id: route._id, name: route.name, code: route.code || null, stops: route.stops, geometry: route.geometry || null, geometryExact: route.geometry?.length >= 2 } : null,
    journeyRoute: followed ? { _id: followed._id, name: followed.name, code: followed.code || null, stops: followed.stops, geometry: followed.geometry || null, geometryExact: followed.geometry?.length >= 2 } : null,
    progress: progress(route, bus.lastLocation),
    eta,
    myStop: myStop || null,
    // Server-recorded journey of the active trip (direction, next stops, actual times, ETAs).
    journey: trip ? await journeyView(trip, bus) : null,
    travelled: path,
    serverTime: new Date().toISOString(),
  });
});

export const getEta = asyncHandler(async (req, res) => {
  const bus = await loadVisibleBus(req.user, req.params.id);
  const route = bus.route ? await BusRoute.findById(bus.route).lean() : null;
  const speed = bus.lastLocation?.at ? await recentSpeed(bus._id) : null;
  res.set('Cache-Control', 'no-store');
  res.json(computeEta({ route, location: bus.lastLocation, stopId: req.query.stopId, speed, campusMinutesNow: nowMinutes() }));
});

export const listRoutes = asyncHandler(async (req, res) => {
  const scope = await requireScope(req.user);
  const filter = isManager(req.user) && req.query.all === 'true' ? {} : { isActive: true };
  if (!scope.all) filter._id = { $in: scope.routes };
  if (!isManager(req.user)) {
    const routes = await BusRoute.find(filter).select('name code stops isActive').sort({ name: 1 }).lean();
    return res.json({ routes });
  }
  // Managers also see each route's geometry status (point count only — not the line itself).
  const routes = await BusRoute.find(filter).select('name code stops isActive returnRoute geometrySource geometryProvider geometryUpdatedAt geometryStopsKey').sort({ name: 1 }).lean();
  const counts = await BusRoute.aggregate([{ $match: { _id: { $in: routes.map((r) => r._id) } } }, { $project: { n: { $size: { $ifNull: ['$geometry', []] } } } }]);
  const pointsOf = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({
    routes: routes.map((r) => {
      const info = geometryInfo(r, pointsOf.get(String(r._id)) || 0);
      delete r.geometryStopsKey;
      return { ...r, geometryInfo: info };
    }),
  });
});

export const getRoute = asyncHandler(async (req, res) => {
  const scope = await requireScope(req.user);
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(422, 'Invalid route');
  if (!scope.all && !scope.routes.includes(String(req.params.id))) throw new ApiError(404, 'Route not found');
  const route = await BusRoute.findOne({ _id: req.params.id, ...(isManager(req.user) ? {} : { isActive: true }) }).lean();
  if (!route) throw new ApiError(404, 'Route not found');
  res.json({ route, ...(isManager(req.user) ? { geometryInfo: geometryInfo(route) } : {}) });
});

/** Search buses (number), routes (name / code) and stops (name) the viewer may see. */
export const search = asyncHandler(async (req, res) => {
  const scope = await requireScope(req.user);
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ buses: [], routes: [], stops: [] });
  const re = new RegExp(escapeRegex(q), 'i');
  const routeScope = scope.all ? {} : { _id: { $in: scope.routes } };
  const [buses, routes, stopRoutes] = await Promise.all([
    Bus.find({ ...busFilter(scope, req.user), number: re }).populate('route', 'name code').limit(20).lean(),
    BusRoute.find({ ...routeScope, isActive: true, $or: [{ name: re }, { code: re }] }).select('name code').limit(20).lean(),
    BusRoute.find({ ...routeScope, isActive: true, 'stops.name': re }).select('name stops').limit(20).lean(),
  ]);
  const stops = stopRoutes.flatMap((r) => r.stops.filter((s) => re.test(s.name)).map((s) => ({ routeId: r._id, routeName: r.name, stopId: s._id, name: s.name, lat: s.lat, lng: s.lng, sequence: s.sequence }))).slice(0, 30);
  res.json({ buses: buses.map((b) => busApi(b, req.user)), routes, stops });
});

/** The viewer's assignment and, for staff, the buses they may share and their active trip. */
export const getMine = asyncHandler(async (req, res) => {
  await requireScope(req.user);
  const assignment = await TransportAssignment.findOne({ user: req.user._id }).populate('route', 'name code stops').populate('bus', 'number').lean();
  let shareable = [];
  let activeTrip = null;
  if (TRIP_SHARER_ROLES.includes(req.user.role)) {
    shareable = await Bus.find({ isActive: true, ...(isManager(req.user) ? {} : { trackingStaff: req.user._id }) }).select('number gpsSource route').populate('route', 'name').sort({ number: 1 }).lean();
    activeTrip = await BusTrip.findOne({ sharedBy: req.user._id, status: 'active' }).populate('bus', 'number').lean();
  }
  res.json({
    assignment: assignment
      ? { route: assignment.route ? { _id: assignment.route._id, name: assignment.route.name } : null, bus: assignment.bus || null, stop: assignment.route?.stops?.find((s) => sameId(s._id, assignment.stop)) || null }
      : null,
    shareable: shareable.map((b) => ({ _id: b._id, number: b.number, gpsSource: b.gpsSource, route: b.route?.name || null })),
    activeTrip: activeTrip ? { ...tripApi(activeTrip, req.user), channel: activeTrip.channel || 'app', bus: { _id: activeTrip.bus._id, number: activeTrip.bus.number } } : null,
  });
});

// ── Trips and phone locations ──────────────────────────────────────

export const startTripCtrl = asyncHandler(async (req, res) => {
  const { trip, bus, deviceKey } = await startTrip(req.user, req.body.busId, { bindDevice: req.body.bindDevice === true, direction: req.body.direction || null });
  logActivity(req, 'transport.trip_started', { entityType: 'bus_trip', entityId: trip._id, summary: `${bus.number} (${trip.source}, ${trip.channel}, ${trip.direction}${trip.directionAssumed ? ' assumed' : ''})` });
  res.set('Cache-Control', 'no-store');
  // The device key is returned once, here, and stored only as a hash.
  res.status(201).json({ trip: tripApi(trip.toObject(), req.user), bus: { _id: bus._id, number: bus.number }, ...(deviceKey ? { deviceKey } : {}) });
});

export const stopTripCtrl = asyncHandler(async (req, res) => {
  const trip = await stopTrip(req.user, req.params.id, req.body?.reason === 'stopped' ? 'stopped' : 'completed');
  logActivity(req, 'transport.trip_stopped', { entityType: 'bus_trip', entityId: trip._id, summary: `${trip.status}` });
  res.json({ trip: tripApi(trip.toObject ? trip.toObject() : trip, req.user) });
});

export const getTrip = asyncHandler(async (req, res) => {
  const trip = await BusTrip.findById(req.params.id).lean();
  if (!trip || !(await canViewBus(req.user, trip.bus))) throw new ApiError(404, 'Trip not found');
  res.json({ trip: tripApi(trip, req.user) });
});

async function ingestMany(bus, fixes, opts) {
  let current = bus;
  const accepted = [];
  const rejected = [];
  const sorted = fixes.map((f, i) => ({ f, i })).sort((a, b) => (Date.parse(a.f.timestamp) || a.f.timestamp) - (Date.parse(b.f.timestamp) || b.f.timestamp));
  for (const { f, i } of sorted) {
    try {
      const fix = await ingestFix(current, f, opts);
      current = { ...current, lastLocation: fix };
      accepted.push(i);
    } catch (err) {
      if (!(err instanceof FixRejected)) throw err;
      rejected.push({ index: i, code: err.code, reason: err.message });
    }
  }
  return { accepted: accepted.length, rejected };
}

/** Phone locations: only from the person sharing this ACTIVE trip. */
export const postTripLocations = asyncHandler(async (req, res) => {
  const trip = await BusTrip.findById(req.params.id).select('+deviceKeyHash').lean();
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (!trip.sharedBy || !sameId(trip.sharedBy, req.user)) throw new ApiError(403, 'Only the person sharing this trip can send its location');
  // A device-bound trip (web sharing) takes locations only from the tab that started it.
  if (!deviceKeyMatches(trip, req.get('x-trip-key'))) throw new ApiError(403, 'This trip is being shared from another browser tab or device', undefined, { code: 'wrong_device' });
  // Ended trips tell the phone to stop its location service.
  if (trip.status !== 'active') throw new ApiError(409, 'This trip is no longer active', undefined, { code: 'trip_not_active', status: trip.status });
  const bus = await Bus.findById(trip.bus).lean();
  if (!bus || !bus.isActive) throw new ApiError(409, 'This bus is no longer active', undefined, { code: 'trip_not_active' });
  const result = await ingestMany(bus, req.body.fixes, { source: 'phone', trip });
  res.json(result);
});

/**
 * Vehicle GPS tracker webhook (machine-to-machine, no user session).
 * Disabled until TRACKER_WEBHOOK_SECRET is set. The request must carry
 *   X-Tracker-Timestamp: unix ms (within 5 minutes — replay protection)
 *   X-Tracker-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * Body: { deviceId, fixes: [{ lat, lng, timestamp, accuracy?, speed?, heading? }] }
 * The device id must match an ACTIVE bus configured with gpsSource "tracker".
 */
export const trackerWebhook = asyncHandler(async (req, res) => {
  const { trackerSecret } = transportConfig();
  if (!trackerSecret) throw new ApiError(404, 'Not found');
  const ts = Number(req.get('x-tracker-timestamp'));
  const sig = String(req.get('x-tracker-signature') || '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60000) throw new ApiError(401, 'Invalid or expired signature');
  const expected = `sha256=${crypto.createHmac('sha256', trackerSecret).update(`${ts}.${req.rawBody || ''}`).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new ApiError(401, 'Invalid or expired signature');

  const { deviceId } = req.body || {};
  const fixes = Array.isArray(req.body?.fixes) ? req.body.fixes : null;
  if (typeof deviceId !== 'string' || !deviceId || !fixes || !fixes.length || fixes.length > 50) throw new ApiError(422, 'deviceId and 1–50 fixes are required');
  const bus = await Bus.findOne({ trackerDeviceId: deviceId, gpsSource: 'tracker', isActive: true }).lean();
  if (!bus) throw new ApiError(404, 'Unknown tracker device');
  const trip = await BusTrip.findOne({ bus: bus._id, status: 'active' }).lean();
  res.json(await ingestMany(bus, fixes, { source: 'tracker', trip }));
});

// ── Management (admin / transport officer) ─────────────────────────

const STOP_FIELDS = (s, i) => {
  const lat = Number(s.lat);
  const lng = Number(s.lng);
  if (!validLatLng(lat, lng)) throw new ApiError(422, `Stop ${i + 1}: invalid coordinates`);
  const name = String(s.name || '').trim();
  if (name.length < 2 || name.length > 80) throw new ApiError(422, `Stop ${i + 1}: a name of 2–80 characters is required`);
  return {
    ...(s._id && mongoose.isValidObjectId(s._id) ? { _id: s._id } : {}),
    name,
    lat,
    lng,
    sequence: Number(s.sequence ?? i + 1),
    scheduledTime: s.scheduledTime || undefined,
    isCollege: Boolean(s.isCollege),
    arrivalRadiusM: s.arrivalRadiusM ? Number(s.arrivalRadiusM) : undefined,
  };
};

function routeData(body, partial = false) {
  const data = {};
  if (body.name !== undefined || !partial) data.name = String(body.name || '').trim();
  if (body.code !== undefined) data.code = body.code ? String(body.code).trim() : undefined;
  if (body.stops !== undefined || !partial) {
    if (!Array.isArray(body.stops) || body.stops.length < 2 || body.stops.length > 200) throw new ApiError(422, 'A route needs 2–200 stops');
    data.stops = body.stops.map(STOP_FIELDS);
    const seq = data.stops.map((s) => s.sequence);
    if (seq.some((n) => !Number.isInteger(n) || n < 1) || new Set(seq).size !== seq.length) throw new ApiError(422, 'Stop sequence numbers must be unique positive integers');
  }
  if (body.geometry !== undefined) {
    if (body.geometry === null) data.geometry = undefined;
    else {
      if (!Array.isArray(body.geometry) || body.geometry.length < 2 || body.geometry.length > MAX_GEOMETRY_POINTS) throw new ApiError(422, `Route geometry must be 2–${MAX_GEOMETRY_POINTS} [longitude, latitude] points`);
      data.geometry = body.geometry.map((p) => {
        const [lng, lat] = (Array.isArray(p) ? p : []).map(Number);
        if (!validLatLng(lat, lng)) throw new ApiError(422, 'Route geometry contains an invalid point');
        return [lng, lat];
      });
    }
  }
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.returnRoute !== undefined) data.returnRoute = body.returnRoute || undefined;
  return data;
}

/** A separately configured return route must be another, active route. */
async function checkReturnRoute(data, selfId) {
  if (!data.returnRoute) return;
  if (selfId && String(data.returnRoute) === String(selfId)) throw new ApiError(422, 'A route cannot be its own return route');
  if (!mongoose.isValidObjectId(data.returnRoute) || !(await BusRoute.exists({ _id: data.returnRoute, isActive: true }))) throw new ApiError(422, 'Choose an active return route');
}

// How far (m) a stop may be from saved geometry. Catches [latitude, longitude]
// pasted where GeoJSON needs [longitude, latitude], and lines for another route.
const maxStopOffset = () => {
  const n = Number(process.env.ROUTE_GEOMETRY_MAX_STOP_OFFSET_M);
  return Number.isFinite(n) && n >= 50 && n <= 10000 ? n : 500;
};

/**
 * Geometry is only ever set or removed when the request says so explicitly
 * (`geometry`); edited stops keep the stored line (see geometryStopsKey).
 * New geometry must pass near every stop, and records where it came from.
 */
function applyGeometry(data, body, stops) {
  if (body.geometry === undefined) return '';
  if (body.geometry === null) {
    Object.assign(data, { geometry: undefined, geometrySource: undefined, geometryProvider: undefined, geometryUpdatedAt: undefined, geometryStopsKey: undefined });
    return 'geometry removed';
  }
  const points = data.geometry.map(([lng, lat]) => ({ lat, lng }));
  const cum = cumulative(points);
  const limit = maxStopOffset();
  stops.forEach((s, i) => {
    const off = project(points, cum, { lat: s.lat, lng: s.lng }).offset;
    if (off > limit) {
      throw new ApiError(422, `Stop ${i + 1} (${s.name}) is ${Math.round(off)} m from the route geometry (limit ${limit} m). Check the geometry is [longitude, latitude] and belongs to this route.`, undefined, { code: 'geometry_off_stops', stopIndex: i });
    }
  });
  const generated = body.geometrySource === 'generated';
  Object.assign(data, {
    geometrySource: generated ? 'generated' : 'manual',
    geometryProvider: generated ? String(body.geometryProvider || 'osrm').slice(0, 40) : undefined,
    geometryUpdatedAt: new Date(),
    geometryStopsKey: stopsKey(stops),
  });
  return `geometry ${data.geometrySource}${generated ? ` (${data.geometryProvider})` : ''}, ${data.geometry.length} points`;
}

/** Managers' view of a route's geometry: present, where from, and whether the stops changed since. */
function geometryInfo(route, points = route.geometry?.length || 0) {
  if (!points) return { points: 0, source: null, stale: false };
  return {
    points,
    source: route.geometrySource || 'unrecorded',
    provider: route.geometryProvider || null,
    updatedAt: route.geometryUpdatedAt || null,
    // Unknown for routes saved before stop keys were recorded.
    stale: route.geometryStopsKey ? route.geometryStopsKey !== stopsKey(route.stops) : null,
  };
}

/** Road geometry preview for the stops in the request. Saves nothing. */
export const previewRouteGeometry = asyncHandler(async (req, res) => {
  try {
    const result = await generateRoadGeometry(req.body.stops);
    res.set('Cache-Control', 'no-store');
    res.json({ ...result, stopsKey: stopsKey(result.stops) });
  } catch (err) {
    if (err instanceof RoutingError) throw new ApiError(err.status, err.message, undefined, { code: err.code, ...err.details });
    throw err;
  }
});

export const createRoute = asyncHandler(async (req, res) => {
  try {
    const data = routeData(req.body);
    await checkReturnRoute(data);
    const geo = applyGeometry(data, req.body, [...data.stops].sort((a, b) => a.sequence - b.sequence));
    const route = await BusRoute.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
    logActivity(req, 'transport.route_created', { entityType: 'bus_route', entityId: route._id, summary: `${route.name} (${route.stops.length} stops)${geo ? `; ${geo}` : ''}` });
    res.status(201).json({ route, geometryInfo: geometryInfo(route) });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'A route with this name already exists');
    throw err;
  }
});

export const updateRoute = asyncHandler(async (req, res) => {
  const route = await BusRoute.findById(req.params.id);
  if (!route) throw new ApiError(404, 'Route not found');
  const data = routeData(req.body, true);
  await checkReturnRoute(data, route._id);
  if (data.isActive === false && (await Bus.exists({ route: route._id, isActive: true }))) throw new ApiError(409, 'Active buses still use this route — reassign them first');
  const geo = applyGeometry(data, req.body, [...(data.stops || route.stops)].sort((a, b) => a.sequence - b.sequence));
  Object.assign(route, data, { updatedBy: req.user._id });
  try {
    await route.save();
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'A route with this name already exists');
    throw err;
  }
  // Assignments to stops that no longer exist lose their stop (never point at a ghost).
  const ids = route.stops.map((s) => s._id);
  await TransportAssignment.updateMany({ route: route._id, stop: { $nin: ids } }, { $unset: { stop: 1 } });
  logActivity(req, 'transport.route_updated', { entityType: 'bus_route', entityId: route._id, summary: `${route.name}${geo ? `; ${geo}` : ''}` });
  res.json({ route, geometryInfo: geometryInfo(route) });
});

async function busData(body, partial = false) {
  const data = {};
  if (body.number !== undefined || !partial) {
    data.number = String(body.number || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(data.number)) throw new ApiError(422, 'Bus number: letters, digits, spaces and dashes (max 20)');
  }
  if (body.registrationNumber !== undefined) data.registrationNumber = body.registrationNumber ? String(body.registrationNumber).trim().toUpperCase().slice(0, 20) : undefined;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.gpsSource !== undefined) {
    if (!['tracker', 'phone'].includes(body.gpsSource)) throw new ApiError(422, 'GPS source must be tracker or phone');
    data.gpsSource = body.gpsSource;
  }
  if (body.trackerDeviceId !== undefined) data.trackerDeviceId = body.trackerDeviceId ? String(body.trackerDeviceId).trim().slice(0, 80) : undefined;
  if (body.route !== undefined) {
    if (body.route === null) data.route = null;
    else {
      if (!mongoose.isValidObjectId(body.route) || !(await BusRoute.exists({ _id: body.route, isActive: true }))) throw new ApiError(422, 'Choose an active route');
      data.route = body.route;
    }
  }
  if (body.trackingStaff !== undefined) {
    const ids = [...new Set((Array.isArray(body.trackingStaff) ? body.trackingStaff : []).map(String))];
    if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new ApiError(422, 'Invalid staff member');
    const n = await User.countDocuments({ _id: { $in: ids }, role: { $in: TRIP_SHARER_ROLES }, isActive: true });
    if (n !== ids.length) throw new ApiError(422, 'Trip sharers must be active faculty, HOD or transport staff');
    data.trackingStaff = ids;
  }
  return data;
}

export const createBus = asyncHandler(async (req, res) => {
  try {
    const bus = await Bus.create({ ...(await busData(req.body)), createdBy: req.user._id, updatedBy: req.user._id });
    logActivity(req, 'transport.bus_created', { entityType: 'bus', entityId: bus._id, summary: bus.number });
    res.status(201).json({ bus });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, err.keyPattern?.trackerDeviceId ? 'That tracker device is already linked to another bus' : 'A bus with this number already exists');
    throw err;
  }
});

export const updateBus = asyncHandler(async (req, res) => {
  const bus = await Bus.findById(req.params.id);
  if (!bus) throw new ApiError(404, 'Bus not found');
  const data = await busData(req.body, true);
  const before = `${bus.number} route:${bus.route || '—'} staff:${bus.trackingStaff.length}`;
  Object.assign(bus, data, { updatedBy: req.user._id });
  try {
    await bus.save();
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, err.keyPattern?.trackerDeviceId ? 'That tracker device is already linked to another bus' : 'A bus with this number already exists');
    throw err;
  }
  if (data.isActive === false) {
    const running = await BusTrip.find({ bus: bus._id, status: 'active' }).select('_id').lean();
    await BusTrip.updateMany({ _id: { $in: running.map((t) => t._id) }, status: 'active' }, { $set: { status: 'stopped', endedAt: new Date(), endedBy: req.user._id, endReason: 'Bus deactivated' } });
    for (const t of await BusTrip.find({ _id: { $in: running.map((r) => r._id) } }).lean()) await recordTripEnd(t);
  }
  logActivity(req, 'transport.bus_updated', { entityType: 'bus', entityId: bus._id, summary: `${before} → ${bus.number} route:${bus.route || '—'} staff:${bus.trackingStaff.length}` });
  res.json({ bus });
});

/** People picker for assignments and trip sharers (managers only; minimal fields). */
export const pickPeople = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ people: [] });
  const re = new RegExp(escapeRegex(q), 'i');
  const roles = req.query.kind === 'sharers' ? TRIP_SHARER_ROLES : TRANSPORT_VIEW_ROLES;
  const people = await User.find({ isActive: true, role: { $in: roles }, $or: [{ name: re }, { rollNo: re }, { employeeId: re }] })
    .select('name rollNo employeeId role department year section')
    .limit(20)
    .lean();
  res.json({ people });
});

// Passenger lists: transport managers only.
export const listAssignments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.route && mongoose.isValidObjectId(req.query.route)) filter.route = req.query.route;
  if (req.query.bus && mongoose.isValidObjectId(req.query.bus)) filter.bus = req.query.bus;
  const rows = await TransportAssignment.find(filter).populate('user', 'name rollNo role department year section').populate('route', 'name stops').populate('bus', 'number').limit(2000).lean();
  res.json({
    assignments: rows.map((a) => ({
      _id: a._id,
      user: a.user,
      route: a.route ? { _id: a.route._id, name: a.route.name } : null,
      bus: a.bus || null,
      stop: a.route?.stops?.find((s) => sameId(s._id, a.stop)) || null,
    })),
  });
});

export const upsertAssignment = asyncHandler(async (req, res) => {
  const { user: userId, route: routeId, bus: busId, stop: stopId } = req.body;
  const user = await User.findOne({ _id: userId, isActive: true, role: { $in: TRANSPORT_VIEW_ROLES } }).select('name').lean();
  if (!user) throw new ApiError(422, 'Choose an active student or staff member');
  const route = await BusRoute.findOne({ _id: routeId, isActive: true }).lean();
  if (!route) throw new ApiError(422, 'Choose an active route');
  if (stopId && !route.stops.some((s) => sameId(s._id, stopId))) throw new ApiError(422, 'That stop is not on this route');
  if (busId && !(await Bus.exists({ _id: busId, route: route._id, isActive: true }))) throw new ApiError(422, 'That bus does not run this route');
  const a = await TransportAssignment.findOneAndUpdate(
    { user: user._id },
    { $set: { route: route._id, bus: busId || null, stop: stopId || null, assignedBy: req.user._id } },
    { upsert: true, new: true }
  );
  logActivity(req, 'transport.assignment_set', { entityType: 'transport_assignment', entityId: a._id, summary: `${user.name} → ${route.name}` });
  res.json({ assignment: a });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const a = await TransportAssignment.findByIdAndDelete(req.params.id);
  if (!a) throw new ApiError(404, 'Assignment not found');
  logActivity(req, 'transport.assignment_removed', { entityType: 'transport_assignment', entityId: a._id });
  res.json({ ok: true });
});
