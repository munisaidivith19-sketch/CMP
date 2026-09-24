import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

let ctx;
let admin;
let hod;
let principal;
let facCse;
let facEce;
let s1;
let s2;
let sEce;
let subject;

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, h, p, fc, fe, st1, st2, se] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-PR' }),
    mk({ role: 'faculty', name: 'Fac CSE', department: 'CSE', employeeId: 'E-1' }),
    mk({ role: 'faculty', name: 'Fac ECE', department: 'ECE', employeeId: 'E-2' }),
    mk({ name: 'Stu One', department: 'CSE', section: 'A', semester: 5, rollNo: '01', phone: '900', parentPhone: '800' }),
    mk({ name: 'Stu Two', department: 'CSE', section: 'A', semester: 5, rollNo: '02' }),
    mk({ name: 'Stu Ece', department: 'ECE', section: 'A', semester: 5, rollNo: '03' }),
  ]);
  subject = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS503', department: 'CSE', semester: 5, faculty: [fc._id], sections: ['A'] });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  facCse = { u: fc, ...(await ctx.loginWeb(fc)) };
  facEce = { u: fe, ...(await ctx.loginWeb(fe)) };
  s1 = { u: st1, ...(await ctx.loginWeb(st1)) };
  s2 = { u: st2, ...(await ctx.loginWeb(st2)) };
  sEce = { u: se };
});
after(async () => {
  await ctx.stop();
});

// ── Admin-created logins ──────────────────────────────────────────

test('admin creates student / faculty / HOD / principal logins with role-specific fields', async () => {
  const student = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      role: 'student', name: 'New Student', email: 'new.student@test.edu', password: 'Welcome123',
      rollNo: '23CS099', year: 2, department: 'CSE', section: 'b', stayType: 'hosteler', phone: '9000000000', parentPhone: '9111111111',
    },
  });
  assert.equal(student.status, 201, JSON.stringify(student.body));
  assert.equal(student.body.section, 'B');
  assert.equal(student.body.stayType, 'hosteler');
  assert.equal(student.body.password, undefined);

  // The college email is the username.
  const login = await ctx.request('POST', '/auth/login', { body: { email: 'new.student@test.edu', password: 'Welcome123' } });
  assert.equal(login.status, 200);

  const missingParent = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'student', name: 'X Y', email: 'x@test.edu', password: 'Welcome123', rollNo: '1', year: 1, department: 'CSE', stayType: 'day_scholar' },
  });
  assert.equal(missingParent.status, 422);

  const badStay = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'student', name: 'X Y', email: 'x2@test.edu', password: 'Welcome123', rollNo: '1', year: 1, department: 'CSE', stayType: 'tent', parentPhone: '999999' },
  });
  assert.equal(badStay.status, 422);

  const fac = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'faculty', name: 'New Fac', email: 'new.fac@test.edu', password: 'Welcome123', employeeId: 'E-100', department: 'CSE', section: 'A', phone: '9222' },
  });
  assert.equal(fac.status, 201, JSON.stringify(fac.body));
  const dupEmp = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'hod', name: 'Dup', email: 'dup@test.edu', password: 'Welcome123', employeeId: 'E-100', department: 'IT' },
  });
  assert.equal(dupEmp.status, 409);

  const noEmp = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'hod', name: 'No Emp', email: 'noemp@test.edu', password: 'Welcome123', department: 'IT' },
  });
  assert.equal(noEmp.status, 422);

  const pr = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'principal', name: 'New Principal', email: 'principal2@test.edu', password: 'Welcome123', employeeId: 'E-P2', phone: '9333' },
  });
  assert.equal(pr.status, 201, 'principal needs no department');

  assert.equal((await ctx.request('POST', '/admin/users', { token: hod.token, body: {} })).status, 403);
  assert.equal((await ctx.request('POST', '/admin/users', { token: facCse.token, body: {} })).status, 403);
});

test("parent phone is visible to staff and the owner, never to classmates", async () => {
  const asClassmate = await ctx.request('GET', `/users/${s1.u._id}`, { token: s2.token });
  assert.equal(asClassmate.body.parentPhone, undefined);
  const asHod = await ctx.request('GET', `/users/${s1.u._id}`, { token: hod.token });
  assert.equal(asHod.body.parentPhone, '800');
});

// ── HOD / Principal attendance scope ──────────────────────────────

test('HOD marks student attendance for any subject in their department only; principal is read-only', async () => {
  const body = { subjectId: String(subject._id), period: 1, section: 'A', date: daysAgo(1), records: [{ student: String(s1.u._id), status: 'present' }, { student: String(s2.u._id), status: 'absent' }] };
  const ok = await ctx.request('POST', '/attendance/mark', { token: hod.token, body });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const eceSubject = await ctx.models.Subject.create({ name: 'Signals', code: 'EC501', department: 'ECE', semester: 5, faculty: [facEce.u._id], sections: ['A'] });
  const other = await ctx.request('POST', '/attendance/mark', {
    token: hod.token,
    body: { subjectId: String(eceSubject._id), period: 1, section: 'A', date: daysAgo(1), records: [{ student: String(sEce.u._id), status: 'present' }] },
  });
  assert.equal(other.status, 403);

  assert.equal((await ctx.request('POST', '/attendance/mark', { token: principal.token, body })).status, 403);
  // …but can read college-wide views.
  assert.equal((await ctx.request('GET', '/attendance/low', { token: principal.token })).status, 200);
  assert.equal((await ctx.request('GET', '/analytics/college', { token: principal.token })).status, 200);
  assert.equal((await ctx.request('GET', '/analytics/department?department=ECE', { token: hod.token })).status, 403);
});

// ── Faculty attendance + daily summary ─────────────────────────────

test('HOD marks faculty attendance for their department; admin for anyone', async () => {
  const roster = await ctx.request('GET', '/attendance/faculty/roster', { token: hod.token });
  assert.equal(roster.status, 200);
  const names = roster.body.faculty.map((f) => f.name);
  assert.ok(names.includes('Fac CSE'));
  assert.ok(!names.includes('Fac ECE'), 'other departments are hidden');
  assert.ok(!names.includes('HOD CSE'), 'HOD does not mark themselves');

  const today = ymd(new Date());
  const mark = await ctx.request('POST', '/attendance/faculty/mark', {
    token: hod.token,
    body: { date: today, records: [{ faculty: String(facCse.u._id), status: 'present' }] },
  });
  assert.equal(mark.status, 200, JSON.stringify(mark.body));

  const crossDept = await ctx.request('POST', '/attendance/faculty/mark', {
    token: hod.token,
    body: { date: today, records: [{ faculty: String(facEce.u._id), status: 'present' }] },
  });
  assert.equal(crossDept.status, 422);
  const self = await ctx.request('POST', '/attendance/faculty/mark', {
    token: hod.token,
    body: { date: today, records: [{ faculty: String(hod.u._id), status: 'present' }] },
  });
  assert.equal(self.status, 403);

  const byAdmin = await ctx.request('POST', '/attendance/faculty/mark', {
    token: admin.token,
    body: { date: today, records: [{ faculty: String(facEce.u._id), status: 'absent' }, { faculty: String(hod.u._id), status: 'leave' }] },
  });
  assert.equal(byAdmin.status, 200);

  assert.equal((await ctx.request('POST', '/attendance/faculty/mark', { token: facCse.token, body: { date: today, records: [{ faculty: String(facEce.u._id), status: 'present' }] } })).status, 403);
  assert.equal((await ctx.request('POST', '/attendance/faculty/mark', { token: principal.token, body: { date: today, records: [{ faculty: String(facEce.u._id), status: 'present' }] } })).status, 403);
});

test('daily summary: admin sees the college, HOD only their department, with view-all lists', async () => {
  // Today's student attendance: s1 present, s2 absent (CSE); ECE student present.
  const today = ymd(new Date());
  await ctx.request('POST', '/attendance/mark', {
    token: admin.token,
    body: { subjectId: String(subject._id), period: 2, section: 'A', date: today, records: [{ student: String(s1.u._id), status: 'present' }, { student: String(s2.u._id), status: 'absent' }] },
  });

  const college = await ctx.request('GET', '/attendance/summary', { token: admin.token });
  assert.equal(college.status, 200);
  assert.ok(college.body.students.total >= 3);
  assert.equal(college.body.faculty.present, 1);
  assert.equal(college.body.faculty.absent, 1);
  assert.equal(college.body.faculty.leave, 1);

  const dept = await ctx.request('GET', '/attendance/summary', { token: hod.token });
  assert.equal(dept.body.department, 'CSE');
  assert.equal(dept.body.students.present, 1);
  assert.equal(dept.body.students.absent, 1);
  assert.equal(dept.body.faculty.present, 1);
  assert.equal(dept.body.faculty.leave, 1, 'the HOD counts in their own department');
  assert.equal((await ctx.request('GET', '/attendance/summary?department=ECE', { token: hod.token })).status, 403);

  const absentees = await ctx.request('GET', '/attendance/summary/students?status=absent', { token: hod.token });
  assert.deepEqual(absentees.body.students.map((s) => s.name), ['Stu Two']);
  const present = await ctx.request('GET', '/attendance/summary/students?status=present', { token: hod.token });
  assert.equal(present.body.students[0].rollNo, '01');
  assert.equal(present.body.students[0].phone, '900');

  const facultyList = await ctx.request('GET', '/attendance/summary/faculty', { token: hod.token });
  assert.ok(facultyList.body.faculty.every((f) => f.department === 'CSE'));

  assert.equal((await ctx.request('GET', '/attendance/summary', { token: facCse.token })).status, 403);
  assert.equal((await ctx.request('GET', '/attendance/summary', { token: s1.token })).status, 403);
  assert.equal((await ctx.request('GET', '/attendance/summary', { token: principal.token })).status, 200);
  void PASSWORD;
});
