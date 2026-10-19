/**
 * Bus trips: start / stop with authorization, and the sweeper that ends
 * trips nobody is reporting for (idle) or that ran too long, so a phone is
 * never asked to keep sharing outside an active trip.
 */
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
    // Who is sharing is staff information: only for managers and the sharer themself.
    ...(viewer && (isManager(viewer) || sameId(trip.sharedBy, viewer)) ? { sharedBy: trip.sharedBy } : {}),
    mine: Boolean(viewer && sameId(trip.sharedBy, viewer)),
  };

function announce(trip, extra = {}) {
  emitToRooms([`bus:${trip.bus}`, 'transport:all'], 'bus:trip', { busId: String(trip.bus), tripId: String(trip._id), status: trip.status, ...extra });
}

/**
 * Start a trip for a bus. Phone sharing: only staff the bus lists in
 * `trackingStaff` (or a transport manager). One active trip per bus — another
 * person cannot take over a running trip; a manager must stop it first.
 */
export async function startTrip(user, busId) {
  if (!TRIP_SHARER_ROLES.includes(user.role)) throw new ApiError(403, 'You cannot start bus trips');
  const bus = await Bus.findById(busId);
  if (!bus || !bus.isActive) throw new ApiError(404, 'Bus not found');
  const assigned = bus.trackingStaff.some((id) => sameId(id, user));
  if (!assigned && !isManager(user)) throw new ApiError(403, 'You are not assigned to share this bus’s location');
  const source = bus.gpsSource === 'tracker' ? 'tracker' : 'phone';
  if (source === 'tracker' && !isManager(user)) throw new ApiError(422, 'This bus reports through its own GPS tracker');
  let trip;
  try {
    trip = await BusTrip.create({ bus: bus._id, route: bus.route, source, sharedBy: source === 'phone' ? user._id : undefined, startedBy: user._id });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, `${bus.number} already has an active trip — it must be stopped before another one starts`);
    throw err;
  }
  announce(trip);
  if (bus.route) {
    const riders = await TransportAssignment.find({ route: bus.route }).distinct('user');
    notifyUsers(riders, { type: 'transport', title: `${bus.number} has started its trip`, message: 'Live tracking is on — open Bus Tracking to follow it.', link: `/transport?bus=${bus._id}` }, { category: 'transport', eventKey: `bus:trip:${trip._id}` });
  }
  return { trip, bus };
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
  if (updated) announce(updated);
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
    if (updated) announce(updated);
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
