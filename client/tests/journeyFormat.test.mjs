// Journey display helpers: campus-time display, day boundaries, predicted vs recorded wording. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campusDate, campusDayKey, campusLocalToIso, campusTime, delayText, directionText, etaLine, passedFromJourney, stopLine } from '../src/pages/transport/journeyFormat.js';

test('times show on the campus clock (Asia/Kolkata), whatever the device timezone', () => {
  // 02:12 UTC = 07:42 IST
  assert.equal(campusTime('2026-10-20T02:12:00.000Z'), '7:42 am');
  assert.equal(campusTime('2026-10-20T02:12:00.000Z', 'UTC'), '2:12 am');
  assert.equal(campusTime(null), '');
  assert.equal(campusTime('not a date'), '');
});

test('day boundary: 18:45 UTC is already the next day on campus', () => {
  const iso = '2026-10-19T18:45:00.000Z'; // 00:15 IST on 20 Oct
  assert.equal(campusDayKey(new Date(iso)), '2026-10-20');
  assert.equal(campusDate(iso), '20 Oct 2026');
  assert.equal(campusTime(iso), '12:15 am');
  assert.equal(campusDayKey(new Date('2026-10-19T18:15:00.000Z')), '2026-10-19', '23:45 IST is still the 19th');
});

test('a manager’s campus wall-clock entry becomes the right UTC instant', () => {
  assert.equal(campusLocalToIso('2026-10-20T07:42'), '2026-10-20T02:12:00.000Z');
  assert.equal(campusLocalToIso('2026-10-20T00:15'), '2026-10-19T18:45:00.000Z');
  assert.equal(campusLocalToIso('2026-10-20T07:42', 'UTC'), '2026-10-20T07:42:00.000Z');
  assert.equal(campusLocalToIso(''), null);
});

test('direction labels say when the direction was assumed', () => {
  assert.equal(directionText({ direction: 'towards_home' }), 'Towards home');
  assert.equal(directionText({ direction: 'towards_college', directionAssumed: true }), 'Towards college (assumed)');
  assert.equal(directionText(null), '');
});

test('ETAs: approximate ones are marked; unavailable ones show the server’s reason, never a time', () => {
  const at = '2026-10-20T02:18:00.000Z';
  assert.equal(etaLine({ status: 'ok', minutes: 6, predictedArrivalAt: at, approximate: false }), 'about 6 min · 7:48 am');
  assert.equal(etaLine({ status: 'ok', minutes: 6, predictedArrivalAt: at, approximate: true }), '~about 6 min · ~7:48 am');
  assert.equal(etaLine({ status: 'ok', minutes: 0, predictedArrivalAt: at }), 'arriving now · 7:48 am');
  assert.equal(etaLine({ status: 'unavailable', reason: 'Tracking is offline — no recent GPS position' }), 'Tracking is offline — no recent GPS position');
});

test('stop rows keep recorded times and predictions apart', () => {
  const arr = '2026-10-20T02:12:00.000Z';
  const dep = '2026-10-20T02:13:00.000Z';
  assert.equal(stopLine({ status: 'departed', actualArrivalAt: arr, actualDepartureAt: dep }), 'Arrived 7:42 am · left 7:43 am');
  assert.equal(stopLine({ status: 'arrived', actualArrivalAt: arr }), 'At the stop since 7:42 am');
  assert.equal(stopLine({ status: 'not_recorded', notRecordedReason: 'not_detected' }), 'Passed — arrival not detected');
  assert.equal(stopLine({ status: 'not_recorded', notRecordedReason: 'before_tracking' }), 'Passed before tracking started');
  assert.match(stopLine({ status: 'upcoming', eta: { status: 'ok', minutes: 4, predictedArrivalAt: dep } }), /^Expected about 4 min/);
  assert.equal(stopLine({ status: 'upcoming' }), 'Upcoming');
});

test('delay against a real timetable; none without one', () => {
  assert.equal(delayText(3.4), '3 min late');
  assert.equal(delayText(-2), '2 min early');
  assert.equal(delayText(1, 5), 'on time');
  assert.equal(delayText(null), null);
});

test('passed stops on the map come from the server journey, matched by stop id', () => {
  const journey = { stops: [{ stopId: 'a', status: 'departed' }, { stopId: 'b', status: 'not_recorded' }, { stopId: 'c', status: 'upcoming' }] };
  const routeStops = [{ _id: 'c', sequence: 1 }, { _id: 'b', sequence: 2 }, { _id: 'a', sequence: 3 }]; // a reverse run
  assert.deepEqual(passedFromJourney(journey, routeStops).sort(), [2, 3]);
  assert.equal(passedFromJourney(null, routeStops), null);
});
