/**
 * Exam timetable (HOD / COE management, visibility) and its integration with
 * regular attendance: exam-time blocking and automatic Present for blocked
 * periods when a student is Present in the first post-exam period.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

const { clock } = await import('../src/utils/clock.js');

// The write limiter is a real control and stays on; every test starts with
// a fresh window, as in day-scholar-outing-hard.test.js.
beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

// Campus time is Asia/Kolkata (UTC+05:30). 12, 19 and 26 Oct 2026 are Mondays.
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
let coe, hodCse, hodEce, fyHod, principal, admin, facA, facB, sA1, sA2, sB1, sEce;
const slotA = {}; // period → slot id, CSE 3rd year section A (Monday)
const slotB = {};
const subj = {};

const req = (actor, method, path, body) => ctx.request(method, path, { token: actor.token, body });
const createExams = (actor, body) => req(actor, 'POST', '/exams', body);
const entry = (o = {}) => ({ subjectCode: 'CS501', subjectName: 'Compiler Design', date: '2026-10-19', startTime: '09:30', endTime: '12:30', ...o });
const mark = (actor, slotId, records, extra = {}) => req(actor, 'POST', '/attendance/mark', { slotId, records, ...extra });
const rec = (u, status) => ({ student: String(u.u._id), status });

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ role: 'coe', name: 'Controller of Examinations', employeeId: 'E-COE' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-H1' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-H2' }),
    mk({ role: 'hod', name: 'HOD First Year', department: 'Science & Humanities', employeeId: 'E-H3' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-P' }),
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'faculty', name: 'Fac A', department: 'CSE', employeeId: 'E-FA' }),
    mk({ role: 'faculty', name: 'Fac B', department: 'CSE', employeeId: 'E-FB' }),
    mk({ name: 'Stu A1', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1' }),
    mk({ name: 'Stu A2', department: 'CSE', section: 'A', semester: 5, rollNo: 'A2' }),
    mk({ name: 'Stu B1', department: 'CSE', section: 'B', semester: 5, rollNo: 'B1' }),
    mk({ name: 'Stu ECE', department: 'ECE', section: 'A', semester: 5, rollNo: 'E1' }),
  ]);
  [coe, hodCse, hodEce, fyHod, principal, admin, facA, facB, sA1, sA2, sB1, sEce] = await Promise.all(
    users.map(async (u) => ({ u, ...(await ctx.loginWeb(u)) }))
  );

  for (const [k, code] of [[1, 'CS511'], [2, 'CS512'], [3, 'CS513'], [4, 'CS514'], [5, 'CS515']]) {
    subj[k] = await ctx.models.Subject.create({ name: `Subject ${k}`, code, department: 'CSE', semester: 5, faculty: [], sections: [] });
  }
  const slot = async (section, period, startTime, endTime, fac) => {
    const res = await req(admin, 'POST', '/timetable', {
      subject: String(subj[period]._id), faculty: String(fac.u._id), section, department: 'CSE', dayOfWeek: 'monday', period, startTime, endTime, semester: 5,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return String(res.body._id);
  };
  // Section A: P1–P4 in the morning, P5 after lunch.
  slotA[1] = await slot('A', 1, '09:00', '09:50', facA);
  slotA[2] = await slot('A', 2, '09:50', '10:40', facA);
  slotA[3] = await slot('A', 3, '10:50', '11:40', facA);
  slotA[4] = await slot('A', 4, '11:40', '12:30', facA);
  slotA[5] = await slot('A', 5, '13:30', '14:20', facA);
  slotB[1] = await slot('B', 1, '09:00', '09:50', facB);
  slotB[5] = await slot('B', 5, '13:30', '14:20', facB);
  setNow('2026-10-12', '08:00');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

// ── Exam timetable management ──────────────────────────────────────

let examA; // CSE · 3rd year · Section A · 19 Oct 09:30–12:30 (published)

test('an HOD creates exams in their own department; the department comes from the account', async () => {
  const res = await createExams(hodCse, { year: 3, section: 'A', status: 'published', entries: [entry()] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [e] = res.body.exams;
  assert.equal(e.subjectCode, 'CS501');
  assert.equal(e.subjectName, 'Compiler Design', 'code and name are stored separately');
  assert.deepEqual(e.departments, ['CSE']);
  assert.deepEqual(e.years, [3]);
  assert.deepEqual(e.sections, ['A']);
  assert.equal(e.status, 'published');
  assert.equal(e.createdBy.name, 'HOD CSE');
  assert.ok(e.history.some((h) => h.action === 'created') && e.history.some((h) => h.action === 'published'), 'audit trail');
  examA = e;

  const stored = await ctx.models.Exam.findById(e._id).lean();
  assert.equal(stored.subjectCode, 'CS501');
  assert.equal(stored.subjectName, 'Compiler Design');
  assert.equal(new Date(stored.date).toISOString().slice(0, 10), '2026-10-19');
  assert.ok(await ctx.models.Activity.exists({ action: 'exam.published', entityId: e._id }), 'activity log entry');
});

test('a branch HOD cannot target another department or 1st year; "All Years" means their years 2–4', async () => {
  const other = await createExams(hodCse, { department: 'ECE', year: 3, entries: [entry({ date: '2026-11-02' })] });
  assert.equal(other.status, 403);
  const first = await createExams(hodCse, { year: 1, entries: [entry({ date: '2026-11-02' })] });
  assert.equal(first.status, 403);

  const all = await createExams(hodCse, { year: 'ALL', section: 'ALL', entries: [entry({ subjectCode: 'CS700', date: '2026-11-03' })] });
  assert.equal(all.status, 201, JSON.stringify(all.body));
  assert.deepEqual(all.body.exams[0].departments, ['CSE']);
  assert.deepEqual(all.body.exams[0].years, [2, 3, 4]);
  assert.deepEqual(all.body.exams[0].sections, []);
  assert.equal(all.body.exams[0].status, 'draft', 'draft by default');
});

test('the COE manages exams campus-wide; All selections are stored once as a scope', async () => {
  const before = await ctx.models.Exam.countDocuments();
  const res = await createExams(coe, {
    department: 'ALL', year: 'ALL', section: 'ALL', status: 'published',
    entries: [entry({ subjectCode: 'MA301', subjectName: 'Maths', date: '2026-11-09', startTime: '14:00', endTime: '15:00' }), entry({ subjectCode: 'PH301', subjectName: 'Physics', date: '2026-11-10', startTime: '14:00', endTime: '15:00' })],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await ctx.models.Exam.countDocuments(), before + 2, 'one record per exam, never one per class');
  const [maths] = res.body.exams;
  assert.deepEqual([maths.departments, maths.years, maths.sections], [[], [], []]);
  assert.equal(maths.scope, 'All Departments · All Years · All Sections');

  // Every class retrieves it: a CSE student and an ECE student.
  for (const s of [sA1, sEce]) {
    const list = await req(s, 'GET', '/exams?from=2026-11-01');
    assert.ok(list.body.exams.some((e) => e.subjectCode === 'MA301'), `${s.u.name} sees the campus-wide exam`);
  }

  const ece = await createExams(coe, { department: 'ECE', year: 3, section: 'A', status: 'draft', entries: [entry({ subjectCode: 'EC501', date: '2026-11-11' })] });
  assert.equal(ece.status, 201, JSON.stringify(ece.body));
  // HOD CSE can edit neither ECE's exam nor the campus-wide one.
  assert.equal((await req(hodCse, 'PUT', `/exams/${ece.body.exams[0]._id}`, { subjectName: 'Hijack' })).status, 403);
  assert.equal((await req(hodCse, 'PATCH', `/exams/${maths._id}/cancel`, {})).status, 403);
  // The COE can edit any of them.
  const edit = await req(coe, 'PUT', `/exams/${ece.body.exams[0]._id}`, { subjectName: 'Signals' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.subjectName, 'Signals');
  assert.ok(edit.body.history.some((h) => h.action === 'updated'));
});

test('read-only roles cannot create, edit, publish or cancel exams', async () => {
  for (const actor of [principal, admin, facA, sA1]) {
    assert.equal((await createExams(actor, { year: 3, entries: [entry({ date: '2026-11-20' })] })).status, 403, `${actor.u.role} create`);
    assert.equal((await req(actor, 'PUT', `/exams/${examA._id}`, { subjectName: 'X' })).status, 403, `${actor.u.role} edit`);
    assert.equal((await req(actor, 'PATCH', `/exams/${examA._id}/cancel`, {})).status, 403, `${actor.u.role} cancel`);
    assert.equal((await req(actor, 'PATCH', `/exams/${examA._id}/publish`, {})).status, 403, `${actor.u.role} publish`);
  }
  const still = await ctx.models.Exam.findById(examA._id).lean();
  assert.equal(still.subjectName, 'Compiler Design');
  assert.equal(still.status, 'published');
});

test('the 1st-year HOD manages 1st year only, in any department', async () => {
  assert.equal((await createExams(fyHod, { department: 'CSE', year: 3, entries: [entry({ date: '2026-11-21' })] })).status, 403);
  // No 1st-year sections are configured in this test college, so pick All Sections.
  const ok = await createExams(fyHod, { department: 'CSE', year: 'ALL', entries: [entry({ subjectCode: 'GE101', date: '2026-11-21' })] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.exams[0].years, [1]);
});

test('invalid fields, past dates, unknown sections and overlapping exams are rejected', async () => {
  const bad = async (body, status, why) => {
    const res = await createExams(hodCse, { year: 3, section: 'A', entries: [entry(body)] });
    assert.equal(res.status, status, `${why}: ${JSON.stringify(res.body)}`);
  };
  await bad({ startTime: '12:30', endTime: '09:30', date: '2026-11-30' }, 422, 'end before start');
  await bad({ startTime: '10:00', endTime: '10:00', date: '2026-11-30' }, 422, 'zero length');
  await bad({ startTime: '25:00', date: '2026-11-30' }, 422, 'invalid time');
  await bad({ date: '2026-02-30' }, 422, 'not a real date');
  await bad({ date: '2026-10-05' }, 422, 'past date');
  await bad({ subjectCode: '', date: '2026-11-30' }, 422, 'missing subject code');
  await bad({ subjectName: '', date: '2026-11-30' }, 422, 'missing subject name');

  const ghost = await createExams(hodCse, { year: 3, section: 'H', entries: [entry({ date: '2026-11-30' })] });
  assert.equal(ghost.status, 422, 'section H is not configured for CSE 3rd year');

  // Same students, overlapping time → refused (published or draft alike).
  const clash = await createExams(hodCse, { year: 3, section: 'A', entries: [entry({ subjectCode: 'CS502', startTime: '12:00', endTime: '13:00' })] });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  // "All Sections" of the same year also contains section A → refused.
  const wide = await createExams(hodCse, { year: 3, section: 'ALL', entries: [entry({ subjectCode: 'CS502', startTime: '10:00', endTime: '11:00' })] });
  assert.equal(wide.status, 409);
  // Two overlapping entries inside one request → refused, nothing stored.
  const n = await ctx.models.Exam.countDocuments();
  const pair = await createExams(hodCse, { year: 2, entries: [entry({ date: '2026-12-01' }), entry({ subjectCode: 'CS999', date: '2026-12-01', startTime: '10:00', endTime: '11:00' })] });
  assert.equal(pair.status, 409);
  assert.equal(await ctx.models.Exam.countDocuments(), n, 'all-or-nothing');
  // Another section at the same time is a different student group → allowed (as a draft).
  const otherSection = await createExams(hodCse, { year: 3, section: 'B', entries: [entry({ subjectCode: 'CS503', startTime: '15:00', endTime: '16:00' })] });
  assert.equal(otherSection.status, 201, JSON.stringify(otherSection.body));
});

test('several exams in one week are created together', async () => {
  const res = await createExams(hodCse, {
    year: 4, status: 'published',
    entries: ['2026-12-07', '2026-12-08', '2026-12-09'].map((date, i) => entry({ subjectCode: `CS80${i}`, subjectName: `Paper ${i}`, date })),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.exams.length, 3);
});

test('visibility: drafts only to their managers, published to the class, cancelled shown as cancelled', async () => {
  const draft = await createExams(hodCse, { year: 3, section: 'A', entries: [entry({ subjectCode: 'CS590', date: '2026-12-14' })] });
  assert.equal(draft.status, 201);
  const pub = await createExams(hodCse, { year: 3, section: 'A', status: 'published', entries: [entry({ subjectCode: 'CS591', date: '2026-12-15' })] });
  const cancelled = await createExams(hodCse, { year: 3, section: 'A', status: 'published', entries: [entry({ subjectCode: 'CS592', date: '2026-12-16' })] });
  const c = await req(hodCse, 'PATCH', `/exams/${cancelled.body.exams[0]._id}/cancel`, { reason: 'Rescheduled to January' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.ok(c.body.history.some((h) => h.action === 'cancelled'));

  const codes = async (actor, q = '') => (await req(actor, 'GET', `/exams?from=2026-12-14&to=2026-12-16${q}`)).body.exams.map((e) => `${e.subjectCode}:${e.status}`).sort();
  assert.deepEqual(await codes(sA1), ['CS591:published', 'CS592:cancelled'], 'student in section A: no draft');
  assert.deepEqual(await codes(sB1), [], 'section B student: not their exams');
  assert.deepEqual(await codes(sEce), [], 'ECE student: not their exams');
  assert.deepEqual(await codes(facA), ['CS591:published', 'CS592:cancelled'], 'faculty teaching the class');
  assert.deepEqual(await codes(principal), ['CS591:published', 'CS592:cancelled'], 'principal reads, no drafts');
  assert.deepEqual(await codes(hodCse), ['CS590:draft', 'CS591:published', 'CS592:cancelled'], 'the managing HOD sees the draft');
  assert.deepEqual(await codes(hodEce), [], 'another department’s HOD sees nothing of CSE');
  assert.deepEqual(await codes(coe), ['CS590:draft', 'CS591:published', 'CS592:cancelled'], 'COE sees everything');
  assert.deepEqual(await codes(coe, '&status=draft'), ['CS590:draft']);
  assert.ok(pub.body.exams[0]._id);

  // Students and faculty cannot widen their view with filters.
  assert.deepEqual(await codes(sB1, '&section=A'), []);
  // Filters by subject work for everyone.
  const bySubject = await req(sA1, 'GET', '/exams?from=2026-10-01&subject=compiler');
  assert.ok(bySubject.body.exams.every((e) => /compiler/i.test(e.subjectName)) && bySubject.body.exams.length >= 1);
});

test('the options endpoint offers only configured sections and fixes the HOD department', async () => {
  const hod = await req(hodCse, 'GET', '/exams/options?department=ECE&year=3');
  assert.equal(hod.status, 200);
  assert.equal(hod.body.fixedDepartment, 'CSE');
  assert.deepEqual(hod.body.departments, ['CSE']);
  assert.deepEqual(hod.body.years, [2, 3, 4]);
  assert.deepEqual(hod.body.sections, ['A', 'B']);
  const c = await req(coe, 'GET', '/exams/options?department=ECE&year=3');
  assert.ok(c.body.departments.includes('ECE') && c.body.departments.includes('CSE'));
  assert.deepEqual(c.body.sections, ['A']);
});

// ── COE confinement ────────────────────────────────────────────────

test('the COE reads class timetables and attendance campus-wide but nothing else, and never writes them', async () => {
  for (const path of ['/timetable?department=CSE&year=3&section=A', '/attendance/sessions?range=all', '/attendance/low', '/attendance/reports/options', '/subjects', '/auth/me']) {
    assert.equal((await req(coe, 'GET', path)).status, 200, path);
  }
  const tt = await req(coe, 'GET', '/timetable?department=CSE&year=3&section=A');
  assert.ok(tt.body.slots.length >= 5, 'campus-wide class timetable');
  for (const path of ['/users', '/events', '/announcements', '/chat/conversations', '/gate-pass', '/dashboard', '/study-materials', '/complaints']) {
    assert.equal((await req(coe, 'GET', path)).status, 403, path);
  }
  assert.equal((await mark(coe, slotA[1], [rec(sA1, 'present')])).status, 403, 'no attendance marking');
  assert.equal((await req(coe, 'POST', '/timetable', { section: 'A' })).status, 403, 'no class-timetable editing');
  assert.equal((await req(coe, 'DELETE', `/timetable/${slotA[1]}`)).status, 403);
});

// ── Exam-time attendance blocking ──────────────────────────────────

test('regular attendance is refused during a published exam, for every role, and the roster says why', async () => {
  setNow('2026-10-19', '09:10');
  const res = await mark(facA, slotA[1], [rec(sA1, 'present'), rec(sA2, 'present')]);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.message, /blocked.*CS501.*exam/i);
  assert.equal(res.body.examBlocked.subjectCode, 'CS501');
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ date: new Date('2026-10-19T00:00:00Z') }), 0, 'nothing written');
  assert.equal(await ctx.models.AttendanceSession.countDocuments({ date: new Date('2026-10-19T00:00:00Z') }), 0, 'no session either');

  const roster = await req(facA, 'GET', `/attendance/roster?slotId=${slotA[1]}`);
  assert.equal(roster.status, 200);
  assert.equal(roster.body.editable, false);
  assert.match(roster.body.lockedReason, /exam/i);
  assert.equal(roster.body.examBlocked.subjectCode, 'CS501');

  const periods = await req(facA, 'GET', '/attendance/my-periods');
  const byPeriod = Object.fromEntries(periods.body.periods.map((p) => [p.period, p]));
  for (const p of [1, 2, 3, 4]) assert.equal(byPeriod[p].examBlocked?.subjectCode, 'CS501', `P${p} blocked`);
  assert.equal(byPeriod[5].examBlocked, null, 'P5 is after the exam');
  assert.deepEqual(byPeriod[5].examTrigger.periods.map((p) => p.period), [1, 2, 3, 4], 'P5 is the post-exam period');

  // HOD (today) and admin are blocked too.
  assert.equal((await mark(hodCse, slotA[2], [rec(sA1, 'present')])).status, 409);
  assert.equal((await mark(admin, slotA[3], [rec(sA1, 'present')], { date: '2026-10-19' })).status, 409);
});

test('another section, an unaffected period and the same weekday on another date are not blocked', async () => {
  setNow('2026-10-19', '09:10');
  const other = await mark(facB, slotB[1], [rec(sB1, 'present')]);
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.examAuto, null);

  // The previous Monday has no exam: P1 of section A is markable as usual.
  setNow('2026-10-12', '09:10');
  const lastWeek = await mark(facA, slotA[1], [rec(sA1, 'present'), rec(sA2, 'absent')]);
  assert.equal(lastWeek.status, 200, JSON.stringify(lastWeek.body));
  assert.equal(lastWeek.body.examAuto, null);
});

// ── Automatic Present for exam-blocked periods ─────────────────────

const day19 = new Date('2026-10-19T00:00:00Z');
const autoRecords = (student) => ctx.models.AttendanceRecord.find({ student: student.u._id, date: day19, source: 'AUTO_EXAM_PERIOD_PRESENT' }).lean();

test('a failed automatic update rolls back the whole save — never a false success', async () => {
  setNow('2026-10-19', '13:40');
  const Model = ctx.models.AttendanceRecord;
  const original = Model.bulkWrite;
  Model.bulkWrite = function failingAuto(ops, opts) {
    if (ops.some((o) => o.updateOne?.update?.$setOnInsert?.source)) return Promise.reject(new Error('simulated write failure'));
    return original.call(this, ops, opts);
  };
  try {
    const res = await mark(facA, slotA[5], [rec(sA1, 'present'), rec(sA2, 'absent')]);
    assert.equal(res.status, 500, JSON.stringify(res.body));
  } finally {
    Model.bulkWrite = original;
  }
  assert.equal(await Model.countDocuments({ date: day19, period: 5 }), 0, 'the trigger period marks were rolled back too');
  assert.equal((await autoRecords(sA1)).length, 0);
});

test('Present in the first post-exam period marks that student’s blocked periods Present; Absent does not', async () => {
  setNow('2026-10-19', '13:40');
  const res = await mark(facA, slotA[5], [rec(sA1, 'present'), rec(sA2, 'absent')]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const auto = res.body.examAuto;
  assert.equal(auto.exam.subjectCode, 'CS501');
  assert.equal(auto.triggerPeriod, 5);
  assert.deepEqual(auto.periods.map((p) => p.period), [1, 2, 3, 4]);
  assert.equal(auto.recordsCreated, 4);
  assert.equal(auto.studentsUpdated, 1);
  assert.deepEqual(auto.conflicts, []);

  const mine = await autoRecords(sA1);
  assert.deepEqual(mine.map((r) => r.period).sort(), [1, 2, 3, 4]);
  for (const r of mine) {
    assert.equal(r.status, 'present');
    assert.equal(String(r.exam), examA._id);
    assert.equal(r.triggerPeriod, 5);
    assert.ok(r.triggerSession, 'trigger session recorded');
    assert.equal(String(r.markedBy), String(facA.u._id), 'actor recorded');
    assert.ok(r.session, 'blocked period has its own session snapshot');
  }
  assert.equal((await autoRecords(sA2)).length, 0, 'absent after the exam → nothing automatic');
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ student: sA2.u._id, date: day19, period: { $lt: 5 } }), 0);
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ student: sB1.u._id, date: day19, period: { $gt: 1 } }), 0, 'other section untouched');
  assert.ok(await ctx.models.Activity.exists({ action: 'attendance.exam_auto_present' }), 'audited');
  // No exam-attendance record is fabricated: only regular-period records exist.
  assert.equal(await ctx.models.AttendanceRecord.countDocuments({ date: day19, student: sA1.u._id }), 5);
});

test('repeating the request is idempotent', async () => {
  setNow('2026-10-19', '13:45');
  const again = await mark(facA, slotA[5], [rec(sA1, 'present'), rec(sA2, 'absent')]);
  assert.equal(again.status, 200);
  assert.equal(again.body.examAuto.recordsCreated, 0);
  assert.equal(again.body.examAuto.alreadyApplied, 4);
  assert.equal((await autoRecords(sA1)).length, 4, 'no duplicates');
});

test('an existing manual record is never overwritten — it is reported as a conflict', async () => {
  // A record that existed before (e.g. taken before the exam was published).
  await ctx.models.AttendanceRecord.create({
    student: sA2.u._id, subject: subj[2]._id, date: day19, period: 2, status: 'absent', department: 'CSE', section: 'A', markedBy: admin.u._id,
  });
  setNow('2026-10-19', '13:50');
  const res = await mark(facA, slotA[5], [rec(sA1, 'present'), rec(sA2, 'present')]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.examAuto.recordsCreated, 3, 'P1, P3, P4 for A2');
  assert.deepEqual(
    res.body.examAuto.conflicts.map((c) => [c.student, c.period, c.status, c.source]),
    [[String(sA2.u._id), 2, 'absent', 'manual']]
  );
  const kept = await ctx.models.AttendanceRecord.findOne({ student: sA2.u._id, date: day19, period: 2 }).lean();
  assert.equal(kept.status, 'absent', 'manual record preserved');
  assert.equal(kept.source, undefined);
});

test('correcting the trigger to Absent withdraws only the untouched automatic marks', async () => {
  setNow('2026-10-19', '13:55');
  const res = await mark(facA, slotA[5], [rec(sA1, 'absent'), rec(sA2, 'present')]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.examAuto.reverted, 4);
  assert.equal((await autoRecords(sA1)).length, 0);
  assert.equal((await autoRecords(sA2)).length, 3, 'the other student keeps theirs');
});

test('another faculty member cannot trigger it, and the COE cannot mark', async () => {
  setNow('2026-10-19', '14:00');
  assert.equal((await mark(facB, slotA[5], [rec(sA1, 'present')])).status, 403);
  assert.equal((await mark(coe, slotA[5], [rec(sA1, 'present')])).status, 403);
  assert.equal((await autoRecords(sA1)).length, 0);
});

test('an event coordinator’s mark cannot write regular attendance into exam-blocked periods', async () => {
  setNow('2026-10-19', '15:00');
  const sA3 = await ctx.createUser({ name: 'Stu A3', department: 'CSE', section: 'A', semester: 5, rollNo: 'A3' });
  const event = await ctx.models.Event.create({
    title: 'Hackathon', description: 'A long hackathon day', category: 'hackathon', organizer: hodCse.u._id, venue: 'Hall',
    startDate: at('2026-10-19', '08:00'), endDate: at('2026-10-19', '18:00'),
    facultyCoordinators: [facB.u._id], registrations: [{ user: sA3._id, status: 'registered' }], registeredCount: 1,
  });
  const res = await req(facB, 'PATCH', `/events/${event._id}/attendance/${sA3._id}`, { attended: true, date: '2026-10-19' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const periods = (await ctx.models.AttendanceRecord.find({ student: sA3._id, date: day19 }).lean()).map((r) => r.period).sort();
  assert.deepEqual(periods, [5], 'only the period outside the exam got the event mark');
});

test('a draft exam blocks nothing', async () => {
  setNow('2026-10-12', '08:00');
  const draft = await createExams(hodCse, { year: 3, section: 'B', entries: [entry({ subjectCode: 'CS595', date: '2026-10-26', startTime: '13:00', endTime: '14:30' })] });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  setNow('2026-10-26', '13:40');
  assert.equal((await mark(facB, slotB[5], [rec(sB1, 'present')])).status, 200);
});

test('rescheduling and cancelling a published exam update the blocking at once', async () => {
  setNow('2026-10-19', '18:00');
  const made = await createExams(hodCse, { year: 3, section: 'A', status: 'published', entries: [entry({ subjectCode: 'CS520', date: '2026-10-26', startTime: '09:00', endTime: '09:50' })] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.exams[0]._id;

  setNow('2026-10-26', '08:00');
  const blocked = async (slot) => (await req(facA, 'GET', `/attendance/roster?slotId=${slot}`)).body.examBlocked?.subjectCode || null;
  assert.equal(await blocked(slotA[1]), 'CS520');
  assert.equal(await blocked(slotA[2]), null, 'an exam ending at 09:50 does not touch a period starting at 09:50');

  const moved = await req(hodCse, 'PUT', `/exams/${id}`, { startTime: '13:30', endTime: '14:20' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(await blocked(slotA[1]), null, 'rescheduled away from P1');
  assert.equal(await blocked(slotA[5]), 'CS520', 'now blocks P5');

  const cancel = await req(hodCse, 'PATCH', `/exams/${id}/cancel`, { reason: 'Postponed' });
  assert.equal(cancel.status, 200);
  assert.equal(await blocked(slotA[5]), null, 'cancelled → unblocked');

  setNow('2026-10-26', '13:40');
  const ok = await mark(facA, slotA[5], [rec(sA1, 'present')]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.examAuto, null, 'a cancelled exam triggers nothing');
});

test('an exam that has started can no longer be edited', async () => {
  setNow('2026-10-19', '10:00');
  const res = await req(hodCse, 'PUT', `/exams/${examA._id}`, { endTime: '11:00' });
  assert.equal(res.status, 422);
});
