/**
 * Student People directory: their own classmates and their class's faculty
 * (timetable + Class In-Charge) — nothing outside that class.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let me, mate, clubMate, otherSection, otherYear, otherSemester, otherDept, teacher, inCharge, outsider, hod, principal, admin, noClass;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const cls = { department: 'CSE', year: 3, section: 'A', semester: 5 };
  const [m, mt, cm, os, oy, osem, od, t, ic, out, h, p, a, nc] = await Promise.all([
    mk({ name: 'Me Student', ...cls, rollNo: 'S1' }),
    mk({ name: 'Classmate', ...cls, rollNo: 'S2', skills: ['python'] }),
    mk({ role: 'club_admin', name: 'Club Classmate', ...cls, rollNo: 'S3' }),
    mk({ name: 'Other Section', ...cls, section: 'B', rollNo: 'S4' }),
    mk({ name: 'Other Year', ...cls, year: 2, semester: 3, rollNo: 'S5' }),
    mk({ name: 'Other Semester', ...cls, semester: 6, rollNo: 'S6' }),
    mk({ name: 'Other Dept', ...cls, department: 'ECE', rollNo: 'S7' }),
    mk({ role: 'faculty', name: 'Teaching Faculty', department: 'CSE', employeeId: 'F1' }),
    mk({ role: 'faculty', name: 'In Charge Faculty', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, employeeId: 'F2' }),
    mk({ role: 'faculty', name: 'Outside Faculty', department: 'CSE', section: 'B', inChargeYear: 3, inChargeSemester: 5, employeeId: 'F3' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H1' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'P1' }),
    mk({ role: 'admin', name: 'Admin' }),
    mk({ name: 'No Class', department: 'CSE', year: 3, semester: 5, rollNo: 'S8' }),
  ]);
  const subject = await ctx.models.Subject.create({ name: 'OS', code: 'CS501', department: 'CSE', semester: 5, year: 3, faculty: [t._id, out._id], sections: ['A', 'B'] });
  await ctx.models.TimetableSlot.create({ subject: subject._id, faculty: t._id, section: 'A', department: 'CSE', year: 3, semester: 5, dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '10:00' });
  // Teaches the same subject to section B only — not this student's class.
  await ctx.models.TimetableSlot.create({ subject: subject._id, faculty: out._id, section: 'B', department: 'CSE', year: 3, semester: 5, dayOfWeek: 'monday', period: 2, startTime: '10:00', endTime: '11:00' });
  // An inactive slot never grants visibility.
  await ctx.models.TimetableSlot.create({ subject: subject._id, faculty: h._id, section: 'A', department: 'CSE', year: 3, semester: 5, dayOfWeek: 'friday', period: 1, startTime: '09:00', endTime: '10:00', isActive: false });

  me = { u: m, ...(await ctx.loginWeb(m)) };
  noClass = { u: nc, ...(await ctx.loginWeb(nc)) };
  [mate, clubMate, otherSection, otherYear, otherSemester, otherDept, teacher, inCharge, outsider, hod, principal, admin] = [mt, cm, os, oy, osem, od, t, ic, out, h, p, a];
});
after(async () => {
  await ctx.stop();
});

const names = (res) => res.body.items.map((u) => u.name).sort();

test('student People list = classmates (not themselves) + the faculty of their class', async () => {
  const res = await ctx.request('GET', '/users?limit=50', { token: me.token });
  assert.equal(res.status, 200);
  assert.deepEqual(names(res), ['Classmate', 'Club Classmate', 'In Charge Faculty', 'Teaching Faculty']);
  assert.equal(res.body.total, 4, 'counts are scoped too');
  for (const u of res.body.items) {
    assert.equal(u.email, undefined, 'no email in the directory');
    assert.equal(u.phone, undefined);
    assert.equal(u.parentPhone, undefined);
  }
});

test('student filters: Students / Faculty switch; out-of-scope parameters return nothing', async () => {
  const cfg = await ctx.request('GET', '/users/people-filters', { token: me.token });
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.body, { scope: 'class', class: { department: 'CSE', year: 3, section: 'A', semester: 5 }, filters: ['search', 'role'], roles: ['student', 'faculty'] });

  assert.deepEqual(names(await ctx.request('GET', '/users?role=faculty', { token: me.token })), ['In Charge Faculty', 'Teaching Faculty']);
  assert.deepEqual(names(await ctx.request('GET', '/users?role=student', { token: me.token })), ['Classmate']);
  assert.deepEqual(names(await ctx.request('GET', '/users?q=python', { token: me.token })), ['Classmate']);

  for (const qs of ['department=ECE', 'section=B', 'year=2', 'semester=6', 'role=hod', 'role=principal', 'role=admin', 'q=Other']) {
    assert.equal((await ctx.request('GET', `/users?${qs}`, { token: me.token })).body.items.length, 0, qs);
  }
  // Operator injection is stripped / never widens the scope.
  const inj = await ctx.request('GET', '/users?department[$ne]=x&section[$ne]=A', { token: me.token });
  assert.ok(inj.status >= 400 || inj.body.items.every((u) => ['Classmate', 'Club Classmate', 'In Charge Faculty', 'Teaching Faculty'].includes(u.name)));
});

test('global search for a student stays inside their class', async () => {
  const res = await ctx.request('GET', '/search?q=Other&type=users', { token: me.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.users, []);
  const fac = await ctx.request('GET', '/search?q=Faculty&type=users', { token: me.token });
  assert.deepEqual(fac.body.users.map((u) => u.name).sort(), ['In Charge Faculty', 'Teaching Faculty']);
});

test('a student without a complete class sees nobody', async () => {
  const res = await ctx.request('GET', '/users', { token: noClass.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 0);
});

test('other roles keep their existing directory scope', async () => {
  const sec = await ctx.createUser({ role: 'security' });
  const secWeb = await ctx.loginWeb(sec);
  assert.equal((await ctx.request('GET', '/users', { token: secWeb.token })).status, 403);
  assert.equal((await ctx.request('GET', '/users/people-filters', { token: secWeb.token })).status, 403);
  const adminWeb = await ctx.loginWeb(admin);
  assert.ok((await ctx.request('GET', '/users?limit=50', { token: adminWeb.token })).body.total >= 14);
});
