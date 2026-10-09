import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, odLeaveCutoff } from '../src/utils/dates.js';

test('dateKey uses the calendar day the user picked, not the UTC day', () => {
  // 1:30 AM local on 9 Oct: in IST the UTC date is still 8 Oct — the old toISOString() bug.
  const early = new Date(2026, 9, 9, 1, 30);
  assert.equal(dateKey(early), '2026-10-09');
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dateKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  assert.equal(dateKey(null), '');
  assert.equal(dateKey(new Date('nope')), '');
});

test('odLeaveCutoff mirrors the server rule: at least one day ahead, before 5 PM the day before', () => {
  const at = (h) => new Date(2026, 9, 9, h, 0);
  assert.equal(odLeaveCutoff('2026-10-09', at(9)).type, 'danger', 'today is never allowed');
  assert.equal(odLeaveCutoff('2026-10-08', at(9)).type, 'danger', 'past is never allowed');
  assert.equal(odLeaveCutoff('2026-10-10', at(16)).type, 'warning', 'tomorrow before 5 PM is allowed, with a reminder');
  assert.equal(odLeaveCutoff('2026-10-10', at(17)).type, 'danger', 'tomorrow after 5 PM is too late');
  assert.equal(odLeaveCutoff('2026-10-11', at(23)), null, 'two days ahead is always fine');
  assert.equal(odLeaveCutoff('', at(9)), null);
});
