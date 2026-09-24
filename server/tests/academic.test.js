import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent } from './helpers.js';

let ctx;
let admin;
let fac; // teaches DBMS
let fac2; // other faculty, not assigned
let s1;
let s2;
let outsider; // student in another section
let subject;

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

before(async () => {
  ctx = await startServer();
  const { User, Subject } = ctx.models;
  const mk = (o) => ctx.createUser(o);
  const [a, f, f2, st1, st2, out] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'faculty', name: 'Faculty One', department: 'CSE' }),
    mk({ role: 'faculty', name: 'Faculty Two', department: 'ECE' }),
    mk({ name: 'Stu One', department: 'CSE', section: 'A', semester: 5, rollNo: '01' }),
    mk({ name: 'Stu Two', department: 'CSE', section: 'A', semester: 5, rollNo: '02' }),
    mk({ name: 'Other Sec', department: 'CSE', section: 'B', semester: 5 }),
  ]);
  subject = await Subject.create({ name: 'DBMS', code: 'CS503', department: 'CSE', semester: 5, faculty: [f._id], sections: ['A'] });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  fac = { u: f, ...(await ctx.loginWeb(f)) };
  fac2 = { u: f2, ...(await ctx.loginWeb(f2)) };
  s1 = { u: st1, ...(await ctx.loginMobile(st1)) };
  s2 = { u: st2, ...(await ctx.loginWeb(st2)) };
  outsider = { u: out, ...(await ctx.loginWeb(out)) };
  void User;
});
after(async () => {
  await ctx.stop();
});

// ── Timetable ─────────────────────────────────────────────────────

const slot = (over = {}) => ({
  subject: String(subject._id),
  faculty: String(fac.u._id),
  section: 'A',
  department: 'CSE',
  dayOfWeek: 'monday',
  period: 1,
  startTime: '09:00',
  endTime: '09:50',
  semester: 5,
  room: 'LH-1',
  ...over,
});

test('timetable: only admins can edit; conflicts are rejected', async () => {
  assert.equal((await ctx.request('POST', '/timetable', { token: fac.token, body: slot() })).status, 403);
  const ok = await ctx.request('POST', '/timetable', { token: admin.token, body: slot() });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const sectionClash = await ctx.request('POST', '/timetable', { token: admin.token, body: slot({ startTime: '09:30', endTime: '10:20', period: 2, room: 'LH-9' }) });
  assert.equal(sectionClash.status, 409);

  const other = await ctx.models.Subject.create({ name: 'OS', code: 'CS599', department: 'CSE', semester: 5, faculty: [fac.u._id], sections: ['B'] });
  const facultyClash = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: slot({ subject: String(other._id), section: 'B', room: 'LH-2' }),
  });
  assert.equal(facultyClash.status, 409, 'faculty cannot teach two sections at once');
  assert.match(facultyClash.body.message, /already teaches/);

  const wrongFaculty = await ctx.request('POST', '/timetable', { token: admin.token, body: slot({ faculty: String(fac2.u._id), dayOfWeek: 'tuesday' }) });
  assert.equal(wrongFaculty.status, 422, 'faculty must be assigned to the subject');

  const badTime = await ctx.request('POST', '/timetable', { token: admin.token, body: slot({ dayOfWeek: 'friday', startTime: '10:00', endTime: '09:00' }) });
  assert.equal(badTime.status, 422);
});

test('timetable: deleting and recreating the same slot twice works (partial unique index)', async () => {
  for (let i = 0; i < 2; i += 1) {
    const c = await ctx.request('POST', '/timetable', { token: admin.token, body: slot({ dayOfWeek: 'wednesday', period: 3, startTime: '11:00', endTime: '11:50' }) });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal((await ctx.request('DELETE', `/timetable/${c.body._id}`, { token: admin.token })).status, 200);
  }
});

test('timetable: students get their own section, faculty their classes, live update on change', async () => {
  const mine = await ctx.request('GET', '/timetable', { token: s1.token });
  assert.equal(mine.body.slots.length, 1);
  assert.equal(mine.body.slots[0].subject.code, 'CS503');
  const out = await ctx.request('GET', '/timetable', { token: outsider.token });
  assert.equal(out.body.slots.length, 0);
  const f = await ctx.request('GET', '/timetable', { token: fac.token });
  assert.equal(f.body.slots.length, 1);

  const sock = await ctx.connect(s1.token);
  const live = nextEvent(sock, 'timetable:updated', (p) => p.section === 'A');
  await ctx.request('POST', '/timetable', { token: admin.token, body: slot({ dayOfWeek: 'thursday' }) });
  await live;

  const cur = await ctx.request('GET', '/timetable/current', { token: s1.token });
  assert.equal(cur.status, 200);
  assert.ok('current' in cur.body && 'next' in cur.body && Array.isArray(cur.body.today));
});

// ── Attendance ────────────────────────────────────────────────────

test('attendance: roster lists only the class; outsiders and unassigned faculty are blocked', async () => {
  const q = `subjectId=${subject._id}&date=${daysAgo(1)}&period=1&section=A`;
  const roster = await ctx.request('GET', `/attendance/roster?${q}`, { token: fac.token });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  assert.deepEqual(roster.body.students.map((s) => s.name).sort(), ['Stu One', 'Stu Two']);
  assert.equal((await ctx.request('GET', `/attendance/roster?${q}`, { token: fac2.token })).status, 403);
  assert.equal((await ctx.request('GET', `/attendance/roster?${q}`, { token: s1.token })).status, 403);
});

test('attendance: marking validates students, dates and duplicates; student is notified live', async () => {
  const base = { subjectId: String(subject._id), period: 1, section: 'A' };
  const intruder = await ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { ...base, date: daysAgo(1), records: [{ student: String(outsider.u._id), status: 'present' }] },
  });
  assert.equal(intruder.status, 422, 'students from another section are rejected');

  const dup = await ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { ...base, date: daysAgo(1), records: [{ student: String(s1.u._id), status: 'present' }, { student: String(s1.u._id), status: 'absent' }] },
  });
  assert.equal(dup.status, 422);

  const future = await ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { ...base, date: ymd(new Date(Date.now() + 3 * 86400000)), records: [{ student: String(s1.u._id), status: 'present' }] },
  });
  assert.equal(future.status, 422);

  const sock = await ctx.connect(s1.token);
  const live = nextEvent(sock, 'attendance:updated');
  // 4 classes: s1 present 3/4 (75%), s2 present 1/4.
  const plan = [
    [1, 'present', 'present'],
    [2, 'present', 'absent'],
    [3, 'present', 'absent'],
    [4, 'absent', 'absent'],
  ];
  for (const [d, a, b] of plan) {
    const r = await ctx.request('POST', '/attendance/mark', {
      token: fac.token,
      body: { ...base, date: daysAgo(d), records: [{ student: String(s1.u._id), status: a }, { student: String(s2.u._id), status: b }] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await live;

  // Re-marking the same class never creates duplicates; a change is audited.
  const again = await ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { ...base, date: daysAgo(4), records: [{ student: String(s1.u._id), status: 'absent' }, { student: String(s2.u._id), status: 'present' }] },
  });
  assert.equal(again.body.created, 0);
  assert.equal(again.body.modified, 1);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({}), 8);
  const edited = await ctx.models.AttendanceRecord.findOne({ student: s2.u._id, date: new Date(`${daysAgo(4)}T00:00:00Z`) }).lean();
  assert.equal(edited.history.length, 1);
  assert.deepEqual([edited.history[0].from, edited.history[0].to], ['absent', 'present']);
});

test('attendance: overall % = Σ present ÷ Σ conducted (not an average of subject %)', async () => {
  // Second subject with one class: s1 present 1/1 = 100%.
  const { Subject } = ctx.models;
  const lab = await Subject.create({ name: 'DB Lab', code: 'CS553', department: 'CSE', semester: 5, faculty: [fac.u._id], sections: ['A'] });
  await ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { subjectId: String(lab._id), period: 5, section: 'A', date: daysAgo(1), records: [{ student: String(s1.u._id), status: 'present' }, { student: String(s2.u._id), status: 'present' }] },
  });
  const me = await ctx.request('GET', '/attendance/my', { token: s1.token });
  // CS503 3/4 = 75%, CS553 1/1 = 100% → average would be 87.5%, correct is 4/5 = 80%.
  assert.equal(me.body.overall.presentPeriods, 4);
  assert.equal(me.body.overall.totalPeriods, 5);
  assert.equal(me.body.overall.percentage, 80);
  assert.equal(me.body.subjects.find((s) => s.subject.code === 'CS503').percentage, 75);
});

test('attendance: students only ever see their own data', async () => {
  assert.equal((await ctx.request('GET', `/attendance/subject/${subject._id}`, { token: s1.token })).status, 403);
  assert.equal((await ctx.request('GET', '/attendance/section?section=A', { token: s1.token })).status, 403);
  assert.equal((await ctx.request('GET', `/attendance/student/${s2.u._id}`, { token: s1.token })).status, 403);
  const recs = await ctx.request('GET', `/attendance/records?student=${s2.u._id}`, { token: s1.token });
  assert.ok(recs.body.records.every((r) => r.student._id === String(s1.u._id)), 'student filter from client is ignored');
  assert.equal((await ctx.request('POST', '/attendance/mark', { token: s1.token, body: {} })).status, 403);
});

test('attendance: staff views — low attendance, trends, faculty scope', async () => {
  const low = await ctx.request('GET', '/attendance/low', { token: fac.token });
  assert.ok(low.body.students.some((r) => r.student.name === 'Stu Two'));
  assert.ok(!low.body.students.some((r) => r.student.name === 'Stu One'));

  const weekly = await ctx.request('GET', '/attendance/trends?groupBy=week&range=month', { token: fac.token });
  assert.equal(weekly.status, 200);
  assert.ok(weekly.body.length >= 1);

  // ECE faculty who does not teach CS503 sees nothing from CSE.
  const foreign = await ctx.request('GET', '/attendance/low', { token: fac2.token });
  assert.equal(foreign.body.students.length, 0);
  assert.equal((await ctx.request('GET', `/attendance/student/${s1.u._id}`, { token: fac2.token })).status, 403);
});

test('attendance: correction request → faculty approval updates the record with an audit entry', async () => {
  const req = await ctx.request('POST', '/attendance/corrections', {
    token: s1.token,
    body: { subjectId: String(subject._id), date: daysAgo(4), period: 1, requestedStatus: 'present', reason: 'I was at the lab exam' },
  });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.currentStatus, 'absent');
  const dup = await ctx.request('POST', '/attendance/corrections', {
    token: s1.token,
    body: { subjectId: String(subject._id), date: daysAgo(4), period: 1, requestedStatus: 'present', reason: 'again please' },
  });
  assert.equal(dup.status, 409);

  assert.equal((await ctx.request('PATCH', `/attendance/corrections/${req.body._id}`, { token: fac2.token, body: { action: 'approved' } })).status, 403);
  const ok = await ctx.request('PATCH', `/attendance/corrections/${req.body._id}`, { token: fac.token, body: { action: 'approved', note: 'Verified' } });
  assert.equal(ok.status, 200);
  const rec = await ctx.models.AttendanceRecord.findOne({ student: s1.u._id, subject: subject._id, date: new Date(`${daysAgo(4)}T00:00:00Z`) }).lean();
  assert.equal(rec.status, 'present');
  assert.equal(rec.correctedFrom, 'absent');
  assert.ok(rec.history.at(-1).reason.startsWith('Correction approved'));
  assert.equal((await ctx.request('PATCH', `/attendance/corrections/${req.body._id}`, { token: fac.token, body: { action: 'rejected' } })).status, 422);
});

test('attendance: faculty edit window; admin may still correct old classes', async () => {
  const old = { subjectId: String(subject._id), period: 2, section: 'A', date: daysAgo(20), records: [{ student: String(s1.u._id), status: 'present' }] };
  assert.equal((await ctx.request('POST', '/attendance/mark', { token: fac.token, body: old })).status, 403);
  assert.equal((await ctx.request('POST', '/attendance/mark', { token: admin.token, body: old })).status, 200);
});

// ── Analytics ─────────────────────────────────────────────────────

test('analytics: role scoping and real aggregates', async () => {
  const mine = await ctx.request('GET', '/analytics/student?range=month', { token: s1.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.attendance.totalPeriods >= 5);
  assert.equal(mine.body.window.range, 'month');

  assert.equal((await ctx.request('GET', '/analytics/college', { token: fac.token })).status, 403);
  assert.equal((await ctx.request('GET', '/analytics/faculty', { token: s1.token })).status, 403);
  assert.equal((await ctx.request('GET', '/analytics/department?department=ECE', { token: fac.token })).status, 403);

  const college = await ctx.request('GET', '/analytics/college?range=week', { token: admin.token });
  assert.equal(college.status, 200);
  assert.ok(college.body.overview.totalStudents >= 3);
  assert.ok(college.body.overview.activeUsers >= 1);

  const custom = await ctx.request('GET', `/analytics/faculty?from=${daysAgo(10)}&to=${daysAgo(0)}`, { token: fac.token });
  assert.equal(custom.status, 200);
  assert.ok(custom.body.overall.classesConducted >= 4);
  assert.equal((await ctx.request('GET', `/analytics/faculty?from=${daysAgo(0)}&to=${daysAgo(5)}`, { token: fac.token })).status, 422);
});
