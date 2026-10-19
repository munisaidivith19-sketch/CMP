/**
 * HOD / Principal / Office attendance reports, the low-attendance monitor
 * and the read-only, confined Office role.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');
const realNow = clock.now;
const D = (s) => new Date(`${s}T00:00:00Z`);

let ctx;
let admin, hod, hodEce, principal, office, coe, fac, facEce, sA, sB, sNone, sEce;
let subX, subY;

before(async () => {
  ctx = await startServer();
  clock.now = () => new Date('2026-10-19T12:00:00Z'); // Monday afternoon IST
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H1' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'H2' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'P1' }),
    mk({ role: 'office', name: 'Office', employeeId: 'O1' }),
    mk({ role: 'coe', name: 'COE', employeeId: 'C1' }),
    mk({ role: 'faculty', name: 'Fac CSE', department: 'CSE', employeeId: 'F1' }),
    mk({ role: 'faculty', name: 'Fac ECE', department: 'ECE', employeeId: 'F2' }),
    mk({ name: 'Low A', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1' }),
    mk({ name: 'Good B', department: 'CSE', section: 'A', semester: 5, rollNo: 'A2' }),
    mk({ name: 'No Classes', department: 'CSE', section: 'A', semester: 5, rollNo: 'A3' }),
    mk({ name: 'Low ECE', department: 'ECE', section: 'A', semester: 5, rollNo: 'E1' }),
  ]);
  [admin, hod, hodEce, principal, office, coe, fac, facEce, sA, sB, sNone, sEce] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  subX = await ctx.models.Subject.create({ name: 'Networks', code: 'CS501', department: 'CSE', semester: 5 });
  subY = await ctx.models.Subject.create({ name: 'Compilers', code: 'CS502', department: 'CSE', semester: 5 });
  const subE = await ctx.models.Subject.create({ name: 'Signals', code: 'EC501', department: 'ECE', semester: 5 });

  // Low A: CS501 1/4 present, CS502 3/4 → overall 4/8 = 50 %. Good B: 8/8.
  const rec = (student, subject, n, status, dept = 'CSE') => ({ student: student.u._id, subject: subject._id, date: D(`2026-10-${String(5 + n).padStart(2, '0')}`), period: 1, status, department: dept, section: 'A', markedBy: fac.u._id });
  const docs = [];
  for (let n = 0; n < 4; n += 1) {
    docs.push(rec(sA, subX, n, n === 0 ? 'present' : 'absent'));
    docs.push(rec(sA, subY, n, n === 3 ? 'absent' : 'present'));
    docs.push(rec(sB, subX, n, 'present'));
    docs.push(rec(sB, subY, n, 'present'));
    docs.push(rec(sEce, subE, n, 'absent', 'ECE'));
  }
  await ctx.models.AttendanceRecord.insertMany(docs);
  await ctx.models.FacultyAttendance.create([
    { faculty: fac.u._id, date: D('2026-10-19'), status: 'present', department: 'CSE', markedBy: hod.u._id },
    { faculty: facEce.u._id, date: D('2026-10-19'), status: 'absent', department: 'ECE', markedBy: hodEce.u._id },
  ]);
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const get = (actor, path) => ctx.request('GET', path, { token: actor.token });

test('low-attendance monitor: subject-wise and overall percentages are attended ÷ held', async () => {
  const res = await get(office, '/attendance/low-monitor?range=all');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.students.find((s) => s.rollNo === 'A1');
  assert.deepEqual([a.attended, a.held, a.percentage, a.below], [4, 8, 50, true]);
  assert.deepEqual(a.subjects.map((s) => [s.code, s.attended, s.held, s.percentage]), [['CS501', 1, 4, 25], ['CS502', 3, 4, 75]]);
  assert.ok(a.lastUpdated);
  assert.ok(!res.body.students.some((s) => s.rollNo === 'A2'), '100 % is not low');
  assert.ok(res.body.students.some((s) => s.rollNo === 'E1'), 'the Office sees the whole college');

  // A student with no held periods: no percentage at all, never a misleading 0 %.
  const all = await get(office, '/attendance/low-monitor?range=all&all=true');
  const none = all.body.students.find((s) => s.rollNo === 'A3');
  assert.deepEqual([none.held, none.percentage, none.below], [0, null, false]);
});

test('low-attendance monitor: the HOD sees only their department, whatever they ask for', async () => {
  const mine = await get(hod, '/attendance/low-monitor?range=all&department=ECE');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.students.map((s) => s.rollNo), ['A1']);
  const sub = await get(hod, `/attendance/low-monitor?range=all&subjectId=${subX._id}`);
  assert.equal(sub.body.students[0].percentage, 25, 'filtered to one subject');
});

test('low-attendance monitor exports a CSV with formula-safe cells', async () => {
  const res = await fetch(`${ctx.base}/api/attendance/low-monitor?range=all&format=csv`, { headers: { authorization: `Bearer ${principal.token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const text = await res.text();
  assert.match(text, /"Roll No","Name"/);
  assert.match(text, /"A1","Low A","CSE"/);
  assert.match(text, /CS501 25% \(1\/4\)/);
});

test('staff report: HOD department-only, Principal and Office college-wide, others refused', async () => {
  const q = '/attendance/staff-report?range=custom&from=2026-10-19&to=2026-10-19';
  const h = await get(hod, `${q}&department=ECE`);
  assert.equal(h.status, 200);
  assert.deepEqual([...new Set(h.body.rows.map((r) => r.department))], ['CSE'], 'the HOD’s own department, not the one asked for');
  assert.equal((await get(hod, `${q}&faculty=${facEce.u._id}`)).status, 403, 'no other-department staff by id');

  for (const who of [principal, office]) {
    const r = await get(who, q);
    assert.equal(r.status, 200);
    const names = r.body.rows.map((x) => `${x.name}:${x.dailyStatus}`).sort();
    assert.ok(names.includes('Fac CSE:present') && names.includes('Fac ECE:absent'), `${who.u.role} sees the college`);
    assert.ok(r.body.departments.some((d) => d.department === 'ECE' && d.absent === 1), 'department comparison');
  }
  for (const who of [fac, coe]) assert.equal((await get(who, q)).status, 403, `${who.u.role} cannot`);

  const csv = await fetch(`${ctx.base}/api${q}&format=csv`, { headers: { authorization: `Bearer ${office.token}` } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /"Daily status","Daily source","Periods scheduled"/);
});

test('the Office role is read-only and confined to attendance', async () => {
  for (const path of ['/attendance/summary', '/attendance/summary/breakdown', '/attendance/low?range=semester', '/attendance/sessions?range=all', `/attendance/student/${sA.u._id}`, '/staff/early-exits']) {
    assert.equal((await get(office, path)).status, 200, path);
  }
  for (const path of ['/users', '/timetable', '/exams', '/gate-pass', '/chat/conversations', '/admin/users', '/dashboard', '/hostel/summary']) {
    assert.equal((await get(office, path)).status, 403, path);
  }
  const mark = await ctx.request('POST', '/attendance/mark', { token: office.token, body: { subjectId: String(subX._id), date: '2026-10-19', period: 1, records: [{ student: String(sA.u._id), status: 'present' }] } });
  assert.equal(mark.status, 403, 'never edits attendance');
  const fm = await ctx.request('POST', '/attendance/faculty/mark', { token: office.token, body: { date: '2026-10-19', records: [{ faculty: String(fac.u._id), status: 'absent' }] } });
  assert.equal(fm.status, 403);
  assert.equal((await ctx.request('POST', '/staff/cover', { token: office.token, body: {} })).status, 403);
});

test('admins can create Office accounts', async () => {
  const res = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { role: 'office', title: 'Ms', gender: 'female', name: 'Office Two', email: 'office.two@test.edu', password: 'Welcome123', employeeId: 'O2' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.role, 'office');
});
