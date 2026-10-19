/**
 * Security home "Students in / Students out / Left today" lists: the gate guard
 * taps a card and sees who it counts, with each student's leave period.
 * Covers scoping (security + admin only), the three views matching the card
 * counts, search, paging, and that a guard never receives student contact data
 * (email / phone) or the parent's number.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const PARENT = '9876504321';
const DAY = 86400000;
let ctx;
const staff = {};
const students = {};

const list = (who, q = '') => ctx.request('GET', `/gate-pass/dashboard/security/students${q}`, { token: who.token });

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `E-${role}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.security = await make('security');
  staff.admin = await make('admin');
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A' });
  staff.warden = await make('warden');
  staff.student = await make('student', { name: 'Zed Inside', rollNo: 'SL99', department: 'CSE', section: 'A', year: 3, parentPhone: PARENT });

  const mk = (name, rollNo) => ctx.createUser({ name, rollNo, department: 'CSE', section: 'A', year: 3, phone: '9000000001', parentPhone: PARENT });
  students.out = await mk('Arun Outside', 'SL01');
  students.returned = await mk('Bala Returned', 'SL02');
  students.never = await mk('Chitra Never Left', 'SL03');
  await ctx.createUser({ name: 'Inactive Ghost', rollNo: 'SL04', department: 'CSE', isActive: false });

  const now = Date.now();
  const normal = (student, extra) => ({
    student: student._id,
    regarding: 'outing',
    description: 'Going home for the weekend',
    parentPhone: PARENT,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    department: 'CSE',
    section: 'A',
    ...extra,
  });
  const { GatePass } = ctx.models;
  await GatePass.create([
    // Left today and still outside.
    normal(students.out, { fromDate: new Date(now - DAY), toDate: new Date(now + DAY), status: 'active', actualExit: new Date(now - 60000) }),
    // Left last week and came back.
    normal(students.returned, {
      fromDate: new Date(now - 8 * DAY), toDate: new Date(now - 6 * DAY), status: 'completed',
      actualExit: new Date(now - 8 * DAY), actualReturn: new Date(now - 6 * DAY),
    }),
  ]);
});

after(async () => ctx?.stop());

test('only security and admin can open the gate student lists', async () => {
  assert.equal((await ctx.request('GET', '/gate-pass/dashboard/security/students?view=in')).status, 401);
  for (const who of ['faculty', 'warden', 'student']) {
    assert.equal((await list(staff[who], '?view=in')).status, 403, `${who} is refused`);
  }
  assert.equal((await list(staff.admin, '?view=in')).status, 200);
  assert.equal((await list(staff.security, '?view=bogus')).status, 422, 'unknown view is rejected');
  assert.equal((await list(staff.security, '?view[$ne]=in')).status, 422, 'operator injection is rejected');
});

test('"Students out" lists who is outside with the leave period, matching the card count', async () => {
  const dash = await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token });
  const res = await list(staff.security, '?view=out');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, dash.body.outside);
  assert.deepEqual(res.body.items.map((i) => i.student.rollNo), ['SL01']);
  const [item] = res.body.items;
  assert.equal(item.student.name, 'Arun Outside');
  assert.ok(item.pass.fromDate && item.pass.toDate && item.pass.actualExit, 'leave period + exit time');
  assert.equal(item.pass.overdue, false);
});

test('"Left today" lists today\'s exits, matching the card count', async () => {
  const dash = await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token });
  const res = await list(staff.security, '?view=left');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, dash.body.leftToday);
  assert.deepEqual(res.body.items.map((i) => i.student.rollNo), ['SL01']);
});

test('"Students in" lists active students on campus with their last leave, matching the card count', async () => {
  const dash = await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token });
  const res = await list(staff.security, '?view=in');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, dash.body.inside);
  const rolls = res.body.items.map((i) => i.student.rollNo);
  assert.deepEqual(rolls, ['SL02', 'SL03', 'SL99'], 'sorted by name; outside + inactive students excluded');
  const returned = res.body.items.find((i) => i.student.rollNo === 'SL02');
  assert.ok(returned.pass.fromDate && returned.pass.toDate && returned.pass.actualReturn, 'last leave period shown');
  assert.equal(res.body.items.find((i) => i.student.rollNo === 'SL03').pass, null, 'never left → no period');
});

test('search and paging work across views; regex input is treated literally', async () => {
  const byRoll = await list(staff.security, '?view=in&search=sl03');
  assert.deepEqual(byRoll.body.items.map((i) => i.student.name), ['Chitra Never Left']);
  const byName = await list(staff.security, '?view=out&search=arun');
  assert.equal(byName.body.total, 1);
  assert.equal((await list(staff.security, '?view=out&search=chitra')).body.total, 0);
  assert.equal((await list(staff.security, '?view=in&search=.*')).body.total, 0, 'regex is escaped');

  const p1 = await list(staff.security, '?view=in&limit=2&page=1');
  const p2 = await list(staff.security, '?view=in&limit=2&page=2');
  assert.equal(p1.body.items.length, 2);
  assert.equal(p2.body.items.length, 1);
  assert.equal(p1.body.pages, 2);
});

test('lists never hand the guard student contact data or the parent number', async () => {
  for (const view of ['in', 'out', 'left']) {
    const res = await list(staff.security, `?view=${view}`);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes(PARENT), `${view}: no parent number`);
    assert.ok(!raw.includes('9000000001'), `${view}: no student phone`);
    assert.ok(!/@test\.edu/.test(raw), `${view}: no email`);
  }
});
