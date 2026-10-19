/**
 * Attendance marking from the web and the Android app, and the real-time
 * updates every screen that shows that attendance depends on.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata (UTC+05:30); 19 Oct 2026 is a Monday.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const realNow = clock.now;

let ctx;
let admin, hod, hodEce, principal, coe, fac, facWeb, inCharge, otherFac, s1, s2, sOd;
let slot;

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-H' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-H2' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-P' }),
    mk({ role: 'coe', name: 'COE', employeeId: 'E-C' }),
    mk({ role: 'faculty', name: 'Fac', department: 'CSE', employeeId: 'E-F' }),
    mk({ role: 'faculty', name: 'In Charge', department: 'CSE', employeeId: 'E-I', section: 'A', inChargeYear: 3, inChargeSemester: 5 }),
    mk({ role: 'faculty', name: 'Other', department: 'CSE', employeeId: 'E-O' }),
    mk({ name: 'S1', department: 'CSE', section: 'A', semester: 5, rollNo: '1' }),
    mk({ name: 'S2', department: 'CSE', section: 'A', semester: 5, rollNo: '2' }),
    mk({ name: 'S-OD', department: 'CSE', section: 'A', semester: 5, rollNo: '3' }),
  ]);
  let facU;
  [admin, hod, hodEce, principal, coe, facU, inCharge, otherFac, s1, s2, sOd] = await Promise.all(
    users.map(async (u) => (u.role === 'faculty' && u.name === 'Fac' ? u : { u, ...(await ctx.loginWeb(u)) }))
  );
  // The faculty member is signed in on the Android app AND in a browser.
  fac = { u: facU, ...(await ctx.loginMobile(facU)) };
  facWeb = { u: facU, ...(await ctx.loginWeb(facU)) };

  const subject = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS503', department: 'CSE', semester: 5, faculty: [], sections: ['A'] });
  const res = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: String(subject._id), faculty: String(facU._id), section: 'A', department: 'CSE', dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50', semester: 5 },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  slot = String(res.body._id);

  // S-OD has an approved On-Duty request covering the day.
  await ctx.models.ODLeaveRequest.create({
    student: sOd.u._id, department: 'CSE', section: 'A', year: 3, requestType: 'od', category: 'Symposium', description: 'Paper presentation', status: 'approved',
    fromDate: new Date('2026-10-19T00:00:00Z'), toDate: new Date('2026-10-19T00:00:00Z'),
  });
  clock.now = () => at('2026-10-19', '09:10');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const mobile = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };
const markAs = (actor, records, headers) => ctx.request('POST', '/attendance/mark', { token: actor.token, headers, body: { slotId: slot, records } });

/** Collect `attendance:updated` events for each of `actors` while `fn` runs. */
async function collect(actors, fn) {
  const got = new Map(actors.map((a) => [a, 0]));
  const sockets = await Promise.all(actors.map((a) => ctx.connect(a.token)));
  sockets.forEach((s, i) => s.on('attendance:updated', () => got.set(actors[i], got.get(actors[i]) + 1)));
  await fn();
  await new Promise((r) => setTimeout(r, 300));
  sockets.forEach((s) => s.disconnect());
  return got;
}

test('faculty mark their period from the Android app by its timetable period (slotId)', async () => {
  const periods = await ctx.request('GET', '/attendance/my-periods', { token: fac.token, headers: mobile });
  assert.equal(periods.status, 200);
  const p1 = periods.body.periods.find((p) => String(p.slotId) === slot);
  assert.equal(p1.status, 'ACTIVE');

  const roster = await ctx.request('GET', `/attendance/roster?slotId=${slot}`, { token: fac.token, headers: mobile });
  assert.equal(roster.status, 200);
  assert.equal(roster.body.editable, true, roster.body.lockedReason);

  const res = await markAs(fac, [{ student: String(s1.u._id), status: 'present' }, { student: String(s2.u._id), status: 'absent' }], mobile);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.created, 2);
});

test('saving a roster that contains an On-Duty student (as both apps send it) succeeds', async () => {
  // The roster shows S-OD as "od" (locked); the apps send the roster back unchanged.
  const roster = await ctx.request('GET', `/attendance/roster?slotId=${slot}`, { token: facWeb.token });
  const odRow = roster.body.students.find((s) => String(s._id) === String(sOd.u._id));
  assert.equal(odRow.status, 'od');
  const records = roster.body.students.map((s) => ({ student: String(s._id), status: s.status || 'present' }));
  const res = await markAs(facWeb, records);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rec = await ctx.models.AttendanceRecord.findOne({ student: sOd.u._id }).lean();
  assert.equal(rec.status, 'od');
});

test('"od" from a client is refused for a student with no approved OD or event', async () => {
  const res = await markAs(facWeb, [{ student: String(s2.u._id), status: 'od' }]);
  assert.equal(res.status, 422, JSON.stringify(res.body));
  const rec = await ctx.models.AttendanceRecord.findOne({ student: s2.u._id }).lean();
  assert.equal(rec.status, 'absent', 'unchanged');
});

test('a saved mark reaches every screen that shows it, live — and nobody outside the class', async () => {
  const watchers = [fac, facWeb, inCharge, hod, principal, coe, s1, hodEce, otherFac];
  const got = await collect(watchers, async () => {
    const res = await markAs(facWeb, [{ student: String(s1.u._id), status: 'absent' }]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
  for (const [who, name] of [[fac, 'faculty on Android'], [facWeb, 'faculty in the browser'], [inCharge, 'class in-charge'], [hod, 'HOD'], [principal, 'principal'], [coe, 'COE'], [s1, 'the student']]) {
    assert.ok(got.get(who) >= 1, `${name} receives attendance:updated`);
  }
  assert.equal(got.get(hodEce), 0, 'another department’s HOD is not told');
  assert.equal(got.get(otherFac), 0, 'an unrelated faculty member is not told');
});

test('dashboard totals stay exact: a past-day edit shows at once even though earlier days are cached', async () => {
  const lowOf = async (who) => {
    const res = await ctx.request('GET', '/attendance/low?range=semester', { token: principal.token });
    assert.equal(res.status, 200);
    return res.body.students.find((r) => String(r._id) === String(who.u._id));
  };
  // Warm the cache: S2 has one absent period today (from the earlier tests).
  const before = await lowOf(s2);
  assert.deepEqual([before.present, before.total], [0, 1]);
  // Admin corrects a PAST day (last Monday) — the cached earlier days must not hide it.
  const past = await ctx.request('POST', '/attendance/mark', {
    token: admin.token,
    body: { slotId: slot, date: '2026-10-12', records: [{ student: String(s2.u._id), status: 'present' }] },
  });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  const after = await lowOf(s2);
  assert.deepEqual([after.present, after.total], [1, 2], 'the past-day record is counted immediately');
  // And today's marks are always read fresh.
  await markAs(facWeb, [{ student: String(s2.u._id), status: 'present' }]);
  assert.equal(await lowOf(s2), undefined, '2 of 2 present — no longer below 75%');

  // The breakdown agrees with the low-attendance list.
  const bd = await ctx.request('GET', '/attendance/summary/breakdown', { token: principal.token });
  assert.equal(bd.status, 200);
  const cse = bd.body.groups.find((g) => g.department === 'CSE');
  const year3 = cse.years.find((y) => y.year === 3);
  // S1: 0/2 present (absent today), S2: 2/2, S-OD: 1/1 → exactly one CSE 3rd-year student below 75%.
  assert.equal(year3.lowCount, 1);
  assert.equal(cse.lowCount, 1);
});

test('an unchanged re-save still refreshes the staff screens (e.g. a second device)', async () => {
  const got = await collect([fac, hod], async () => {
    const res = await markAs(facWeb, [{ student: String(s1.u._id), status: 'absent' }]);
    assert.equal(res.status, 200);
    assert.equal(res.body.modified, 0);
  });
  assert.ok(got.get(fac) >= 1);
  assert.ok(got.get(hod) >= 1);
});
