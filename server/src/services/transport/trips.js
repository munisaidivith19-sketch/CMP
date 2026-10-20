/**
 * Bus trips: start / stop with authorization, and the sweeper that ends
 * trips nobody is reporting for (idle) or that ran too long, so a phone is
 * never asked to keep sharing outside an active trip.
 */
import crypto from 'node:crypto';
import Bus from '../../models/Bus.js';
import { registerJob, runJob } from '../soc/monitors.js';
import BusTrip from '../../models/BusTrip.js';
import TransportAssignment from '../../models/TransportAssignment.js';
import User from '../../models/User.js';
import { ApiError } from '../../utils/http.js';
import { sameId } from '../../utils/permissions.js';
import { notifyUsers } from '../../utils/notify.js';
import { emitToRooms } from '../../config/socket.js';
import { TRANSPORT_MANAGE_ROLES, TRIP_SHARER_ROLES } from '../../constants.js';
import { transportConfig } from './config.js';
import { journeyFields, recordTripEnd, recordTripStart } from './stopEvents.js';

const isManager = (user) => TRANSPORT_MANAGE_ROLES.includes(user.role);

export const tripApi = (trip, viewer) =>
  trip && {
    _id: trip._id,
    bus: trip.bus,
    route: trip.route,
    source: trip.source,
    status: trip.status,
    startedAt: trip.startedAt,
    endedAt: trip.endedAt || null,
    endReason: trip.endReason || null,
    lastLocationAt: trip.lastLocationAt || null,
    direction: trip.direction || null,
    directionAssumed: Boolean(trip.directionAssumed),
    finalArrivalAt: trip.finalArrivalAt || null,
    collegeArrivedAt: trip.collegeArrivedAt || null,
    // Who is sharing is staff information: only for managers and the sharer themself.
    ...(viewer && (isManager(viewer) || sameId(trip.sharedBy, viewer)) ? { sharedBy: trip.sharedBy } : {}),
    mine: Boolean(viewer && sameId(trip.sharedBy, viewer)),
  };

function announce(trip, extra = {}) {
  emitToRooms([`bus:${trip.bus}`, 'transport:all'], 'bus:trip', { busId: String(trip.bus), tripId: String(trip._id), status: trip.status, ...extra });
}

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** Does `key` match the trip's device binding? Trips without one accept any of the sharer's devices. */
export function deviceKeyMatches(trip, key) {
  if (!trip.deviceKeyHash) return true;
  if (typeof key !== 'string' || !key || key.length > 200) return false;
  const a = Buffer.from(hashKey(key));
  const b = Buffer.from(trip.deviceKeyHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Start a trip for a bus. Phone sharing: only staff the bus lists in
 * `trackingStaff` (or a transport manager). One active trip per bus — another
 * person cannot take over a running trip; a manager must stop it first — and
 * one shared trip per person, so one device never reports for two buses.
 *
 * `bindDevice` (the web sharing page): the response carries a one-time device
 * key; only requests with that key may send this trip's locations.
 *
 * `direction` (towards_college | towards_home) fixes the stop order the trip
 * follows; without one the trip is recorded as towards_college, marked assumed.
 */
export async function startTrip(user, busId, { bindDevice = false, direction = null } = {}) {
  if (!TRIP_SHARER_ROLES.includes(user.role)) throw new ApiError(403, 'You cannot start bus trips');
  const bus = await Bus.findById(busId);
  if (!bus || !bus.isActive) throw new ApiError(404, 'Bus not found');
  const assigned = bus.trackingStaff.some((id) => sameId(id, user));
  if (!assigned && !isManager(user)) throw new ApiError(403, 'You are not assigned to share this bus’s location');
  const source = bus.gpsSource === 'tracker' ? 'tracker' : 'phone';
  if (source === 'tracker' && !isManager(user)) throw new ApiError(422, 'This bus reports through its own GPS tracker');
  const busyMsg = `${bus.number} is already being shared by someone else. Ask them to stop, or ask a transport manager to end that trip.`;
  if (source === 'phone') {
    const own = await BusTrip.findOne({ sharedBy: user._id, status: 'active' }).populate('bus', 'number').lean();
    if (own) {
      const same = sameId(own.bus?._id || own.bus, bus);
      throw new ApiError(409, same ? `You are already sharing ${bus.number}${own.channel === 'web' ? ' from another browser tab or device' : ' from the VEXON app'}. Stop that trip first.` : `You are already sharing ${own.bus?.number || 'another bus'}. Stop that trip before sharing ${bus.number}.`, undefined, { code: 'already_sharing', tripId: String(own._id) });
    }
  }
  const deviceKey = bindDevice && source === 'phone' ? crypto.randomBytes(32).toString('base64url') : null;
  const journey = await journeyFields(bus.route, direction);
  let trip;
  try {
    trip = await BusTrip.create({
      bus: bus._id,
      route: bus.route,
      ...journey,
      source,
      sharedBy: source === 'phone' ? user._id : undefined,
      startedBy: user._id,
      channel: bindDevice ? 'web' : 'app',
      ...(deviceKey ? { deviceKeyHash: hashKey(deviceKey) } : {}),
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.sharedBy) throw new ApiError(409, 'You are already sharing another bus. Stop that trip first.', undefined, { code: 'already_sharing' });
    if (err.code === 11000) throw new ApiError(409, busyMsg, undefined, { code: 'bus_busy' });
    throw err;
  }
  announce(trip, { direction: trip.direction });
  await recordTripStart(trip).catch((err) => console.error('[transport] trip start event failed:', err.message));
  if (bus.route) {
    const riders = await TransportAssignment.find({ route: bus.route }).distinct('user');
    notifyUsers(riders, { type: 'transport', title: `${bus.number} has started its trip`, message: 'Live tracking is on — open Bus Tracking to follow it.', link: `/transport?bus=${bus._id}` }, { category: 'transport', eventKey: `bus:trip:${trip._id}` });
  }
  return { trip, bus, deviceKey };
}

/** Stop a trip: the person sharing it, whoever started it, or a manager. */
export async function stopTrip(user, tripId, reason = 'completed') {
  const trip = await BusTrip.findById(tripId);
  if (!trip) throw new ApiError(404, 'Trip not found');
  if (!sameId(trip.sharedBy, user) && !sameId(trip.startedBy, user) && !isManager(user)) throw new ApiError(403, 'You cannot stop this trip');
  if (trip.status !== 'active') return trip;
  const updated = await BusTrip.findOneAndUpdate(
    { _id: trip._id, status: 'active' },
    { $set: { status: reason === 'completed' ? 'completed' : 'stopped', endedAt: new Date(), endedBy: user._id, endReason: String(reason).slice(0, 120) } },
    { new: true }
  );
  if (updated) {
    announce(updated);
    await recordTripEnd(updated).catch((err) => console.error('[transport] trip end event failed:', err.message));
  }
  return updated || trip;
}

/** End idle / over-long trips; warn once when an active trip stops reporting. Returns how many ended. */
export async function sweepTrips(now = Date.now()) {
  const cfg = transportConfig();
  const idleBefore = new Date(now - cfg.tripIdleMinutes * 60000);
  const tooOld = new Date(now - cfg.tripMaxHours * 3600000);
  const stale = await BusTrip.find({
    status: 'active',
    $or: [{ startedAt: { $lt: tooOld } }, { lastLocationAt: { $lt: idleBefore } }, { lastLocationAt: null, startedAt: { $lt: idleBefore } }],
  }).lean();
  for (const t of stale) {
    const updated = await BusTrip.findOneAndUpdate(
      { _id: t._id, status: 'active' },
      { $set: { status: 'timeout', endedAt: new Date(now), endReason: t.startedAt < tooOld ? 'Maximum trip duration reached' : 'No location received — ended automatically' } },
      { new: true }
    );
    if (updated) {
      announce(updated);
      await recordTripEnd(updated).catch((err) => console.error('[transport] trip end event failed:', err.message));
    }
  }

  // Tracking lost (but the trip is still open): tell the sharer and the transport managers, once.
  const lostBefore = new Date(now - cfg.trackingLostMinutes * 60000);
  const quiet = await BusTrip.find({ status: 'active', $or: [{ lastLocationAt: { $lt: lostBefore } }, { lastLocationAt: null, startedAt: { $lt: lostBefore } }] }).populate('bus', 'number').lean();
  if (quiet.length) {
    const managers = await User.find({ role: { $in: TRANSPORT_MANAGE_ROLES }, isActive: true }).distinct('_id');
    for (const t of quiet) {
      announce(t, { tracking: 'lost' });
      await notifyUsers([...managers, ...(t.sharedBy ? [t.sharedBy] : [])], {
        type: 'transport',
        title: `Tracking lost for ${t.bus?.number || 'a bus'}`,
        message: `No location for ${cfg.trackingLostMinutes} minutes. Check the phone / tracker.`,
        link: `/transport?bus=${t.bus?._id || t.bus}`,
      }, { category: 'transport', eventKey: `bus:lost:${t._id}` });
    }
  }
  return stale.length;
}

export function startTripSweeper() {
  registerJob('transport.trip_sweep', { intervalMs: 60_000, description: 'End idle / over-long bus trips' });
  const timer = setInterval(() => runJob('transport.trip_sweep', sweepTrips, { logTag: '[transport] trip sweep' }), 60_000);
  timer.unref();
  return timer;
}
