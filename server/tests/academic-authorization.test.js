/**
 * Strict academic access control for the People and Timetable modules.
 *
 * Every assertion here goes through the HTTP API with a real token, because
 * the requirement is that unauthorized data is never RETURNED — not that the
 * frontend hides it. Each scope-expanding parameter a client could tamper with
 * (department, program, year, section, semester, subject, faculty, role, ids)
 * is exercised explicitly.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, hodCse, hodEce, facNs, facOther, facEce;
let stuA, stuB, stuC, stuY2, stuEce;
let subjNs, subjCrypto, subjEce;
let slotNsA, slotNsC, slotCryptoA, slotNsB, slotY2, slotEce;

const CSE = 'CSE (Cyber Security)';
const names = (res) => res.body.items.map((u) => u.name);
const sections = (slots) => [...new Set(slots.map((s) => s.section))].sort();
const departments = (slots) => [...new Set(slots.map((s) => s.department))].sort();

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);

  [admin, hodCse, hodEce, facNs, facOther, facEce, stuA, stuB, stuC, stuY2, stuEce] = await Promise.all(
    [
      { role: 'admin', name: 'Admin' },
      { role: 'hod', name: 'HOD CSE', department: CSE, employeeId: 'E-HOD-CSE' },
      { role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HOD-ECE' },
      // Teaches Network Security to Y3-A and Y3-C, and Cryptography to Y3-A.
      { role: 'faculty', name: 'Fac NS', department: CSE, employeeId: 'E-NS' },
      // Teaches Network Security to Y3-B only — the "same subject, other section" case.
      { role: 'faculty', name: 'Fac Other', department: CSE, employeeId: 'E-OTH' },
      { role: 'faculty', name: 'Fac ECE', department: 'ECE', employeeId: 'E-ECE' },
      { name: 'Rahul SecA', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '101' },
      { name: 'Rahul SecB', department: CSE, section: 'B', year: 3, semester: 6, rollNo: '201' },
      { name: 'Rahul SecC', department: CSE, section: 'C', year: 3, semester: 6, rollNo: '301' },
      { name: 'Rahul Year2', department: CSE, section: 'A', year: 2, semester: 4, rollNo: '401' },
      { name: 'Rahul Ece', department: 'ECE', section: 'A', year: 3, semester: 6, rollNo: '501' },
    ].map(async (o) => {
      const u = await mk(o);
      return { u, ...(await ctx.loginWeb(u)) };
    })
  );

  const { Subject, TimetableSlot } = ctx.models;
  [subjNs, subjCrypto, subjEce] = await Promise.all([
    Subject.create({ name: 'Network Security', code: 'CS601', department: CSE, semester: 6, year: 3, sections: ['A', 'B', 'C'] }),
    Subject.create({ name: 'Cryptography', code: 'CS602', department: CSE, semester: 6, year: 3, sections: ['A'] }),
    Subject.create({ name: 'VLSI Design', code: 'EC601', department: 'ECE', semester: 6, year: 3, sections: ['A'] }),
  ]);
  const slot = (o) => ({ dayOfWeek: 'monday', startTime: '08:30', endTime: '09:15', period: 1, semester: 6, year: 3, isActive: true, ...o });
  [slotNsA, slotNsC, slotCryptoA, slotNsB, slotY2, slotEce] = await TimetableSlot.create([
    slot({ subject: subjNs._id, faculty: facNs.u._id, department: CSE, section: 'A', room: 'LH-1' }),
    slot({ subject: subjNs._id, faculty: facNs.u._id, department: CSE, section: 'C', period: 2, startTime: '09:15', endTime: '10:00' }),
    slot({ subject: subjCrypto._id, faculty: facNs.u._id, department: CSE, section: 'A', period: 3, startTime: '10:00', endTime: '10:45' }),
    slot({ subject: subjNs._id, faculty: facOther.u._id, department: CSE, section: 'B' }),
    slot({ subject: subjCrypto._id, faculty: facOther.u._id, department: CSE, section: 'A', year: 2, semester: 4, period: 4, startTime: '11:00', endTime: '11:45' }),
    slot({ subject: subjEce._id, faculty: facEce.u._id, department: 'ECE', section: 'A' }),
  ]);
});
after(async () => {
  await ctx.stop();
});

// ── §55 People: faculty ────────────────────────────────────────────

test('People/faculty: only the students of the exact classes they teach are returned', async () => {
  const res = await ctx.request('GET', '/users', { token: facNs.token });
  assert.equal(res.status, 200);
  const got = names(res);
  assert.ok(got.includes('Rahul SecA'), 'teaches Y3-A');
  assert.ok(got.includes('Rahul SecC'), 'teaches Y3-C');
  assert.ok(!got.includes('Rahul SecB'), 'never another section of the same subject');
  assert.ok(!got.includes('Rahul Year2'), 'never another year of the same section letter');
  assert.ok(!got.includes('Rahul Ece'), 'never another department');
  // A faculty People list is a class roster: no staff rows at all.
  assert.ok(res.body.items.every((u) => ['student', 'club_admin'].includes(u.role)));
});

test('People/faculty: search only ever finds people inside the authorized scope', async () => {
  // All five students are called "Rahul" — only the two in scope may surface.
  const res = await ctx.request('GET', '/users?q=Rahul', { token: facNs.token });
  assert.equal(res.status, 200);
  assert.deepEqual(names(res).sort(), ['Rahul SecA', 'Rahul SecC']);
  assert.equal(res.body.total, 2, 'the count is the authorized count, not the college count');

  const global = await ctx.request('GET', '/search?q=Rahul&type=users', { token: facNs.token });
  assert.ok(global.body.users.every((u) => ['Rahul SecA', 'Rahul SecC'].includes(u.name)));
});

test('People/faculty: no query parameter can expand the scope', async () => {
  const cases = [
    ['department', `department=${encodeURIComponent('ECE')}`],
    ['program/department', `department=${encodeURIComponent(CSE)}&section=B`],
    ['year', 'year=2'],
    ['section', 'section=B'],
    ['semester', 'semester=4'],
    ['role=faculty', 'role=faculty'],
    ['role=admin', 'role=admin'],
    ['search for another section', 'q=Rahul+SecB'],
    ['search for another department', 'q=Rahul+Ece'],
  ];
  for (const [label, qs] of cases) {
    const res = await ctx.request('GET', `/users?${qs}`, { token: facNs.token });
    assert.equal(res.status, 200, label);
    const leaked = names(res).filter((n) => !['Rahul SecA', 'Rahul SecC'].includes(n));
    assert.deepEqual(leaked, [], `${label} must not return unauthorized people`);
  }
});

test('People/faculty: an unauthorized person id cannot be fetched directly', async () => {
  for (const target of [stuB, stuY2, stuEce]) {
    const res = await ctx.request('GET', `/users/${target.u._id}`, { token: facNs.token });
    assert.equal(res.status, 403, `${target.u.name} must not be readable`);
  }
  assert.equal((await ctx.request('GET', `/users/${stuA.u._id}`, { token: facNs.token })).status, 200);
});

test('People/faculty: the filter options offered are search-only — no department or role selector', async () => {
  const res = await ctx.request('GET', '/users/people-filters', { token: facNs.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'assignment');
  assert.deepEqual(res.body.filters, ['search']);
});

// ── §56 People: HOD ────────────────────────────────────────────────

test('People/HOD: own department only, students and faculty, with working year/section/role filters', async () => {
  const all = await ctx.request('GET', '/users', { token: hodCse.token });
  const got = names(all);
  assert.ok(['Rahul SecA', 'Rahul SecB', 'Rahul SecC', 'Rahul Year2'].every((n) => got.includes(n)));
  assert.ok(got.includes('Fac NS') && got.includes('Fac Other'), 'own department faculty');
  assert.ok(!got.includes('Rahul Ece') && !got.includes('Fac ECE'), 'never another department');

  const y3 = await ctx.request('GET', '/users?year=3&role=student', { token: hodCse.token });
  assert.ok(names(y3).includes('Rahul SecA') && !names(y3).includes('Rahul Year2'));

  const secA = await ctx.request('GET', '/users?year=3&section=A&role=student', { token: hodCse.token });
  assert.deepEqual(names(secA), ['Rahul SecA']);

  const facOnly = await ctx.request('GET', '/users?role=faculty', { token: hodCse.token });
  assert.ok(facOnly.body.items.every((u) => u.role === 'faculty'));
  assert.ok(names(facOnly).includes('Fac NS') && !names(facOnly).includes('Fac ECE'));
});

test('People/HOD: department, section and year manipulation cannot escape the department', async () => {
  for (const qs of ['department=ECE', `department=${encodeURIComponent('ECE')}&role=faculty`, 'department=ECE&section=A&year=3', 'q=Rahul+Ece', 'q=Fac+ECE']) {
    const res = await ctx.request('GET', `/users?${qs}`, { token: hodCse.token });
    assert.equal(res.status, 200, qs);
    assert.ok(!names(res).includes('Rahul Ece') && !names(res).includes('Fac ECE'), `${qs} must stay inside the department`);
  }
  for (const target of [stuEce, facEce]) {
    assert.equal((await ctx.request('GET', `/users/${target.u._id}`, { token: hodCse.token })).status, 403);
  }
});

test('People/HOD: the section and role options come from the HOD’s own department', async () => {
  const res = await ctx.request('GET', '/users/people-filters', { token: hodCse.token });
  assert.equal(res.body.scope, 'department');
  assert.equal(res.body.department, CSE);
  assert.deepEqual(res.body.filters, ['search', 'year', 'section', 'role']);
  assert.deepEqual(res.body.roles, ['faculty', 'student'], 'only Faculty and Student are offered');
  assert.deepEqual(res.body.sections, ['A', 'B', 'C'], 'own-department sections only');
  assert.ok(!res.body.departments, 'no department selector for an HOD');
});

// ── §57 Timetable: faculty ─────────────────────────────────────────

test('Timetable/faculty: only their own assigned periods are returned', async () => {
  const res = await ctx.request('GET', '/timetable', { token: facNs.token });
  assert.equal(res.status, 200);
  assert.deepEqual(sections(res.body.slots), ['A', 'C']);
  assert.deepEqual(departments(res.body.slots), [CSE]);
  assert.ok(res.body.slots.every((s) => String(s.faculty._id) === String(facNs.u._id)), 'never another faculty member’s period');
});

test('Timetable/faculty: department, year, section and faculty parameters cannot expand the scope', async () => {
  const cases = [
    'department=ECE',
    `department=${encodeURIComponent(CSE)}&section=B`,
    'section=B',
    'year=2',
    'year=2&section=A&semester=4',
    `faculty=${facOther.u._id}`,
    `faculty=${facEce.u._id}&department=ECE`,
  ];
  for (const qs of cases) {
    const res = await ctx.request('GET', `/timetable?${qs}`, { token: facNs.token });
    assert.equal(res.status, 200, qs);
    assert.ok(
      res.body.slots.every((s) => String(s.faculty._id) === String(facNs.u._id) && ['A', 'C'].includes(s.section) && s.department === CSE),
      `${qs} must not return unauthorized timetable rows`
    );
  }
});

test('Timetable/faculty: the semester filter narrows but never expands authorization', async () => {
  const own = await ctx.request('GET', '/timetable?semester=6', { token: facNs.token });
  assert.ok(own.body.slots.length >= 3);
  assert.ok(own.body.slots.every((s) => s.semester === 6));

  // Semester 4 is a real semester, just not one this faculty member teaches.
  const other = await ctx.request('GET', '/timetable?semester=4&section=A&department=' + encodeURIComponent(CSE), { token: facNs.token });
  assert.deepEqual(other.body.slots, []);
});

test('Timetable/faculty: the section and per-faculty lookups are scoped too', async () => {
  const sectionB = await ctx.request('GET', '/timetable/section/B', { token: facNs.token });
  assert.equal(sectionB.status, 200);
  assert.deepEqual(sectionB.body, [], 'a section they do not teach returns nothing');

  const sectionA = await ctx.request('GET', '/timetable/section/A', { token: facNs.token });
  assert.ok(sectionA.body.length > 0);
  assert.ok(sectionA.body.every((s) => String(s.faculty._id) === String(facNs.u._id)));

  const other = await ctx.request('GET', `/timetable/faculty/${facOther.u._id}`, { token: facNs.token });
  assert.equal(other.status, 403, 'another faculty member’s schedule is not readable');
  const self = await ctx.request('GET', `/timetable/faculty/${facNs.u._id}`, { token: facNs.token });
  assert.equal(self.status, 200);
});

test('Timetable/faculty: My Schedule is always the authenticated faculty’s own classes', async () => {
  const res = await ctx.request('GET', '/timetable/my-schedule', { token: facNs.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.slots.length, 3, 'NS-A, NS-C and Crypto-A');
  assert.ok(res.body.slots.every((s) => String(s.faculty._id) === String(facNs.u._id)));
  // Each row carries the academic context the view displays.
  for (const s of res.body.slots) {
    assert.ok(s.dayOfWeek && s.period && s.startTime && s.endTime);
    assert.ok(s.subject?.name && s.subject?.code);
    assert.ok(s.department && s.year && s.section && s.semester);
  }
  assert.deepEqual(res.body.semesters, [6]);

  // There is no parameter to ask for somebody else's schedule.
  const spoof = await ctx.request('GET', `/timetable/my-schedule?faculty=${facOther.u._id}`, { token: facNs.token });
  assert.ok(spoof.body.slots.every((s) => String(s.faculty._id) === String(facNs.u._id)));
});

// ── §58 Timetable: HOD ─────────────────────────────────────────────

test('Timetable/HOD: own department, with year, section and semester selectable', async () => {
  const all = await ctx.request('GET', '/timetable', { token: hodCse.token });
  assert.deepEqual(departments(all.body.slots), [CSE]);
  assert.deepEqual(sections(all.body.slots), ['A', 'B', 'C']);

  const y3a = await ctx.request('GET', '/timetable?year=3&section=A&semester=6', { token: hodCse.token });
  assert.ok(y3a.body.slots.length > 0);
  assert.ok(y3a.body.slots.every((s) => s.year === 3 && s.section === 'A' && s.semester === 6 && s.department === CSE));
});

test('Timetable/HOD: department and id manipulation cannot reach another department', async () => {
  for (const qs of ['department=ECE', 'department=ECE&section=A', 'department=ECE&year=3&semester=6', `faculty=${facEce.u._id}&department=ECE`]) {
    const res = await ctx.request('GET', `/timetable?${qs}`, { token: hodCse.token });
    assert.equal(res.status, 200, qs);
    assert.ok(res.body.slots.every((s) => s.department === CSE), `${qs} must stay inside the department`);
  }

  const eceSection = await ctx.request('GET', '/timetable/section/A?department=ECE', { token: hodCse.token });
  assert.ok(eceSection.body.every((s) => s.department === CSE));

  const eceFaculty = await ctx.request('GET', `/timetable/faculty/${facEce.u._id}`, { token: hodCse.token });
  assert.deepEqual(eceFaculty.body, [], 'another department’s faculty schedule is empty for this HOD');

  // Editing a slot in another department is refused by id alone.
  const edit = await ctx.request('PUT', `/timetable/${slotEce._id}`, { token: hodCse.token, body: { room: 'HACK' } });
  assert.equal(edit.status, 403);
  const del = await ctx.request('DELETE', `/timetable/${slotEce._id}`, { token: hodCse.token });
  assert.equal(del.status, 403);
});

test('Timetable/HOD: My Schedule shows only the HOD’s own teaching periods', async () => {
  const none = await ctx.request('GET', '/timetable/my-schedule', { token: hodCse.token });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.slots, [], 'an HOD who teaches nothing gets a clean empty state, not the department timetable');

  // Give the HOD a real teaching period; only that one may appear.
  const slot = await ctx.models.TimetableSlot.create({
    subject: subjCrypto._id, faculty: hodCse.u._id, department: CSE, section: 'C', year: 3, semester: 6,
    dayOfWeek: 'tuesday', period: 1, startTime: '08:30', endTime: '09:15',
  });
  const mine = await ctx.request('GET', '/timetable/my-schedule', { token: hodCse.token });
  assert.equal(mine.body.slots.length, 1);
  assert.equal(String(mine.body.slots[0]._id), String(slot._id));
  await ctx.models.TimetableSlot.deleteOne({ _id: slot._id });
});

test('Timetable: the subject catalogue is scoped to the account as well', async () => {
  const mine = await ctx.request('GET', '/subjects', { token: facNs.token });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.map((s) => s.code).sort(), ['CS601', 'CS602'], 'only the subjects they are actually scheduled for');

  // Asking for another department intersects the scope to nothing rather than
  // widening it — the ECE subject is never listed.
  const facultyView = await ctx.request('GET', `/subjects?department=${encodeURIComponent('ECE')}`, { token: facNs.token });
  assert.equal(facultyView.status, 200);
  assert.deepEqual(facultyView.body, []);

  const hodView = await ctx.request('GET', '/subjects?department=ECE', { token: hodCse.token });
  assert.ok(hodView.body.every((s) => s.department === CSE));
  assert.ok(!hodView.body.some((s) => s.code === 'EC601'));
});
