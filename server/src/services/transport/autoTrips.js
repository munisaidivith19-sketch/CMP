/**
 * Automatic trips for buses with a vehicle GPS tracker: nobody has to press
 * "Start trip" or "Stop".
 *
 *   - Start: with no active trip, the bus moves more than TRIP_AUTO_START_M
 *     (default 500 m) from where it was last standing. The direction comes
 *     from where it set off: within TRIP_AUTO_COLLEGE_M of the route's college
 *     stop → towards_home, otherwise towards_college.
 *   - End: the existing rules (final stop reached, no location for
 *     TRIP_IDLE_MINUTES, TRIP_MAX_HOURS), plus: the bus stays within
 *     TRIP_AUTO_PARK_M for TRIP_AUTO_PARK_MINUTES (parked).
 *   - A manager who stops a tracker trip by hand pauses automatic starts for
 *     TRIP_AUTO_PAUSE_MINUTES, so the bus is not restarted at once.
 *
 * Off with TRACKER_AUTO_TRIPS=false (everywhere) or a bus's `autoTrips: false`.
 * Runs after each tracker webhook batch, on the bus's latest ACCEPTED position.
 */
import Bus from '../../models/Bus.js';
import BusRoute from '../../models/BusRoute.js';
import BusTrip from '../../models/BusTrip.js';
import { transportConfig } from './config.js';
import { haversine } from './geo.js';
import { createTrip, endTripAutomatically } from './trips.js';
import { processFix } from './stopEvents.js';

/** towards_home when the bus set off near the college stop, else towards_college (null: no college stop). */
export async function directionFrom(routeId, from, cfg = transportConfig()) {
  if (!routeId) return null;
  const route = await BusRoute.findById(routeId).select('stops').lean();
  const college = route?.stops?.find((s) => s.isCollege);
  if (!college) return null;
  return haversine(from, college) <= cfg.autoCollegeM ? 'towards_home' : 'towards_college';
}

const point = (p) => ({ lat: p.lat, lng: p.lng, at: new Date(p.at) });

/**
 * One step of the automatic trip logic for a tracker bus. Returns what happened:
 * { action: 'off' | 'anchored' | 'waiting' | 'paused' | 'started' | 'moving' | 'parked' | 'ended', trip? }.
 */
export async function autoTripStep(busId, now = Date.now()) {
  const cfg = transportConfig();
  if (!cfg.autoTrips) return { action: 'off' };
  const bus = await Bus.findById(busId).lean();
  if (!bus || !bus.isActive || bus.gpsSource !== 'tracker' || bus.autoTrips === false) return { action: 'off' };
  const pos = bus.lastLocation;
  if (!pos?.at || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return { action: 'off' };
  const here = point(pos);
  const setAnchor = () => Bus.updateOne({ _id: bus._id }, { $set: { 'autoTrip.anchor': here } });

  const trip = await BusTrip.findOne({ bus: bus._id, status: 'active' }).lean();
  if (trip) {
    // While a trip runs the anchor follows the bus, so after the trip ends the
    // bus must move again before the next trip starts.
    await setAnchor();
    const park = trip.parkAnchor;
    if (!park?.at || haversine(park, here) > cfg.autoParkM) {
      await BusTrip.updateOne({ _id: trip._id, status: 'active' }, { $set: { parkAnchor: here } });
      return { action: 'moving', trip };
    }
    if (here.at.getTime() - new Date(park.at).getTime() >= cfg.autoParkMinutes * 60000) {
      const ended = await endTripAutomatically(trip._id, { reason: `Bus parked for ${cfg.autoParkMinutes} minutes — ended automatically` });
      return { action: 'ended', trip: ended || trip };
    }
    return { action: 'parked', trip };
  }

  const anchor = bus.autoTrip?.anchor;
  if (!anchor?.at) {
    await setAnchor();
    return { action: 'anchored' };
  }
  if (haversine(anchor, here) < cfg.autoStartM) return { action: 'waiting' };
  const pausedUntil = bus.autoTrip?.pausedUntil;
  if (pausedUntil && now < new Date(pausedUntil).getTime()) {
    await setAnchor();
    return { action: 'paused' };
  }

  let created;
  try {
    created = await createTrip(bus, { source: 'tracker', direction: await directionFrom(bus.route, anchor, cfg), autoStarted: true });
  } catch (err) {
    if (err.code === 11000) return { action: 'moving' }; // another batch started it a moment ago
    throw err;
  }
  await setAnchor();
  await BusTrip.updateOne({ _id: created._id }, { $set: { parkAnchor: here, lastLocationAt: here.at } });
  // Feed the position that started the trip into its journey.
  await processFix(bus._id, { ...pos, at: here.at }, created._id).catch((err) => console.error('[transport] auto trip first fix failed:', err.message));
  return { action: 'started', trip: created };
}
