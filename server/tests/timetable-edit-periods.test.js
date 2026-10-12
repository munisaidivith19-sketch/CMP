/**
 * HOD "Edit Timetable", break-free period numbering, and faculty auto-present.
 *
 * - An HOD edits one class (year + section + semester) of their own assigned
 *   department only; the server forces the department and refuses any other.
 * - Breaks are not periods: a break never takes a class number, so the
 *   classes of a day are P1, P2, P3… in time order.
 * - The first class a faculty member takes attendance in today marks them
 *   present for the whole day, without overriding an HOD/admin mark.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');
const { normaliseBreakPeriods } = await import('../src/services/timetablePeriods.js');

// Campus time is Asia/Kolkata (UTC+05:30). 28 Sep 2026 is a Monday.
const MONDAY = '2026-09-28';
const at = (date, hhmm) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, h * 60 + m - 330));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;
const dayOf = (date) => new Date(`${date}T00:00:00.000Z`);

let ctx;
let admin, hodCse, hodEce, hodSh, facA, facB, facC, stu1, stu2;
let subjCse, subjCse2, subjEce, subjFirst;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H-CSE' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'H-ECE' }),
    mk({ role: 'hod', name: 'HOD S&H', department: 'Science & Humanities', employeeId: 'H-SH' }),
    mk({ role: 'faculty', name: 'Dr. A', department: 'CSE', employeeId: 'F-A' }),
    mk({ role: 'faculty', name: 'Dr. B', department: 'CSE', employeeId: 'F-B' }),
    mk({ role: 'faculty', name: 'Dr. C', department: 'CSE', employeeId: 'F-C' }),
    mk({ name: 'Stu 1', department: 'CSE', section: 'A', semester: 5, rollNo: 'CA1' }),
    mk({ name: 'Stu 2', department: 'CSE', section: 'A', semester: 5, rollNo: 'CA2' }),
  ]);
  [admin, hodCse, hodEce, hodSh, facA, facB, facC, stu1, stu2] = await Promise.all(
    users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) }))
  );
  const S = ctx.models.Subject;
  [subjCse, subjCse2, subjEce, subjFirst] = await Promise.all([
    S.create({ name: 'Compilers', code: 'CS501', department: 'CSE', semester: 5, faculty: [], sections: [] }),
    S.create({ name: 'Networks', code: 'CS502', department: 'CSE', semester: 5, faculty: [], sections: [] }),
    S.create({ name: 'Signals', code: 'EC501', department: 'ECE', semester: 5, faculty: [], sections: [] }),
    S.create({ name: 'Physics', code: 'PH101', department: 'CSE', semester: 1, faculty: [], sections: [] }),
  ]);
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const post = (actor, body) => ctx.request('POST', '/timetable', { token: actor.token, body });
const put = (actor, id, body) => ctx.request('PUT', `/timetable/${id}`, { token: actor.token, body });
const cls = (o = {}) => ({
  subject: String(subjCse._id),
  faculty: String(facA.u._id),
  department: 'CSE',
  section: 'A',
  semester: 5,
  dayOfWeek: 'monday',
  ...o,
});
const brk = (o = {}) => ({ isBreak: true, breakLabel: 'Lunch break', department: 'CSE', section: 'A', semester: 5, dayOfWeek: 'monday', ...o });

// ── HOD Edit Timetable: one class of their own department ─────────

test('HOD edits a class of their own assigned department only (department forced server-side)', async () => {
  const created = await post(hodCse, cls({ dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '09:50' }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.department, 'CSE');

  // Year / section / semester pick: the HOD reads exactly that class.
  const view = await ctx.request('GET', '/timetable?year=3&section=A&semester=5', { token: hodCse.token });
  assert.equal(view.status, 200);
  assert.ok(view.body.slots.length >= 1);
  assert.ok(view.body.slots.every((s) => s.department === 'CSE' && s.section === 'A' && s.semester === 5));

  // A sent department is ignored: the slot still lands in the HOD's own department.
  const spoof = await post(hodCse, cls({ department: 'ECE', subject: String(subjEce._id), dayOfWeek: 'tuesday', period: 2, startTime: '10:00', endTime: '10:50' }));
  assert.notEqual(spoof.status, 201, 'an ECE subject can never be scheduled into CSE');
  assert.equal(await ctx.models.TimetableSlot.countDocuments({ department: 'ECE', isActive: true }), 0);

  // Another HOD cannot edit, delete or even read this class.
  const id = created.body._id;
  assert.equal((await put(hodEce, id, { room: 'X-1' })).status, 403);
  assert.equal((await ctx.request('DELETE', `/timetable/${id}`, { token: hodEce.token })).status, 403);
  const ece = await ctx.request('GET', '/timetable?year=3&section=A&semester=5', { token: hodEce.token });
  assert.equal(ece.body.slots.filter((s) => s.department === 'CSE').length, 0);

  // A branch HOD never edits 1st year — that belongs to the S&H HOD.
  const firstYear = await post(hodCse, cls({ subject: String(subjFirst._id), semester: 1, dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '09:50' }));
  assert.equal(firstYear.status, 403);

  // The S&H HOD edits 1st year of any department, and nothing above it.
  const sh = await post(hodSh, cls({ subject: String(subjFirst._id), faculty: String(facC.u._id), semester: 1, dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '09:50' }));
  assert.equal(sh.status, 201, JSON.stringify(sh.body));
  assert.equal((await post(hodSh, cls({ dayOfWeek: 'wednesday', period: 1, startTime: '09:00', endTime: '09:50' }))).status, 403);

  // Faculty and students cannot edit at all.
  assert.equal((await post(facA, cls({ dayOfWeek: 'thursday', period: 1, startTime: '09:00', endTime: '09:50' }))).status, 403);
  assert.equal((await post(stu1, cls({ dayOfWeek: 'thursday', period: 1, startTime: '09:00', endTime: '09:50' }))).status, 403);
});

// ── Breaks are not periods ───────────────────────────────────────

test('a break never takes a class period number — classes after it keep counting', async () => {
  const day = { dayOfWeek: 'wednesday' };
  const p1 = await post(hodCse, cls({ ...day, period: 1, startTime: '09:00', endTime: '09:50' }));
  const p2 = await post(hodCse, cls({ ...day, subject: String(subjCse2._id), faculty: String(facB.u._id), period: 2, startTime: '09:50', endTime: '10:40' }));
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p2.status, 201, JSON.stringify(p2.body));

  // The client tries to make the break "period 3": ignored.
  const lunch = await post(hodCse, brk({ ...day, period: 3, startTime: '10:40', endTime: '11:00' }));
  assert.equal(lunch.status, 201, JSON.stringify(lunch.body));
  assert.equal(lunch.body.isBreak, true);
  assert.ok(lunch.body.period > 2, `break stored under a spare key, got ${lunch.body.period}`);
  assert.notEqual(lunch.body.period, 3);

  // The class after the break is P3 — sent without a number, the server numbers it.
  const p3 = await post(hodCse, cls({ ...day, faculty: String(facC.u._id), startTime: '11:00', endTime: '11:50' }));
  assert.equal(p3.status, 201, JSON.stringify(p3.body));
  assert.equal(p3.body.period, 3);

  // …and P3 can be typed explicitly as well, while the break still holds no class number.
  const thu = { dayOfWeek: 'thursday' };
  await post(hodCse, cls({ ...thu, period: 1, startTime: '09:00', endTime: '09:50' }));
  await post(hodCse, brk({ ...thu, startTime: '09:50', endTime: '10:10' }));
  const thuP2 = await post(hodCse, cls({ ...thu, faculty: String(facB.u._id), period: 2, startTime: '10:10', endTime: '11:00' }));
  assert.equal(thuP2.status, 201, JSON.stringify(thuP2.body));

  const view = await ctx.request('GET', '/timetable?year=3&section=A&semester=5', { token: hodCse.token });
  const wed = view.body.slots.filter((s) => s.dayOfWeek === 'wednesday' && !s.isBreak).map((s) => s.period);
  assert.deepEqual(wed, [1, 2, 3], 'Wednesday classes are P1 P2 P3 — the break is not counted');
});

test('period numbers are unique on a day and follow the time order', async () => {
  const day = { dayOfWeek: 'friday' };
  assert.equal((await post(hodCse, cls({ ...day, period: 1, startTime: '09:00', endTime: '09:50' }))).status, 201);
  assert.equal((await post(hodCse, cls({ ...day, faculty: String(facB.u._id), period: 3, startTime: '11:00', endTime: '11:50' }))).status, 201);

  // Same number twice on one day.
  const dup = await post(hodCse, cls({ ...day, faculty: String(facC.u._id), period: 3, startTime: '12:00', endTime: '12:50' }));
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /Period 3 already exists/);

  // A later class with a smaller number.
  const order = await post(hodCse, cls({ ...day, faculty: String(facC.u._id), period: 2, startTime: '13:00', endTime: '13:50' }));
  assert.equal(order.status, 422);
  assert.match(order.body.message, /time order/);

  // A genuine free period stays a gap: P2 at 10:00 still fits between P1 and P3.
  const gap = await post(hodCse, cls({ ...day, faculty: String(facC.u._id), period: 2, startTime: '10:00', endTime: '10:50' }));
  assert.equal(gap.status, 201, JSON.stringify(gap.body));
});

test('turning a class into a break frees its number; a break turned back into a class is numbered again', async () => {
  const day = { dayOfWeek: 'saturday' };
  const a = await post(hodCse, cls({ ...day, period: 1, startTime: '09:00', endTime: '09:50' }));
  const b = await post(hodCse, cls({ ...day, faculty: String(facB.u._id), period: 2, startTime: '09:50', endTime: '10:40' }));
  assert.equal(b.status, 201);

  const toBreak = await put(hodCse, b.body._id, { isBreak: true, breakLabel: 'Recess', period: 2 });
  assert.equal(toBreak.status, 200, JSON.stringify(toBreak.body));
  assert.equal(toBreak.body.isBreak, true);
  assert.notEqual(toBreak.body.period, 2, 'the break gave up P2');
  assert.equal(toBreak.body.subject, undefined);

  // P2 is free again for the next class.
  const c = await post(hodCse, cls({ ...day, faculty: String(facC.u._id), startTime: '11:00', endTime: '11:50' }));
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.period, 2);

  // Back to a class, no number sent: it slots in between by time.
  await ctx.request('DELETE', `/timetable/${c.body._id}`, { token: hodCse.token });
  const back = await put(hodCse, b.body._id, { isBreak: false, subject: String(subjCse2._id), faculty: String(facB.u._id) });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.period, 2);
  assert.ok(a.body.period === 1);
});

test('legacy class days where a break took a number are renumbered once, gaps kept, idempotent', async () => {
  const T = ctx.models.TimetableSlot;
  const base = { department: 'CSE', section: 'B', semester: 5, year: 3, dayOfWeek: 'monday', subject: subjCse._id, faculty: facA.u._id };
  // P1 P2 P3 [Break P4] P5 P6 — saved before breaks stopped counting.
  await T.create([
    { ...base, period: 1, startTime: '09:00', endTime: '09:50' },
    { ...base, period: 2, startTime: '09:50', endTime: '10:40' },
    { ...base, period: 3, startTime: '10:40', endTime: '11:30' },
    { department: 'CSE', section: 'B', semester: 5, year: 3, dayOfWeek: 'monday', isBreak: true, breakLabel: 'Lunch', period: 4, startTime: '11:30', endTime: '12:10' },
    { ...base, period: 5, startTime: '12:10', endTime: '13:00' },
    { ...base, period: 6, startTime: '13:00', endTime: '13:50' },
  ]);
  // A correct day with a genuine free period (no P2) must not change.
  const ok = { ...base, section: 'C' };
  await T.create([
    { ...ok, period: 1, startTime: '09:00', endTime: '09:50' },
    { ...ok, isBreak: true, subject: undefined, faculty: undefined, breakLabel: 'Lunch', period: 12, startTime: '10:40', endTime: '11:00' },
    { ...ok, period: 3, startTime: '11:00', endTime: '11:50' },
  ]);

  const dry = await normaliseBreakPeriods({ dryRun: true });
  assert.equal(dry.days, 1);
  assert.equal((await T.findOne({ section: 'B', startTime: '12:10' }).lean()).period, 5, 'dry run writes nothing');

  const res = await normaliseBreakPeriods();
  assert.equal(res.days, 1);
  const dayB = await T.find({ section: 'B', department: 'CSE', dayOfWeek: 'monday', isActive: true }).sort({ startTime: 1 }).lean();
  assert.deepEqual(dayB.filter((s) => !s.isBreak).map((s) => s.period), [1, 2, 3, 4, 5]);
  assert.ok(dayB.find((s) => s.isBreak).period > 5);

  const dayC = await T.find({ section: 'C', department: 'CSE', isActive: true }).sort({ startTime: 1 }).lean();
  assert.deepEqual(dayC.map((s) => s.period), [1, 12, 3], 'a real free period keeps its gap');

  assert.equal((await normaliseBreakPeriods()).days, 0, 'second run changes nothing');
});

// ── Faculty auto-present ─────────────────────────────────────────

test('taking attendance in their own class marks the faculty present for the whole day — once', async () => {
  const FA = ctx.models.FacultyAttendance;
  const T = ctx.models.TimetableSlot;
  // facA teaches Monday P1 09:00 and P3 11:00 for CSE-A; facB Monday P2 10:00.
  const mon = { department: 'CSE', section: 'A', semester: 5, year: 3, dayOfWeek: 'monday', subject: subjCse._id };
  const [p1, p2, p3] = await T.create([
    { ...mon, faculty: facA.u._id, period: 1, startTime: '09:00', endTime: '09:50' },
    { ...mon, faculty: facB.u._id, period: 2, startTime: '10:00', endTime: '10:50' },
    { ...mon, faculty: facA.u._id, period: 3, startTime: '11:00', endTime: '11:50' },
  ]);
  await ctx.models.Subject.updateOne({ _id: subjCse._id }, { $addToSet: { faculty: { $each: [facA.u._id, facB.u._id] } } });
  const records = [
    { student: String(stu1.u._id), status: 'present' },
    { student: String(stu2.u._id), status: 'absent' },
  ];
  const mark = (actor, slot, extra = {}) => ctx.request('POST', '/attendance/mark', { token: actor.token, body: { slotId: String(slot._id), records, ...extra } });

  setNow(MONDAY, '09:10');
  assert.equal(await FA.countDocuments({ faculty: facA.u._id }), 0);
  const first = await mark(facA, p1);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.facultyMarkedPresent, true);
  const rec = await FA.findOne({ faculty: facA.u._id, date: dayOf(MONDAY) }).lean();
  assert.equal(rec.status, 'present');
  assert.equal(rec.source, 'auto');
  assert.equal(rec.department, 'CSE');
  assert.equal(rec.autoFrom.period, 1);
  assert.equal(rec.autoFrom.subjectCode, 'CS501');

  // Correcting the same period, or a later period, changes nothing.
  assert.equal((await mark(facA, p1)).body.facultyMarkedPresent, false);
  setNow(MONDAY, '11:05');
  const later = await mark(facA, p3);
  assert.equal(later.status, 200);
  assert.equal(later.body.facultyMarkedPresent, false);
  assert.equal(await FA.countDocuments({ faculty: facA.u._id }), 1);

  // The HOD sees it on the faculty roster as an automatic present.
  const roster = await ctx.request('GET', `/attendance/faculty/roster?date=${MONDAY}`, { token: hodCse.token });
  assert.equal(roster.status, 200);
  const row = roster.body.faculty.find((f) => String(f._id) === String(facA.u._id));
  assert.equal(row.status, 'present');
  assert.equal(row.source, 'auto');
  assert.equal(row.autoFrom.period, 1);
  const summary = await ctx.request('GET', `/attendance/summary/faculty?date=${MONDAY}&status=present`, { token: hodCse.token });
  assert.ok(summary.body.faculty.some((f) => String(f._id) === String(facA.u._id)));

  // An HOD's own decision is never overwritten: facB is on leave today.
  await ctx.request('POST', '/attendance/faculty/mark', {
    token: hodCse.token,
    body: { date: MONDAY, records: [{ faculty: String(facB.u._id), status: 'leave' }] },
  });
  setNow(MONDAY, '10:05');
  const onLeave = await mark(facB, p2);
  assert.equal(onLeave.status, 200);
  assert.equal(onLeave.body.facultyMarkedPresent, false);
  const b = await FA.findOne({ faculty: facB.u._id, date: dayOf(MONDAY) }).lean();
  assert.equal(b.status, 'leave');
  assert.equal(b.source, 'manual');

  // The HOD can still change an automatic mark; it then counts as manual.
  const fix = await ctx.request('POST', '/attendance/faculty/mark', {
    token: hodCse.token,
    body: { date: MONDAY, records: [{ faculty: String(facA.u._id), status: 'absent' }] },
  });
  assert.equal(fix.status, 200);
  const a2 = await FA.findOne({ faculty: facA.u._id, date: dayOf(MONDAY) }).lean();
  assert.equal(a2.status, 'absent');
  assert.equal(a2.source, 'manual');
});

test('only the scheduled faculty, only today: admin / other-HOD edits and back-dated marks never auto-mark', async () => {
  const FA = ctx.models.FacultyAttendance;
  const T = ctx.models.TimetableSlot;
  const NEXT_MONDAY = '2026-10-05';
  const slot = await T.create({ department: 'CSE', section: 'A', semester: 5, year: 3, dayOfWeek: 'monday', subject: subjCse2._id, faculty: facC.u._id, period: 5, startTime: '14:00', endTime: '14:50' });
  await ctx.models.Subject.updateOne({ _id: subjCse2._id }, { $addToSet: { faculty: facC.u._id } });
  const records = [{ student: String(stu1.u._id), status: 'present' }];

  // Admin marks facC's class (today, and a past Monday): nobody is auto-marked.
  setNow(NEXT_MONDAY, '14:10');
  const byAdmin = await ctx.request('POST', '/attendance/mark', { token: admin.token, body: { slotId: String(slot._id), records } });
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
  assert.equal(byAdmin.body.facultyMarkedPresent, false);
  const backdated = await ctx.request('POST', '/attendance/mark', { token: admin.token, body: { slotId: String(slot._id), date: MONDAY, records } });
  assert.equal(backdated.status, 200, JSON.stringify(backdated.body));
  assert.equal(await FA.countDocuments({ faculty: { $in: [facC.u._id, admin.u._id] } }), 0);

  // The CSE HOD editing facC's class today is not facC taking it.
  const byHod = await ctx.request('POST', '/attendance/mark', { token: hodCse.token, body: { slotId: String(slot._id), records } });
  assert.equal(byHod.status, 200, JSON.stringify(byHod.body));
  assert.equal(byHod.body.facultyMarkedPresent, false);
  assert.equal(await FA.countDocuments({ faculty: { $in: [facC.u._id, hodCse.u._id] }, date: dayOf(NEXT_MONDAY) }), 0);

  // facC taking their own class today is.
  const own = await ctx.request('POST', '/attendance/mark', { token: facC.token, body: { slotId: String(slot._id), records } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.facultyMarkedPresent, true);
  assert.equal((await FA.findOne({ faculty: facC.u._id, date: dayOf(NEXT_MONDAY) }).lean()).status, 'present');
});

test('an HOD teaching their own period is auto-marked present too', async () => {
  const FA = ctx.models.FacultyAttendance;
  const THIRD_MONDAY = '2026-10-12';
  const slot = await ctx.models.TimetableSlot.create({ department: 'CSE', section: 'A', semester: 5, year: 3, dayOfWeek: 'monday', subject: subjCse._id, faculty: hodCse.u._id, period: 6, startTime: '15:00', endTime: '15:50' });
  setNow(THIRD_MONDAY, '15:10');
  const res = await ctx.request('POST', '/attendance/mark', { token: hodCse.token, body: { slotId: String(slot._id), records: [{ student: String(stu1.u._id), status: 'present' }] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.facultyMarkedPresent, true);
  const rec = await FA.findOne({ faculty: hodCse.u._id, date: dayOf(THIRD_MONDAY) }).lean();
  assert.equal(rec.status, 'present');
  assert.equal(rec.source, 'auto');
});
