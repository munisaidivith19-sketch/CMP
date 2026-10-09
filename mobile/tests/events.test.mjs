import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDays, statusOnDay } from '../src/utils/events.js';

test('eventDays lists each calendar day of the event (max 30)', () => {
  assert.deepEqual(eventDays(new Date(2026, 9, 10, 9, 0), new Date(2026, 9, 12, 17, 0)), ['2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(eventDays(new Date(2026, 9, 10, 9, 0), new Date(2026, 9, 10, 11, 0)), ['2026-10-10']);
  assert.equal(eventDays(new Date(2026, 0, 1), new Date(2026, 5, 1)).length, 30);
  assert.deepEqual(eventDays(null), []);
});

test('statusOnDay reads the per-day record, else the overall status', () => {
  const reg = { status: 'attended', attendanceDays: [{ date: '2026-10-10', attended: true }, { date: '2026-10-11', attended: false }] };
  assert.equal(statusOnDay(reg, '2026-10-10'), 'attended');
  assert.equal(statusOnDay(reg, '2026-10-11'), 'absent');
  assert.equal(statusOnDay({ status: 'registered' }, '2026-10-10'), 'pending');
  assert.equal(statusOnDay({ status: 'waitlisted', attendanceDays: [{ date: '2026-10-10', attended: true }] }, '2026-10-10'), 'waitlisted');
});
