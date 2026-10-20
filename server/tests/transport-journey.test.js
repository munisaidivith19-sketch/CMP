/**
 * Direction-aware journeys: planned stop order per direction, server-side
 * stop arrival / departure detection, ETAs, journey history and reports.
 *
 * TEST DATA ONLY — synthetic users, buses and coordinates on a straight line
 * north of 13.000° N, 80.000° E. Every GPS track here is generated.
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { writeLimiter, locationLimiter } from '../src/middleware/rateLimit.js';

const { resetIngestState } = await import('../src/services/transport/ingest.js');
const { resetEventState } = await import('../src/services/transport/events.js');
const { resetJourneyState } = await import('../src/services/transport/stopEvents.js');
const { transportConfig } = await import('../src/services/transport/config.js');
const J = await import('../src/services/transport/journey.js');

const LNG = 80.0;
// ~1.11 km between stops; the college is the last stop (the stored order runs towards the college).
const STOPS = [
  { _id: 'sA', name: 'Synthetic Stop A', lat: 13.0, lng: LNG, sequence: 1, scheduledTime: '07:30' },
  { _id: 'sB', name: 'Synthetic Stop B', lat: 13.01, lng: LNG, sequence: 2, scheduledTime: '07:40' },
  { _id: 'sC', name: 'Synthetic College', lat: 13.02, lng: LNG, sequence: 3, isCollege: true, scheduledTime: '07:50' },
];
const cfg = { ...transportConfig() };
const ms = (s) => s * 1000;
const T0 = Date.UTC(2026, 9, 1, 2, 0, 0); // pure tests only

/** Feed fixes [lat, secondsFromT0, speed?, accuracy?] through the tracker. */
function run(planStops, path, fixes, state = J.initialTracker()) {
  const events = [];
  let s = state;
  for (const [lat, sec, speed = 10, accuracy = 10] of fixes) {
    const r = J.stepTracker(s, path, planStops, { lat, lng: LNG, at: new Date(T0 + ms(sec)), speed, accuracy }, cfg);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
const forward = () => {
  const plan = J.planFor({ _id: 'r1', stops: STOPS }, 'towards_college');
  return { plan, path: J.tripPath({ stops: STOPS }, plan.stops, plan.mode) };
};
// A complete, well-sampled run from Stop A to the college.
const FULL_RUN = [
  [13.0, 0, 0], [13.0002, 5, 0], [13.003, 15, 20],
  [13.0098, 45, 20], [13.01, 48, 3], [13.0101, 52, 0], [13.014, 62, 20],
  [13.0198, 90, 5], [13.02, 94, 0],
];

describe('stop order per direction', () => {
  test('towards the college follows the stored order; towards home reverses it, without the morning timetable', () => {
    const route = { _id: 'r1', stops: [...STOPS].reverse() }; // stored out of order on purpose
    assert.equal(J.forwardDirection(route), 'towards_college');
    const there = J.planFor(route, 'towards_college');
    assert.equal(there.mode, 'forward');
    assert.deepEqual(there.stops.map((s) => s.name), ['Synthetic Stop A', 'Synthetic Stop B', 'Synthetic College']);
    assert.equal(there.stops[0].scheduledTime, '07:30');
    const back = J.planFor(route, 'towards_home');
    assert.equal(back.mode, 'reverse');
    assert.deepEqual(back.stops.map((s) => s.name), ['Synthetic College', 'Synthetic Stop B', 'Synthetic Stop A']);
    assert.ok(back.stops.every((s) => !s.scheduledTime), 'a reversed run has no timetable of its own');
  });

  test('a separately configured return route is followed with its own stops; an inactive one falls back to reverse', () => {
    const ret = { _id: 'r2', isActive: true, stops: [
      { _id: 'x1', name: 'Synthetic College Gate 2', lat: 13.0205, lng: 80.001, sequence: 1, isCollege: true, scheduledTime: '16:30' },
      { _id: 'x2', name: 'Synthetic Stop D', lat: 13.005, lng: 80.002, sequence: 2, scheduledTime: '16:45' },
    ] };
    const p = J.planFor({ _id: 'r1', stops: STOPS }, 'towards_home', ret);
    assert.equal(p.mode, 'return_route');
    assert.equal(String(p.routeId), 'r2');
    assert.deepEqual(p.stops.map((s) => s.name), ['Synthetic College Gate 2', 'Synthetic Stop D']);
    assert.equal(p.stops[1].scheduledTime, '16:45', 'its own timetable is real');
    assert.equal(J.planFor({ _id: 'r1', stops: STOPS }, 'towards_home', { ...ret, isActive: false }).mode, 'reverse');
    assert.equal(J.planFor({ _id: 'r1', stops: STOPS }, 'towards_home', { ...ret, _id: 'r1' }).mode, 'reverse', 'never itself');
  });

  test('a route stored college-first runs towards home in its own order', () => {
    const route = { _id: 'r3', stops: [...STOPS].reverse().map((s, i) => ({ ...s, sequence: i + 1 })) };
    assert.equal(J.forwardDirection(route), 'towards_home');
    assert.equal(J.planFor(route, 'towards_home').mode, 'forward');
    assert.equal(J.planFor(route, 'towards_college').mode, 'reverse');
    assert.equal(J.planFor(route, 'towards_college').stops[2].name, 'Synthetic College');
  });

  test('road geometry is reversed for the return run; stop distances always increase in travel order', () => {
    const geometry = [[LNG, 13.0], [80.0005, 13.005], [LNG, 13.01], [80.0005, 13.015], [LNG, 13.02]];
    const route = { _id: 'r1', stops: STOPS, geometry };
    const back = J.planFor(route, 'towards_home');
    const path = J.tripPath(route, back.stops, back.mode);
    assert.equal(path.exact, true);
    assert.equal(path.reversedRoad, true);
    assert.deepEqual(path.points[0], { lat: 13.02, lng: LNG });
    assert.ok(path.stopAlong[0] < path.stopAlong[1] && path.stopAlong[1] < path.stopAlong[2]);
  });

  test('geometry that no longer passes the stops is not trusted (stop-to-stop lines instead)', () => {
    const far = [[80.05, 13.0], [80.05, 13.02]]; // ~5 km east of every stop
    const plan = J.planFor({ stops: STOPS, geometry: far }, 'towards_college');
    const path = J.tripPath({ stops: STOPS, geometry: far }, plan.stops, plan.mode);
    assert.equal(path.exact, false);
  });
});

describe('arrival and departure detection', () => {
  test('a well-sampled run records each arrival and departure once, at the fix times, in order', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, FULL_RUN);
    assert.deepEqual(events.map((e) => `${e.type}:${e.order}`), ['arrival:0', 'departure:0', 'arrival:1', 'departure:1', 'arrival:2']);
    const at = (t, o) => events.find((e) => e.type === t && e.order === o).at.getTime();
    assert.equal(at('arrival', 0), T0, 'standing at the stop: arrival at the first fix there');
    assert.equal(at('departure', 0), T0 + ms(5), 'departure = last fix still at the stop');
    assert.equal(at('arrival', 1), T0 + ms(45), 'two fixes at the stop: arrival at the first of them');
    assert.equal(at('departure', 1), T0 + ms(52));
    assert.equal(at('arrival', 2), T0 + ms(90));
    assert.equal(state.nextOrder, 3);
    assert.equal(state.atOrder, 2);
    assert.deepEqual(state.missed, []);
  });

  test('repeated fixes at a stop never record it twice', () => {
    const { plan, path } = forward();
    const fixes = [[13.0, 0, 0], ...Array.from({ length: 10 }, (_, i) => [13.0001, 5 + i * 5, 0])];
    const { events } = run(plan.stops, path, fixes);
    assert.equal(events.filter((e) => e.type === 'arrival').length, 1);
    assert.equal(events.filter((e) => e.type === 'departure').length, 0, 'still standing there');
  });

  test('an out-of-order or duplicate fix changes nothing', () => {
    const { plan, path } = forward();
    const { state } = run(plan.stops, path, FULL_RUN.slice(0, 5));
    for (const sec of [48, 30, 0]) {
      const r = J.stepTracker(state, path, plan.stops, { lat: 13.01, lng: LNG, at: new Date(T0 + ms(sec)), speed: 0, accuracy: 5 }, cfg);
      assert.equal(r.skipped, 'out_of_order');
      assert.equal(r.state, state);
      assert.deepEqual(r.events, []);
    }
  });

  test('one noisy fix next to a later stop records nothing (implausible progress is off the plausible stretch)', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, [[13.0, 0, 0], [13.0002, 5, 0], [13.02, 10, 0]]);
    assert.deepEqual(events.map((e) => e.type), ['arrival'], 'only the real arrival at Stop A');
    assert.equal(state.nextOrder, 1);
    assert.equal(state.offRoute, true);
  });

  test('inaccurate fixes are never used as evidence', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, [[13.0, 0, 0, 90], [13.0, 5, 0, 120]]);
    assert.deepEqual(events, []);
    assert.equal(state.lowAccuracy, true);
    assert.equal(J.nextStops(state, plan.stops, 'live').uncertain, true);
  });

  test('passing a stop at speed: one fix at the stop then progress beyond it records arrival and departure', () => {
    const { plan, path } = forward();
    const { events } = run(plan.stops, path, [[13.0, 0, 0], [13.003, 15, 20], [13.0099, 45, 20], [13.0135, 60, 20]]);
    assert.deepEqual(events.map((e) => `${e.type}:${e.order}`), ['arrival:0', 'departure:0', 'arrival:1', 'departure:1']);
    assert.equal(events[2].at.getTime(), T0 + ms(45));
  });

  test('a GPS gap over a stop marks it "not detected" — no time is invented', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, [[13.0, 0, 0], [13.003, 15, 20], [13.0175, 75, 20]]);
    assert.ok(!events.some((e) => e.order === 1), 'Stop B has no event');
    assert.deepEqual(state.missed, [{ order: 1, reason: 'not_detected' }]);
    assert.equal(state.nextOrder, 2);
  });

  test('a trip started mid-route marks the stops behind as passed before tracking', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, [[13.0125, 0, 15], [13.014, 6, 15]]);
    assert.deepEqual(events, []);
    assert.deepEqual(state.missed, [{ order: 0, reason: 'before_tracking' }, { order: 1, reason: 'before_tracking' }]);
    assert.equal(J.nextStops(state, plan.stops, 'live').nextOrder, 2);
  });

  test('a trip whose first position is at its final stop is flagged and never completed (wrong direction)', () => {
    const { plan, path } = forward();
    const { state, events } = run(plan.stops, path, [[13.02, 0, 0], [13.0201, 5, 0], [13.02, 10, 0]]);
    assert.equal(state.directionWarning, true);
    assert.ok(!events.some((e) => e.type === 'arrival' && e.order === 2));
    const ns = J.nextStops(state, plan.stops, 'live');
    assert.equal(ns.uncertain, true);
    assert.match(ns.reason, /direction/);
  });

  test('towards home: the same GPS run in reverse visits College → B → A', () => {
    const plan = J.planFor({ _id: 'r1', stops: STOPS }, 'towards_home');
    const path = J.tripPath({ stops: STOPS }, plan.stops, plan.mode);
    const back = FULL_RUN.map(([lat, sec, sp]) => [13.02 - (lat - 13.0), sec, sp]);
    const { events } = run(plan.stops, path, back);
    assert.deepEqual(events.map((e) => `${e.type}:${plan.stops[e.order].name}`), [
      'arrival:Synthetic College', 'departure:Synthetic College', 'arrival:Synthetic Stop B', 'departure:Synthetic Stop B', 'arrival:Synthetic Stop A',
    ]);
  });

  test('next and following stop, and uncertainty from stale or offline tracking', () => {
    const { plan, path } = forward();
    const { state } = run(plan.stops, path, FULL_RUN.slice(0, 3));
    const ns = J.nextStops(state, plan.stops, 'live');
    assert.deepEqual([ns.currentOrder, ns.nextOrder, ns.followingOrder, ns.uncertain], [null, 1, 2, false]);
    assert.equal(J.nextStops(state, plan.stops, 'stale').uncertain, true);
    assert.match(J.nextStops(state, plan.stops, 'offline').reason, /offline/);
  });
});

describe('ETAs', () => {
  const base = () => {
    // Road geometry through the stops, so confidence reflects the method, not an approximate line.
    const road = { stops: STOPS, geometry: [[LNG, 13.0], [LNG, 13.01], [LNG, 13.02]] };
    const plan = J.planFor(road, 'towards_college');
    const path = J.tripPath(road, plan.stops, plan.mode);
    assert.equal(path.exact, true);
    const { state } = run(plan.stops, path, FULL_RUN.slice(0, 3)); // just left Stop A, ~333 m along
    return { plan, path, state };
  };

  test('no measured speed and no history: a disclosed assumed speed, low confidence — never a division by zero', () => {
    const { plan, path, state } = base();
    for (const speed of [null, 0, 0.4, NaN]) {
      const e = J.stopEtas({ planStops: plan.stops, path, state, fresh: 'live', speed, history: null, now: T0, cfg }).get(1);
      assert.equal(e.status, 'ok');
      assert.equal(e.method, 'assumed_speed');
      assert.equal(e.confidence, 'low');
      assert.equal(e.approximate, true);
      assert.ok(Number.isFinite(e.minutes));
    }
  });

  test('recent moving speed gives a medium-confidence estimate along the remaining route', () => {
    const { plan, path, state } = base();
    const etas = J.stopEtas({ planStops: plan.stops, path, state, fresh: 'live', speed: 10, history: null, now: T0, cfg });
    const b = etas.get(1);
    const c = etas.get(2);
    assert.equal(b.method, 'recent_speed');
    assert.equal(b.confidence, 'medium');
    // ~780 m left at 10 m/s ≈ 78 s.
    const secs = (new Date(b.predictedArrivalAt) - T0) / 1000;
    assert.ok(secs > 60 && secs < 100, String(secs));
    assert.ok(new Date(c.predictedArrivalAt) > new Date(b.predictedArrivalAt), 'later stops later (plus dwell)');
  });

  test('measured history is used once enough trips exist, and only then', () => {
    const { plan, path, state } = base();
    const evs = (trip, depA, arrB, depB, arrC) => [
      { trip, order: 0, stop: 'sA', type: 'departure', at: new Date(T0 + depA * 1000) },
      { trip, order: 1, stop: 'sB', type: 'arrival', at: new Date(T0 + arrB * 1000) },
      { trip, order: 1, stop: 'sB', type: 'departure', at: new Date(T0 + depB * 1000) },
      { trip, order: 2, stop: 'sC', type: 'arrival', at: new Date(T0 + arrC * 1000) },
    ];
    const two = [...evs('t1', 0, 200, 230, 430), ...evs('t2', 0, 220, 250, 450)];
    assert.equal(J.historyFromEvents(two, 3), null, 'two trips are not enough');
    const three = [...two, ...evs('t3', 0, 210, 240, 440)];
    const history = J.historyFromEvents(three, 3);
    assert.equal(history.segments.get('sA>sB'), 210);
    assert.equal(history.dwell.get('sB'), 30);
    const e = J.stopEtas({ planStops: plan.stops, path, state, fresh: 'live', speed: 10, history, now: T0, cfg });
    assert.equal(e.get(1).method, 'history');
    assert.equal(e.get(1).confidence, 'high');
    assert.equal(e.get(2).method, 'history');
  });

  test('stale, offline, off-route or no position: unavailable with a reason, not a guess', () => {
    const { plan, path, state } = base();
    for (const [fresh, st, re] of [['stale', state, /too old/], ['offline', state, /offline/], ['live', { ...state, offRoute: true }, /not on its route/], ['live', J.initialTracker(), /No GPS/]]) {
      const e = J.stopEtas({ planStops: plan.stops, path, state: st, fresh, speed: 10, history: null, now: T0, cfg }).get(st.nextOrder);
      assert.equal(e.status, 'unavailable');
      assert.match(e.reason, re);
    }
  });
});

// ── API: trips, recorded events, history ───────────────────────────

let ctx;
let admin, fac, facOther, principal, student, hod;
let route, returnRoute;
let busN = 0;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
  for (const a of [admin, fac, facOther, principal, student, hod].filter(Boolean)) await locationLimiter.resetKey(`user:${a.u._id}`);
  resetIngestState();
  resetEventState();
  resetJourneyState();
});

before(async () => {
  delete process.env.TRANSPORT_STUDENT_VISIBILITY;
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Synthetic Admin' }),
    mk({ role: 'faculty', name: 'Synthetic Faculty', department: 'CSE', employeeId: 'JF1' }),
    mk({ role: 'faculty', name: 'Other Faculty', department: 'ECE', employeeId: 'JF2' }),
    mk({ role: 'principal', name: 'Synthetic Principal', employeeId: 'JP1' }),
    mk({ name: 'Synthetic Rider', department: 'CSE', section: 'A', semester: 5, rollNo: 'JR1', stayType: 'day_scholar' }),
    mk({ role: 'hod', name: 'Synthetic HOD', department: 'CSE', employeeId: 'JH1' }),
  ]);
  [admin, fac, facOther, principal, student, hod] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  const strip = (s) => ({ name: s.name, lat: s.lat, lng: s.lng, sequence: s.sequence, isCollege: s.isCollege, scheduledTime: s.scheduledTime });
  route = (await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Journey Route', stops: STOPS.map(strip) })).body.route;
  returnRoute = (await call(admin, 'POST', '/transport/routes', { name: 'Synthetic Return Route', stops: [
    { name: 'Synthetic College Back Gate', lat: 13.0205, lng: 80.001, sequence: 1, isCollege: true },
    { name: 'Synthetic Stop D', lat: 13.005, lng: 80.002, sequence: 2 },
  ] })).body.route;
  assert.ok(route?._id && returnRoute?._id);
});
after(async () => {
  await ctx.stop();
});

function call(actor, method, path, body, headers = {}) {
  return ctx.request(method, path, { token: actor?.token, body, headers });
}
async function newBus(routeId = route._id, staff = [fac, hod]) {
  busN += 1;
  const r = await call(admin, 'POST', '/transport/buses', { number: `JRN-${busN}`, route: routeId, gpsSource: 'phone', trackingStaff: staff.map((a) => String(a.u._id)) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.bus;
}
/**
 * Start a trip, then move its start 5 minutes back (trip record and its
 * start event) so the generated fixes — which end a few seconds before now —
 * fall inside the trip, as they would on a real run.
 */
async function start(who, busId, direction) {
  const r = await call(who, 'POST', '/transport/trips', { busId, ...(direction ? { direction } : {}) });
  if (r.status === 201) {
    const startedAt = new Date(Date.now() - ms(300));
    await ctx.models.BusTrip.updateOne({ _id: r.body.trip._id }, { $set: { startedAt } });
    await ctx.models.BusStopEvent.updateMany({ trip: r.body.trip._id }, { $set: { at: startedAt, tripStartedAt: startedAt } });
  }
  return r;
}
/** A track as API fixes, its last fix 3 s before now. */
const apiRun = (track = FULL_RUN) => {
  const t0 = Date.now() - ms(track[track.length - 1][1] + 3);
  return track.map(([lat, sec, speed, accuracy = 8]) => ({ lat, lng: LNG, timestamp: t0 + ms(sec), speed, accuracy }));
};
const send = (who, tripId, fixes) => call(who, 'POST', `/transport/trips/${tripId}/locations`, { fixes });
const eventsOf = (tripId) => ctx.models.BusStopEvent.find({ trip: tripId }).sort({ at: 1 }).lean();

test('API: a trip stores its direction and planned stops; without one it is towards_college, marked assumed', async () => {
  const bus = await newBus();
  const r = await start(fac, bus._id, 'towards_home');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.trip.direction, 'towards_home');
  assert.equal(r.body.trip.directionAssumed, false);
  const t = await ctx.models.BusTrip.findById(r.body.trip._id).lean();
  assert.equal(t.routeMode, 'reverse');
  assert.deepEqual(t.plan.map((s) => s.name), ['Synthetic College', 'Synthetic Stop B', 'Synthetic Stop A']);
  assert.equal((await call(fac, 'POST', `/transport/trips/${t._id}/stop`, { reason: 'stopped' })).status, 200);

  const bus2 = await newBus();
  const r2 = await start(fac, bus2._id);
  assert.equal(r2.body.trip.direction, 'towards_college');
  assert.equal(r2.body.trip.directionAssumed, true);
  assert.equal((await call(fac, 'POST', '/transport/trips', { busId: bus2._id, direction: 'sideways' })).status, 422);
  await call(fac, 'POST', `/transport/trips/${r2.body.trip._id}/stop`, { reason: 'stopped' });
});

test('API: a separately configured return route is followed with its own stops', async () => {
  const withReturn = (await call(admin, 'POST', '/transport/routes', {
    name: 'Synthetic Route With Return',
    stops: STOPS.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, sequence: s.sequence, isCollege: s.isCollege })),
    returnRoute: returnRoute._id,
  })).body.route;
  assert.equal(String(withReturn.returnRoute), String(returnRoute._id));
  assert.equal((await call(admin, 'PUT', `/transport/routes/${withReturn._id}`, { returnRoute: withReturn._id })).status, 422, 'not itself');
  const bus = await newBus(withReturn._id);
  const r = await start(fac, bus._id, 'towards_home');
  const t = await ctx.models.BusTrip.findById(r.body.trip._id).lean();
  assert.equal(t.routeMode, 'return_route');
  assert.equal(String(t.route), String(returnRoute._id));
  assert.equal(String(t.baseRoute), String(withReturn._id));
  assert.deepEqual(t.plan.map((s) => s.name), ['Synthetic College Back Gate', 'Synthetic Stop D']);
  // Viewers get the route actually being followed for the map, beside the bus's own route.
  const view = (await call(student, 'GET', `/transport/buses/${bus._id}`)).body;
  assert.equal(view.route.name, 'Synthetic Route With Return');
  assert.equal(view.journeyRoute.name, 'Synthetic Return Route');
  assert.equal(view.journey.routeMode, 'return_route');
  await call(fac, 'POST', `/transport/trips/${t._id}/stop`, { reason: 'stopped' });
  assert.equal((await call(student, 'GET', `/transport/buses/${bus._id}`)).body.journeyRoute, null, 'no trip, no followed route');
});

test('API: GPS fixes record arrivals and departures; reaching the college completes the trip; predictions stay separate', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id, 'towards_college')).body.trip;
  const res = await send(fac, trip._id, apiRun());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.accepted, FULL_RUN.length, JSON.stringify(res.body.rejected));

  const events = await eventsOf(trip._id);
  assert.deepEqual(events.map((e) => `${e.type}:${e.order}`), ['trip_started:-1', 'arrival:0', 'departure:0', 'arrival:1', 'departure:1', 'arrival:2', 'trip_ended:-1']);
  assert.ok(events.filter((e) => e.order >= 0).every((e) => e.source === 'gps'));
  const arrB = events.find((e) => e.type === 'arrival' && e.order === 1);
  assert.ok(arrB.predictedArrivalAt, 'the prediction made before the arrival is kept');
  assert.notEqual(arrB.predictedArrivalAt.getTime(), arrB.at.getTime(), 'and is not the actual time');
  assert.ok(arrB.scheduledAt, 'real timetable time recorded beside it');
  assert.ok(!('lat' in arrB) && !('lng' in arrB), 'no coordinates stored with events');

  const t = await ctx.models.BusTrip.findById(trip._id).lean();
  assert.equal(t.status, 'completed');
  assert.equal(t.endReason, 'Arrived at the final stop');
  assert.ok(t.collegeArrivedAt && t.finalArrivalAt);
  const ended = events.find((e) => e.type === 'trip_ended');
  assert.equal(ended.endStatus, 'completed');

  // The phone is told the trip is over; resending changes nothing.
  assert.equal((await send(fac, trip._id, apiRun())).status, 409);
  assert.equal((await eventsOf(trip._id)).length, events.length);
});

test('API: duplicate and concurrent submissions never record a stop twice', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id, 'towards_college')).body.trip;
  const fixes = apiRun(FULL_RUN.slice(0, 7));
  assert.equal((await send(fac, trip._id, fixes.slice(0, 3))).body.accepted, 3);
  // The same later fixes, four times at once (retries / a second tab), plus the early ones again.
  const later = fixes.slice(3);
  const results = await Promise.all([send(fac, trip._id, later), send(fac, trip._id, later), send(fac, trip._id, fixes), send(fac, trip._id, later)]);
  assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join());
  assert.equal(results.reduce((n, r) => n + r.body.accepted, 0), later.length, 'each fix accepted once');
  const events = await eventsOf(trip._id);
  const keys = events.map((e) => `${e.type}:${e.order}`);
  assert.equal(new Set(keys).size, keys.length, `duplicates: ${keys}`);
  assert.ok(keys.includes('arrival:0') && keys.includes('departure:0'));
  // Re-sending everything afterwards changes nothing.
  await send(fac, trip._id, fixes);
  assert.equal((await eventsOf(trip._id)).length, events.length);
  // A direct duplicate insert is refused by the database itself.
  const one = events.find((e) => e.type === 'arrival');
  await assert.rejects(ctx.models.BusStopEvent.create({ ...one, _id: undefined }), (err) => err.code === 11000);
  await call(fac, 'POST', `/transport/trips/${trip._id}/stop`, { reason: 'stopped' });
});

test('API: the live journey shows direction, next / following stop, actual times and ETAs to every viewer of the bus', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id, 'towards_college')).body.trip;
  await send(fac, trip._id, apiRun(FULL_RUN.slice(0, 3))); // left Stop A
  const view = await call(student, 'GET', `/transport/buses/${bus._id}`);
  assert.equal(view.status, 200);
  for (const k of ['bus', 'route', 'progress', 'eta', 'travelled', 'serverTime']) assert.ok(k in view.body, `existing field ${k} kept`);
  const j = view.body.journey;
  assert.equal(j.direction, 'towards_college');
  assert.equal(j.nextStop.name, 'Synthetic Stop B');
  assert.equal(j.followingStop.name, 'Synthetic College');
  assert.equal(j.stops[0].status, 'departed');
  assert.ok(j.stops[0].actualArrivalAt && j.stops[0].actualDepartureAt);
  assert.equal(j.stops[0].arrivalSource, 'gps');
  assert.equal(j.nextStop.eta.status, 'ok');
  assert.ok(j.college.predictedArrivalAt);
  assert.equal(j.college.actualArrivalAt, null, 'no actual time before it happens');
  assert.ok(!JSON.stringify(j).includes('Synthetic Faculty'), 'no operator name for viewers');

  const viaTrip = await call(student, 'GET', `/transport/trips/${trip._id}/journey`);
  assert.equal(viaTrip.status, 200);
  assert.equal(viaTrip.body.journey.nextStop.name, 'Synthetic Stop B');
  assert.equal(viaTrip.body.timezone, 'Asia/Kolkata');
  await call(fac, 'POST', `/transport/trips/${trip._id}/stop`, { reason: 'stopped' });
});

test('API: direction can be corrected only on an active trip before any stop is recorded', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id)).body.trip;
  assert.equal((await call(facOther, 'PATCH', `/transport/trips/${trip._id}/direction`, { direction: 'towards_home' })).status, 403);
  const ok = await call(fac, 'PATCH', `/transport/trips/${trip._id}/direction`, { direction: 'towards_home' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.trip.direction, 'towards_home');
  assert.equal(ok.body.trip.directionAssumed, false);
  // Bus at the college, departing towards home: College recorded → no more changes.
  const home = [[13.02, 0, 0], [13.0198, 5, 0], [13.017, 15, 20]];
  await send(fac, trip._id, apiRun(home));
  const r = await call(fac, 'PATCH', `/transport/trips/${trip._id}/direction`, { direction: 'towards_college' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'stops_recorded');
  await call(fac, 'POST', `/transport/trips/${trip._id}/stop`, { reason: 'stopped' });
  assert.equal((await call(admin, 'PATCH', `/transport/trips/${trip._id}/direction`, { direction: 'towards_college' })).body.code, 'trip_not_active', 'an ended trip is never reversed');
});

test('API: managers record a missing stop or correct one, with a reason; it is marked manual and audited', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id, 'towards_college')).body.trip;
  await send(fac, trip._id, apiRun(FULL_RUN.slice(0, 3)));
  const body = { order: 1, type: 'arrival', at: new Date(Date.now() - 20000).toISOString(), reason: 'Conductor confirmed the stop' };
  assert.equal((await call(fac, 'POST', `/transport/trips/${trip._id}/stop-events`, body)).status, 403, 'sharers cannot');
  assert.equal((await call(admin, 'POST', `/transport/trips/${trip._id}/stop-events`, { ...body, reason: '' })).status, 422, 'reason required');
  assert.equal((await call(admin, 'POST', `/transport/trips/${trip._id}/stop-events`, { ...body, at: new Date(Date.now() + 3600000).toISOString() })).status, 422, 'not in the future');
  assert.equal((await call(admin, 'POST', `/transport/trips/${trip._id}/stop-events`, { ...body, order: 9 })).status, 422);

  const rec = await call(admin, 'POST', `/transport/trips/${trip._id}/stop-events`, body);
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.equal(rec.body.event.source, 'manual');
  assert.equal(rec.body.corrected, false);

  const gpsArrival = (await eventsOf(trip._id)).find((e) => e.type === 'arrival' && e.order === 0);
  const fixAt = new Date(gpsArrival.at.getTime() + 2000).toISOString();
  const cor = await call(admin, 'POST', `/transport/trips/${trip._id}/stop-events`, { order: 0, type: 'arrival', at: fixAt, reason: 'Clock check' });
  assert.equal(cor.status, 200);
  assert.equal(cor.body.corrected, true);
  assert.equal(cor.body.event.previousSource, 'gps');
  assert.equal(cor.body.event.previousAt, gpsArrival.at.toISOString(), 'the GPS time is kept');
  assert.equal(await ctx.models.BusStopEvent.countDocuments({ trip: trip._id, type: 'arrival', order: 0 }), 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(await ctx.models.Activity.exists({ action: 'transport.stop_event_corrected' }));
  assert.ok(await ctx.models.Activity.exists({ action: 'transport.stop_event_recorded' }));
  await call(fac, 'POST', `/transport/trips/${trip._id}/stop`, { reason: 'stopped' });
});

test('API: journey history — roles, own trips only for sharers, no coordinates, interrupted trips', async () => {
  const bus = await newBus();
  const trip = (await start(fac, bus._id, 'towards_college')).body.trip;
  await send(fac, trip._id, apiRun(FULL_RUN.slice(0, 3)));
  await call(fac, 'POST', `/transport/trips/${trip._id}/stop`, { reason: 'stopped' });

  assert.equal((await call(student, 'GET', '/transport/history/trips')).status, 403);
  assert.equal((await call(student, 'GET', `/transport/history/trips/${trip._id}`)).status, 403);
  assert.equal((await call(fac, 'GET', '/transport/history/report')).status, 403, 'reports are for history roles');

  const all = await call(principal, 'GET', '/transport/history/trips?range=all');
  assert.equal(all.status, 200);
  assert.equal(all.body.scope, 'all');
  const row = all.body.trips.find((t) => t._id === trip._id);
  assert.ok(row);
  assert.equal(row.status, 'stopped');
  assert.equal(row.interrupted, true);
  assert.equal(row.operator.name, 'Synthetic Faculty');
  assert.equal(row.stopsRecorded, 1);

  const own = await call(fac, 'GET', '/transport/history/trips?range=all');
  assert.equal(own.body.scope, 'own');
  assert.ok(own.body.trips.length >= 1 && own.body.trips.every((t) => t.operator?.self));
  assert.deepEqual((await call(facOther, 'GET', '/transport/history/trips?range=all')).body.trips, []);
  assert.equal((await call(facOther, 'GET', `/transport/history/trips/${trip._id}`)).status, 404);

  const detail = await call(principal, 'GET', `/transport/history/trips/${trip._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.stops[0].arrivalSource, 'gps');
  assert.ok(detail.body.stops[0].actualDepartureAt);
  assert.equal(detail.body.stops[1].notRecorded, 'not_detected');
  assert.equal(detail.body.stops[1].actualArrivalAt, null);
  assert.ok(Number.isFinite(detail.body.stops[0].delayMinutes), 'compared with the real timetable');
  const text = JSON.stringify(detail.body);
  assert.ok(!/"lat"|"lng"/.test(text), 'no positions in history');

  const filtered = await call(principal, 'GET', `/transport/history/trips?range=all&bus=${bus._id}&direction=towards_home`);
  assert.deepEqual(filtered.body.trips, []);
  assert.equal((await call(principal, 'GET', '/transport/history/trips?status=interrupted&range=all')).body.trips.some((t) => t._id === trip._id), true);
  assert.equal((await call(principal, 'GET', '/transport/history/trips?direction=north')).status, 422);
});

test('API: an ended trip from days ago is history — not visible to students as a live journey', async () => {
  const bus = await newBus();
  const old = await ctx.models.BusTrip.create({ bus: bus._id, route: route._id, source: 'phone', startedBy: fac.u._id, sharedBy: fac.u._id, status: 'completed', startedAt: new Date(Date.now() - 3 * 86400000), endedAt: new Date(Date.now() - 3 * 86400000 + 3600000), direction: 'towards_college', plan: [] });
  assert.equal((await call(student, 'GET', `/transport/trips/${old._id}/journey`)).status, 404);
  assert.equal((await call(principal, 'GET', `/transport/trips/${old._id}/journey`)).status, 200);
});

test('API: history dates are campus (Asia/Kolkata) days — 00:15 IST belongs to that day, not the UTC one before', async () => {
  const bus = await newBus();
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - 4 * 86400000));
  const prev = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - 5 * 86400000));
  const startedAt = new Date(`${key}T00:15:00+05:30`); // 18:45 UTC the previous calendar day
  const t = await ctx.models.BusTrip.create({ bus: bus._id, route: route._id, source: 'phone', startedBy: fac.u._id, status: 'completed', startedAt, endedAt: new Date(startedAt.getTime() + 1800000), direction: 'towards_college' });
  const on = await call(principal, 'GET', `/transport/history/trips?from=${key}&to=${key}&bus=${bus._id}`);
  assert.deepEqual(on.body.trips.map((r) => r._id), [String(t._id)]);
  assert.equal(on.body.trips[0].campusDate, key);
  assert.equal(on.body.trips[0].tripStartedAt, startedAt.toISOString(), 'stored and returned in UTC');
  const before = await call(principal, 'GET', `/transport/history/trips?from=${prev}&to=${prev}&bus=${bus._id}`);
  assert.deepEqual(before.body.trips, []);
});

test('API: reports show averages only when enough measured trips exist', async () => {
  const bus = await newBus();
  const mkTrip = async (i) => {
    const startedAt = new Date(Date.now() - (i + 1) * 86400000);
    const plan = STOPS.map((s) => ({ stop: s._id === 'sA' ? route.stops[0]._id : s._id === 'sB' ? route.stops[1]._id : route.stops[2]._id, name: s.name, lat: s.lat, lng: s.lng, isCollege: Boolean(s.isCollege), scheduledTime: s.scheduledTime }));
    const t = await ctx.models.BusTrip.create({ bus: bus._id, route: route._id, baseRoute: route._id, source: 'phone', startedBy: fac.u._id, status: 'completed', startedAt, endedAt: new Date(startedAt.getTime() + 1500000), direction: 'towards_college', routeMode: 'forward', plan });
    const ev = (type, order, min) => ({ trip: t._id, bus: bus._id, route: route._id, direction: 'towards_college', type, order, stop: plan[order].stop, stopName: plan[order].name, at: new Date(startedAt.getTime() + min * 60000), source: 'gps', tripStartedAt: startedAt });
    await ctx.models.BusStopEvent.insertMany([ev('arrival', 0, 0), ev('departure', 0, 1), ev('arrival', 1, 10 + i), ev('departure', 1, 11 + i), ev('arrival', 2, 20 + i)]);
  };
  await mkTrip(0);
  await mkTrip(1);
  let rep = await call(principal, 'GET', `/transport/history/report?range=all&bus=${bus._id}`);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.measured, true);
  assert.equal(rep.body.journeyDuration.sufficient, false);
  assert.equal(rep.body.journeyDuration.samples, 2);
  assert.ok(!('averageMinutes' in rep.body.journeyDuration), 'no average from too few trips');
  await mkTrip(2);
  rep = await call(principal, 'GET', `/transport/history/report?range=all&bus=${bus._id}`);
  assert.equal(rep.body.journeyDuration.sufficient, true);
  assert.equal(rep.body.journeyDuration.averageMinutes, 20); // first departure (1) → college (20..22): 19, 20, 21
  assert.equal(rep.body.segments[0].from, 'Synthetic Stop A');
  assert.equal(rep.body.segments[0].averageMinutes, 10);
  assert.equal(rep.body.punctuality, null, 'events without a scheduled time: no punctuality claimed');
});

test('API: config tells clients the campus timezone and who may open history and reports', async () => {
  const c = (who) => call(who, 'GET', '/transport/config').then((r) => r.body);
  const [st, f, p, a] = await Promise.all([c(student), c(fac), c(principal), c(admin)]);
  for (const x of [st, f, p, a]) assert.equal(x.timezone, 'Asia/Kolkata');
  assert.deepEqual([st.canViewHistory, st.canViewReports], [false, false]);
  assert.deepEqual([f.canViewHistory, f.canViewReports], [true, false]);
  assert.deepEqual([p.canViewHistory, p.canViewReports], [true, true]);
  assert.deepEqual([a.canViewHistory, a.canViewReports], [true, true]);
});
