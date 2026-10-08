/**
 * Faculty dashboard cards (their own Class In-Charge class today) and the
 * Class In-Charge student form: title + gender, and 10-digit mobile numbers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { toDay } from '../src/utils/dates.js';
import { clock } from '../src/utils/clock.js';

let ctx;
let cic; // Class In-Charge of CSE · Year 3 · Sec A · Sem 5
let noClass;
let hod;
let student;
let subject;
const s = {};
let n = 0;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const login = async (o) => {
  const u = await ctx.createUser(o);
  return { u, ...(await ctx.loginWeb(u)) };
};

before(async () => {
  ctx = await startServer();
  cic = await login({ role: 'faculty', name: 'In Charge', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3], employeeId: 'E-1' });
  noClass = await login({ role: 'faculty', name: 'No Class', department: 'CSE', employeeId: 'E-2' });
  hod = await login({ role: 'hod', name: 'HOD', department: 'CSE', employeeId: 'E-3' });
  const mk = (o) => ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5, ...o });
  s.present = await mk({ name: 'Present Hosteler', rollNo: '301', phone: '9000000301', stayType: 'hosteler' });
  s.absent = await mk({ name: 'Absent Hosteler', rollNo: '302', phone: '9000000302', stayType: 'hosteler' });
  s.unmarked = await mk({ name: 'Not Marked', rollNo: '303', stayType: 'day_scholar' });
  s.half = await mk({ name: 'Half Day', rollNo: '304', phone: '9000000304', stayType: 'day_scholar' });
  s.otherSection = await mk({ name: 'Section B', section: 'B', rollNo: '401', stayType: 'hosteler' });
  student = await ctx.loginWeb(s.present).then((x) => ({ u: s.present, ...x }));

  subject = await ctx.models.Subject.create({ name: 'Networks', code: 'CS301', department: 'CSE', semester: 5, faculty: [cic.u._id] });
  const day = toDay(clock.now());
  const rec = (who, period, status) => ({ student: who._id, subject: subject._id, date: day, period, status, section: who.section, department: 'CSE', markedBy: cic.u._id });
  await ctx.models.AttendanceRecord.insertMany([
    rec(s.present, 1, 'present'),
    rec(s.present, 2, 'present'),
    rec(s.absent, 1, 'absent'),
    rec(s.absent, 2, 'absent'),
    rec(s.half, 1, 'present'),
    rec(s.half, 2, 'absent'),
    rec(s.otherSection, 1, 'absent'),
  ]);
});
after(async () => {
  await ctx.stop();
});

test('Class today: totals, present / absent / not marked, hostelers and below-75% — own class only', async () => {
  const res = await req('GET', '/attendance/our-class/today', cic);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  assert.equal(res.body.class.section, 'A');
  assert.deepEqual(res.body.students, { total: 4, present: 2, absent: 1, unmarked: 1 });
  assert.deepEqual(res.body.hostelers, { total: 2, present: 1, absent: 1, unmarked: 0 });
  assert.equal(res.body.belowThreshold, 2, '0% and 50% are below 75%; a student with no periods is not');

  const byName = Object.fromEntries(res.body.list.map((x) => [x.name, x]));
  assert.ok(!byName['Section B'], 'another section never appears');
  assert.equal(byName['Absent Hosteler'].today, 'absent');
  assert.equal(byName['Absent Hosteler'].phone, '9000000302', 'absent list shows the mobile');
  assert.equal(byName['Absent Hosteler'].rollNo, '302');
  assert.equal(byName['Half Day'].today, 'present');
  assert.equal(byName['Half Day'].percentage, 50);
  assert.equal(byName['Not Marked'].today, 'unmarked');
  for (const row of res.body.list) {
    assert.ok(!('parentPhone' in row) && !('email' in row) && !('password' in row), 'only the fields the cards need');
  }
});

test('Class today: faculty without a class get none; HOD, student and anonymous are refused', async () => {
  assert.deepEqual((await req('GET', '/attendance/our-class/today', noClass)).body, { class: null });
  assert.equal((await req('GET', '/attendance/our-class/today', hod)).status, 403);
  assert.equal((await req('GET', '/attendance/our-class/today', student)).status, 403);
  assert.equal((await ctx.request('GET', '/attendance/our-class/today')).status, 401);
});

const newStudent = (over = {}) => {
  n += 1;
  return { name: `Form Student ${n}`, email: `form${n}@jnn.edu.in`, password: 'Welcome123', rollNo: `F${n}`, stayType: 'hosteler', title: 'Ms', gender: 'female', parentPhone: '9876543210', ...over };
};

test('Create student: title + gender are required, Mr/Ms only, and must agree', async () => {
  const ok = await req('POST', '/class-students', cic, newStudent({ phone: '9123456789' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const saved = await ctx.models.User.findById(ok.body._id).lean();
  assert.equal(saved.title, 'Ms');
  assert.equal(saved.gender, 'female');

  for (const over of [{ title: undefined }, { gender: undefined }, { title: 'Dr' }, { gender: 'other' }, { title: 'Mr', gender: 'female' }]) {
    const body = newStudent(over);
    const res = await req('POST', '/class-students', cic, body);
    assert.equal(res.status, 422, `${JSON.stringify(over)} → ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(await ctx.models.User.exists({ email: body.email }), null);
  }
});

test('Create student: mobile numbers must be exactly 10 digits (a +91 / 0 prefix is dropped)', async () => {
  for (const [field, value] of [
    ['parentPhone', '98765432101'],
    ['parentPhone', '987654321'],
    ['parentPhone', '98765abcde'],
    ['parentPhone', ''],
    ['phone', '12345'],
    ['phone', '+91 98765 432101'],
  ]) {
    const res = await req('POST', '/class-students', cic, newStudent({ [field]: value }));
    assert.equal(res.status, 422, `${field}=${value}`);
  }
  const prefixed = await req('POST', '/class-students', cic, newStudent({ parentPhone: '+91 98765-43210', phone: '09123456789' }));
  assert.equal(prefixed.status, 201, JSON.stringify(prefixed.body));
  const saved = await ctx.models.User.findById(prefixed.body._id).lean();
  assert.equal(saved.parentPhone, '9876543210');
  assert.equal(saved.phone, '9123456789');
});

test('Edit student: title / gender editable; mobiles stay 10 digits; empty clears the student mobile', async () => {
  const id = s.half._id;
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { title: 'Mr', gender: 'male' })).status, 200);
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { gender: 'female' })).status, 422, 'Mr with Female is refused');
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { parentPhone: '12345678901' })).status, 422);
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { phone: '99999' })).status, 422);
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { parentPhone: '9988776655' })).status, 200);
  assert.equal((await req('PATCH', `/class-students/${id}`, cic, { phone: null })).status, 200);
  const saved = await ctx.models.User.findById(id).lean();
  assert.equal(saved.title, 'Mr');
  assert.equal(saved.gender, 'male');
  assert.equal(saved.parentPhone, '9988776655');
  assert.equal(saved.phone, undefined);
});
