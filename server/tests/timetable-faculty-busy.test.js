import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

// A faculty member can teach only one class at a time: any overlapping minute
// on the same day is a clash, whichever class it is for.
let ctx;
let admin, vijay, other, subjA, subjB;

before(async () => {
  ctx = await startServer();
  const [a, f1, f2] = await Promise.all([
    ctx.createUser({ role: 'admin', name: 'Admin' }),
    ctx.createUser({ role: 'faculty', name: 'MR.VIJAY', department: 'CSE', employeeId: 'E-VJ' }),
    ctx.createUser({ role: 'faculty', name: 'MS.ANU', department: 'CSE', employeeId: 'E-AN' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  vijay = f1;
  other = f2;
  subjA = await ctx.models.Subject.create({ name: 'Computer Networks', code: 'CS501', department: 'CSE', semester: 5, sections: ['A', 'B'] });
  subjB = await ctx.models.Subject.create({ name: 'Cryptography', code: 'CS502', department: 'CSE', semester: 5, sections: ['A', 'B'] });
});
after(async () => {
  await ctx.stop();
});

const slot = (over = {}) => ({
  subject: String(subjA._id),
  faculty: String(vijay._id),
  section: 'A',
  department: 'CSE',
  dayOfWeek: 'tuesday',
  startTime: '09:00',
  endTime: '10:00',
  semester: 5,
  ...over,
});
const add = (body) => ctx.request('POST', '/timetable', { token: admin.token, body });
const busy = (q) => ctx.request('GET', `/timetable/faculty-busy?${new URLSearchParams(q)}`, { token: admin.token });

test('the same faculty at the same time in another class is refused with a clear message', async () => {
  const first = await add(slot());
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const same = await add(slot({ section: 'B', subject: String(subjB._id) }));
  assert.equal(same.status, 409);
  assert.match(same.body.message, /MR\.VIJAY is already assigned to CS501 \(CSE, Year 3, Section A\) on Tuesday 9:00 AM–10:00 AM/);
});

test('a period starting at 9:50 overlaps 9:00–10:00 and is refused', async () => {
  const r = await add(slot({ section: 'B', subject: String(subjB._id), startTime: '09:50', endTime: '10:40' }));
  assert.equal(r.status, 409);
  assert.match(r.body.message, /MR\.VIJAY is already assigned/);
});

test('back-to-back periods (10:00 after 9:00–10:00) and other faculty are allowed', async () => {
  const next = await add(slot({ section: 'B', subject: String(subjB._id), startTime: '10:00', endTime: '10:50' }));
  assert.equal(next.status, 201, JSON.stringify(next.body));
  const otherFaculty = await add(slot({ section: 'B', subject: String(subjB._id), faculty: String(other._id), dayOfWeek: 'wednesday' }));
  assert.equal(otherFaculty.status, 201, JSON.stringify(otherFaculty.body));
});

test('faculty-busy lists who is busy at an overlapping time, and skips the period being edited', async () => {
  const r = await busy({ dayOfWeek: 'tuesday', startTime: '09:50', endTime: '10:40' });
  assert.equal(r.status, 200);
  const mine = r.body.filter((c) => c.faculty === String(vijay._id));
  assert.equal(mine.length, 2, 'overlaps both 9:00–10:00 and 10:00–10:50');
  assert.ok(mine.every((c) => c.facultyName === 'MR.VIJAY' && c.subjectCode));
  assert.ok(!r.body.some((c) => c.faculty === String(other._id)), 'MS.ANU teaches on Wednesday only');

  const free = await busy({ dayOfWeek: 'tuesday', startTime: '11:00', endTime: '11:50' });
  assert.deepEqual(free.body, []);

  const editing = r.body.find((c) => c.startTime === '09:00');
  const excl = await busy({ dayOfWeek: 'tuesday', startTime: '09:00', endTime: '09:50', excludeId: editing.slotId });
  assert.deepEqual(excl.body, []);
});

test('editing a period onto a busy faculty member is refused too', async () => {
  const anu = await add(slot({ faculty: String(other._id), section: 'A', subject: String(subjB._id), dayOfWeek: 'thursday' }));
  assert.equal(anu.status, 201, JSON.stringify(anu.body));
  const vj = await add(slot({ dayOfWeek: 'thursday', section: 'B', startTime: '09:00', endTime: '10:00' }));
  assert.equal(vj.status, 201, JSON.stringify(vj.body));
  const r = await ctx.request('PUT', `/timetable/${anu.body._id}`, { token: admin.token, body: { faculty: String(vijay._id) } });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /MR\.VIJAY is already assigned to CS501 \(CSE, Year 3, Section B\) on Thursday/);
});

test('faculty-busy is for timetable editors only and validates its input', async () => {
  const s = await ctx.createUser({ name: 'Student', department: 'CSE', section: 'A', semester: 5, rollNo: '77' });
  const st = await ctx.loginWeb(s);
  const q = new URLSearchParams({ dayOfWeek: 'tuesday', startTime: '09:00', endTime: '10:00' });
  assert.equal((await ctx.request('GET', `/timetable/faculty-busy?${q}`, { token: st.token })).status, 403);
  assert.equal((await busy({ dayOfWeek: 'funday', startTime: '09:00', endTime: '10:00' })).status, 422);
  assert.equal((await busy({ dayOfWeek: 'tuesday', startTime: '9am', endTime: '10:00' })).status, 422);
});
