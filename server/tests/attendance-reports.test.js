/**
 * Faculty "My Classes", Low Attendance scoping, and the attendance report
 * family (period / particular-date / weekly / monthly / semester) including
 * the generated PDFs.
 *
 * The report assertions read the real PDF back with `unpdf` (already a project
 * dependency, used by the study-material indexer) so the checks are about what
 * the document actually contains, not about what the API was asked for.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const { clock } = await import('../src/utils/clock.js');
const { extractText, getDocumentProxy } = await import('unpdf');

const CSE = 'CSE (Cyber Security)';

// Campus time is Asia/Kolkata (UTC+05:30). 2026-10-05 and 2026-09-28 are Mondays.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utcMinutes = h * 60 + m - 330;
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 0, utcMinutes));
};
const setNow = (date, hhmm) => {
  clock.now = () => at(date, hhmm);
};
const realNow = clock.now;
const day = (d) => new Date(`${d}T00:00:00.000Z`);

const MONDAY = '2026-10-05';
const PREV_MONDAY = '2026-09-28';

let ctx;
let admin, hodCse, hodEce, facNs, facOther, facEce;
let stuA1, stuA2, stuA3, stuA4, stuB1, stuEce;
let subjNs, subjCrypto, subjEce;
let slotNsA, slotNsB, slotCryptoA;
let sessionNsA;

/** Read a PDF response body back to text. */
async function pdfText(res) {
  const pdf = await getDocumentProxy(new Uint8Array(res.body));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Fetch a report as a PDF (the helper's JSON request can't carry bytes). */
async function getPdf(path, token) {
  const res = await fetch(`${ctx.base}/api${path}`, { headers: { authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: buf, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition') };
}

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);

  [admin, hodCse, hodEce, facNs, facOther, facEce, stuA1, stuA2, stuA3, stuA4, stuB1, stuEce] = await Promise.all(
    [
      { role: 'admin', name: 'Admin' },
      { role: 'hod', name: 'HOD CSE', department: CSE, employeeId: 'E-HOD-CSE' },
      { role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HOD-ECE' },
      { role: 'faculty', name: 'Dr Nalini', department: CSE, employeeId: 'E-NS' },
      { role: 'faculty', name: 'Dr Other', department: CSE, employeeId: 'E-OTH' },
      { role: 'faculty', name: 'Dr Ece', department: 'ECE', employeeId: 'E-ECE' },
      // Roll numbers deliberately out of order so the sort is really tested.
      { name: 'Student Charlie', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '108' },
      { name: 'Student Alpha', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '101' },
      { name: 'Student Bravo', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '103' },
      // A single-digit roll number: it must sort before 101, which only a
      // natural (numeric) ordering gets right.
      { name: 'Student Delta', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '9' },
      { name: 'Student SecB', department: CSE, section: 'B', year: 3, semester: 6, rollNo: '201' },
      { name: 'Student Ece', department: 'ECE', section: 'A', year: 3, semester: 6, rollNo: '501' },
    ].map(async (o) => {
      const u = await mk(o);
      return { u, ...(await ctx.loginWeb(u)) };
    })
  );

  const { Subject, TimetableSlot } = ctx.models;
  [subjNs, subjCrypto, subjEce] = await Subject.create([
    { name: 'Network Security', code: 'CS601', department: CSE, semester: 6, year: 3, faculty: [facNs.u._id], sections: ['A', 'C'] },
    { name: 'Cryptography', code: 'CS602', department: CSE, semester: 6, year: 3, faculty: [facNs.u._id], sections: ['A'] },
    { name: 'VLSI Design', code: 'EC601', department: 'ECE', semester: 6, year: 3, faculty: [facEce.u._id], sections: ['A'] },
  ]);

  const base = { dayOfWeek: 'monday', semester: 6, year: 3, isActive: true };
  [slotNsA, slotNsB, slotCryptoA] = await TimetableSlot.create([
    { ...base, subject: subjNs._id, faculty: facNs.u._id, department: CSE, section: 'A', period: 1, startTime: '08:30', endTime: '09:15', room: 'LH-1' },
    { ...base, subject: subjNs._id, faculty: facOther.u._id, department: CSE, section: 'B', period: 1, startTime: '08:30', endTime: '09:15' },
    { ...base, subject: subjCrypto._id, faculty: facNs.u._id, department: CSE, section: 'A', period: 2, startTime: '09:15', endTime: '10:00' },
  ]);
  await TimetableSlot.create({ ...base, subject: subjEce._id, faculty: facEce.u._id, department: 'ECE', section: 'A', period: 1, startTime: '08:30', endTime: '09:15' });

  // Attendance for NS/CSE-A on two Mondays, taken through the API during the
  // live period so the sessions are created exactly as they are in production.
  for (const date of [PREV_MONDAY, MONDAY]) {
    setNow(date, '08:45');
    const res = await ctx.request('POST', '/attendance/mark', {
      token: facNs.token,
      body: {
        slotId: String(slotNsA._id),
        records: [
          { student: String(stuA1.u._id), status: 'present' }, // roll 108
          { student: String(stuA2.u._id), status: 'present' }, // roll 101
          { student: String(stuA3.u._id), status: date === MONDAY ? 'absent' : 'present' }, // roll 103
        ],
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  sessionNsA = await ctx.models.AttendanceSession.findOne({ timetableSlot: slotNsA._id, date: day(MONDAY) }).lean();

  // Section B's own class, marked by the other faculty member — the data a
  // cross-section leak would expose.
  setNow(MONDAY, '08:45');
  const b = await ctx.request('POST', '/attendance/mark', {
    token: facOther.token,
    body: { slotId: String(slotNsB._id), records: [{ student: String(stuB1.u._id), status: 'absent' }] },
  });
  assert.equal(b.status, 200, JSON.stringify(b.body));

  setNow(MONDAY, '12:00');
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

// ── §59 Faculty attendance: My Classes and Low Attendance ──────────

test('My Classes: the subject options are only the faculty’s real assignments, with per-subject sections', async () => {
  const res = await ctx.request('GET', '/attendance/my-classes/options', { token: facNs.token });
  assert.equal(res.status, 200);
  const codes = res.body.subjects.map((s) => s.code).sort();
  assert.deepEqual(codes, ['CS601', 'CS602'], 'never the whole college catalogue');

  const ns = res.body.subjects.find((s) => s.code === 'CS601');
  assert.deepEqual(ns.sections, ['A'], 'Network Security section B belongs to another faculty member');
  const crypto = res.body.subjects.find((s) => s.code === 'CS602');
  assert.deepEqual(crypto.sections, ['A']);
  assert.ok(!res.body.subjects.some((s) => s.code === 'EC601'));
});

test('My Classes: an authorized subject + section returns that exact class with correct percentages', async () => {
  const res = await ctx.request('GET', `/attendance/my-classes?subjectId=${subjNs._id}&section=A`, { token: facNs.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.class.department, CSE);
  assert.equal(res.body.class.year, 3);
  assert.equal(res.body.class.section, 'A');
  assert.equal(res.body.class.semester, 6);
  assert.equal(res.body.overall.classesConducted, 2);

  const byRoll = Object.fromEntries(res.body.students.map((s) => [s.rollNo, s]));
  assert.deepEqual(res.body.students.map((s) => s.rollNo), ['9', '101', '103', '108'], 'roll numbers sort naturally, not as text');
  assert.ok(!res.body.students.some((s) => s.section === 'B'), 'never another section');

  // Roll 103 was present once of two conducted periods.
  assert.equal(byRoll['103'].totalPeriods, 2);
  assert.equal(byRoll['103'].presentPeriods, 1);
  assert.equal(byRoll['103'].absentPeriods, 1);
  assert.equal(byRoll['103'].percentage, 50);
  assert.equal(byRoll['101'].percentage, 100);
  // Every row carries the academic context the table shows.
  for (const s of res.body.students) assert.ok(s.name && s.department && s.year && s.section);
});

test('My Classes: subjectId / sectionId / facultyId manipulation is refused, not silently redirected', async () => {
  // Another faculty member's section of a subject this faculty does teach.
  const otherSection = await ctx.request('GET', `/attendance/my-classes?subjectId=${subjNs._id}&section=B`, { token: facNs.token });
  assert.equal(otherSection.status, 403);

  // A subject they do not teach at all, and one from another department.
  for (const subject of [subjEce._id]) {
    const res = await ctx.request('GET', `/attendance/my-classes?subjectId=${subject}&section=A`, { token: facNs.token });
    assert.equal(res.status, 403);
  }

  // Extra parameters cannot graft on another scope.
  const spoofed = await ctx.request(
    'GET',
    `/attendance/my-classes?subjectId=${subjNs._id}&section=A&department=ECE&year=2&semester=4&facultyId=${facOther.u._id}`,
    { token: facNs.token }
  );
  assert.equal(spoofed.status, 200);
  assert.equal(spoofed.body.class.department, CSE, 'the class comes from the assignment, not the query');
  assert.equal(spoofed.body.class.year, 3);
  assert.ok(spoofed.body.students.every((s) => s.section === 'A'));

  // My Classes belongs to faculty accounts only.
  assert.equal((await ctx.request('GET', `/attendance/my-classes?subjectId=${subjNs._id}&section=A`, { token: hodCse.token })).status, 403);
});

test('Low Attendance: a faculty account sees only their assigned classes, and no section parameter widens it', async () => {
  const mine = await ctx.request('GET', '/attendance/low?range=all', { token: facNs.token });
  assert.equal(mine.status, 200);
  const got = mine.body.students.map((r) => r.student.name);
  assert.ok(got.includes('Student Bravo'), 'the 50% student of their own class');
  assert.ok(!got.includes('Student SecB'), 'never section B, whose attendance belongs to another faculty member');

  for (const qs of ['section=B', `department=${encodeURIComponent(CSE)}&section=B`, 'department=ECE', `subject=${subjEce._id}`]) {
    const res = await ctx.request('GET', `/attendance/low?range=all&${qs}`, { token: facNs.token });
    assert.equal(res.status, 200, qs);
    assert.ok(!res.body.students.some((r) => ['Student SecB', 'Student Ece'].includes(r.student.name)), `${qs} must not widen the scope`);
  }

  // The same leak through the other read endpoints.
  const sectionView = await ctx.request('GET', '/attendance/section?range=all&section=B', { token: facNs.token });
  assert.deepEqual(sectionView.body.subjects, []);
  const records = await ctx.request('GET', '/attendance/records?range=all&section=B', { token: facNs.token });
  assert.deepEqual(records.body.records, []);
  const otherStudent = await ctx.request('GET', `/attendance/student/${stuB1.u._id}`, { token: facNs.token });
  assert.equal(otherStudent.status, 403);
});

test('Low Attendance: an HOD stays inside their own department whatever they send', async () => {
  const own = await ctx.request('GET', '/attendance/low?range=all', { token: hodCse.token });
  assert.ok(own.body.students.every((r) => r.student.department === CSE));
  assert.ok(own.body.students.some((r) => r.student.name === 'Student SecB'), 'an HOD does see the whole department');

  const bypass = await ctx.request('GET', '/attendance/low?range=all&department=ECE', { token: hodCse.token });
  assert.ok(bypass.body.students.every((r) => r.student.department === CSE), 'a sent department cannot overwrite the scope');

  const eceHod = await ctx.request('GET', `/attendance/low?range=all&department=${encodeURIComponent(CSE)}`, { token: hodEce.token });
  assert.deepEqual(eceHod.body.students, [], 'the ECE HOD sees no CSE student');
});

test('Attendance %: it is present periods ÷ conducted periods, never an average of percentages', async () => {
  const res = await ctx.request('GET', `/attendance/my-classes?subjectId=${subjNs._id}&section=A`, { token: facNs.token });
  const { presentPeriods, totalPeriods, percentage } = res.body.overall;
  assert.equal(totalPeriods, 6, '3 marked students x 2 periods');
  assert.equal(presentPeriods, 5);
  assert.equal(percentage, Math.round((5 / 6) * 10000) / 100);
});

// ── §60 Period report: server time is authoritative ────────────────

const periodUrl = (extra = '') => `/attendance/reports/period?subjectId=${subjNs._id}&section=A&date=${MONDAY}&period=1${extra}`;

test('Period report: blocked before the period ends, available after — on the server clock', async () => {
  setNow(MONDAY, '08:40'); // inside 08:30–09:15
  const during = await ctx.request('GET', periodUrl(), { token: facNs.token });
  assert.equal(during.status, 409);
  assert.match(during.body.message, /ends at 09:15/);

  setNow(MONDAY, '09:14');
  assert.equal((await ctx.request('GET', periodUrl(), { token: facNs.token })).status, 409, 'one minute before the end is still closed');

  setNow(MONDAY, '09:15');
  const done = await ctx.request('GET', periodUrl(), { token: facNs.token });
  assert.equal(done.status, 200, 'available from the end time itself');
  assert.equal(done.body.totals.total, 3);
});

test('Period report: a faked client timestamp cannot unlock a period that has not finished', async () => {
  setNow(MONDAY, '08:40');
  for (const extra of ['&now=23:59', `&now=${encodeURIComponent(new Date().toISOString())}`, '&time=23:59', '&serverTime=23:59']) {
    const res = await ctx.request('GET', periodUrl(extra), { token: facNs.token });
    assert.equal(res.status, 409, `a client-sent ${extra} must change nothing`);
  }
  // A future date is refused outright rather than reported as empty.
  const future = await ctx.request('GET', `/attendance/reports/period?subjectId=${subjNs._id}&section=A&date=2026-10-12&period=1`, { token: facNs.token });
  assert.equal(future.status, 422);
  setNow(MONDAY, '12:00');
});

test('Period report: present and absent lists are correct and both sorted by roll number', async () => {
  const res = await ctx.request('GET', periodUrl(), { token: facNs.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.present.map((s) => s.rollNo), ['101', '108'], 'present, ascending by roll number');
  assert.deepEqual(res.body.absent.map((s) => s.rollNo), ['103'], 'absent, ascending by roll number');
  assert.deepEqual(res.body.totals, { present: 2, absent: 1, total: 3, percentage: 66.67 });

  const h = res.body.header;
  assert.equal(h.department, CSE);
  assert.equal(h.year, 3);
  assert.equal(h.section, 'A');
  assert.equal(h.semester, 6);
  assert.equal(h.subjectCode, 'CS601');
  assert.equal(h.period, 1);
  assert.equal(h.startTime, '08:30');
  assert.equal(h.endTime, '09:15');
  assert.equal(h.facultyName, 'Dr Nalini');
  assert.equal(h.date, MONDAY);
});

test('Reports: a faculty account cannot generate another section’s, subject’s, department’s or colleague’s report', async () => {
  const cases = [
    ['another section of their own subject', `subjectId=${subjNs._id}&section=B&date=${MONDAY}&period=1`],
    ['another department’s subject', `subjectId=${subjEce._id}&section=A&date=${MONDAY}&period=1`],
    ['a subject with a spoofed department', `subjectId=${subjEce._id}&section=A&department=${encodeURIComponent(CSE)}&date=${MONDAY}&period=1`],
  ];
  for (const [label, qs] of cases) {
    for (const type of ['period', 'date', 'weekly', 'monthly', 'semester']) {
      const res = await ctx.request('GET', `/attendance/reports/${type}?${qs}`, { token: facNs.token });
      assert.equal(res.status, 403, `${type}: ${label}`);
    }
  }

  // The colleague's own class, requested with their faculty id attached.
  const spoofFaculty = await ctx.request(
    'GET',
    `/attendance/reports/period?subjectId=${subjNs._id}&section=B&period=1&date=${MONDAY}&facultyId=${facOther.u._id}&faculty=${facOther.u._id}`,
    { token: facNs.token }
  );
  assert.equal(spoofFaculty.status, 403);

  // Faculty must name a class at all — there is no "everything" report.
  assert.equal((await ctx.request('GET', '/attendance/reports/weekly', { token: facNs.token })).status, 422);
  assert.equal((await ctx.request('GET', `/attendance/reports/weekly?subjectId=${subjNs._id}`, { token: facNs.token })).status, 422);
});

test('Reports: a report never contains a period belonging to another faculty member', async () => {
  // Section A period 1 is Dr Nalini's; Dr Other teaches section B at the same
  // time. Dr Other's own date report must hold only their section B period.
  const res = await ctx.request('GET', `/attendance/reports/date?subjectId=${subjNs._id}&section=B&date=${MONDAY}`, { token: facOther.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.periods.every((p) => p.section === 'B' && p.facultyName === 'Dr Other'));
  assert.ok(res.body.students.every((s) => s.section === 'B'));
  assert.ok(!res.body.students.some((s) => ['101', '103', '108'].includes(s.rollNo)));
});

// ── Particular-date / weekly / monthly / semester ──────────────────

test('Particular-date report: every finished period of the day, with present and absent lists', async () => {
  const res = await ctx.request('GET', `/attendance/reports/date?subjectId=${subjNs._id}&section=A&date=${MONDAY}`, { token: facNs.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.periods.length, 1);
  const p = res.body.periods[0];
  assert.equal(p.period, 1);
  assert.equal(p.subjectCode, 'CS601');
  assert.deepEqual(p.present.map((s) => s.rollNo), ['101', '108']);
  assert.deepEqual(p.absent.map((s) => s.rollNo), ['103']);
  assert.deepEqual(res.body.students.map((s) => s.rollNo), ['101', '103', '108'], 'day totals ordered by roll number');
  assert.equal(res.body.totals.periodsConducted, 1);
});

test('Particular-date report: a period still running today is not included', async () => {
  setNow(MONDAY, '08:40');
  const res = await ctx.request('GET', `/attendance/reports/date?subjectId=${subjNs._id}&section=A&date=${MONDAY}`, { token: facNs.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.periods, [], 'the 08:30–09:15 period has not finished on the server clock');
  setNow(MONDAY, '12:00');
});

test('Weekly / monthly / semester reports: conducted, present, absent and percentage per student', async () => {
  const weekly = await ctx.request('GET', `/attendance/reports/weekly?subjectId=${subjNs._id}&section=A`, { token: facNs.token });
  assert.equal(weekly.status, 200);
  assert.equal(weekly.body.totals.periodsConducted, 1, 'only this Monday falls in the last 7 days');
  const wByRoll = Object.fromEntries(weekly.body.students.map((s) => [s.rollNo, s]));
  assert.deepEqual(weekly.body.students.map((s) => s.rollNo), ['9', '101', '103', '108']);
  assert.equal(wByRoll['9'].totalPeriods, 0, 'a student with no record still appears, at 0');
  assert.equal(wByRoll['103'].totalPeriods, 1);
  assert.equal(wByRoll['103'].percentage, 0);
  assert.equal(wByRoll['101'].percentage, 100);
  // The period-level breakdown is available when the report is opened.
  assert.equal(weekly.body.sessions.length, 1);
  assert.equal(weekly.body.sessions[0].period, 1);

  for (const type of ['monthly', 'semester']) {
    const res = await ctx.request('GET', `/attendance/reports/${type}?subjectId=${subjNs._id}&section=A`, { token: facNs.token });
    assert.equal(res.status, 200, type);
    assert.equal(res.body.totals.periodsConducted, 2, `${type} covers both Mondays`);
    const byRoll = Object.fromEntries(res.body.students.map((s) => [s.rollNo, s]));
    assert.equal(byRoll['103'].totalPeriods, 2);
    assert.equal(byRoll['103'].presentPeriods, 1);
    assert.equal(byRoll['103'].absentPeriods, 1);
    assert.equal(byRoll['103'].percentage, 50);
    assert.deepEqual(res.body.students.map((s) => s.rollNo), ['9', '101', '103', '108']);
    assert.ok(res.body.students.every((s) => s.department === CSE && s.year === 3 && s.section === 'A'));
  }
});

// ── §34–39 HOD reports ─────────────────────────────────────────────

test('HOD reports: own department, with year / section / semester filtering', async () => {
  const res = await ctx.request('GET', `/attendance/reports/date?date=${MONDAY}&year=3&section=A&semester=6`, { token: hodCse.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.header.department, CSE, 'the department comes from the account, not the request');
  assert.equal(res.body.header.section, 'A');
  assert.ok(res.body.periods.length >= 1);
  assert.ok(res.body.students.every((s) => s.section === 'A'));

  const secB = await ctx.request('GET', `/attendance/reports/date?date=${MONDAY}&year=3&section=B&semester=6`, { token: hodCse.token });
  assert.equal(secB.status, 200);
  assert.ok(secB.body.students.every((s) => s.section === 'B'), 'an HOD may look across their own sections');

  const monthly = await ctx.request('GET', '/attendance/reports/monthly?year=3&section=A&semester=6', { token: hodCse.token });
  assert.equal(monthly.status, 200);
  assert.equal(monthly.body.totals.periodsConducted, 2);
});

test('HOD reports: no parameter reaches another department', async () => {
  for (const type of ['period', 'date', 'weekly', 'monthly', 'semester']) {
    const res = await ctx.request(
      'GET',
      `/attendance/reports/${type}?department=ECE&year=3&section=A&semester=6&date=${MONDAY}&period=1`,
      { token: hodEce.token }
    );
    // The ECE HOD is confined to ECE, so a CSE class is simply not in scope.
    if (res.status === 200) {
      assert.equal(res.body.header.department, 'ECE', type);
      assert.ok((res.body.students || []).every((s) => s.department === 'ECE'), type);
    } else {
      assert.ok([404, 409, 422].includes(res.status), `${type} → ${res.status}`);
    }
  }

  // A CSE subject id handed to the ECE HOD is refused outright.
  const spoof = await ctx.request('GET', `/attendance/reports/monthly?subjectId=${subjNs._id}&section=A`, { token: hodEce.token });
  assert.equal(spoof.status, 403);

  const cseHodIntoEce = await ctx.request('GET', `/attendance/reports/monthly?subjectId=${subjEce._id}&section=A`, { token: hodCse.token });
  assert.equal(cseHodIntoEce.status, 403);
});

test('HOD reports: a period report is blocked until the period has finished', async () => {
  setNow(MONDAY, '08:40');
  const early = await ctx.request('GET', `/attendance/reports/period?date=${MONDAY}&period=1&year=3&section=A&semester=6`, { token: hodCse.token });
  assert.equal(early.status, 409);
  setNow(MONDAY, '09:15');
  const after = await ctx.request('GET', `/attendance/reports/period?date=${MONDAY}&period=1&year=3&section=A&semester=6`, { token: hodCse.token });
  assert.equal(after.status, 200);
  assert.equal(after.body.totals.total, 3);
  setNow(MONDAY, '12:00');
});

test('Reports: students and other roles cannot generate them at all', async () => {
  for (const actor of [stuA1, stuEce]) {
    const res = await ctx.request('GET', `/attendance/reports/monthly?subjectId=${subjNs._id}&section=A`, { token: actor.token });
    assert.equal(res.status, 403);
  }
});

// ── §61 PDF output ─────────────────────────────────────────────────

test('PDF: the period report contains the academic header and correctly ordered Present / Absent sections', async () => {
  const res = await getPdf(`${periodUrl()}&format=pdf`, facNs.token);
  assert.equal(res.status, 200);
  assert.equal(res.type, 'application/pdf');
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');

  const text = await pdfText(res);
  for (const expected of [
    'Network Security', 'CS601', CSE, '3rd Year', 'Section: A', 'Semester: 6',
    'Dr Nalini', MONDAY, 'PRESENT STUDENTS (2)', 'ABSENT STUDENTS (1)',
    'Student Alpha', 'Student Charlie', 'Student Bravo', '8:30 AM - 9:15 AM',
  ]) {
    assert.ok(text.includes(expected), `the PDF should contain "${expected}"`);
  }

  // Ordering inside each section is by roll number.
  const present = text.slice(text.indexOf('PRESENT STUDENTS'), text.indexOf('ABSENT STUDENTS'));
  assert.ok(present.indexOf('101') < present.indexOf('108'), 'present list sorted by roll number');
  const absent = text.slice(text.indexOf('ABSENT STUDENTS'));
  assert.ok(absent.includes('103') && absent.includes('Student Bravo'));
  // Present and absent students never appear in the wrong section.
  assert.ok(!present.includes('Student Bravo'));
  assert.ok(!absent.includes('Student Alpha'));

  // No unauthorized student reaches the document.
  assert.ok(!text.includes('Student SecB') && !text.includes('Student Ece'));
});

test('PDF: the download filename names the academic scope and nothing sensitive', async () => {
  const res = await getPdf(`${periodUrl()}&format=pdf`, facNs.token);
  const name = /filename="([^"]+)"/.exec(res.disposition)[1];
  assert.match(name, /^VEXON_Attendance_Period_2026-10-05_CSE_Cyber_Security_Y3_A_P1\.pdf$/);
  assert.ok(!/Student|Alpha|101/.test(name), 'no student detail in the filename');
  // Nothing a client sends can steer the name towards a path.
  const traversal = await getPdf(`${periodUrl()}&format=pdf&filename=../../etc/passwd`, facNs.token);
  assert.ok(!/\.\.|\//.test(/filename="([^"]+)"/.exec(traversal.disposition)[1]));
});

test('PDF: the summary reports carry per-student totals and the period breakdown', async () => {
  const res = await getPdf(`/attendance/reports/monthly?subjectId=${subjNs._id}&section=A&format=pdf`, facNs.token);
  assert.equal(res.status, 200);
  const text = await pdfText(res);
  for (const expected of ['Monthly Attendance Report', 'ATTENDANCE BY STUDENT', 'PERIODS CONDUCTED', 'Student Bravo', '50%', '100%', MONDAY, PREV_MONDAY]) {
    assert.ok(text.includes(expected), `the PDF should contain "${expected}"`);
  }
  assert.ok(!text.includes('Student SecB'));
});

test('PDF: an HOD’s report is generated for their own department only', async () => {
  const res = await getPdf(`/attendance/reports/date?date=${MONDAY}&year=3&section=B&semester=6&format=pdf`, hodCse.token);
  assert.equal(res.status, 200);
  const text = await pdfText(res);
  assert.ok(text.includes('Student SecB'));
  assert.ok(!text.includes('Student Alpha'), 'section A is not part of a section B report');
  assert.ok(!text.includes('Student Ece'));
});
