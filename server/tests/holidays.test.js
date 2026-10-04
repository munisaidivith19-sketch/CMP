import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata (UTC+05:30). 5 Oct and 12 Oct 2026 are Mondays.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;

let ctx;
let principal, admin, hod, fac, s1, s2, sB, sEce, warden, subject, slotA, slotB;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'principal', name: 'Principal' }),
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD' }),
    mk({ role: 'faculty', name: 'Dr. Fac', department: 'CSE', employeeId: 'E-FAC' }),
    mk({ name: 'Stu A1', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1' }),
    mk({ name: 'Stu A2', department: 'CSE', section: 'A', semester: 5, rollNo: 'A2' }),
    mk({ name: 'Stu B1', department: 'CSE', section: 'B', semester: 5, rollNo: 'B1' }),
    mk({ name: 'Stu ECE', department: 'ECE', section: 'A', semester: 5, rollNo: 'E1' }),
    mk({ role: 'warden', name: 'Warden' }),
  ]);
  [principal, admin, hod, fac, s1, s2, sB, sEce, warden] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  subject = await ctx.models.Subject.create({ name: 'Compilers', code: 'CS501', department: 'CSE', semester: 5, faculty: [], sections: [] });

  const slot = (section, period, startTime, endTime) =>
    ctx.request('POST', '/timetable', {
      token: admin.token,
      body: { subject: String(subject._id), faculty: String(fac.u._id), section, department: 'CSE', dayOfWeek: 'monday', period, startTime, endTime, semester: 5 },
    });
  const [a, b] = [await slot('A', 1, '09:00', '09:50'), await slot('B', 2, '10:00', '10:50')];
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));
  slotA = String(a.body._id);
  slotB = String(b.body._id);
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const create = (actor, body) => ctx.request('POST', '/holidays', { token: actor.token, body });
const markA = () =>
  ctx.request('POST', '/attendance/mark', {
    token: fac.token,
    body: { slotId: slotA, records: [{ student: String(s1.u._id), status: 'present' }, { student: String(s2.u._id), status: 'absent' }] },
  });
const markB = () =>
  ctx.request('POST', '/attendance/mark', { token: fac.token, body: { slotId: slotB, records: [{ student: String(sB.u._id), status: 'present' }] } });

const classA = { reason: 'Local festival', type: 'SINGLE', startDate: '2026-10-05', department: 'CSE', year: 3, section: 'A' };

// ── Authorization ──────────────────────────────────────────────────

test('only the Principal can create, edit or delete a holiday — direct API calls by others are refused', async () => {
  for (const actor of [fac, hod, admin, s1, warden]) {
    const res = await create(actor, classA);
    assert.equal(res.status, 403, `${actor.u.role} create`);
  }
  assert.equal(await ctx.models.Holiday.countDocuments(), 0, 'nothing was written');

  const made = await create(principal, { reason: 'Temp', type: 'SINGLE', startDate: '2026-11-20', department: 'ECE', year: 'ALL', section: 'ALL' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  for (const actor of [fac, hod, admin]) {
    assert.equal((await ctx.request('PUT', `/holidays/${made.body._id}`, { token: actor.token, body: { ...classA } })).status, 403);
    assert.equal((await ctx.request('DELETE', `/holidays/${made.body._id}`, { token: actor.token })).status, 403);
  }
  const still = await ctx.models.Holiday.findById(made.body._id).lean();
  assert.equal(still.status, 'ACTIVE');
  assert.equal(still.reason, 'Temp');
  assert.equal((await ctx.request('DELETE', `/holidays/${made.body._id}`, { token: principal.token })).status, 200);
});

test('validation: dates, department, year, section and scope hierarchy', async () => {
  const bad = [
    [{ ...classA, type: 'CUSTOM', startDate: '2026-10-10', endDate: '2026-10-05' }, /before/],
    [{ ...classA, startDate: '2026-13-40' }, /date/i],
    [{ ...classA, department: 'Astrology' }, /department/i],
    [{ ...classA, year: 7 }, /Year/],
    [{ ...classA, section: 'Z' }, /Section/],
    [{ ...classA, year: 'ALL' }, /year before/i],
    [{ ...classA, department: 'ALL', year: 2, section: 'ALL' }, /department before/i],
    [{ ...classA, reason: 'x' }, /Reason/],
    [{ ...classA, type: 'CUSTOM', startDate: '2026-01-01', endDate: '2027-06-01' }, /at most/],
  ];
  for (const [body, msg] of bad) {
    const res = await create(principal, body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.match(res.body.message, msg);
  }
  assert.equal(await ctx.models.Holiday.countDocuments({ status: 'ACTIVE' }), 0);
});

// ── Attendance ─────────────────────────────────────────────────────

test('a class holiday blocks attendance for that class only — no session, no record, no absentee', async () => {
  const res = await create(principal, classA);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.scope, 'CSE → Year 3 → Section A');
  assert.equal(res.body.endDate, '2026-10-05');

  setNow('2026-10-05', '09:10');
  const blocked = await markA();
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /HOLIDAY — Local festival/);
  assert.equal(blocked.body.holiday.reason, 'Local festival');
  assert.equal(await ctx.models.AttendanceSession.countDocuments(), 0);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments(), 0);

  const roster = await ctx.request('GET', `/attendance/roster?slotId=${slotA}`, { token: fac.token });
  assert.equal(roster.status, 200);
  assert.equal(roster.body.editable, false);
  assert.equal(roster.body.holiday.reason, 'Local festival');

  const periods = await ctx.request('GET', '/attendance/my-periods', { token: fac.token });
  const p1 = periods.body.periods.find((p) => p.period === 1);
  const p2 = periods.body.periods.find((p) => p.period === 2);
  assert.equal(p1.holiday.reason, 'Local festival');
  assert.equal(p2.holiday, null, 'section B is not on holiday');

  // HOD and admin editing by subject are refused the same way.
  const hodMark = await ctx.request('POST', '/attendance/mark', {
    token: hod.token,
    body: { subjectId: String(subject._id), section: 'A', date: '2026-10-05', period: 1, records: [{ student: String(s1.u._id), status: 'absent' }] },
  });
  assert.equal(hodMark.status, 409);

  // Section B, same day, is a normal working class.
  setNow('2026-10-05', '10:10');
  assert.equal((await markB()).status, 200);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ section: 'A' }), 0);
});

test('overlapping holidays are refused deterministically; disjoint scopes are allowed', async () => {
  const dept = await create(principal, { reason: 'Dept day', type: 'SINGLE', startDate: '2026-10-05', department: 'CSE', year: 'ALL', section: 'ALL' });
  assert.equal(dept.status, 409, 'department-wide overlaps the class holiday');
  assert.match(dept.body.message, /Local festival/);

  const college = await create(principal, { reason: 'Rain', type: 'CUSTOM', startDate: '2026-10-04', endDate: '2026-10-06', department: 'ALL', year: 'ALL', section: 'ALL' });
  assert.equal(college.status, 409, 'entire college overlaps the targeted holiday');

  const same = await create(principal, { ...classA, reason: 'Duplicate' });
  assert.equal(same.status, 409, 'exact duplicate');

  const ece = await create(principal, { reason: 'ECE expo', type: 'SINGLE', startDate: '2026-10-05', department: 'ECE', year: 'ALL', section: 'ALL' });
  assert.equal(ece.status, 201, 'another department may share the date');
  const otherSection = await create(principal, { ...classA, reason: 'Lab shutdown', section: 'C' });
  assert.equal(otherSection.status, 201, 'a sibling section may share the date');
});

// ── Timetable ──────────────────────────────────────────────────────

test('timetable shows the holiday for that date without touching the stored slots', async () => {
  setNow('2026-10-05', '08:00');
  const before = await ctx.models.TimetableSlot.countDocuments({ isActive: true });

  const a = await ctx.request('GET', '/timetable', { token: s1.token });
  assert.equal(a.status, 200);
  assert.equal(a.body.week.monday, '2026-10-05');
  const mon = a.body.slots.filter((s) => s.dayOfWeek === 'monday');
  assert.ok(mon.length);
  assert.ok(mon.every((s) => s.holiday?.reason === 'Local festival'));

  const b = await ctx.request('GET', '/timetable', { token: sB.token });
  assert.ok(b.body.slots.every((s) => s.holiday === null));

  const current = await ctx.request('GET', '/timetable/current', { token: s1.token });
  assert.equal(current.body.holiday?.reason, 'Local festival');

  // The following week the normal timetable is back on its own.
  setNow('2026-10-12', '08:00');
  const next = await ctx.request('GET', '/timetable', { token: s1.token });
  assert.ok(next.body.slots.every((s) => s.holiday === null));
  assert.equal(await ctx.models.TimetableSlot.countDocuments({ isActive: true }), before);
});

// ── Reports ────────────────────────────────────────────────────────

test('reports say "holiday" for the class and never list students as absent', async () => {
  setNow('2026-10-05', '18:00');
  const period = await ctx.request('GET', `/attendance/reports/period?department=CSE&year=3&section=A&date=2026-10-05&period=1`, { token: principal.token });
  assert.equal(period.status, 200, JSON.stringify(period.body));
  assert.equal(period.body.holiday.reason, 'Local festival');
  assert.equal(period.body.absent.length, 0);

  const date = await ctx.request('GET', `/attendance/reports/date?department=CSE&year=3&section=A&date=2026-10-05`, { token: hod.token });
  assert.equal(date.status, 200);
  assert.equal(date.body.holiday.reason, 'Local festival');
  assert.equal(date.body.totals.absent, 0);

  // A department-wide report: the Section A holiday is partial, Section B's marks stand.
  const dept = await ctx.request('GET', `/attendance/reports/date?date=2026-10-05`, { token: hod.token });
  assert.equal(dept.body.holiday, null);
  assert.ok(dept.body.holidays.some((h) => h.reason === 'Local festival' && h.full === false));
  assert.equal(dept.body.totals.total, 1);

  const pdf = await fetch(`${ctx.base}/api/attendance/reports/date?department=CSE&year=3&section=A&date=2026-10-05&format=pdf`, {
    headers: { authorization: `Bearer ${principal.token}` },
  });
  assert.equal(pdf.status, 200);
  assert.match(Buffer.from(await pdf.arrayBuffer()).toString('latin1'), /HOLIDAY/);
});

// ── Edit / delete ──────────────────────────────────────────────────

test('editing moves the holiday; deleting restores attendance; history is untouched', async () => {
  const h = await ctx.models.Holiday.findOne({ reason: 'Local festival' }).lean();
  const recordsBefore = await ctx.models.AttendanceRecord.countDocuments();

  const moved = await ctx.request('PUT', `/holidays/${h._id}`, { token: principal.token, body: { ...classA, section: 'B' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.section, 'B');
  assert.equal(await ctx.models.AttendanceRecord.countDocuments(), recordsBefore, 'existing B attendance is not deleted');

  setNow('2026-10-05', '09:10');
  assert.equal((await markA()).status, 200, 'section A is a working day again');
  setNow('2026-10-05', '10:10');
  assert.equal((await markB()).status, 409, 'section B is now on holiday');

  const del = await ctx.request('DELETE', `/holidays/${h._id}`, { token: principal.token });
  assert.equal(del.status, 200);
  assert.equal((await ctx.models.Holiday.findById(h._id).lean()).status, 'CANCELLED', 'soft delete');
  assert.equal((await markB()).status, 200, 'normal rules restored');
  assert.equal((await ctx.request('DELETE', `/holidays/${h._id}`, { token: principal.token })).status, 404);
});

// ── Percentage ─────────────────────────────────────────────────────

test('holidays never become absences: percentage is unchanged across a custom holiday', async () => {
  const beforeRes = await ctx.request('GET', '/attendance/my?range=all', { token: s1.token });
  const res = await create(principal, { reason: 'Puja break', type: 'CUSTOM', startDate: '2026-10-12', endDate: '2026-10-14', department: 'CSE', year: 'ALL', section: 'ALL' });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  setNow('2026-10-12', '09:10');
  assert.equal((await markA()).status, 409);

  const afterRes = await ctx.request('GET', '/attendance/my?range=all', { token: s1.token });
  assert.deepEqual(afterRes.body.overall, beforeRes.body.overall);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ date: new Date('2026-10-12T00:00:00Z') }), 0);
});

// ── Visibility / calendar ──────────────────────────────────────────

test('holiday listing: students see only their own class; ranges span months and years', async () => {
  const yearEnd = await create(principal, { reason: 'Year-end break', type: 'CUSTOM', startDate: '2026-12-30', endDate: '2027-01-02', department: 'ALL', year: 'ALL', section: 'ALL' });
  assert.equal(yearEnd.status, 201, JSON.stringify(yearEnd.body));

  const jan = await ctx.request('GET', '/holidays?from=2027-01-01&to=2027-01-31', { token: s1.token });
  assert.equal(jan.status, 200);
  assert.deepEqual(jan.body.holidays.map((h) => h.reason), ['Year-end break']);
  assert.equal(jan.body.canManage, false);

  const ece = await ctx.request('GET', '/holidays?from=2026-10-01&to=2026-10-31', { token: sEce.token });
  assert.ok(ece.body.holidays.every((h) => h.department === 'ECE' || h.department === 'ALL'));
  assert.ok(!ece.body.holidays.some((h) => h.reason === 'Puja break'));

  const mine = await ctx.request('GET', '/holidays?from=2026-10-01&to=2026-10-31', { token: s1.token });
  assert.ok(mine.body.holidays.some((h) => h.reason === 'Puja break'));
  assert.ok(!mine.body.holidays.some((h) => h.reason === 'ECE expo'));

  const p = await ctx.request('GET', '/holidays', { token: principal.token });
  assert.equal(p.body.canManage, true);
  assert.equal((await ctx.request('GET', '/holidays', { token: warden.token })).status, 403);
  assert.equal((await ctx.request('GET', '/holidays/options', { token: principal.token })).body.departments.includes('CSE'), true);
});
