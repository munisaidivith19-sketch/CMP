import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');

// Day-wise attendance (chosen by the Principal). Campus time is Asia/Kolkata
// (UTC+05:30). 27 Sep 2026 is a Sunday; 28 Sep and 5 Oct 2026 are Mondays.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;
const MON = '2026-09-28';

let ctx;
let principal, admin, hodCse, hodEce, facA, facB, s1, s2;
let subj1, subj2, subj3;
let p1, p2, p3; // Monday slot ids (CSE-A, semester 5)

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-PR' }),
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HC' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HE' }),
    mk({ role: 'faculty', name: 'Fac A', department: 'CSE', employeeId: 'E-FA' }),
    mk({ role: 'faculty', name: 'Fac B', department: 'CSE', employeeId: 'E-FB' }),
    mk({ name: 'Stu 1', department: 'CSE', section: 'A', semester: 5, rollNo: '01' }),
    mk({ name: 'Stu 2', department: 'CSE', section: 'A', semester: 5, rollNo: '02' }),
  ]);
  [principal, admin, hodCse, hodEce, facA, facB, s1, s2] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  const S = ctx.models.Subject;
  [subj1, subj2, subj3] = await Promise.all([
    S.create({ name: 'Networks', code: 'CS501', department: 'CSE', semester: 5, sections: ['A'] }),
    S.create({ name: 'Crypto', code: 'CS502', department: 'CSE', semester: 5, sections: ['A'] }),
    S.create({ name: 'AI', code: 'CS503', department: 'CSE', semester: 5, sections: ['A'] }),
  ]);
  const add = async (subject, faculty, period, startTime, endTime) => {
    const r = await ctx.request('POST', '/timetable', {
      token: admin.token,
      body: { subject: String(subject._id), faculty: String(faculty.u._id), section: 'A', department: 'CSE', dayOfWeek: 'monday', period, startTime, endTime, semester: 5 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return String(r.body._id);
  };
  p1 = await add(subj1, facA, 1, '09:00', '09:50');
  p2 = await add(subj2, facB, 2, '10:00', '10:50');
  p3 = await add(subj3, facA, 3, '11:00', '11:50');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const mark = (actor, slotId, statuses, extra = {}) =>
  ctx.request('POST', '/attendance/mark', {
    token: actor.token,
    body: {
      slotId,
      records: [
        { student: String(s1.u._id), status: statuses[0] },
        { student: String(s2.u._id), status: statuses[1] },
      ],
      ...extra,
    },
  });
const rec = (subject, student, date = MON) =>
  ctx.models.AttendanceRecord.findOne({ subject: subject._id, student: student.u._id, date: new Date(`${date}T00:00:00.000Z`) }).lean();
const setFlow = (actor, flow) => ctx.request('PUT', '/attendance/flow', { token: actor.token, body: { flow } });

// ── The Principal's switch ─────────────────────────────────────────

test('only the Principal can change the flow; it starts on the next class day', async () => {
  setNow('2026-09-27', '18:00');
  for (const actor of [admin, hodCse, facA, s1]) assert.equal((await setFlow(actor, 'day')).status, 403);
  assert.equal((await setFlow(principal, 'weekly')).status, 422);

  const r = await setFlow(principal, 'day');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.current, 'period', 'today stays period-wise');
  assert.deepEqual(r.body.upcoming, { flow: 'day', from: MON });

  const seen = await ctx.request('GET', '/attendance/flow', { token: facA.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.upcoming.flow, 'day');

  setNow(MON, '08:00');
  assert.equal((await ctx.request('GET', '/attendance/flow', { token: facB.token })).body.current, 'day');
});

// ── The class day ──────────────────────────────────────────────────

test('day-wise: the morning period is taken while it runs and copied to every period of the day', async () => {
  setNow(MON, '08:59');
  assert.equal((await mark(facA, p1, ['present', 'absent'])).status, 403, 'before the morning period opens');

  setNow(MON, '09:10');
  const r = await mark(facA, p1, ['present', 'absent']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.flow, 'day');
  assert.deepEqual(r.body.dayWise, { copiedRecords: 4, periods: 2 });

  for (const subject of [subj2, subj3]) {
    const a = await rec(subject, s1);
    const b = await rec(subject, s2);
    assert.equal(a.status, 'present');
    assert.equal(b.status, 'absent');
    assert.equal(b.source, 'DAY_WISE_COPY');
  }

  // Re-taking the morning period while it runs updates the copies.
  setNow(MON, '09:40');
  const again = await mark(facA, p1, ['present', 'present']);
  assert.equal(again.status, 200);
  assert.equal((await rec(subj2, s2)).status, 'present');
  assert.equal((await rec(subj3, s2)).status, 'present');
});

test('day-wise: other periods cannot be taken live; they open for correction at 3:00 PM', async () => {
  setNow(MON, '10:10');
  const live = await mark(facB, p2, ['present', 'absent']);
  assert.equal(live.status, 403);
  assert.match(live.body.message, /filled from the morning attendance.*3:00 PM today until 3:00 PM tomorrow/);

  const periods = await ctx.request('GET', '/attendance/my-periods', { token: facB.token });
  assert.equal(periods.body.flow, 'day');
  assert.equal(periods.body.periods[0].marked, true, 'filled from the morning period');
  assert.equal(periods.body.periods[0].dayWise.canEdit, false);
  assert.equal(periods.body.periods[0].dayWise.isMorning, false);

  const roster = await ctx.request('GET', `/attendance/roster?slotId=${p2}`, { token: facB.token });
  assert.equal(roster.status, 200);
  assert.equal(roster.body.editable, false);
  assert.equal(roster.body.dayWise.copiedCount, 2);

  // The morning period has ended: it is closed until 3:00 PM too.
  setNow(MON, '10:00');
  const late = await mark(facA, p1, ['present', 'present']);
  assert.equal(late.status, 403);
  assert.match(late.body.message, /morning period has ended/);
});

test('day-wise: a corrected period is never overwritten by a later morning change', async () => {
  setNow(MON, '15:30');
  const fix = await mark(facB, p2, ['absent', 'present']);
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  const fixed = await rec(subj2, s1);
  assert.equal(fixed.status, 'absent');
  assert.equal(fixed.source, undefined, 'now Fac B’s own mark');
  assert.equal((await rec(subj2, s2)).source, undefined, 'confirmed unchanged → also Fac B’s mark');

  // The morning faculty corrects P1 in the window: P3 (still a copy) follows, P2 (corrected) does not.
  const morning = await mark(facA, p1, ['present', 'absent']);
  assert.equal(morning.status, 200);
  assert.equal((await rec(subj3, s2)).status, 'absent');
  assert.equal((await rec(subj2, s2)).status, 'present');
  assert.equal((await rec(subj2, s1)).status, 'absent');
});

test('day-wise: faculty can correct until 3:00 PM the next day (and see yesterday in My periods)', async () => {
  setNow('2026-09-29', '10:00');
  const list = await ctx.request('GET', '/attendance/my-periods', { token: facB.token });
  assert.equal(list.body.previousDay.date, MON);
  assert.equal(list.body.previousDay.periods.length, 1);
  assert.equal(list.body.previousDay.periods[0].dayWise.canEdit, true);

  setNow('2026-09-29', '14:59');
  const ok = await mark(facB, p2, ['present', 'present'], { date: MON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  setNow('2026-09-29', '15:00');
  const closed = await mark(facB, p2, ['absent', 'present'], { date: MON });
  assert.equal(closed.status, 403);
  assert.match(closed.body.message, /correction window for this day has closed/);
  assert.equal((await ctx.request('GET', '/attendance/my-periods', { token: facB.token })).body.previousDay, null);
});

test('day-wise: the HOD can edit for 48 hours from 3:00 PM (own department only)', async () => {
  setNow('2026-09-30', '14:59');
  const ok = await mark(hodCse, p3, ['absent', 'absent'], { date: MON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await mark(hodEce, p3, ['present', 'present'], { date: MON })).status, 403, 'other department');

  setNow('2026-09-30', '15:00');
  const closed = await mark(hodCse, p3, ['present', 'present'], { date: MON });
  assert.equal(closed.status, 403);
  assert.match(closed.body.message, /HOD correction window/);

  // Admin keeps full access.
  assert.equal((await mark(admin, p3, ['present', 'present'], { date: MON })).status, 200);
});

test('day-wise: with Period 1 not conducted, the first held period is the morning attendance', async () => {
  const D = '2026-10-05';
  setNow(D, '08:00');
  await ctx.models.PeriodCover.create({
    date: new Date(`${D}T00:00:00.000Z`),
    timetableSlot: p1,
    startTime: '09:00',
    endTime: '09:50',
    department: 'CSE',
    originalFaculty: facA.u._id,
    kind: 'not_conducted',
    assignedBy: hodCse.u._id,
    history: [{ action: 'not_conducted', by: hodCse.u._id }],
  });
  setNow(D, '10:05');
  const r = await mark(facB, p2, ['absent', 'present']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.dayWise, { copiedRecords: 2, periods: 1 }, 'copied to P3 only');
  assert.equal((await rec(subj3, s1, D)).status, 'absent');
  assert.equal(await rec(subj1, s1, D), null, 'P1 was not conducted');
});

// ── Back to period-wise: the existing flow, untouched ──────────────

test('switching back to period-wise restores the per-period flow from the next day', async () => {
  setNow('2026-10-10', '18:00');
  const r = await setFlow(principal, 'period');
  assert.equal(r.status, 200);
  assert.equal(r.body.current, 'day');
  assert.deepEqual(r.body.upcoming, { flow: 'period', from: '2026-10-11' });

  const D = '2026-10-12';
  setNow(D, '09:10');
  const morning = await mark(facA, p1, ['present', 'absent']);
  assert.equal(morning.status, 200);
  assert.equal(morning.body.flow, 'period');
  assert.equal(morning.body.dayWise, null);
  assert.equal(await rec(subj2, s1, D), null, 'nothing copied');

  setNow(D, '10:10');
  assert.equal((await mark(facB, p2, ['present', 'present'])).status, 200, 'P2 taken live by its own faculty');
  setNow(D, '15:30');
  assert.equal((await mark(facB, p2, ['present', 'absent'])).status, 403, 'no 3 PM window in period-wise');

  // History: earlier days keep the flow that applied to them.
  const st = await ctx.request('GET', '/attendance/flow', { token: principal.token });
  assert.equal(st.body.current, 'period');
  assert.deepEqual(st.body.history.map((h) => [h.flow, h.from]), [['period', '2026-10-11'], ['day', MON]]);
});

test('changing your mind the same evening just replaces the pending choice', async () => {
  setNow('2026-10-13', '18:00');
  assert.equal((await setFlow(principal, 'day')).body.upcoming.flow, 'day');
  const back = await setFlow(principal, 'period');
  assert.equal(back.body.upcoming, null);
  assert.equal(back.body.changed, true);
  assert.equal((await setFlow(principal, 'period')).body.changed, false);
});
