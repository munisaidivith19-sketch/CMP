// Route distance / time text. Synthetic values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceText, durationText, planApproximate, planSummary } from '../src/pages/transport/journeyFormat.js';

test('distances in metres below a kilometre, then km with one decimal', () => {
  assert.equal(distanceText(0), '0 m');
  assert.equal(distanceText(847), '850 m');
  assert.equal(distanceText(2224), '2.2 km');
  assert.equal(distanceText(123456), '123 km');
  assert.equal(distanceText(null), '');
});

test('durations in minutes, then hours and minutes', () => {
  assert.equal(durationText(7), '7 min');
  assert.equal(durationText(85), '1 h 25 min');
  assert.equal(durationText(120), '2 h');
  assert.equal(durationText(undefined), '');
});

test('plan summary marks approximate plans', () => {
  assert.equal(planSummary({ distanceM: 12400, minutes: 45, exact: true, method: 'history' }), '12.4 km · about 45 min');
  assert.equal(planSummary({ distanceM: 12400, minutes: 45, exact: true, method: 'assumed_speed' }), '~12.4 km · about 45 min');
  assert.equal(planSummary({ distanceM: 12400, minutes: 45, exact: false, method: 'timetable' }), '~12.4 km · about 45 min');
  assert.equal(planApproximate(null), false);
  assert.equal(planSummary(null), '');
});
