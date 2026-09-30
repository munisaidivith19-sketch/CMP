/**
 * Canonical class identity: Department + Year + Section + Semester.
 * The same section letter in different years must never mix in any module.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin;
let hod;
let fac3A;
let facScoped;
let stu3A;
let stu2A;
let subj5;
let subj3;
let slot3A;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, h, f, fs, s3, s2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin', employeeId: 'E-ADM' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD' }),
    mk({ role: 'faculty', name: 'Fac 3A', department: 'CSE', employeeId: 'E-3A' }),
    mk({ role: 'faculty', name: 'Fac Scoped', department: 'CSE', employeeId: 'E-SC', teachingYears: [2], teachingSections: ['A'] }),
    mk({ name: 'Stu 3A', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '3A1' }),
    mk({ name: 'Stu 2A', department: 'CSE', section: 'A', year: 2, semester: 3, rollNo: '2A1' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  fac3A = { u: f, ...(await ctx.loginWeb(f)) };
  facScoped = { u: fs, ...(await ctx.loginWeb(fs)) };
  stu3A = { u: s3, ...(await ctx.loginWeb(s3)) };
  stu2A = { u: s2, ...(await ctx.loginWeb(s2)) };

  subj5 = await ctx.models.Subject.create({ name: 'Computer Networks', code: 'CS502', department: 'CSE', semester: 5, sections: ['A'] });
  subj3 = await ctx.models.Subject.create({ name: 'Data Structures', code: 'CS301', department: 'CSE', semester: 3, sections: ['A'] });

  const res = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: subj5._id, faculty: f._id, department: 'CSE', section: 'A', semester: 5, dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  slot3A = res.body;
  // Same section letter, 2nd year — must stay separate everywhere.
  const other = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: subj3._id, faculty: fs._id, department: 'CSE', section: 'A', semester: 3, dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50' },
  });
  assert.equal(other.status, 201, JSON.stringify(other.body));
});
after(async () => {
  await ctx.stop();
});

const newStudent = (over) => ({
  role: 'student', name: 'New Kid', email: `kid${Math.random().toString(36).slice(2, 8)}@test.edu`, password: 'Welcome123',
  rollNo: 'K1', department: 'CSE', year: 3, section: 'A', semester: 5, stayType: 'hosteler', parentPhone: '9111111111', ...over,
});
const newFaculty = (over) => ({
  role: 'faculty', name: 'New Fac', email: `fac${Math.random().toString(36).slice(2, 8)}@test.edu`, password: 'Welcome123',
  employeeId: `E-${Math.random().toString(36).slice(2, 8)}`, department: 'CSE', teachingYears: [2, 3], teachingSections: ['A', 'B'], ...over,
});

// ── User creation ──────────────────────────────────────────────────

test('student creation requires department + year + section; semester is optional but must match the year', async () => {
  const create = (body) => ctx.request('POST', '/admin/users', { token: admin.token, body });
  assert.equal((await create(newStudent())).status, 201);
  const noSem = await create(newStudent({ semester: undefined }));
  assert.equal(noSem.status, 201, `semester is optional: ${JSON.stringify(noSem.body)}`);
  assert.equal(noSem.body.semester, undefined);
  for (const [over, why] of [
    [{ year: undefined }, 'missing year'],
    [{ section: undefined }, 'missing section'],
    [{ year: 7 }, 'invalid year'],
    [{ section: 'Z' }, 'invalid section'],
    [{ semester: 11 }, 'invalid semester'],
    [{ year: 3, semester: 3 }, 'semester 3 is not a 3rd-year semester'],
    [{ department: 'Astrology' }, 'unknown department'],
  ]) {
    const res = await create(newStudent(over));
    assert.equal(res.status, 422, `${why}: ${JSON.stringify(res.body)}`);
  }
});

test('faculty creation stores multiple years and sections handled, and rejects invalid ones', async () => {
  const create = (body) => ctx.request('POST', '/admin/users', { token: admin.token, body });
  const ok = await create(newFaculty());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const stored = await ctx.models.User.findById(ok.body._id).lean();
  assert.deepEqual(stored.teachingYears, [2, 3]);
  assert.deepEqual(stored.teachingSections, ['A', 'B']);

  for (const [over, why] of [
    [{ teachingYears: undefined }, 'missing years'],
    [{ teachingSections: [] }, 'no sections'],
    [{ teachingYears: [5] }, 'year out of range'],
    [{ teachingYears: [2, 2] }, 'duplicate year'],
    [{ teachingSections: ['A', 'Z'] }, 'unknown section'],
  ]) {
    const res = await create(newFaculty(over));
    assert.equal(res.status, 422, `${why}: ${JSON.stringify(res.body)}`);
  }
});

test('admin update rejects a semester that does not belong to the student’s year', async () => {
  const res = await ctx.request('PATCH', `/admin/users/${stu3A.u._id}`, { token: admin.token, body: { semester: 3 } });
  assert.equal(res.status, 422);
  const again = await ctx.models.User.findById(stu3A.u._id).lean();
  assert.equal(again.semester, 5, 'placement unchanged');
});

// ── Timetable ──────────────────────────────────────────────────────

test('timetable year is derived from the semester, and a mismatched year is rejected', async () => {
  assert.equal(slot3A.year, 3);
  const bad = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: subj5._id, faculty: fac3A.u._id, department: 'CSE', section: 'A', semester: 5, year: 2, dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '09:50' },
  });
  assert.equal(bad.status, 422);
});

test('Department + Year + Section + Semester filter never returns another year’s Section A', async () => {
  const res = await ctx.request('GET', '/timetable?department=CSE&year=3&section=A&semester=5', { token: admin.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.slots.length >= 1);
  assert.ok(res.body.slots.every((s) => s.year === 3 && s.section === 'A' && s.semester === 5));

  const byYear = await ctx.request('GET', '/timetable?department=CSE&year=2&section=A', { token: admin.token });
  assert.ok(byYear.body.slots.every((s) => s.year === 2), 'year filter alone separates the two Section As');
  assert.ok(byYear.body.slots.some((s) => s.subject.code === 'CS301'));
});

test('students see only their own year’s timetable; query params cannot widen it', async () => {
  const mine = await ctx.request('GET', '/timetable?year=2&section=B&department=ECE', { token: stu3A.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.slots.length >= 1);
  assert.ok(mine.body.slots.every((s) => s.year === 3 && s.section === 'A' && s.department === 'CSE'));
  const other = await ctx.request('GET', '/timetable', { token: stu2A.token });
  assert.ok(other.body.slots.every((s) => s.year === 2));
});

test('faculty sees only their own teaching timetable', async () => {
  const res = await ctx.request('GET', '/timetable', { token: fac3A.token });
  assert.ok(res.body.slots.length >= 1);
  assert.ok(res.body.slots.every((s) => String(s.faculty._id) === String(fac3A.u._id)));
});

test('faculty can be scheduled outside their declared years/sections handled — any active faculty teaches any class college-wide', async () => {
  const res = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: subj5._id, faculty: facScoped.u._id, department: 'CSE', section: 'A', semester: 5, dayOfWeek: 'wednesday', period: 2, startTime: '10:00', endTime: '10:50' },
  });
  assert.equal(res.status, 201, 'Fac Scoped declares year 2 only, but that no longer bounds scheduling');
});

// ── Attendance ─────────────────────────────────────────────────────

test('attendance roster for 3rd Year Section A excludes 2nd Year Section A', async () => {
  const res = await ctx.request('GET', `/attendance/roster?slotId=${slot3A._id}&date=2026-09-28`, { token: admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const names = res.body.students.map((s) => s.name);
  assert.ok(names.includes('Stu 3A'));
  assert.ok(!names.includes('Stu 2A'), 'same section letter, different year');
});

test('marking attendance rejects a student from another year of the same section', async () => {
  const res = await ctx.request('POST', '/attendance/mark', {
    token: admin.token,
    body: { slotId: slot3A._id, date: '2026-09-28', records: [{ student: stu2A.u._id, status: 'present' }] },
  });
  assert.equal(res.status, 422);
});

// ── People ─────────────────────────────────────────────────────────

test('People: faculty sees their class’s students, never another year’s same section', async () => {
  const res = await ctx.request('GET', '/users?role=student', { token: fac3A.token });
  assert.equal(res.status, 200);
  const names = res.body.items.map((u) => u.name);
  assert.ok(names.includes('Stu 3A'));
  assert.ok(!names.includes('Stu 2A'));
  const profile = await ctx.request('GET', `/users/${stu2A.u._id}`, { token: fac3A.token });
  assert.equal(profile.status, 403);
});

// ── Chat ───────────────────────────────────────────────────────────

test('Chat: faculty class groups follow year + section, not the section letter alone', async () => {
  const bad = await ctx.request('POST', '/chat/conversations', {
    token: fac3A.token,
    body: { type: 'group', name: 'Mixed', participantIds: [stu3A.u._id, stu2A.u._id] },
  });
  assert.equal(bad.status, 403);
  const ok = await ctx.request('POST', '/chat/conversations', {
    token: fac3A.token,
    body: { type: 'group', name: 'CN 3A', participantIds: [stu3A.u._id] },
  });
  assert.ok([201, 202].includes(ok.status), JSON.stringify(ok.body));
});

// ── Study Materials ────────────────────────────────────────────────

test('Study Materials: a 3rd-year student never sees 2nd-year Section A material', async () => {
  const base = { category: 'notes', department: 'CSE', section: 'A', uploadedBy: admin.u._id, isActive: true, file: { url: '/uploads/x.txt', name: 'x.txt', mimeType: 'text/plain' } };
  await ctx.models.StudyMaterial.create({ ...base, title: 'Year 3 notes', semester: 5, subject: subj5._id, subjectName: subj5.name, subjectCode: subj5.code });
  await ctx.models.StudyMaterial.create({ ...base, title: 'Year 2 notes', semester: 3, subject: subj3._id, subjectName: subj3.name, subjectCode: subj3.code });

  const res = await ctx.request('GET', '/study-materials?year=2&semester=3', { token: stu3A.token });
  assert.equal(res.status, 200);
  const titles = res.body.items.map((m) => m.title);
  assert.ok(!titles.includes('Year 2 notes'), 'query params cannot widen a student’s scope');

  const own = await ctx.request('GET', '/study-materials', { token: stu3A.token });
  assert.ok(own.body.items.some((m) => m.title === 'Year 3 notes'));
  assert.ok(own.body.items.every((m) => m.year === 3));
});

test('Study Materials: a client-sent year that contradicts the semester is rejected', async () => {
  const res = await ctx.request('POST', '/study-materials', {
    token: hod.token,
    body: { title: 'Bad year', category: 'notes', subjectId: subj5._id, section: 'A', semester: 5, year: 2, file: { url: '/uploads/x.txt', name: 'x.txt', mimeType: 'text/plain' } },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
});
