/**
 * Faculty "Our Class" (Class In-Charge) vs "Handling Class" (subject teaching).
 *
 *   Our Class      = User.department + User.section + User.inChargeYear
 *                    + User.inChargeSemester → COMPLETE visibility of that one
 *                    class (timetable, attendance, reports). Never marking.
 *   Handling Class = TimetableSlot.faculty → only the faculty's own subjects.
 *
 * Every check goes through the HTTP API with a real token. The campus clock is
 * stubbed to Monday 2026-10-05 (Asia/Kolkata); the class's periods are
 *   P1 08:30–09:15  P2 09:15–10:00  P3 10:00–10:45  P4 10:45–11:30
 * and most tests run at 10:20 — P1/P2 finished, P3 running, P4 in the future.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');
const { extractText, getDocumentProxy } = await import('unpdf');

const CY = 'CSE (Cyber Security)';
const MONDAY = '2026-10-05';
const PREV_MONDAY = '2026-09-28';

const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 0, h * 60 + m - 330));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

let ctx;
let admin, facA, facB, facC, facOther, facE, facLegacyB, facLegacyA, facNone;
let alpha, bravo, charlie, delta, stuB, stuC, stuY2, stuSem6, stuEce;
let aiml, netsec, maths, os3, crypto6, vlsi;
let slot = {};

const rolls = (rows) => rows.map((r) => r.rollNo);
const sectionsOf = (slots) => [...new Set(slots.map((s) => `${s.department}|${s.year}|${s.section}|${s.semester}`))].sort();

async function pdf(path, token) {
  const res = await fetch(`${ctx.base}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) return { status: res.status, text: body.toString() };
  const doc = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(doc, { mergePages: true });
  return { status: res.status, text, disposition: res.headers.get('content-disposition') };
}

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };

  [admin, facA, facB, facC, facOther, facE, facLegacyB, facLegacyA, facNone] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    // OUR CLASS: CY / 3rd Year / Section A / Semester 5.
    mk({ role: 'faculty', name: 'Dr Anitha', department: CY, section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3, 4], employeeId: 'F-A' }),
    mk({ role: 'faculty', name: 'Dr Bala', department: CY, employeeId: 'F-B' }),
    mk({ role: 'faculty', name: 'Dr Chitra', department: CY, employeeId: 'F-C' }),
    mk({ role: 'faculty', name: 'Dr Other', department: CY, employeeId: 'F-O' }),
    mk({ role: 'faculty', name: 'Dr Ece', department: 'ECE', employeeId: 'F-E' }),
    // Legacy accounts: a section but no stored in-charge year/semester.
    mk({ role: 'faculty', name: 'Legacy B', department: CY, section: 'B', employeeId: 'F-LB' }),
    mk({ role: 'faculty', name: 'Legacy A', department: CY, section: 'A', employeeId: 'F-LA' }),
    mk({ role: 'faculty', name: 'No Class', department: CY, employeeId: 'F-N' }),
  ]);

  [alpha, bravo, charlie, delta, stuB, stuC, stuY2, stuSem6, stuEce] = await Promise.all([
    mk({ name: 'Alpha', department: CY, section: 'A', year: 3, semester: 5, rollNo: '101', parentPhone: '9800000001', stayType: 'hosteler' }),
    mk({ name: 'Bravo', department: CY, section: 'A', year: 3, semester: 5, rollNo: '103' }),
    mk({ name: 'Charlie', department: CY, section: 'A', year: 3, semester: 5, rollNo: '108' }),
    // Roll "9" must sort before "101" — only natural ordering gets that right.
    mk({ name: 'Delta', department: CY, section: 'A', year: 3, semester: 5, rollNo: '9' }),
    mk({ name: 'Sec B Student', department: CY, section: 'B', year: 3, semester: 5, rollNo: '201' }),
    mk({ name: 'Sec C Student', department: CY, section: 'C', year: 3, semester: 5, rollNo: '301' }),
    mk({ name: 'Year2 Student', department: CY, section: 'A', year: 2, semester: 3, rollNo: '401' }),
    mk({ name: 'Sem6 Student', department: CY, section: 'A', year: 3, semester: 6, rollNo: '601' }),
    mk({ name: 'Ece Student', department: 'ECE', section: 'A', year: 3, semester: 5, rollNo: '501' }),
  ]);

  const { Subject, TimetableSlot } = ctx.models;
  [aiml, netsec, maths, os3, crypto6, vlsi] = await Subject.create([
    { name: 'AI & ML', code: 'CY501', department: CY, semester: 5, year: 3, sections: ['A', 'B'] },
    { name: 'Network Security', code: 'CY502', department: CY, semester: 5, year: 3, sections: ['A', 'C'] },
    { name: 'Mathematics', code: 'CY503', department: CY, semester: 5, year: 3, sections: ['A'] },
    { name: 'Operating Systems', code: 'CY301', department: CY, semester: 3, year: 2, sections: ['A'] },
    { name: 'Cryptography', code: 'CY601', department: CY, semester: 6, year: 3, sections: ['A'] },
    { name: 'VLSI', code: 'EC501', department: 'ECE', semester: 5, year: 3, sections: ['A'] },
  ]);

  const mon = (o) => ({ dayOfWeek: 'monday', isActive: true, ...o });
  const P = {
    1: { period: 1, startTime: '08:30', endTime: '09:15' },
    2: { period: 2, startTime: '09:15', endTime: '10:00' },
    3: { period: 3, startTime: '10:00', endTime: '10:45' },
    4: { period: 4, startTime: '10:45', endTime: '11:30' },
    5: { period: 5, startTime: '11:30', endTime: '12:15' },
  };
  const y3a = { department: CY, year: 3, semester: 5, section: 'A' };
  const rows = await TimetableSlot.create([
    // OUR CLASS — every period taught by somebody other than Dr Anitha.
    mon({ ...y3a, ...P[1], subject: aiml._id, faculty: facB.u._id, room: 'LH-1' }),
    mon({ ...y3a, ...P[2], subject: netsec._id, faculty: facC.u._id, room: 'LH-1' }),
    mon({ ...y3a, ...P[3], subject: maths._id, faculty: facB.u._id }),
    mon({ ...y3a, ...P[4], subject: netsec._id, faculty: facC.u._id }),
    // HANDLING CLASS for Dr Anitha: AI & ML → B, Network Security → C.
    mon({ department: CY, year: 3, semester: 5, section: 'B', ...P[1], subject: aiml._id, faculty: facA.u._id }),
    mon({ department: CY, year: 3, semester: 5, section: 'C', ...P[2], subject: netsec._id, faculty: facA.u._id }),
    // Same section letter, other year / other semester / other department.
    mon({ department: CY, year: 2, semester: 3, section: 'A', ...P[1], subject: os3._id, faculty: facOther.u._id }),
    mon({ department: CY, year: 3, semester: 6, section: 'A', ...P[5], subject: crypto6._id, faculty: facOther.u._id }),
    mon({ department: 'ECE', year: 3, semester: 5, section: 'A', ...P[1], subject: vlsi._id, faculty: facE.u._id }),
  ]);
  const [a1, a2, a3, a4, hb, hc, y2, s6, ece] = rows;
  slot = { a1, a2, a3, a4, hb, hc, y2, s6, ece };

  // Attendance is taken through the API, during each live period, by the
  // faculty who teaches it — exactly as in production.
  const mark = async (when, actor, slotDoc, records) => {
    setNow(...when);
    const res = await ctx.request('POST', '/attendance/mark', {
      token: actor.token,
      body: { slotId: String(slotDoc._id), records: records.map(([s, status]) => ({ student: String(s.u._id), status })) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  const all = (status) => [alpha, bravo, charlie, delta].map((s) => [s, status]);

  await mark([PREV_MONDAY, '08:45'], facB, a1, all('present'));
  await mark([MONDAY, '08:45'], facB, a1, [[alpha, 'present'], [bravo, 'absent'], [charlie, 'present'], [delta, 'present']]);
  await mark([MONDAY, '09:30'], facC, a2, [[alpha, 'present'], [bravo, 'present'], [charlie, 'absent'], [delta, 'present']]);
  // P3 is marked while it is running — a running period must still be excluded.
  await mark([MONDAY, '10:15'], facB, a3, all('absent'));
  await mark([MONDAY, '08:45'], facA, hb, [[stuB, 'absent']]);
  await mark([MONDAY, '09:30'], facA, hc, [[stuC, 'present']]);
  await mark([MONDAY, '08:45'], facOther, y2, [[stuY2, 'absent']]);
  await mark([MONDAY, '11:45'], facOther, s6, [[stuSem6, 'absent']]);
  await mark([MONDAY, '08:45'], facE, ece, [[stuEce, 'absent']]);

  setNow(MONDAY, '10:20');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

// ── 1. Data model: inChargeYear + inChargeSemester ─────────────────

test('Faculty create/update stores the exact in-charge year and semester, and refuses invalid ones', async () => {
  const base = {
    role: 'faculty', name: 'New In-Charge', password: 'Welcome123', department: CY, section: 'A',
    teachingYears: [3, 4], teachingSections: ['A'], phone: '9333',
  };
  const ok = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: { ...base, email: 'incharge.ok@test.edu', employeeId: 'NIC-1', inChargeYear: 3, inChargeSemester: 5 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const stored = await ctx.models.User.findById(ok.body._id).lean();
  assert.equal(stored.inChargeYear, 3);
  assert.equal(stored.inChargeSemester, 5);
  assert.equal(stored.section, 'A', 'User.section remains the Class In Charge section');
  assert.deepEqual(stored.teachingYears, [3, 4], 'years handled are separate from the in-charge year');

  const bad = [
    [{ inChargeYear: 3, inChargeSemester: 3 }, 'semester 3 is not a 3rd-year semester'],
    [{ inChargeYear: 1, inChargeSemester: 8 }, 'semester 8 is not a 1st-year semester'],
    [{ inChargeYear: 5, inChargeSemester: 9 }, 'out of range'],
    [{ inChargeYear: 3 }, 'year without semester'],
    [{ inChargeSemester: 5 }, 'semester without year'],
    [{ inChargeYear: 3, inChargeSemester: 5, section: undefined }, 'no Class In Charge section'],
  ];
  for (const [over, why] of bad) {
    const body = { ...base, email: `bad.${Math.random().toString(36).slice(2, 7)}@test.edu`, employeeId: `NIC-${Math.random().toString(36).slice(2, 7)}`, ...over };
    if ('section' in over && over.section === undefined) delete body.section;
    const res = await ctx.request('POST', '/admin/users', { token: admin.token, body });
    assert.equal(res.status, 422, `${why}: ${JSON.stringify(res.body)}`);
  }

  // Only faculty can be Class In-Charge.
  const student = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      role: 'student', name: 'Sneaky', email: 'sneaky@test.edu', password: 'Welcome123', rollNo: 'SN1', department: CY,
      year: 3, section: 'A', semester: 5, stayType: 'hosteler', parentPhone: '9811111111', inChargeYear: 3, inChargeSemester: 5,
    },
  });
  assert.equal(student.status, 422, JSON.stringify(student.body));

  // Update: valid change, invalid pair, and clearing.
  const id = ok.body._id;
  assert.equal((await ctx.request('PATCH', `/admin/users/${id}`, { token: admin.token, body: { inChargeYear: 2, inChargeSemester: 4 } })).status, 200);
  assert.equal((await ctx.request('PATCH', `/admin/users/${id}`, { token: admin.token, body: { inChargeYear: 2, inChargeSemester: 5 } })).status, 422);
  const cleared = await ctx.request('PATCH', `/admin/users/${id}`, { token: admin.token, body: { inChargeYear: null, inChargeSemester: null } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  const after = await ctx.models.User.findById(id).lean();
  assert.equal(after.inChargeYear, undefined);
  assert.equal(after.section, 'A');

  // Existing callers that send no in-charge fields keep working.
  const legacy = await ctx.request('POST', '/admin/users', { token: admin.token, body: { ...base, email: 'legacy.fac@test.edu', employeeId: 'NIC-L' } });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
});

// ── 2. Timetable: Our Class vs Handling Class ──────────────────────

test('Timetable Our Class: the complete Y3-A Sem 5 timetable, every subject and faculty', async () => {
  const res = await ctx.request('GET', '/timetable?scope=class', { token: facA.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.classInCharge, { department: CY, program: CY, year: 3, section: 'A', semester: 5 });
  assert.deepEqual(sectionsOf(res.body.slots), [`${CY}|3|A|5`], 'exactly one class');
  assert.deepEqual(res.body.slots.map((s) => s.period).sort(), [1, 2, 3, 4]);
  const faculty = [...new Set(res.body.slots.map((s) => s.faculty.name))].sort();
  assert.deepEqual(faculty, ['Dr Bala', 'Dr Chitra'], 'periods of other faculty, not filtered by the viewer');
  for (const s of res.body.slots) assert.ok(s.subject?.code && s.startTime && s.endTime && s.dayOfWeek);
});

test('Timetable Handling Class: only Dr Anitha’s own periods (AI & ML B, Network Security C)', async () => {
  for (const qs of ['', '?scope=handling']) {
    const res = await ctx.request('GET', `/timetable${qs}`, { token: facA.token });
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.slots.map((s) => `${s.subject.code}-${s.section}`).sort(),
      ['CY501-B', 'CY502-C'],
      'never AI & ML A or Network Security A, which other faculty teach'
    );
  }
});

test('Timetable Our Class: no query parameter moves it to another class', async () => {
  const tamper = [
    'department=ECE', `department=${encodeURIComponent(CY)}&section=B`, 'section=B', 'year=2', 'year=2&section=A&semester=3',
    `faculty=${facOther.u._id}`, `facultyId=${facOther.u._id}`, `userId=${facLegacyB.u._id}`, `timetableId=${slot.ece._id}`,
    `subjectId=${vlsi._id}`, 'programId=ECE', 'departmentId=ECE', 'sectionId=B',
  ];
  for (const qs of tamper) {
    const res = await ctx.request('GET', `/timetable?scope=class&${qs}`, { token: facA.token });
    assert.equal(res.status, 200, qs);
    // A different semester narrows to nothing; anything else is simply ignored.
    if (/semester=3/.test(qs)) assert.deepEqual(res.body.slots, [], qs);
    else assert.deepEqual(sectionsOf(res.body.slots), [`${CY}|3|A|5`], `${qs} must not change the class`);
  }
  // Another semester of the same section narrows to nothing rather than leaking sem 6.
  const sem6 = await ctx.request('GET', '/timetable?scope=class&semester=6', { token: facA.token });
  assert.deepEqual(sem6.body.slots, []);
});

test('Legacy accounts: inferred only when the timetable leaves exactly one class, otherwise none', async () => {
  // CY section B runs only as Y3 Sem 5 → resolvable.
  const b = await ctx.request('GET', '/timetable?scope=class', { token: facLegacyB.token });
  assert.deepEqual(b.body.classInCharge, { department: CY, program: CY, year: 3, section: 'B', semester: 5 });
  assert.deepEqual(sectionsOf(b.body.slots), [`${CY}|3|B|5`]);

  // CY section A runs as Y2 Sem 3, Y3 Sem 5 and Y3 Sem 6 → ambiguous → nothing,
  // never a year-unconstrained "every section A".
  const a = await ctx.request('GET', '/timetable?scope=class', { token: facLegacyA.token });
  assert.equal(a.body.classInCharge, null);
  assert.deepEqual(a.body.slots, []);

  const none = await ctx.request('GET', '/timetable?scope=class', { token: facNone.token });
  assert.equal(none.body.classInCharge, null);
  assert.deepEqual(none.body.slots, []);
});

// ── 3. Attendance: Our Class ───────────────────────────────────────

test('Our Class attendance (today): the whole class, finished periods only, natural roll order', async () => {
  const res = await ctx.request('GET', '/attendance/our-class?range=day', { token: facA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.class.year, 3);
  assert.equal(res.body.class.section, 'A');
  assert.equal(res.body.class.semester, 5);
  assert.equal(res.body.class.classInCharge, 'Dr Anitha');

  // P1 (Dr Bala) and P2 (Dr Chitra) finished; P3 is running at 10:20, so its
  // already-marked records are not counted yet.
  assert.deepEqual(res.body.sessions.map((s) => s.period), [1, 2]);
  assert.deepEqual(res.body.sessions.map((s) => s.facultyName), ['Dr Bala', 'Dr Chitra']);
  const p1 = res.body.sessions[0];
  assert.equal(p1.subjectCode, 'CY501');
  assert.equal(p1.present, 3);
  assert.equal(p1.absent, 1);

  assert.deepEqual(rolls(res.body.students), ['9', '101', '103', '108'], 'natural roll order, current class only');
  const bravoRow = res.body.students.find((s) => s.rollNo === '103');
  assert.deepEqual([bravoRow.totalPeriods, bravoRow.presentPeriods, bravoRow.absentPeriods, bravoRow.percentage], [2, 1, 1, 50]);
  // Σ present ÷ Σ conducted: (3 + 3) ÷ 8.
  assert.equal(res.body.overall.percentage, 75);
  for (const s of res.body.students) assert.ok(s.department === CY && s.program === CY && s.year === 3 && s.section === 'A' && s.semester === 5);
});

test('Our Class attendance: week, month, semester and custom ranges stay inside the class', async () => {
  // "week" is the last 7 days (Tue 29 Sep – Mon 5 Oct), so last Monday is outside it.
  for (const [qs, held, bravoTotals] of [
    ['range=week', 2, [2, 1]],
    ['range=month', 3, [3, 2]],
    ['range=semester', 3, [3, 2]],
    [`range=custom&from=${PREV_MONDAY}&to=${MONDAY}`, 3, [3, 2]],
  ]) {
    const res = await ctx.request('GET', `/attendance/our-class?${qs}`, { token: facA.token });
    assert.equal(res.status, 200, qs);
    assert.equal(res.body.overall.classesConducted, held, qs);
    const bravoRow = res.body.students.find((s) => s.rollNo === '103');
    assert.deepEqual([bravoRow.totalPeriods, bravoRow.presentPeriods], bravoTotals, qs);
    assert.deepEqual(rolls(res.body.students), ['9', '101', '103', '108'], qs);
  }
  const custom = await ctx.request('GET', `/attendance/our-class?range=custom&from=${PREV_MONDAY}&to=${PREV_MONDAY}`, { token: facA.token });
  assert.equal(custom.body.overall.classesConducted, 1, 'a custom range is honoured exactly');
});

test('Our Class attendance: tampering never reaches another section, year, semester or department', async () => {
  const tamper = [
    'department=ECE', 'departmentId=ECE', 'programId=ECE', 'section=B', 'sectionId=C', 'year=2', 'semester=3', 'semester=6',
    `subjectId=${vlsi._id}`, `facultyId=${facE.u._id}`, `userId=${stuEce.u._id}`, `timetableId=${slot.ece._id}`,
    `attendanceSessionId=${(await ctx.models.AttendanceSession.findOne({ timetableSlot: slot.ece._id }).lean())._id}`,
  ];
  for (const qs of tamper) {
    const res = await ctx.request('GET', `/attendance/our-class?range=all&${qs}`, { token: facA.token });
    assert.equal(res.status, 200, qs);
    assert.equal(res.body.class.section, 'A', qs);
    assert.deepEqual(rolls(res.body.students), ['9', '101', '103', '108'], `${qs} must not change the roster`);
    assert.ok(res.body.sessions.every((s) => ['CY501', 'CY502', 'CY503'].includes(s.subjectCode)), qs);
  }
});

test('Our Class: no Class In-Charge → a clean empty answer, never a department fallback', async () => {
  for (const actor of [facNone, facLegacyA, facB]) {
    const res = await ctx.request('GET', '/attendance/our-class?range=all', { token: actor.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.class, null);
  }
});

test('Low Attendance: Our Class students plus Handling Class, never other classes', async () => {
  const res = await ctx.request('GET', '/attendance/low?range=all', { token: facA.token });
  assert.equal(res.status, 200);
  const names = res.body.students.map((r) => r.student.name);
  // Bravo: P1 last week ✓, P1 ✗, P2 ✓, P3 (running) ✗ → 2/4 = 50%.
  assert.ok(names.includes('Bravo'), 'Our Class student below 75%');
  assert.ok(names.includes('Sec B Student'), 'Handling Class student below 75% (AI & ML B)');
  for (const outsider of ['Year2 Student', 'Sem6 Student', 'Ece Student']) {
    assert.ok(!names.includes(outsider), `${outsider} must not appear`);
  }
  for (const qs of ['department=ECE', 'section=B&department=ECE', 'year=2']) {
    const t = await ctx.request('GET', `/attendance/low?range=all&${qs}`, { token: facA.token });
    assert.ok(!t.body.students.some((r) => ['Year2 Student', 'Sem6 Student', 'Ece Student'].includes(r.student.name)), qs);
  }
});

test('Student lookup: an Our Class student’s complete record across subjects; other classes refused', async () => {
  const res = await ctx.request('GET', `/attendance/student/${bravo.u._id}`, { token: facA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const codes = res.body.subjects.map((s) => s.subject.code).sort();
  assert.ok(codes.includes('CY501') && codes.includes('CY502'), 'subjects Dr Anitha does not teach in section A');

  for (const target of [stuY2, stuSem6, stuEce]) {
    assert.equal((await ctx.request('GET', `/attendance/student/${target.u._id}`, { token: facA.token })).status, 403, target.u.name);
  }
});

// ── 4. Class In-Charge never becomes the marking faculty ───────────

test('Class In-Charge can VIEW the class but cannot MARK another faculty’s period', async () => {
  setNow(MONDAY, '10:50'); // P4 (Dr Chitra, Network Security A) is live
  const mark = await ctx.request('POST', '/attendance/mark', {
    token: facA.token,
    body: { slotId: String(slot.a4._id), records: [{ student: String(alpha.u._id), status: 'absent' }] },
  });
  assert.equal(mark.status, 403, JSON.stringify(mark.body));

  const bySubject = await ctx.request('POST', '/attendance/mark', {
    token: facA.token,
    body: { subjectId: String(netsec._id), section: 'A', date: MONDAY, period: 4, records: [{ student: String(alpha.u._id), status: 'absent' }] },
  });
  assert.equal(bySubject.status, 403);

  const roster = await ctx.request('GET', `/attendance/roster?slotId=${slot.a4._id}`, { token: facA.token });
  assert.equal(roster.status, 403, 'not even the marking roster');

  // The handling faculty still marks it as before.
  const own = await ctx.request('POST', '/attendance/mark', {
    token: facC.token,
    body: { slotId: String(slot.a4._id), records: [{ student: String(alpha.u._id), status: 'present' }] },
  });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  await ctx.models.AttendanceRecord.deleteMany({ session: (await ctx.models.AttendanceSession.findOne({ timetableSlot: slot.a4._id }))._id });
  await ctx.models.AttendanceSession.deleteMany({ timetableSlot: slot.a4._id });
  setNow(MONDAY, '10:20');
});

// ── 5. Reports: Our Class ──────────────────────────────────────────

const ourClass = (type, qs = '') => `/attendance/reports/${type}?scope=class${qs}`;

test('Our Class period list: All Periods + the real timetable periods, with server-side completion', async () => {
  const res = await ctx.request('GET', `/attendance/reports/periods?scope=class&date=${MONDAY}`, { token: facA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.periods.map((p) => p.period), [1, 2, 3, 4], 'derived from the class timetable — not sem 6’s P5');
  assert.deepEqual(res.body.periods.map((p) => p.completed), [true, true, false, false]);
  assert.deepEqual(res.body.periods.map((p) => p.facultyName), ['Dr Bala', 'Dr Chitra', 'Dr Bala', 'Dr Chitra']);

  const handling = await ctx.request('GET', `/attendance/reports/periods?scope=handling&subjectId=${aiml._id}&section=B&date=${MONDAY}`, { token: facA.token });
  assert.deepEqual(handling.body.periods.map((p) => p.period), [1]);
  const notMine = await ctx.request('GET', `/attendance/reports/periods?scope=handling&subjectId=${aiml._id}&section=A&date=${MONDAY}`, { token: facA.token });
  assert.equal(notMine.status, 403);
});

test('Our Class All Periods: every finished period, each separately — not the running or future one', async () => {
  const res = await ctx.request('GET', ourClass('period', `&date=${MONDAY}&period=all`), { token: facA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.header.scope, 'class');
  assert.equal(res.body.header.classInCharge, 'Dr Anitha');
  assert.deepEqual([res.body.header.department, res.body.header.year, res.body.header.section, res.body.header.semester], [CY, 3, 'A', 5]);
  assert.deepEqual(res.body.periods.map((p) => p.period), [1, 2]);
  assert.deepEqual(res.body.periods.map((p) => p.facultyName), ['Dr Bala', 'Dr Chitra']);
  assert.deepEqual(rolls(res.body.periods[0].present), ['9', '101', '108'], 'natural roll order');
  assert.deepEqual(rolls(res.body.periods[0].absent), ['103']);
  assert.deepEqual(rolls(res.body.periods[1].absent), ['108']);
});

test('Our Class specific period: completion is enforced on the server clock, and the period must be the class’s', async () => {
  const p3 = ourClass('period', `&date=${MONDAY}&period=3`);
  setNow(MONDAY, '10:44');
  assert.equal((await ctx.request('GET', p3, { token: facA.token })).status, 409, 'before the end');
  setNow(MONDAY, '10:45');
  const exact = await ctx.request('GET', p3, { token: facA.token });
  assert.equal(exact.status, 200, 'exactly at the end');
  assert.equal(exact.body.header.facultyName, 'Dr Bala', 'the handling faculty of that period');
  setNow(MONDAY, '11:00');
  assert.equal((await ctx.request('GET', p3, { token: facA.token })).status, 200, 'after the end');

  setNow(MONDAY, '10:20');
  assert.equal((await ctx.request('GET', ourClass('period', `&date=${MONDAY}&period=4`), { token: facA.token })).status, 409, 'future period');
  // P5 exists only in the Sem 6 timetable of section A — not this class's.
  assert.equal((await ctx.request('GET', ourClass('period', `&date=${MONDAY}&period=5`), { token: facA.token })).status, 404);

  // A client clock cannot unlock it.
  for (const extra of ['&now=23:59', '&time=23:59', '&serverTime=23:59', `&timestamp=${encodeURIComponent(new Date().toISOString())}`]) {
    assert.equal((await ctx.request('GET', `${p3}${extra}`, { token: facA.token })).status, 409, extra);
  }
});

test('Current Data: today’s completed periods only — never the running or future one', async () => {
  const res = await ctx.request('GET', ourClass('current'), { token: facA.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.type, 'current');
  assert.equal(res.body.header.date, MONDAY);
  assert.deepEqual(res.body.periods.map((p) => p.period), [1, 2], 'P3 running, P4 future');

  // A client date / clock is ignored: "current" is always the server's today.
  for (const extra of [`&date=${PREV_MONDAY}`, '&now=23:59', '&time=23:59', '&serverTime=23:59', '&timestamp=2026-10-05T23:59:00Z']) {
    const t = await ctx.request('GET', ourClass('current', extra), { token: facA.token });
    assert.equal(t.status, 200, extra);
    assert.equal(t.body.header.date, MONDAY, extra);
    assert.deepEqual(t.body.periods.map((p) => p.period), [1, 2], extra);
  }

  setNow(MONDAY, '11:30'); // P4 has just finished; P3 too
  const later = await ctx.request('GET', ourClass('current'), { token: facA.token });
  assert.deepEqual(later.body.periods.map((p) => p.period), [1, 2, 3]);

  setNow(MONDAY, '08:40'); // nothing finished yet
  const early = await ctx.request('GET', ourClass('current'), { token: facA.token });
  assert.equal(early.status, 409);
  assert.equal(early.body.message, 'No completed periods are available for today.');
  setNow(MONDAY, '10:20');
});

test('Our Class weekly / monthly / semester / custom reports: the class, Σ present ÷ Σ conducted', async () => {
  for (const [type, qs, conducted] of [
    ['weekly', '', 2],
    ['monthly', '', 3],
    ['semester', '', 3],
    ['custom', `&from=${PREV_MONDAY}&to=${PREV_MONDAY}`, 1],
    ['custom', `&from=${PREV_MONDAY}&to=${MONDAY}`, 3],
  ]) {
    const res = await ctx.request('GET', ourClass(type, qs), { token: facA.token });
    assert.equal(res.status, 200, `${type}${qs}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.totals.periodsConducted, conducted, `${type}${qs}`);
    assert.deepEqual(rolls(res.body.students), ['9', '101', '103', '108'], `${type}${qs}`);
    assert.equal(res.body.totals.percentage, Math.round((res.body.totals.present / res.body.totals.total) * 10000) / 100);
  }
  assert.equal((await ctx.request('GET', ourClass('custom'), { token: facA.token })).status, 422, 'custom needs both dates');
});

test('Our Class reports: no parameter moves the report to another class', async () => {
  const tamper = [
    'department=ECE', 'departmentId=ECE', 'programId=ECE', 'section=B', 'sectionId=C', 'year=2', 'semester=6',
    `subjectId=${vlsi._id}`, `subjectId=${aiml._id}&section=B`, `facultyId=${facE.u._id}`, `userId=${stuEce.u._id}`,
    `timetableId=${slot.y2._id}`,
    `attendanceSessionId=${(await ctx.models.AttendanceSession.findOne({ timetableSlot: slot.y2._id }).lean())._id}`,
  ];
  for (const qs of tamper) {
    const res = await ctx.request('GET', ourClass('monthly', `&${qs}`), { token: facA.token });
    assert.equal(res.status, 200, `${qs}: ${JSON.stringify(res.body)}`);
    assert.deepEqual([res.body.header.department, res.body.header.year, res.body.header.section, res.body.header.semester], [CY, 3, 'A', 5], qs);
    assert.deepEqual(rolls(res.body.students), ['9', '101', '103', '108'], qs);
  }
  const none = await ctx.request('GET', ourClass('monthly'), { token: facNone.token });
  assert.equal(none.status, 404);
  assert.equal(none.body.message, 'No class is currently assigned to you as Class In-Charge.');
});

// ── 6. Reports: Handling Class ─────────────────────────────────────

test('Handling Class: subject options and per-subject sections come only from the real assignments', async () => {
  const options = await ctx.request('GET', '/attendance/reports/options', { token: facA.token });
  assert.equal(options.status, 200);
  const bySubject = Object.fromEntries(options.body.subjects.map((s) => [s.code, s.sections]));
  assert.deepEqual(bySubject, { CY501: ['B'], CY502: ['C'] });
  assert.deepEqual(options.body.ourClass && [options.body.ourClass.year, options.body.ourClass.section, options.body.ourClass.semester], [3, 'A', 5]);

  const ok = await ctx.request('GET', `/attendance/reports/period?scope=handling&subjectId=${aiml._id}&section=B&date=${MONDAY}&period=1`, { token: facA.token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(rolls(ok.body.absent), ['201']);

  // Being Class In-Charge of A does not make AI & ML A or Network Security A a Handling Class.
  for (const qs of [
    `subjectId=${aiml._id}&section=A`, `subjectId=${netsec._id}&section=A`, `subjectId=${maths._id}&section=A`,
    `subjectId=${aiml._id}&section=C`, `subjectId=${vlsi._id}&section=A`,
  ]) {
    const res = await ctx.request('GET', `/attendance/reports/date?scope=handling&${qs}&date=${MONDAY}`, { token: facA.token });
    assert.equal(res.status, 403, qs);
  }
  // Handling "All Periods" is the faculty's own periods of that subject/section.
  const allP = await ctx.request('GET', `/attendance/reports/period?scope=handling&subjectId=${netsec._id}&section=C&date=${MONDAY}&period=all`, { token: facA.token });
  assert.equal(allP.status, 200);
  assert.deepEqual(allP.body.periods.map((p) => `${p.period}-${p.section}`), ['2-C']);
});

test('Both scopes work independently for the same faculty member', async () => {
  const [our, handling] = await Promise.all([
    ctx.request('GET', ourClass('date', `&date=${MONDAY}`), { token: facA.token }),
    ctx.request('GET', `/attendance/reports/date?scope=handling&subjectId=${aiml._id}&section=B&date=${MONDAY}`, { token: facA.token }),
  ]);
  assert.deepEqual([...new Set(our.body.periods.map((p) => p.section))], ['A']);
  assert.deepEqual([...new Set(handling.body.periods.map((p) => p.section))], ['B']);
  assert.ok(!our.body.students.some((s) => s.rollNo === '201'));
  assert.ok(!handling.body.students.some((s) => ['9', '101', '103', '108'].includes(s.rollNo)));
});

// ── 7. PDF ─────────────────────────────────────────────────────────

test('PDF (Our Class, All Periods): class identity, each period with its handling faculty, ordered lists, nothing out of scope', async () => {
  const res = await pdf(`${ourClass('period', `&date=${MONDAY}&period=all`)}&format=pdf`, facA.token);
  assert.equal(res.status, 200, res.text);
  for (const expected of [
    'Our Class (Class In-Charge)', 'Class In-Charge: Dr Anitha', CY, '3rd Year', 'Section: A', 'Semester: 5', MONDAY,
    'PERIOD 1', 'PERIOD 2', 'CY501', 'CY502', 'AI & ML', 'Network Security',
    'Handling faculty: Dr Bala', 'Handling faculty: Dr Chitra', '8:30 AM - 9:15 AM', '9:15 AM - 10:00 AM',
    'PRESENT STUDENTS', 'ABSENT STUDENTS', 'Alpha', 'Bravo', 'Charlie', 'Delta',
  ]) {
    assert.ok(res.text.includes(expected), `PDF should contain "${expected}"`);
  }
  assert.ok(!res.text.includes('PERIOD 3'), 'the running period is not in the report');
  for (const outsider of ['Sec B Student', 'Sec C Student', 'Year2 Student', 'Sem6 Student', 'Ece Student']) {
    assert.ok(!res.text.includes(outsider), `${outsider} must not be in the PDF`);
  }
  // Natural order inside period 1's present list: 9, 101, 108.
  const p1 = res.text.slice(res.text.indexOf('PERIOD 1'), res.text.indexOf('PERIOD 2'));
  const present = p1.slice(p1.indexOf('PRESENT STUDENTS'), p1.indexOf('ABSENT STUDENTS'));
  assert.ok(present.indexOf('Delta') < present.indexOf('Alpha') && present.indexOf('Alpha') < present.indexOf('Charlie'), 'natural roll order');
});

test('PDF (Current Data): today’s completed periods only, named as such', async () => {
  const res = await pdf(`${ourClass('current')}&format=pdf`, facA.token);
  assert.equal(res.status, 200, res.text);
  assert.ok(res.text.includes('PERIOD 1') && res.text.includes('PERIOD 2'));
  assert.ok(!res.text.includes('PERIOD 3') && !res.text.includes('PERIOD 4'));
  assert.match(/filename="([^"]+)"/.exec(res.disposition)[1], /^VEXON_Attendance_Current_OurClass_2026-10-05_CSE_Cyber_Security_Y3_A\.pdf$/);

  setNow(MONDAY, '08:40');
  const early = await pdf(`${ourClass('current')}&format=pdf`, facA.token);
  assert.equal(early.status, 409, 'no empty fake report');
  setNow(MONDAY, '10:20');
});

// ── 8. Gate Pass routing is untouched ──────────────────────────────

test('Gate Pass still routes to the faculty by department + section, with in-charge fields present', async () => {
  const body = {
    regarding: 'outing',
    description: 'Visiting family for the weekend',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: inDays(1).slice(0, 10),
    parentPhone: '9800000000',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' },
  };
  const created = await ctx.request('POST', '/gate-pass', { token: alpha.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.section, 'A');

  const mine = await ctx.request('GET', '/gate-pass', { token: facA.token });
  assert.ok(mine.body.passes.some((p) => p._id === created.body._id), 'the section A Class In-Charge receives it');
  const otherSection = await ctx.request('GET', '/gate-pass', { token: facLegacyB.token });
  assert.ok(!otherSection.body.passes.some((p) => p._id === created.body._id), 'section B does not');
});
