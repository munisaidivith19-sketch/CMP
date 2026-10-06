import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
const tok = {};
let boyOut, girlOut;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const roles = ['principal', 'dean', 'ao', 'chairman', 'warden', 'admin', 'hod', 'faculty', 'security'];
  const staff = await Promise.all(roles.map((role, i) => mk({ role, name: `Staff ${role}`, department: 'CSE', employeeId: `E-${i}` })));
  await Promise.all(staff.map(async (u) => { tok[u.role] = (await ctx.loginWeb(u)).token; }));

  const stu = (name, gender, rollNo, extra = {}) =>
    mk({ name, gender, rollNo, department: 'CSE', section: 'A', semester: 3, stayType: 'hosteler', phone: '9000000000', ...extra });
  const [b1, b2, g1, g2] = await Promise.all([
    stu('Arun Boy', 'male', 'H01'),
    stu('Bala Boy', 'male', 'H02'),
    stu('Divya Girl', 'female', 'H03'),
    stu('Kavya Girl', 'female', 'H04'),
  ]);
  const ds = await mk({ name: 'Day Scholar', gender: 'male', rollNo: 'D01', department: 'CSE', section: 'A', semester: 3, stayType: 'day_scholar' });
  tok.student = (await ctx.loginWeb(b1)).token;
  boyOut = b2;
  girlOut = g1;

  const pass = (s, extra) => ({
    student: s._id, department: 'CSE', section: 'A', description: 'Home', regarding: 'outing',
    fromDate: new Date(), toDate: new Date(Date.now() + 2 * 86400000), parentPhone: '9800000000',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' }, ...extra,
  });
  await ctx.models.GatePass.create([
    pass(b2, { status: 'active', actualExit: new Date() }), // boy outside
    pass(g1, { status: 'active', actualExit: new Date() }), // girl outside
    pass(g2, { status: 'completed', actualExit: new Date(Date.now() - 86400000), actualReturn: new Date() }), // back already
    pass(b1, { status: 'approved' }), // approved but has not left
    pass(ds, { status: 'active', actualExit: new Date(), dayScholarOuting: true }), // not a hosteller
  ]);
});

after(async () => {
  await ctx.stop();
});

const get = (role, path) => ctx.request('GET', path, { token: tok[role] });

test('hostel: only admin, principal, dean, AO, chairman and warden can open it', async () => {
  for (const role of ['admin', 'principal', 'dean', 'ao', 'chairman', 'warden']) {
    assert.equal((await get(role, '/hostel/summary')).status, 200, role);
    assert.equal((await get(role, '/hostel/students')).status, 200, role);
  }
  for (const role of ['student', 'faculty', 'hod', 'security']) {
    assert.equal((await get(role, '/hostel/summary')).status, 403, role);
    assert.equal((await get(role, '/hostel/students?status=outside')).status, 403, role);
  }
  assert.equal((await ctx.request('GET', '/hostel/summary')).status, 401);
});

test('hostel: totals, inside and outside — overall, boys and girls', async () => {
  const { body } = await get('warden', '/hostel/summary');
  assert.deepEqual({ total: body.total, inside: body.inside, outside: body.outside }, { total: 4, inside: 2, outside: 2 });
  assert.deepEqual(body.boys, { total: 2, inside: 1, outside: 1 });
  assert.deepEqual(body.girls, { total: 2, inside: 1, outside: 1 });
});

test('hostel: lists show names by default and search by name or roll number', async () => {
  const all = await get('principal', '/hostel/students');
  assert.equal(all.body.students.length, 4, 'names listed without a search');
  assert.ok(all.body.students.every((s) => s.phone === undefined), 'no phone numbers in the general lists');

  const boysIn = await get('principal', '/hostel/students?gender=male&status=inside');
  assert.deepEqual(boysIn.body.students.map((s) => s.name), ['Arun Boy']);
  const girls = await get('principal', '/hostel/students?gender=female');
  assert.deepEqual(girls.body.students.map((s) => s.name).sort(), ['Divya Girl', 'Kavya Girl']);

  assert.deepEqual((await get('dean', '/hostel/students?q=kavya')).body.students.map((s) => s.name), ['Kavya Girl']);
  assert.deepEqual((await get('dean', '/hostel/students?q=H02')).body.students.map((s) => s.name), ['Bala Boy']);
});

test('hostel: the outside list carries roll no, class, mobile, leave and return dates', async () => {
  const res = await get('chairman', '/hostel/students?status=outside');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.students.map((s) => s.name).sort(), ['Bala Boy', 'Divya Girl']);
  const bala = res.body.students.find((s) => s.name === 'Bala Boy');
  assert.equal(bala.rollNo, 'H02');
  assert.equal(bala.department, 'CSE');
  assert.equal(bala.section, 'A');
  assert.equal(bala.year, 2);
  assert.equal(bala.phone, '9000000000');
  assert.ok(bala.leftAt && bala.returnBy);

  const girlsOut = await get('ao', '/hostel/students?status=outside&gender=female');
  assert.deepEqual(girlsOut.body.students.map((s) => String(s._id)), [String(girlOut._id)]);
  const boysOut = await get('ao', '/hostel/students?status=outside&gender=male');
  assert.deepEqual(boysOut.body.students.map((s) => String(s._id)), [String(boyOut._id)]);
});

test('hostel: bad input is rejected and search text is never a regex or operator', async () => {
  assert.equal((await get('warden', '/hostel/students?gender=other')).status, 422);
  assert.equal((await get('warden', '/hostel/students?status=everyone')).status, 422);
  assert.equal((await get('warden', '/hostel/students?gender[$ne]=male')).status, 422);
  assert.equal((await get('warden', '/hostel/students?q[$gt]=')).status, 422);
  const rx = await get('warden', '/hostel/students?q=.*');
  assert.equal(rx.status, 200);
  assert.equal(rx.body.students.length, 0, '".*" is matched literally');
});
