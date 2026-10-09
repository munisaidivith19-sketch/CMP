import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { clock } from '../src/utils/clock.js';
import { addDays, toDay } from '../src/utils/dates.js';

/**
 * A gate pass "from" date is a campus calendar day, stored as UTC midnight
 * (05:30 IST). Exit must open at the start of that campus day — not at
 * 04:30 IST — and never on the day before.
 */
let ctx;
let security;
let hosteler;
const realNow = clock.now;
const AT_2AM_IST = new Date('2026-10-10T02:00:00+05:30');

async function approvedPass(fromDay, code) {
  return ctx.models.GatePass.create({
    student: hosteler._id,
    department: 'CSE',
    section: 'A',
    passType: 'normal',
    regarding: 'home',
    description: 'Going home for the weekend',
    fromDate: fromDay,
    toDate: addDays(fromDay, 1),
    parentPhone: '9000000001',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Home' },
    status: 'approved',
    verificationCode: code,
    verificationExpiry: addDays(fromDay, 3),
  });
}
const verify = (code) => ctx.request('POST', '/gate-pass/verify', { token: security.token, body: { code } });

before(async () => {
  ctx = await startServer();
  const s = await ctx.createUser({ role: 'security', name: 'Gate Guard', employeeId: 'GX-1' });
  security = { u: s, ...(await ctx.loginWeb(s)) };
  hosteler = await ctx.createUser({ name: 'Night Leaver', rollNo: 'GX001', department: 'CSE', section: 'A', year: 3, stayType: 'hosteler', parentPhone: '9000000001' });
  clock.now = () => AT_2AM_IST;
});

after(async () => {
  clock.now = realNow;
  if (ctx) await ctx.stop();
});

test('a pass starting today can be used at 2 AM campus time', async () => {
  await approvedPass(toDay(AT_2AM_IST), 'A2B3');
  const res = await verify('A2B3');
  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true, JSON.stringify(res.body.problems));
});

test('a pass starting tomorrow still cannot be used tonight', async () => {
  await approvedPass(addDays(toDay(AT_2AM_IST), 1), 'C4D5');
  const res = await verify('C4D5');
  assert.equal(res.body.valid, false);
  assert.match(res.body.problems.join(' '), /Exit is allowed from/);
});
