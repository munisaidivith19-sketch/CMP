import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

// HOD / Principal attendance cards (per-year or per-department present,
// low attendance and hostellers),
// and the study-material upload status (HOD + Principal) — and that none of
// them reach past the caller's scope.

let ctx;
const tok = {};
const u = {};
let today;

before(async () => {
  ctx = await startServer();
  ({ today } = await import('../src/utils/dates.js'));
  const mk = (o) => ctx.createUser(o);
  const D = 'CSE (Cyber Security)';

  const staff = {
    hod: { role: 'hod', department: D, employeeId: 'E-H' },
    otherHod: { role: 'hod', department: 'ECE', employeeId: 'E-OH' },
    fyHod: { role: 'hod', department: 'Science & Humanities', employeeId: 'E-FY' },
    principal: { role: 'principal', employeeId: 'E-P' },
    dean: { role: 'dean', employeeId: 'E-D' },
    chairman: { role: 'chairman', employeeId: 'E-C' },
    ao: { role: 'ao', employeeId: 'E-AO' },
    admin: { role: 'admin', employeeId: 'E-A' },
    faculty: { role: 'faculty', department: D, employeeId: 'E-F', name: 'Ravi Teacher' },
    student: { department: D, section: 'A', semester: 3, rollNo: 'S-LOGIN' },
  };
  for (const [k, o] of Object.entries(staff)) {
    u[k] = await mk(o);
    tok[k] = (await ctx.loginWeb(u[k])).token;
  }

  const stu = (rollNo, semester, extra = {}) => mk({ name: `Stu ${rollNo}`, rollNo, department: D, section: 'A', semester, parentPhone: `98000${rollNo.slice(-5).padStart(5, '0')}`, ...extra });
  u.y2Host = await stu('Y2-001', 3, { stayType: 'hosteler' });
  u.y2Day = await stu('Y2-002', 3, { stayType: 'day_scholar' });
  u.y3Host = await stu('Y3-001', 5, { stayType: 'hosteler', section: 'B' });
  u.y1 = await stu('Y1-001', 1, { stayType: 'hosteler' });
  u.ece = await mk({ name: 'ECE kid', rollNo: 'E-001', department: 'ECE', section: 'A', semester: 3, stayType: 'hosteler', parentPhone: '9811111111' });

  const subject = await ctx.models.Subject.create({ name: 'Networks', code: 'CS301', department: D, semester: 3, faculty: [u.faculty._id], sections: ['A'] });
  await ctx.models.Subject.create({ name: 'Crypto', code: 'CS302', department: D, semester: 3 });
  await ctx.models.Subject.create({ name: 'ECE Sub', code: 'EC301', department: 'ECE', semester: 3 });
  const rec = (s, status, period) => ({ student: s._id, subject: subject._id, date: today(), period, status, section: s.section, department: s.department, markedBy: u.faculty._id });
  await ctx.models.AttendanceRecord.create([
    rec(u.y2Host, 'present', 1),
    rec(u.y2Host, 'present', 2),
    rec(u.y2Day, 'absent', 1),
    rec(u.y2Day, 'absent', 2), // 0% → low attendance
    rec(u.y3Host, 'absent', 1), // hosteller absent, 0% → low attendance
    rec(u.ece, 'absent', 1),
  ]);

  await ctx.models.StudyMaterial.create({
    title: 'Unit 1', category: 'notes', department: D, section: 'A', semester: 3, subject: subject._id,
    subjectName: 'Networks', subjectCode: 'CS301', file: { url: '/uploads/x.pdf', name: 'x.pdf' }, uploadedBy: u.faculty._id,
  });

  const pass = (s, extra) => ({
    student: s._id, department: s.department, section: s.section, description: 'Home', regarding: 'outing',
    fromDate: new Date(), toDate: new Date(Date.now() + 86400000), parentPhone: '9822222222',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' }, ...extra,
  });
  await ctx.models.GatePass.create([
    pass(u.y2Host, { status: 'pending_hod' }),
    pass(u.y3Host, { status: 'active', actualExit: new Date() }),
    pass(u.y2Day, { status: 'completed', actualExit: new Date(Date.now() - 2 * 86400000), actualReturn: new Date() }),
  ]);
});

after(async () => {
  await ctx.stop();
});

const get = (who, path) => ctx.request('GET', path, { token: tok[who] });

test('breakdown: branch HOD gets years 2–4 of their own department only', async () => {
  const r = await get('hod', '/attendance/summary/breakdown');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.groupBy, 'year');
  assert.deepEqual(r.body.groups.map((g) => g.year), [2, 3, 4]);
  const y2 = r.body.groups.find((g) => g.year === 2);
  const y3 = r.body.groups.find((g) => g.year === 3);
  // Y2-001 present, Y2-002 absent, the signed-in student S-LOGIN not marked today.
  assert.deepEqual(y2.students, { total: 3, present: 1, absent: 1, unmarked: 1 });
  assert.deepEqual(y2.hostellers, { total: 1, present: 1, absent: 0, unmarked: 0 });
  assert.deepEqual(y3.hostellers, { total: 1, present: 0, absent: 1, unmarked: 0 });
  assert.deepEqual(y2.lowAttendance.map((s) => s.rollNo), ['Y2-002']);
  assert.equal(y2.lowAttendance[0].parentPhone, u.y2Day.parentPhone);
  assert.equal(r.body.totals.lowAttendance, 2);
  assert.equal(r.body.totals.students.total, 4, 'no 1st year, no other department');
  const all = JSON.stringify(r.body);
  assert.ok(!all.includes('E-001') && !all.includes('Y1-001'), 'out-of-scope students never appear');
});

test('breakdown: a branch HOD cannot widen the scope with query parameters', async () => {
  assert.equal((await get('hod', '/attendance/summary/breakdown?department=ECE')).status, 403);
  const y1 = await get('hod', '/attendance/summary/breakdown?year=1');
  assert.equal(y1.status, 200);
  assert.ok(!JSON.stringify(y1.body).includes('Y1-001'));
  const injected = await get('hod', '/attendance/summary/breakdown?department[$ne]=x');
  assert.ok([403, 422].includes(injected.status), `operator injection refused (${injected.status})`);
});

test('breakdown: 1st-year HOD sees 1st year per department; others are refused', async () => {
  const r = await get('fyHod', '/attendance/summary/breakdown');
  assert.equal(r.status, 200);
  assert.equal(r.body.groupBy, 'department');
  assert.deepEqual(r.body.groups.map((g) => g.department), ['CSE (Cyber Security)']);
  assert.equal(r.body.groups[0].students.total, 1);
  assert.equal(r.body.groups[0].hostellers.unmarked, 1);
  for (const who of ['faculty', 'student']) assert.equal((await get(who, '/attendance/summary/breakdown')).status, 403, who);
  assert.equal((await ctx.request('GET', '/attendance/summary/breakdown')).status, 401);
});

test('breakdown: an On Duty period counts as present, not absent / low attendance', async () => {
  const D = 'CSE (Cyber Security)';
  const od = await ctx.createUser({ name: 'On Duty', rollNo: 'Y4-OD', department: D, section: 'A', semester: 7, stayType: 'hosteler' });
  const subject = await ctx.models.Subject.findOne({ code: 'CS301' });
  await ctx.models.AttendanceRecord.create({ student: od._id, subject: subject._id, date: today(), period: 1, status: 'od', section: 'A', department: D, markedBy: u.faculty._id });
  const r = await get('hod', '/attendance/summary/breakdown');
  const y4 = r.body.groups.find((g) => g.year === 4);
  assert.deepEqual(y4.hostellers, { total: 1, present: 1, absent: 0, unmarked: 0 });
  assert.equal(y4.lowAttendance.length, 0);
  await ctx.models.AttendanceRecord.deleteMany({ student: od._id });
  await ctx.models.User.deleteOne({ _id: od._id });
});

test('breakdown: principal sees the whole college — departments with their years', async () => {
  const r = await get('principal', '/attendance/summary/breakdown');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.groupBy, 'department');
  assert.equal(r.body.department, 'All departments');
  const cyber = r.body.groups.find((g) => g.department === 'CSE (Cyber Security)');
  const ece = r.body.groups.find((g) => g.department === 'ECE');
  assert.ok(r.body.groups.find((g) => g.department === 'AI & DS'), 'departments with no students still get a row');
  assert.ok(!r.body.groups.find((g) => g.department === 'Science & Humanities'));
  // Cyber: Y1 hosteller (unmarked), Y2 ×3 (present, absent, unmarked), Y3 hosteller (absent).
  assert.deepEqual(cyber.students, { total: 5, present: 1, absent: 2, unmarked: 2 });
  assert.deepEqual(cyber.years.map((y) => y.year), [1, 2, 3, 4]);
  assert.deepEqual(cyber.years.find((y) => y.year === 1).hostellers, { total: 1, present: 0, absent: 0, unmarked: 1 });
  assert.equal(cyber.years.find((y) => y.year === 2).lowCount, 1);
  assert.equal(cyber.lowCount, 2);
  assert.deepEqual(ece.students, { total: 1, present: 0, absent: 1, unmarked: 0 });
  assert.equal(ece.lowCount, 1);
  assert.equal(r.body.totals.students.total, 6, 'every department, every year');
  assert.equal(r.body.totals.lowAttendance, 3);
  assert.equal(cyber.lowAttendance, undefined, 'the college overview carries counts, not student lists');
});

test('breakdown: principal drill-down into one department lists years 1–4 with students', async () => {
  const r = await get('principal', '/attendance/summary/breakdown?department=ECE');
  assert.equal(r.status, 200);
  assert.equal(r.body.groupBy, 'year');
  assert.deepEqual(r.body.groups.map((g) => g.year), [1, 2, 3, 4]);
  const y2 = r.body.groups.find((g) => g.year === 2);
  assert.deepEqual(y2.lowAttendance.map((s) => s.rollNo), ['E-001']);
  // Audit B8: read-only oversight roles (principal …) never receive parentPhone.
  assert.equal(y2.lowAttendance[0].parentPhone ?? null, null);
  assert.ok(!JSON.stringify(r.body).includes('Y2-001'), 'only the chosen department');

  const host = await get('principal', '/attendance/summary/students?stayType=hosteler&department=ECE&year=2');
  assert.deepEqual(host.body.students.map((s) => s.rollNo), ['E-001']);
});

test('summary students: stayType=hosteler narrows the drill-down list within scope', async () => {
  const r = await get('hod', '/attendance/summary/students?stayType=hosteler&year=2');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.students.map((s) => s.rollNo), ['Y2-001']);
  assert.equal(r.body.students[0].status, 'present');
  assert.equal(r.body.students[0].parentPhone, u.y2Host.parentPhone);
  assert.equal((await get('hod', '/attendance/summary/students?stayType=$ne')).status, 422);
});

test('study material status: HOD sees own department, uploaded vs not uploaded', async () => {
  const r = await get('hod', '/study-materials/status?year=2&semester=3');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.department, 'CSE (Cyber Security)');
  assert.deepEqual(r.body.summary, { subjects: 2, uploaded: 1, notUploaded: 1 });
  const net = r.body.subjects.find((s) => s.subject.code === 'CS301');
  assert.equal(net.status, 'uploaded');
  assert.deepEqual(net.categories, ['notes']);
  assert.equal(net.materials[0].uploadedBy.name, 'Ravi Teacher');
  assert.ok(net.materials[0].uploadedAt);
  assert.equal(net.faculty[0].name, 'Ravi Teacher');
  assert.equal(r.body.subjects.find((s) => s.subject.code === 'CS302').status, 'not_uploaded');
});

test('study material status: HOD scope is pinned; only HOD, Principal, Dean and Chairman may open it', async () => {
  assert.equal((await get('hod', '/study-materials/status?department=ECE&semester=3')).status, 403);
  assert.equal((await get('hod', '/study-materials/status?semester=1')).status, 403, '1st year belongs to S&H HOD');
  assert.equal((await get('hod', '/study-materials/status?year=3&semester=3')).status, 422, 'year must match semester');
  assert.equal((await get('hod', '/study-materials/status')).status, 422);
  assert.equal((await get('fyHod', '/study-materials/status?semester=3&department=ECE')).status, 403);
  assert.equal((await get('fyHod', '/study-materials/status?semester=1&department=ECE')).status, 200);
  for (const who of ['faculty', 'student', 'admin', 'ao']) assert.equal((await get(who, '/study-materials/status?semester=3&department=ECE')).status, 403, who);

  // Dean and Chairman get the Principal's college-wide view: any department, never unscoped.
  for (const who of ['principal', 'dean', 'chairman']) {
    const p = await get(who, '/study-materials/status?department=ECE&year=2&semester=3');
    assert.equal(p.status, 200, who);
    assert.deepEqual(p.body.subjects.map((s) => s.subject.code), ['EC301'], who);
    assert.equal((await get(who, '/study-materials/status?semester=3')).status, 422, `${who} must pick a department`);
    assert.equal((await get(who, '/study-materials/status?department=Nope&semester=3')).status, 422, who);
    assert.equal((await get(who, '/study-materials/status?department[$ne]=x&semester=3')).status, 422, `${who}: operator injection`);
  }
});
