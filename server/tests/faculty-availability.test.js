import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, principal, hodCse, hodSh, facultyCse1, facultyCse2, facultyEce, warden, security, student;
let subCseY2, subCseY3;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);

  const [a, p, hc, hsh, fc1, fc2, fe, w, sec, s] = await Promise.all([
    mk({ role: 'admin', name: 'Admin Avail' }),
    mk({ role: 'principal', name: 'Principal Avail' }),
    mk({ role: 'hod', name: 'HOD CSE Avail', department: 'CSE', employeeId: 'E-HOD-CSE-AV' }),
    mk({ role: 'hod', name: 'HOD S&H Avail', department: 'Science & Humanities', employeeId: 'E-HOD-SH-AV' }),
    mk({ role: 'faculty', name: 'Dr. Suresh CSE', department: 'CSE', employeeId: 'E-FAC-CS1', designation: 'Professor' }),
    mk({ role: 'faculty', name: 'Prof. Anitha CSE', department: 'CSE', employeeId: 'E-FAC-CS2', designation: 'Assistant Professor' }),
    mk({ role: 'faculty', name: 'Dr. Ramesh ECE', department: 'ECE', employeeId: 'E-FAC-EC1', designation: 'Associate Professor' }),
    mk({ role: 'warden', name: 'Warden Avail', employeeId: 'E-WD-AV' }),
    mk({ role: 'security', name: 'Security Avail', employeeId: 'E-SEC-AV' }),
    mk({ name: 'Student Avail', department: 'CSE', section: 'A', semester: 3, rollNo: '01-AV' }),
  ]);

  admin = { u: a, ...(await ctx.loginWeb(a)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  hodCse = { u: hc, ...(await ctx.loginWeb(hc)) };
  hodSh = { u: hsh, ...(await ctx.loginWeb(hsh)) };
  facultyCse1 = { u: fc1, ...(await ctx.loginWeb(fc1)) };
  facultyCse2 = { u: fc2, ...(await ctx.loginWeb(fc2)) };
  facultyEce = { u: fe, ...(await ctx.loginWeb(fe)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  student = { u: s, ...(await ctx.loginWeb(s)) };

  // Subjects
  subCseY2 = await ctx.models.Subject.create({
    name: 'Data Structures',
    code: 'CS201-AV',
    department: 'CSE',
    year: 2,
    semester: 3,
    faculty: [fc1._id],
    sections: ['A'],
  });

  subCseY3 = await ctx.models.Subject.create({
    name: 'Operating Systems',
    code: 'CS301-AV',
    department: 'CSE',
    year: 3,
    semester: 5,
    faculty: [fc2._id],
    sections: ['A'],
  });

  // Monday Slots:
  // Faculty 1 teaches Period 1 (09:00 - 09:50)
  await ctx.models.TimetableSlot.create({
    subject: subCseY2._id,
    faculty: fc1._id,
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'LH-101',
    isActive: true,
  });

  // Faculty 2 teaches Period 2 (10:00 - 10:50)
  await ctx.models.TimetableSlot.create({
    subject: subCseY3._id,
    faculty: fc2._id,
    department: 'CSE',
    year: 3,
    semester: 5,
    section: 'A',
    dayOfWeek: 'monday',
    period: 2,
    startTime: '10:00',
    endTime: '10:50',
    room: 'LH-102',
    isActive: true,
  });

  // Tea Break (10:50 - 11:05)
  await ctx.models.TimetableSlot.create({
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'monday',
    period: 12,
    isBreak: true,
    breakLabel: 'Tea Break',
    startTime: '10:50',
    endTime: '11:05',
    isActive: true,
  });

  // Period 3 (11:05 - 11:55) - Faculty 1 also teaches Period 3
  await ctx.models.TimetableSlot.create({
    subject: subCseY2._id,
    faculty: fc1._id,
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'monday',
    period: 3,
    startTime: '11:05',
    endTime: '11:55',
    room: 'LH-101',
    isActive: true,
  });
});

after(async () => {
  await ctx.stop();
});

// ── Access Control ──────────────────────────────────────────────────

test('non-HOD roles get 403 on /timetable/faculty-availability and /pdf', async () => {
  for (const actor of [student, facultyCse1, warden, security, admin, principal]) {
    const res1 = await ctx.request('GET', '/timetable/faculty-availability', { token: actor.token });
    assert.equal(res1.status, 403, `${actor.u.role} should be forbidden from faculty availability`);

    const res2 = await ctx.request('GET', '/timetable/faculty-availability/pdf', { token: actor.token });
    assert.equal(res2.status, 403, `${actor.u.role} should be forbidden from faculty availability PDF`);
  }
});

// ── Branch HOD Faculty Availability & Stage Schedule ───────────────

test('Branch HOD (CSE) retrieves department faculties with correct free and busy periods', async () => {
  const res = await ctx.request('GET', '/timetable/faculty-availability?dayOfWeek=monday', { token: hodCse.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.department, 'CSE');
  assert.equal(res.body.dayOfWeek, 'monday');

  const { faculties, periods } = res.body;
  assert.ok(faculties.length >= 2, 'Should return at least 2 CSE faculties');

  // Verify only CSE faculties are returned
  assert.ok(faculties.every((f) => f.department === 'CSE'));
  assert.ok(!faculties.some((f) => f.name.includes('ECE')), 'ECE faculty must not appear in CSE HOD availability');

  // Faculty 1 (Dr. Suresh):
  // Period 1: busy (Data Structures)
  // Period 2: free
  // Tea Break: break
  // Period 3: busy (Data Structures)
  const fac1 = faculties.find((f) => String(f._id) === String(facultyCse1.u._id));
  assert.ok(fac1, 'Dr. Suresh must exist');
  assert.equal(fac1.busyPeriods, 2, 'Dr. Suresh should have 2 busy periods');
  assert.equal(fac1.freePeriods, 1, 'Dr. Suresh should have 1 free period (Period 2)');

  const p1Fac1 = fac1.periods.find((p) => p.period === 1);
  assert.equal(p1Fac1.status, 'busy');
  assert.equal(p1Fac1.slot.room, 'LH-101');
  assert.equal(p1Fac1.slot.subject.code, 'CS201-AV');

  const p2Fac1 = fac1.periods.find((p) => p.period === 2);
  assert.equal(p2Fac1.status, 'free');

  // Faculty 2 (Prof. Anitha):
  // Period 1: free
  // Period 2: busy (Operating Systems)
  // Period 3: free
  const fac2 = faculties.find((f) => String(f._id) === String(facultyCse2.u._id));
  assert.ok(fac2, 'Prof. Anitha must exist');
  assert.equal(fac2.busyPeriods, 1);
  assert.equal(fac2.freePeriods, 2);

  const p1Fac2 = fac2.periods.find((p) => p.period === 1);
  assert.equal(p1Fac2.status, 'free');

  const p2Fac2 = fac2.periods.find((p) => p.period === 2);
  assert.equal(p2Fac2.status, 'busy');
  assert.equal(p2Fac2.slot.subject.code, 'CS301-AV');
});

// ── Quick Substitution Filter ───────────────────────────────────────

test('Quick substitution filter: ?period=1 returns only faculties free in Period 1', async () => {
  const res = await ctx.request('GET', '/timetable/faculty-availability?dayOfWeek=monday&period=1', {
    token: hodCse.token,
  });
  assert.equal(res.status, 200);

  // Faculty 1 is busy in Period 1 -> must NOT be in results
  assert.ok(!res.body.faculties.some((f) => String(f._id) === String(facultyCse1.u._id)));

  // Faculty 2 is free in Period 1 -> MUST be in results
  assert.ok(res.body.faculties.some((f) => String(f._id) === String(facultyCse2.u._id)));
});

test('Quick substitution filter: ?period=2 returns only faculties free in Period 2', async () => {
  const res = await ctx.request('GET', '/timetable/faculty-availability?dayOfWeek=monday&period=2', {
    token: hodCse.token,
  });
  assert.equal(res.status, 200);

  // Faculty 1 is free in Period 2 -> MUST be in results
  assert.ok(res.body.faculties.some((f) => String(f._id) === String(facultyCse1.u._id)));

  // Faculty 2 is busy in Period 2 -> must NOT be in results
  assert.ok(!res.body.faculties.some((f) => String(f._id) === String(facultyCse2.u._id)));
});

// ── Faculty Availability PDF Export ─────────────────────────────────

test('Branch HOD can export Faculty Availability PDF via /pdf and format=pdf', async () => {
  const res = await ctx.request('GET', '/timetable/faculty-availability/pdf?dayOfWeek=monday', { token: hodCse.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.ok(
    res.headers.get('content-disposition')?.includes('Faculty_Availability_CSE_Monday.pdf'),
    `unexpected content-disposition: ${res.headers.get('content-disposition')}`
  );
  const pdfString = typeof res.body === 'string' ? res.body : res.body.toString('latin1');
  assert.ok(pdfString.startsWith('%PDF-1.4'), 'Exported buffer must be valid PDF 1.4');

  // Test format=pdf
  const fmtRes = await ctx.request('GET', '/timetable/faculty-availability?format=pdf&dayOfWeek=monday', {
    token: hodCse.token,
  });
  assert.equal(fmtRes.status, 200);
  assert.match(fmtRes.headers.get('content-type'), /application\/pdf/);
});

