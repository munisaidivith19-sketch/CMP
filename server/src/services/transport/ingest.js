/**
 * Normalized bus-location ingestion — the ONLY way a position reaches the map.
 *
 * Sources (BUS_GPS_SOURCES):
 *   - 'tracker': the vehicle GPS tracker, through the signed webhook
 *     (controllers/transportController.trackerWebhook) once the institution
 *     connects one;
 *   - 'phone':   an authorized staff phone during a trip it started.
 *
 * Every fix is validated before anything is stored or broadcast: coordinates,
 * fix time (not too old, not in the future, not older than the last accepted
 * one), accuracy, reported speed, the implied speed from the previous fix
 * (teleport / spoof check) and the update rate. A rejected fix changes
 * nothing. Accepted fixes update the bus's latest position (one small write),
 * a thinned history, and are pushed to the bus's socket room. A position is
 * evidence from a device, never proof of where the bus physically is — the
 * map always shows its age.
 */
import Bus from '../../models/Bus.js';
import BusLocation from '../../models/BusLocation.js';
import BusTrip from '../../models/BusTrip.js';
import { emitToRooms } from '../../config/socket.js';
import { haversine, validLatLng } from './geo.js';
import { transportConfig } from './config.js';
import { evaluateTripEvents } from './events.js';

const lastHistoryAt = new Map(); // busId → ms (history thinning)
const lastTripTouch = new Map(); // tripId → ms (trip.lastLocationAt write thinning)

export class FixRejected extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const toNum = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** Parse and validate one raw fix against the bus's previous accepted position. */
export function validateFix(raw, previous, { now = Date.now(), cfg = transportConfig(), source } = {}) {
  const lat = toNum(raw?.lat ?? raw?.latitude);
  const lng = toNum(raw?.lng ?? raw?.longitude);
  if (!validLatLng(lat, lng)) throw new FixRejected('invalid_coordinates', 'Invalid latitude / longitude');
  const t = typeof raw.timestamp === 'number' ? raw.timestamp : Date.parse(raw.timestamp);
  if (!Number.isFinite(t)) throw new FixRejected('invalid_timestamp', 'A fix timestamp is required');
  if (now - t > cfg.maxFixAgeSeconds * 1000) throw new FixRejected('stale', 'The fix is too old');
  if (t - now > cfg.maxFutureSeconds * 1000) throw new FixRejected('future', 'The fix time is in the future');
  const accuracy = toNum(raw.accuracy);
  if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > cfg.maxAccuracyMeters)) {
    throw new FixRejected('inaccurate', `Accuracy worse than ${cfg.maxAccuracyMeters} m`);
  }
  if (accuracy === undefined && source === 'phone') throw new FixRejected('inaccurate', 'Phone fixes must report their accuracy');
  let speed = toNum(raw.speed);
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0 || speed > cfg.maxSpeedMps)) throw new FixRejected('implausible_speed', 'Implausible speed');
  let heading = toNum(raw.heading);
  if (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading > 360)) heading = undefined;

  if (previous?.at) {
    const prevT = new Date(previous.at).getTime();
    if (t <= prevT) throw new FixRejected('out_of_order', 'Older than the last accepted fix');
    const dt = (t - prevT) / 1000;
    if (dt * 1000 < cfg.minIntervalMs) throw new FixRejected('too_frequent', 'Updates are arriving too fast');
    const moved = haversine(previous, { lat, lng });
    // Allow for both fixes' accuracy before judging the implied speed.
    const slack = (accuracy || 0) + (previous.accuracy || 0);
    if (dt < 600 && (moved - slack) / dt > cfg.maxSpeedMps * 1.5) throw new FixRejected('implausible_jump', 'The position jumped implausibly far');
  }
  if (speed === undefined && previous?.at) {
    const dt = (t - new Date(previous.at).getTime()) / 1000;
    if (dt > 0 && dt < 120) speed = haversine(previous, { lat, lng }) / dt;
  }
  return { lat, lng, at: new Date(t), accuracy, speed, heading };
}

/** The payload viewers receive (no personal data). Heading only when moving (otherwise unreliable). */
export const livePayload = (bus, fix, tripId) => ({
  busId: String(bus._id),
  lat: fix.lat,
  lng: fix.lng,
  at: fix.at.toISOString(),
  accuracy: fix.accuracy ?? null,
  speed: fix.speed ?? null,
  heading: fix.heading !== undefined && (fix.speed ?? 0) >= 2 ? fix.heading : null,
  source: fix.source,
  tripId: tripId ? String(tripId) : null,
});

/**
 * Validate and store one fix for `bus` (a Bus document or lean object).
 * Returns the accepted fix; throws FixRejected otherwise.
 */
export async function ingestFix(bus, raw, { source, trip = null, now = Date.now() }) {
  const cfg = transportConfig();
  const fix = { ...validateFix(raw, bus.lastLocation, { now, cfg, source }), source };
  const tripId = trip?._id || null;
  // Conditional write: a concurrent, newer fix wins; an older one is dropped.
  const res = await Bus.updateOne(
    { _id: bus._id, $or: [{ 'lastLocation.at': { $exists: false } }, { 'lastLocation.at': null }, { 'lastLocation.at': { $lt: fix.at } }] },
    { $set: { lastLocation: { ...fix, trip: tripId } } }
  );
  if (!res.modifiedCount) throw new FixRejected('out_of_order', 'A newer fix was already accepted');

  const busKey = String(bus._id);
  if (!lastHistoryAt.has(busKey) || now - lastHistoryAt.get(busKey) >= cfg.historyIntervalMs) {
    lastHistoryAt.set(busKey, now);
    BusLocation.create({ bus: bus._id, trip: tripId, ...fix }).catch((err) => console.error('[transport] history write failed:', err.message));
  }
  if (tripId && (!lastTripTouch.has(String(tripId)) || now - lastTripTouch.get(String(tripId)) >= 15000)) {
    lastTripTouch.set(String(tripId), now);
    await BusTrip.updateOne({ _id: tripId, status: 'active' }, { $set: { lastLocationAt: fix.at } });
  }
  emitToRooms([`bus:${busKey}`, 'transport:all'], 'bus:location', livePayload(bus, fix, tripId));
  evaluateTripEvents(bus, fix, trip).catch((err) => console.error('[transport] events failed:', err.message));
  return fix;
}

/** Test hook. */
export function resetIngestState() {
  lastHistoryAt.clear();
  lastTripTouch.clear();
}
