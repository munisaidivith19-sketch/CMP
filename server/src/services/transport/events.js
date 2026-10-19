/**
 * Meaningful bus events → notifications (never one per GPS fix; map movement
 * goes over the socket only). Evaluated at most every 30 s per bus, each event
 * at most once per trip and person (eventKey), and only for people whose
 * transport assignment names the route and a stop. All use the optional
 * 'transport' category, so anyone can switch them off.
 *
 *   - approaching:  ETA to the person's stop ≤ BUS_APPROACHING_MINUTES;
 *   - delay:        only when the stop has a scheduled time and the
 *                   speed-based estimate is ≥ 10 min later than it;
 *   - arrived:      the bus is within 150 m of the route's college stop.
 * Texts carry the bus number, route and stop only — no personal data.
 */
import BusRoute from '../../models/BusRoute.js';
import TransportAssignment from '../../models/TransportAssignment.js';
import { notifyUsers } from '../../utils/notify.js';
import { campusParts } from '../../utils/dates.js';
import { computeEta, recentSpeed } from './eta.js';
import { haversine } from './geo.js';
import { transportConfig } from './config.js';

const lastEval = new Map();
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function evaluateTripEvents(bus, fix, trip, { now = Date.now(), force = false } = {}) {
  if (!trip?._id || !bus.route) return;
  const key = String(bus._id);
  if (!force && lastEval.has(key) && now - lastEval.get(key) < 30000) return;
  lastEval.set(key, now);

  const cfg = transportConfig();
  const route = await BusRoute.findById(bus.route._id || bus.route).lean();
  if (!route) return;
  const assigned = await TransportAssignment.find({ route: route._id, stop: { $ne: null }, $or: [{ bus: null }, { bus: { $exists: false } }, { bus: bus._id }] }).select('user stop').lean();
  const tag = `${bus.number} · ${route.name}`;

  // Arrived at the college.
  const college = route.stops.find((s) => s.isCollege);
  if (college && haversine(fix, college) <= 150) {
    const everyone = await TransportAssignment.find({ route: route._id }).distinct('user');
    await notifyUsers(everyone, { type: 'transport', title: `${bus.number} reached the college`, message: `${tag} arrived at ${college.name}.`, link: `/transport?bus=${bus._id}` }, { category: 'transport', eventKey: `bus:arrived:${trip._id}` });
  }

  if (!assigned.length) return;
  const speed = await recentSpeed(bus._id, now);
  const nowMin = minutesOf(campusParts(new Date(now)).time);
  const byStop = new Map();
  for (const a of assigned) {
    const k = String(a.stop);
    if (!byStop.has(k)) byStop.set(k, []);
    byStop.get(k).push(a.user);
  }
  for (const [stopId, users] of byStop) {
    const eta = computeEta({ route, location: fix, stopId, speed, now, campusMinutesNow: nowMin, cfg });
    if (eta.status !== 'ok') continue;
    if (eta.minutes <= cfg.approachingMinutes) {
      await notifyUsers(users, {
        type: 'transport',
        title: `${bus.number} is about ${eta.minutes} min away`,
        message: `${tag} is approaching ${eta.stop.name}${eta.confidence === 'low' ? ' (approximate)' : ''}.`,
        link: `/transport?bus=${bus._id}&stop=${stopId}`,
      }, { category: 'transport', eventKey: `bus:approach:${trip._id}:${stopId}` });
    }
    const stop = route.stops.find((s) => String(s._id) === stopId);
    if (stop?.scheduledTime && eta.method === 'recent_speed') {
      const late = nowMin + eta.minutes - minutesOf(stop.scheduledTime);
      if (late >= 10) {
        await notifyUsers(users, {
          type: 'transport',
          title: `${bus.number} is running late`,
          message: `${tag} is expected at ${stop.name} about ${Math.round(late)} min after its ${stop.scheduledTime} schedule.`,
          link: `/transport?bus=${bus._id}&stop=${stopId}`,
        }, { category: 'transport', eventKey: `bus:delay:${trip._id}:${stopId}` });
      }
    }
  }
}

export function resetEventState() {
  lastEval.clear();
}
