import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata (UTC+05:30). 28 Sep 2026 and 5 Oct 2026 are Mondays.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMinutes = h * 60 + m - 330;
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 0, utcMinutes));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;

let ctx;
let admin, hodCse, hodEce, facA, facB, s1, s2, sB, subject, slotId;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, hc, he, fa, fb, st1, st2, stB] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HC' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HE' }),
    mk({ role: 'faculty', name: 'Dr. Ravi', department: 'ECE', employeeId: 'E-RAVI' }),
    mk({ role: 'faculty', name: 'Dr. Other', department: 'CSE', employeeId: 'E-OTHER' }),
    mk({ name: 'Stu A1', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1' }),
    mk({ name: 'Stu A2', department: 'CSE', section: 'A', semester: 5, rollNo: 'A2' }),
    mk({ name: 'Stu B1', department: 'CSE', section: 'B', semester: 5, rollNo: 'B1' }),
  ]);
  [admin, hodCse, hodEce, facA, facB, s1, s2, sB] = await Promise.all(
    [a, hc, he, fa, fb, st1, st2, stB].map(async (u) => ({ u, ...(await ctx.loginWeb(u)) }))
  );
  subject = await ctx.models.Subject.create({ name: 'Network Security', code: 'CS900', department: 'CSE', semester: 5, faculty: [], sections: [] });

  // Monday P1 09:00–09:50, CSE-A, taught by an ECE faculty member.
  const created = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: String(subject._id), faculty: String(fa._id), section: 'A', department: 'CSE', dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50', semester: 5, room: 'LH-1' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  slotId = String(created.body._id);
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

const mark = (actor, extra = {}, statuses = { s1: 'present', s2: 'absent' }) =>
  ctx.request('POST', '/attendance/mark', {
    token: actor.token,
    body: {
      slotId,
      records: [
        { student: String(s1.u._id), status: statuses.s1 },
        { student: String(s2.u._id), status: statuses.s2 },
      ],
      ...extra,
    },
  });

// ── Faculty: time window + ownership ───────────────────────────────

test('faculty can take attendance only while their period is ACTIVE (server clock)', async () => {
  setNow('2026-09-28', '08:59');
  let periods = await ctx.request('GET', '/attendance/my-periods', { token: facA.token });
  assert.equal(periods.body.periods[0].status, 'UPCOMING');
  assert.equal((await mark(facA)).status, 403, 'before start');

  setNow('2026-09-28', '09:00');
  assert.equal((await mark(facA)).status, 200, 'at start');

  setNow('2026-09-28', '09:49');
  periods = await ctx.request('GET', '/attendance/my-periods', { token: facA.token });
  assert.equal(periods.body.periods[0].status, 'ACTIVE');
  assert.equal(periods.body.periods[0].marked, true);
  assert.equal((await mark(facA, {}, { s1: 'present', s2: 'present' })).status, 200, 'can still correct while active');

  setNow('2026-09-28', '09:50');
  assert.equal((await mark(facA)).status, 403, 'closed at end time');
  setNow('2026-09-28', '09:51');
  const closed = await mark(facA);
  assert.equal(closed.status, 403);
  assert.match(closed.body.message, /closed/);
  periods = await ctx.request('GET', '/attendance/my-periods', { token: facA.token });
  assert.equal(periods.body.periods[0].status, 'COMPLETED');
});

test('faculty cannot take another faculty’s class or bypass rules through the API', async () => {
  setNow('2026-09-28', '09:20');
  const other = await mark(facB);
  assert.equal(other.status, 403);

  // Legacy subject/date/period path is closed to faculty.
  const legacy = await ctx.request('POST', '/attendance/mark', {
    token: facA.token,
    body: { subjectId: String(subject._id), date: '2026-09-28', period: 1, section: 'A', records: [{ student: String(s1.u._id), status: 'present' }] },
  });
  assert.equal(legacy.status, 403);

  // Client-sent date/section/subject are ignored: the slot + server clock decide.
  const spoof = await mark(facA, { date: '2026-09-21', section: 'B', subjectId: String(subject._id) });
  assert.equal(spoof.status, 200);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ date: new Date('2026-09-21T00:00:00Z') }), 0);

  // A student from another section cannot be smuggled into the class.
  const intruder = await ctx.request('POST', '/attendance/mark', {
    token: facA.token,
    body: { slotId, records: [{ student: String(sB.u._id), status: 'present' }] },
  });
  assert.equal(intruder.status, 422);

  // Students cannot mark at all.
  assert.equal((await mark(s1)).status, 403);
});

// ── Snapshot: timetable changes affect only future attendance ───────

test('timetable change applies to future sessions; history and in-progress sessions keep their snapshot', async () => {
  const oldSession = await ctx.models.AttendanceSession.findOne({ timetableSlot: slotId, date: new Date('2026-09-28T00:00:00Z') }).lean();
  assert.equal(oldSession.startTime, '09:00');
  assert.equal(oldSession.endTime, '09:50');
  assert.equal(oldSession.subjectCode, 'CS900');
  assert.equal(oldSession.facultyName, 'Dr. Ravi');

  // HOD moves the period to 09:10–10:00.
  setNow('2026-10-01', '12:00');
  const edited = await ctx.request('PUT', `/timetable/${slotId}`, { token: hodCse.token, body: { startTime: '09:10', endTime: '10:00' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));

  // Next Monday the new window applies: 09:55 is now inside the period.
  setNow('2026-10-05', '09:05');
  assert.equal((await mark(facA)).status, 403, '09:05 is before the new start');
  setNow('2026-10-05', '09:55');
  assert.equal((await mark(facA)).status, 200);
  const newSession = await ctx.models.AttendanceSession.findOne({ timetableSlot: slotId, date: new Date('2026-10-05T00:00:00Z') }).lean();
  assert.equal(newSession.startTime, '09:10');
  assert.equal(newSession.endTime, '10:00');

  // Mid-session edit: shortening the slot does not change today's running session.
  await ctx.request('PUT', `/timetable/${slotId}`, { token: admin.token, body: { endTime: '09:56' } });
  setNow('2026-10-05', '09:58');
  assert.equal((await mark(facA)).status, 200, 'in-progress session keeps its snapshot window');

  // History untouched.
  const again = await ctx.models.AttendanceSession.findById(oldSession._id).lean();
  assert.equal(again.startTime, '09:00');
  assert.equal(again.endTime, '09:50');
  const roster = await ctx.request('GET', `/attendance/roster?slotId=${slotId}&date=2026-09-28`, { token: admin.token });
  assert.equal(roster.body.slot.startTime, '09:00', 'past roster shows the original times');
  assert.equal(roster.body.slot.snapshot, true);

  const audit = await ctx.models.Activity.find({ action: { $in: ['timetable.changed', 'attendance.session_created'] } }).lean();
  assert.ok(audit.some((a) => a.action === 'timetable.changed' && /startTime: 09:00→09:10/.test(a.summary)));
  assert.ok(audit.some((a) => a.action === 'attendance.session_created'));
});

// ── HOD: today only, own department ────────────────────────────────

test('HOD can edit today’s attendance only, within their own department', async () => {
  setNow('2026-10-05', '16:00'); // any time of day is fine for HOD
  const today = await mark(hodCse, { date: '2026-10-05' }, { s1: 'absent', s2: 'absent' });
  assert.equal(today.status, 200, JSON.stringify(today.body));

  const yesterday = await ctx.request('POST', '/attendance/mark', {
    token: hodCse.token,
    body: { subjectId: String(subject._id), date: '2026-10-04', period: 1, section: 'A', records: [{ student: String(s1.u._id), status: 'present' }] },
  });
  assert.equal(yesterday.status, 403);
  const older = await mark(hodCse, { date: '2026-09-28' });
  assert.equal(older.status, 403, 'direct API request for an old date is rejected');

  assert.equal((await mark(hodEce, { date: '2026-10-05' })).status, 403, 'other department');

  const sessions = await ctx.request('GET', '/attendance/sessions?range=all', { token: hodCse.token });
  const byDate = Object.fromEntries(sessions.body.map((s) => [String(s.date).slice(0, 10), s.editable]));
  assert.equal(byDate['2026-10-05'], true, 'today → EDIT');
  assert.equal(byDate['2026-09-28'], false, 'past → LOCKED');

  const edits = await ctx.models.Activity.find({ action: 'attendance.edited' }).lean();
  assert.ok(edits.some((e) => /^\[hod\]/.test(e.summary)), 'HOD edit is audited with the actor role');
});

// ── Admin: no date restriction ─────────────────────────────────────

test('admin can edit today, yesterday and older attendance', async () => {
  setNow('2026-10-05', '18:00');
  assert.equal((await mark(admin, { date: '2026-10-05' })).status, 200);
  assert.equal((await mark(admin, { date: '2026-09-28' }, { s1: 'absent', s2: 'present' })).status, 200);
  assert.equal((await mark(admin, { date: '2026-08-31' })).status, 200, 'weeks old');
  const legacyYesterday = await ctx.request('POST', '/attendance/mark', {
    token: admin.token,
    body: { subjectId: String(subject._id), date: '2026-10-04', period: 3, section: 'A', records: [{ student: String(s1.u._id), status: 'present' }] },
  });
  assert.equal(legacyYesterday.status, 200);
  assert.equal((await mark(admin, { date: '2026-10-12' })).status, 422, 'never a future date');

  const sessions = await ctx.request('GET', '/attendance/sessions?range=all', { token: admin.token });
  assert.ok(sessions.body.every((s) => s.editable), 'admin sees EDIT on every date');

  // Editing the 28 Sep attendance did not rewrite its snapshot.
  const snap = await ctx.models.AttendanceSession.findOne({ timetableSlot: slotId, date: new Date('2026-09-28T00:00:00Z') }).lean();
  assert.equal(snap.startTime, '09:00');
});
