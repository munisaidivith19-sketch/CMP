/**
 * Who gets college-wide academic visibility.
 *
 * Exactly five roles (COLLEGE_WIDE_ROLES): admin, principal, chairman, dean
 * and AO. All but admin are read-only. Faculty are scoped to their teaching
 * assignment and an HOD to their department (covered in
 * academic-authorization.test.js); Security and Warden get no academic
 * directory at all, which matters because the old code granted access by
 * "not one of the scoped roles" and so handed them the whole college.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { COLLEGE_WIDE_ROLES, ACADEMIC_READ_ONLY_ROLES } = await import('../src/constants.js');
const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata (UTC+05:30); 2026-10-05 is a Monday, the day the
// fixture's periods are held on.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 0, h * 60 + m - 330));
};
const realNow = clock.now;

const CSE = 'CSE (Cyber Security)';
const names = (res) => res.body.items.map((u) => u.name);

let ctx;
let admin, principal, chairman, dean, ao, security, warden, hodCse, facNs;
let stuCse, stuEce;
let facEce;
let subjNs, slotNsA;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);

  [admin, principal, chairman, dean, ao, security, warden, hodCse, facNs, facEce, stuCse, stuEce] = await Promise.all(
    [
      { role: 'admin', name: 'The Admin' },
      { role: 'principal', name: 'The Principal', employeeId: 'E-PR' },
      { role: 'chairman', name: 'The Chairman', employeeId: 'E-CH' },
      { role: 'dean', name: 'The Dean', employeeId: 'E-DN' },
      { role: 'ao', name: 'The AO', employeeId: 'E-AO' },
      { role: 'security', name: 'The Guard', employeeId: 'E-SEC' },
      { role: 'warden', name: 'The Warden', employeeId: 'E-WD' },
      { role: 'hod', name: 'HOD CSE', department: CSE, employeeId: 'E-HOD' },
      { role: 'faculty', name: 'Fac NS', department: CSE, employeeId: 'E-NS' },
      { role: 'faculty', name: 'Fac ECE', department: 'ECE', employeeId: 'E-FE' },
      { name: 'Stu Cse', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '101' },
      { name: 'Stu Ece', department: 'ECE', section: 'A', year: 3, semester: 6, rollNo: '201' },
    ].map(async (o) => {
      const u = await mk(o);
      return { u, ...(await ctx.loginWeb(u)) };
    })
  );

  const { Subject, TimetableSlot } = ctx.models;
  subjNs = await Subject.create({ name: 'Network Security', code: 'CS601', department: CSE, semester: 6, year: 3, faculty: [facNs.u._id], sections: ['A'] });
  const subjEce = await Subject.create({ name: 'VLSI', code: 'EC601', department: 'ECE', semester: 6, year: 3, sections: ['A'] });
  const base = { dayOfWeek: 'monday', semester: 6, year: 3, isActive: true, startTime: '08:30', endTime: '09:15' };
  [slotNsA] = await TimetableSlot.create([
    { ...base, subject: subjNs._id, faculty: facNs.u._id, department: CSE, section: 'A', period: 1 },
    { ...base, subject: subjEce._id, faculty: facEce.u._id, department: 'ECE', section: 'A', period: 2, startTime: '09:15', endTime: '10:00' },
  ]);
  clock.now = () => at('2026-10-05', '08:45');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const collegeWide = () => [
  ['admin', () => admin],
  ['principal', () => principal],
  ['chairman', () => chairman],
  ['dean', () => dean],
  ['ao', () => ao],
];

test('the college-wide list is exactly admin, principal, chairman, dean and AO', () => {
  assert.deepEqual(COLLEGE_WIDE_ROLES, ['admin', 'principal', 'chairman', 'dean', 'ao']);
  // Everyone on the list bar admin reads academic data without writing it.
  assert.deepEqual(ACADEMIC_READ_ONLY_ROLES, ['principal', 'chairman', 'dean', 'ao']);
});

// ── College-wide reads ─────────────────────────────────────────────

test('every college-wide role sees People across every department', async () => {
  for (const [role, who] of collegeWide()) {
    const res = await ctx.request('GET', '/users', { token: who().token });
    assert.equal(res.status, 200, role);
    const got = names(res);
    assert.ok(got.includes('Stu Cse') && got.includes('Stu Ece'), `${role} should see both departments`);
    assert.ok(got.includes('Fac NS') && got.includes('HOD CSE'), `${role} should see staff too`);

    const filters = await ctx.request('GET', '/users/people-filters', { token: who().token });
    assert.equal(filters.status, 200, role);
    assert.equal(filters.body.scope, 'college', role);

    // A single profile in any department opens.
    assert.equal((await ctx.request('GET', `/users/${stuEce.u._id}`, { token: who().token })).status, 200, role);
  }
});

test('every college-wide role sees the timetable of any department', async () => {
  for (const [role, who] of collegeWide()) {
    const res = await ctx.request('GET', '/timetable?department=ECE&year=3&section=A&semester=6', { token: who().token });
    assert.equal(res.status, 200, role);
    assert.ok(res.body.slots.length > 0, `${role} should reach ECE`);
    assert.ok(res.body.slots.every((s) => s.department === 'ECE'), role);

    const cse = await ctx.request('GET', `/timetable?department=${encodeURIComponent(CSE)}&year=3&section=A&semester=6`, { token: who().token });
    assert.ok(cse.body.slots.length > 0, `${role} should reach CSE as well`);
  }
});

test('every college-wide role reads attendance and reports in any department', async () => {
  for (const [role, who] of collegeWide()) {
    assert.equal((await ctx.request('GET', '/attendance/low?range=all', { token: who().token })).status, 200, role);
    assert.equal((await ctx.request('GET', '/attendance/section?range=all', { token: who().token })).status, 200, role);

    const options = await ctx.request('GET', '/attendance/reports/options', { token: who().token });
    assert.equal(options.status, 200, role);
    assert.equal(options.body.scope, 'college', role);

    // A report for a department that is not their own is allowed, and the
    // requested department is honoured rather than silently replaced.
    const report = await ctx.request('GET', `/attendance/reports/monthly?department=${encodeURIComponent(CSE)}&year=3&section=A&semester=6`, {
      token: who().token,
    });
    assert.equal(report.status, 200, role);
    assert.equal(report.body.header.department, CSE, role);

    assert.equal((await ctx.request('GET', '/attendance/summary', { token: who().token })).status, 200, `${role} daily summary`);
  }
});

// ── College-wide means read-only (except admin) ────────────────────

test('the read-only authorities cannot mark attendance or write the timetable', async () => {
  for (const [role, who] of [['principal', () => principal], ['chairman', () => chairman], ['dean', () => dean], ['ao', () => ao]]) {
    const mark = await ctx.request('POST', '/attendance/mark', {
      token: who().token,
      body: { slotId: String(slotNsA._id), records: [{ student: String(stuCse.u._id), status: 'present' }] },
    });
    assert.equal(mark.status, 403, `${role} must not mark attendance`);

    const roster = await ctx.request('GET', `/attendance/roster?slotId=${slotNsA._id}`, { token: who().token });
    assert.equal(roster.status, 403, `${role} must not reach the marking roster`);

    const slot = await ctx.request('POST', '/timetable', {
      token: who().token,
      body: {
        subject: String(subjNs._id), faculty: String(facNs.u._id), section: 'B', department: CSE,
        dayOfWeek: 'friday', period: 1, startTime: '08:30', endTime: '09:15', semester: 6,
      },
    });
    assert.equal(slot.status, 403, `${role} must not create timetable periods`);
    assert.equal((await ctx.request('DELETE', `/timetable/${slotNsA._id}`, { token: who().token })).status, 403, `${role} must not delete periods`);
  }

  // Admin keeps full write access.
  assert.equal((await ctx.request('GET', `/attendance/roster?slotId=${slotNsA._id}`, { token: admin.token })).status, 200);
});

// ── Security and Warden: no academic access at all ─────────────────

test('Security and Warden get no People directory — the old catch-all gave them the whole college', async () => {
  for (const [role, who] of [['security', () => security], ['warden', () => warden]]) {
    const list = await ctx.request('GET', '/users', { token: who().token });
    assert.equal(list.status, 403, `${role} must not browse the directory`);

    const filters = await ctx.request('GET', '/users/people-filters', { token: who().token });
    assert.equal(filters.status, 403, `${role} must not get filter options`);

    const profile = await ctx.request('GET', `/users/${stuCse.u._id}`, { token: who().token });
    assert.equal(profile.status, 403, `${role} must not open a student profile`);

    const search = await ctx.request('GET', '/search?q=Stu&type=users', { token: who().token });
    assert.equal(search.status, 200, role);
    assert.deepEqual(search.body.users, [], `${role} search must return nothing`);
  }

  // The chat/club "pick a person" picker is a separate, deliberately open
  // endpoint and keeps working — it is not the People directory.
  const picker = await ctx.request('GET', '/users?context=picker&limit=5', { token: security.token });
  assert.equal(picker.status, 200);
});

test('Security and Warden still have no timetable or attendance access', async () => {
  for (const [role, who] of [['security', () => security], ['warden', () => warden]]) {
    for (const path of ['/timetable', '/timetable/my-schedule', '/timetable/section/A', '/subjects']) {
      assert.equal((await ctx.request('GET', path, { token: who().token })).status, 403, `${role} ${path}`);
    }
    for (const path of ['/attendance/low', '/attendance/section', '/attendance/reports/options', '/attendance/reports/monthly', '/attendance/summary']) {
      assert.equal((await ctx.request('GET', path, { token: who().token })).status, 403, `${role} ${path}`);
    }
  }
});

// ── The scoped roles are unchanged by all this ─────────────────────

test('faculty and HOD remain scoped, not college-wide', async () => {
  const facPeople = await ctx.request('GET', '/users', { token: facNs.token });
  assert.ok(!names(facPeople).includes('Stu Ece'), 'faculty stay on their own classes');

  const hodPeople = await ctx.request('GET', '/users?department=ECE', { token: hodCse.token });
  assert.ok(!names(hodPeople).includes('Stu Ece'), 'an HOD stays in their own department');

  const hodFilters = await ctx.request('GET', '/users/people-filters', { token: hodCse.token });
  assert.equal(hodFilters.body.scope, 'department');
  const facFilters = await ctx.request('GET', '/users/people-filters', { token: facNs.token });
  assert.equal(facFilters.body.scope, 'assignment');

  const tt = await ctx.request('GET', '/timetable', { token: facNs.token });
  assert.ok(tt.body.slots.length > 0);
  assert.ok(tt.body.slots.every((s) => String(s.faculty._id) === String(facNs.u._id) && s.department === CSE));
});
