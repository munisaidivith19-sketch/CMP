/**
 * Faculty daily attendance from class submissions, substitutes, "class not
 * conducted" and emergency early exits.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata; 19 Oct 2026 is a Monday.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const setNow = (hhmm) => {
  clock.now = () => at('2026-10-19', hhmm);
};
const realNow = clock.now;
const DAY = '2026-10-19';
const day = new Date(`${DAY}T00:00:00Z`);

let ctx;
let admin, hod, hodEce, principal, fac, sub, busy, s1, s2;
const slot = {};

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H1' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'H2' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'P1' }),
    mk({ role: 'faculty', name: 'Fac', department: 'CSE', employeeId: 'F1' }),
    mk({ role: 'faculty', name: 'Sub', department: 'CSE', employeeId: 'F2' }),
    mk({ role: 'faculty', name: 'Busy', department: 'CSE', employeeId: 'F3' }),
    mk({ name: 'S1', department: 'CSE', section: 'A', semester: 5, rollNo: '1' }),
    mk({ name: 'S2', department: 'CSE', section: 'A', semester: 5, rollNo: '2' }),
  ]);
  [admin, hod, hodEce, principal, fac, sub, busy, s1, s2] = await Promise.all(users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) })));
  const subject = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS503', department: 'CSE', semester: 5, faculty: [], sections: ['A', 'B'] });
  const mkSlot = async (who, section, period, startTime, endTime) => {
    const res = await ctx.request('POST', '/timetable', {
      token: admin.token,
      body: { subject: String(subject._id), faculty: String(who.u._id), section, department: 'CSE', dayOfWeek: 'monday', period, startTime, endTime, semester: 5, room: `LH-${section}${period}` },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return String(res.body._id);
  };
  slot.p1 = await mkSlot(fac, 'A', 1, '09:00', '09:50');
  slot.p2 = await mkSlot(fac, 'A', 2, '09:50', '10:40');
  slot.p3 = await mkSlot(fac, 'A', 3, '10:50', '11:40');
  slot.p4 = await mkSlot(fac, 'A', 4, '11:40', '12:30');
  slot.busyP2 = await mkSlot(busy, 'B', 2, '09:50', '10:40');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const records = [
  () => ({ student: String(s1.u._id), status: 'present' }),
  () => ({ student: String(s2.u._id), status: 'absent' }),
];
const mark = (actor, slotId) => ctx.request('POST', '/attendance/mark', { token: actor.token, body: { slotId, records: records.map((r) => r()) } });
const dailyOf = (who) => ctx.models.FacultyAttendance.find({ faculty: who.u._id, date: day }).lean();

test('an unauthorized / invalid submission never marks the faculty member present', async () => {
  setNow('08:30'); // P1 has not started
  assert.equal((await mark(fac, slot.p1)).status, 403);
  setNow('09:10');
  assert.equal((await mark(sub, slot.p1)).status, 403, 'not their period');
  assert.equal((await dailyOf(fac)).length, 0);
  assert.equal((await dailyOf(sub)).length, 0);
});

test('submitting P1 marks the faculty member Present once; later periods do not duplicate it', async () => {
  setNow('09:10');
  const res = await mark(fac, slot.p1);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.facultyMarkedPresent, true);
  setNow('10:00');
  assert.equal((await mark(fac, slot.p2)).status, 200);
  const rows = await dailyOf(fac);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'present');
  assert.equal(rows[0].source, 'auto');
  assert.equal(rows[0].autoFrom.period, 1, 'the first period that proved presence');
  // The period-wise teaching record names who took each class.
  const sess = await ctx.models.AttendanceSession.find({ date: day }).lean();
  assert.equal(sess.length, 2);
  assert.ok(sess.every((x) => String(x.takenBy) === String(fac.u._id) && x.takenAt));
});

test('early exit: requested by the faculty, decided only by an authorized person; daily presence is kept', async () => {
  setNow('10:45');
  const req = await ctx.request('POST', '/staff/early-exits', { token: fac.token, body: { reason: 'Family emergency at home', departureTime: '10:45' } });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.status, 'pending');
  assert.deepEqual(req.body.affectedPeriods.map((p) => p.period), [3, 4], 'the periods after the departure');
  const id = req.body._id;

  assert.equal((await ctx.request('PATCH', `/staff/early-exits/${id}/decision`, { token: fac.token, body: { action: 'approve' } })).status, 403, 'faculty cannot approve');
  assert.equal((await ctx.request('PATCH', `/staff/early-exits/${id}/decision`, { token: hodEce.token, body: { action: 'approve' } })).status, 403, 'another department’s HOD cannot');
  const ok = await ctx.request('PATCH', `/staff/early-exits/${id}/decision`, { token: hod.token, body: { action: 'approve', note: 'Go safely' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'approved');
  assert.equal(String(ok.body.decidedBy), String(hod.u._id));
  assert.equal((await ctx.request('PATCH', `/staff/early-exits/${id}/decision`, { token: hod.token, body: { action: 'reject' } })).status, 409, 'decided once');

  const gone = await ctx.request('PATCH', `/staff/early-exits/${id}/departure`, { token: fac.token });
  assert.equal(gone.status, 200);
  assert.ok(gone.body.actualDepartureAt);
  assert.deepEqual(gone.body.history.map((h) => h.action), ['requested', 'approved', 'departed']);

  const daily = await dailyOf(fac);
  assert.equal(daily[0].status, 'present', 'still present for the day');

  // The HOD sees the periods that now need cover.
  const cover = await ctx.request('GET', `/staff/cover?date=${DAY}`, { token: hod.token });
  assert.equal(cover.status, 200);
  assert.deepEqual(cover.body.periods.map((p) => [p.period, p.reason]), [[3, 'early_exit'], [4, 'early_exit']]);
});

test('only free staff are offered and accepted as substitutes', async () => {
  const avail = await ctx.request('GET', `/staff/cover/available?slotId=${slot.p3}&date=${DAY}`, { token: hod.token });
  assert.equal(avail.status, 200);
  const names = avail.body.faculty.map((f) => f.name);
  assert.ok(names.includes('Sub'));
  assert.ok(!names.includes('Fac'), 'not the absent faculty themself');

  // Busy teaches section B at 09:50–10:40: they cannot cover a class at the same time.
  const clash = await ctx.request('POST', '/staff/cover', { token: hod.token, body: { slotId: slot.p2, date: DAY, kind: 'substitute', substitute: String(busy.u._id) } });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
});

test('unauthorized people cannot assign cover', async () => {
  for (const actor of [fac, sub, hodEce]) {
    const res = await ctx.request('POST', '/staff/cover', { token: actor.token, body: { slotId: slot.p3, date: DAY, kind: 'substitute', substitute: String(sub.u._id) } });
    assert.equal(res.status, 403, actor.u.name);
  }
});

test('a substitute takes the period: they submit it, they are recorded and marked present; the original cannot', async () => {
  const assign = await ctx.request('POST', '/staff/cover', { token: hod.token, body: { slotId: slot.p3, date: DAY, kind: 'substitute', substitute: String(sub.u._id), reason: 'Early exit' } });
  assert.equal(assign.status, 201, JSON.stringify(assign.body));
  assert.equal(String(assign.body.originalFaculty), String(fac.u._id), 'the scheduled assignment is kept');
  assert.equal((await ctx.request('POST', '/staff/cover', { token: hod.token, body: { slotId: slot.p3, date: DAY, kind: 'not_conducted' } })).status, 409, 'one arrangement per period');

  setNow('11:00');
  const mine = await ctx.request('GET', '/attendance/my-periods', { token: sub.token });
  const p3 = mine.body.periods.find((p) => String(p.slotId) === slot.p3);
  assert.ok(p3, 'the substitute sees the period');
  assert.equal(p3.substituteFor.name, 'Fac');
  const theirs = await ctx.request('GET', '/attendance/my-periods', { token: fac.token });
  assert.equal(theirs.body.periods.find((p) => String(p.slotId) === slot.p3).coveredBy.name, 'Sub');

  assert.equal((await mark(fac, slot.p3)).status, 403, 'the original faculty cannot take a covered period');
  const res = await mark(sub, slot.p3);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.facultyMarkedPresent, true);
  const sess = await ctx.models.AttendanceSession.findOne({ date: day, period: 3 }).lean();
  assert.equal(String(sess.takenBy), String(sub.u._id), 'the person who did the work');
  assert.equal(String(sess.faculty), String(fac.u._id), 'scheduled faculty kept separately');
  assert.ok(sess.cover);
  const subDaily = await dailyOf(sub);
  assert.equal(subDaily.length, 1);
  assert.equal(String(subDaily[0].autoFrom.substituteFor), String(fac.u._id));
});

test('a period recorded as not conducted takes no attendance, and no students are marked present', async () => {
  const nc = await ctx.request('POST', '/staff/cover', { token: hod.token, body: { slotId: slot.p4, date: DAY, kind: 'not_conducted', reason: 'No substitute available' } });
  assert.equal(nc.status, 201, JSON.stringify(nc.body));
  setNow('11:50');
  const res = await mark(admin, slot.p4);
  assert.equal(res.status, 409);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ date: day, period: 4 }), 0);

  // The staff report separates daily presence from period-wise teaching.
  setNow('13:00');
  const rep = await ctx.request('GET', `/attendance/staff-report?range=custom&from=${DAY}&to=${DAY}`, { token: hod.token });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const row = rep.body.rows.find((r) => r.name === 'Fac');
  assert.deepEqual(
    { daily: row.dailyStatus, scheduled: row.scheduled, taken: row.taken, covered: row.covered, notConducted: row.notConducted },
    { daily: 'present', scheduled: 4, taken: 2, covered: 1, notConducted: 1 }
  );
  assert.equal(row.earlyExit.status, 'approved');
  const subRow = rep.body.rows.find((r) => r.name === 'Sub');
  assert.equal(subRow.substituteTaken, 1);
});

test('cancelling an arrangement is audited and the period is open again', async () => {
  const list = await ctx.request('GET', `/staff/cover?date=${DAY}`, { token: hod.token });
  const p4 = list.body.periods.find((p) => p.period === 4);
  const res = await ctx.request('DELETE', `/staff/cover/${p4.cover._id}`, { token: hod.token, body: { reason: 'Entered by mistake' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  assert.deepEqual(res.body.history.map((h) => h.action), ['assigned_not_conducted', 'cancelled']);
  assert.equal(await ctx.models.PeriodCover.countDocuments({ timetableSlot: p4.slotId, status: 'active' }), 0);
});
