import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, principal, hodCse, hodSh, faculty1, faculty2, warden, security, student;
let subCseY1, subCseY2A, subCseY2B, subCseY3, subEceY1, subEceY2;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);

  const [a, p, hc, hsh, f1, f2, w, sec, s] = await Promise.all([
    mk({ role: 'admin', name: 'Admin Master' }),
    mk({ role: 'principal', name: 'Principal Master' }),
    mk({ role: 'hod', name: 'HOD CSE Master', department: 'CSE', employeeId: 'E-HOD-CSE-M' }),
    mk({ role: 'hod', name: 'HOD S&H Master', department: 'Science & Humanities', employeeId: 'E-HOD-SH-M' }),
    mk({ role: 'faculty', name: 'Faculty 1', department: 'CSE', employeeId: 'E-FAC-1-M' }),
    mk({ role: 'faculty', name: 'Faculty 2', department: 'ECE', employeeId: 'E-FAC-2-M' }),
    mk({ role: 'warden', name: 'Warden Master', employeeId: 'E-WD-M' }),
    mk({ role: 'security', name: 'Security Master', employeeId: 'E-SEC-M' }),
    mk({ name: 'Student Master', department: 'CSE', section: 'A', semester: 3, rollNo: '01-M' }),
  ]);

  admin = { u: a, ...(await ctx.loginWeb(a)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  hodCse = { u: hc, ...(await ctx.loginWeb(hc)) };
  hodSh = { u: hsh, ...(await ctx.loginWeb(hsh)) };
  faculty1 = { u: f1, ...(await ctx.loginWeb(f1)) };
  faculty2 = { u: f2, ...(await ctx.loginWeb(f2)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  student = { u: s, ...(await ctx.loginWeb(s)) };

  // Subjects across years and departments
  subCseY1 = await ctx.models.Subject.create({
    name: 'Engg Physics',
    code: 'PH101-M',
    department: 'CSE',
    year: 1,
    semester: 1,
    faculty: [f1._id],
    sections: ['A'],
  });

  subCseY2A = await ctx.models.Subject.create({
    name: 'Data Structures',
    code: 'CS301-M',
    department: 'CSE',
    year: 2,
    semester: 3,
    faculty: [f1._id],
    sections: ['A'],
  });

  subCseY2B = await ctx.models.Subject.create({
    name: 'Discrete Math',
    code: 'CS302-M',
    department: 'CSE',
    year: 2,
    semester: 3,
    faculty: [f1._id],
    sections: ['B'],
  });

  subCseY3 = await ctx.models.Subject.create({
    name: 'Operating Systems',
    code: 'CS501-M',
    department: 'CSE',
    year: 3,
    semester: 5,
    faculty: [f1._id],
    sections: ['A'],
  });

  subEceY1 = await ctx.models.Subject.create({
    name: 'Basic Electronics',
    code: 'EC101-M',
    department: 'ECE',
    year: 1,
    semester: 1,
    faculty: [f2._id],
    sections: ['A'],
  });

  subEceY2 = await ctx.models.Subject.create({
    name: 'Signals and Systems',
    code: 'EC301-M',
    department: 'ECE',
    year: 2,
    semester: 3,
    faculty: [f2._id],
    sections: ['A'],
  });

  // Timetable slots
  // 1. CSE Year 1 Monday Period 1 (belonging to S&H purview)
  await ctx.models.TimetableSlot.create({
    subject: subCseY1._id,
    faculty: f1._id,
    department: 'CSE',
    year: 1,
    semester: 1,
    section: 'A',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'LH-101',
    isActive: true,
  });

  // 2. CSE Year 2 Sec A Monday Period 1
  await ctx.models.TimetableSlot.create({
    subject: subCseY2A._id,
    faculty: f1._id,
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'LH-201',
    isActive: true,
  });

  // 3. CSE Year 2 Sec B Monday Period 1
  await ctx.models.TimetableSlot.create({
    subject: subCseY2B._id,
    faculty: f1._id,
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'B',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'LH-202',
    isActive: true,
  });

  // 4. CSE Year 2 Sec A Tuesday Period 2
  await ctx.models.TimetableSlot.create({
    subject: subCseY2A._id,
    faculty: f1._id,
    department: 'CSE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'tuesday',
    period: 2,
    startTime: '10:00',
    endTime: '10:50',
    room: 'LH-201',
    isActive: true,
  });

  // 5. CSE Year 3 Sec A Monday Period 2
  await ctx.models.TimetableSlot.create({
    subject: subCseY3._id,
    faculty: f1._id,
    department: 'CSE',
    year: 3,
    semester: 5,
    section: 'A',
    dayOfWeek: 'monday',
    period: 2,
    startTime: '10:00',
    endTime: '10:50',
    room: 'LH-301',
    isActive: true,
  });

  // 6. ECE Year 1 Monday Period 1 (for S&H HOD cross-dept view)
  await ctx.models.TimetableSlot.create({
    subject: subEceY1._id,
    faculty: f2._id,
    department: 'ECE',
    year: 1,
    semester: 1,
    section: 'A',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'EC-101',
    isActive: true,
  });

  // 7. ECE Year 2 Sec A Monday Period 1 (should never appear for CSE HOD or S&H HOD)
  await ctx.models.TimetableSlot.create({
    subject: subEceY2._id,
    faculty: f2._id,
    department: 'ECE',
    year: 2,
    semester: 3,
    section: 'A',
    dayOfWeek: 'monday',
    period: 1,
    startTime: '09:00',
    endTime: '09:50',
    room: 'EC-201',
    isActive: true,
  });
});

after(async () => {
  await ctx.stop();
});

// ── Access Control ──────────────────────────────────────────────────

test('non-HOD roles (student, faculty, warden, security, admin, principal) get 403 on /timetable/master', async () => {
  for (const actor of [student, faculty1, warden, security, admin, principal]) {
    const res = await ctx.request('GET', '/timetable/master', { token: actor.token });
    assert.equal(res.status, 403, `${actor.u.role} should be forbidden from master timetable`);
  }
});

// ── Branch HOD Access & Scoping ─────────────────────────────────────

test('Branch HOD (CSE) gets master timetable combining Years 2-4 and excluding Year 1 & other departments', async () => {
  const res = await ctx.request('GET', '/timetable/master', { token: hodCse.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.department, 'CSE');
  assert.equal(res.body.isFirstYearHod, false);

  // All returned slots must be CSE and year in [2, 3, 4]
  assert.ok(res.body.slots.length >= 4, `expected at least 4 slots, got ${res.body.slots.length}`);
  for (const s of res.body.slots) {
    assert.equal(s.department, 'CSE');
    assert.ok([2, 3, 4].includes(s.year), `year ${s.year} is not in [2, 3, 4]`);
    assert.notEqual(s.year, 1, 'Year 1 must be excluded for branch HOD');
  }

  // Classes list must contain CSE Year 2 Sec A, Year 2 Sec B, and Year 3 Sec A
  const classLabels = res.body.classes.map((c) => c.label);
  assert.ok(classLabels.some((l) => l.includes('Year 2 · Sec A')));
  assert.ok(classLabels.some((l) => l.includes('Year 2 · Sec B')));
  assert.ok(classLabels.some((l) => l.includes('Year 3 · Sec A')));
  assert.ok(!classLabels.some((l) => l.includes('Year 1')), 'Classes list must not include Year 1');

  // Periods list must contain distinct periods
  assert.ok(res.body.periods.length >= 2);
  const p1 = res.body.periods.find((p) => p.period === 1);
  assert.ok(p1, 'period 1 must exist');
  assert.equal(p1.startTime, '09:00');
  assert.equal(p1.endTime, '09:50');

  // Faculties list
  assert.ok(res.body.faculties.length >= 1);
  const fac = res.body.faculties.find((f) => String(f._id) === String(faculty1.u._id));
  assert.ok(fac, 'faculty 1 must be present in master timetable faculties');
  assert.equal(fac.name, 'Faculty 1');
});

test('Branch HOD query filtering: by year, dayOfWeek, and department spoofing rejection', async () => {
  // 1. Year filter
  const y2Res = await ctx.request('GET', '/timetable/master?year=2', { token: hodCse.token });
  assert.equal(y2Res.status, 200);
  assert.ok(y2Res.body.slots.every((s) => s.year === 2));
  assert.ok(y2Res.body.classes.every((c) => c.year === 2));

  // Year 1 query from branch HOD returns empty schedule (Year 1 is S&H HOD's domain)
  const y1Res = await ctx.request('GET', '/timetable/master?year=1', { token: hodCse.token });
  assert.equal(y1Res.status, 200);
  assert.equal(y1Res.body.slots.length, 0);
  assert.equal(y1Res.body.classes.length, 0);

  // 2. Day of week filter
  const tueRes = await ctx.request('GET', '/timetable/master?dayOfWeek=tuesday', { token: hodCse.token });
  assert.equal(tueRes.status, 200);
  assert.ok(tueRes.body.slots.length >= 1);
  assert.ok(tueRes.body.slots.every((s) => s.dayOfWeek === 'tuesday'));

  // 3. Department spoofing rejection
  const spoofRes = await ctx.request('GET', '/timetable/master?department=ECE', { token: hodCse.token });
  assert.equal(spoofRes.status, 200);
  assert.equal(spoofRes.body.department, 'CSE');
  assert.ok(spoofRes.body.slots.every((s) => s.department === 'CSE'));
});

// ── First-Year S&H HOD Access & Cross-Department Aggregation ─────────

test('First-Year S&H HOD gets master timetable combining Year 1 across branch departments', async () => {
  const res = await ctx.request('GET', '/timetable/master', { token: hodSh.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.isFirstYearHod, true);

  // Must only return Year 1 slots
  assert.ok(res.body.slots.length >= 2, `expected at least 2 Year 1 slots, got ${res.body.slots.length}`);
  for (const s of res.body.slots) {
    assert.equal(s.year, 1, 'S&H HOD master timetable must only return Year 1 slots');
  }

  // Must include Year 1 from both CSE and ECE
  const slotDepts = new Set(res.body.slots.map((s) => s.department));
  assert.ok(slotDepts.has('CSE'), 'S&H HOD should see CSE Year 1');
  assert.ok(slotDepts.has('ECE'), 'S&H HOD should see ECE Year 1');

  // Classes list must contain Year 1 classes from both departments
  const classLabels = res.body.classes.map((c) => c.label);
  assert.ok(classLabels.some((l) => l.includes('CSE · Year 1')));
  assert.ok(classLabels.some((l) => l.includes('ECE · Year 1')));

  // Filtering by department works for S&H HOD
  const cseOnlyRes = await ctx.request('GET', '/timetable/master?department=CSE', { token: hodSh.token });
  assert.equal(cseOnlyRes.status, 200);
  assert.ok(cseOnlyRes.body.slots.length >= 1);
  assert.ok(cseOnlyRes.body.slots.every((s) => s.department === 'CSE' && s.year === 1));
});

// ── Master Timetable PDF Export Tests ─────────────────────────────────

test('non-HOD roles get 403 on /timetable/master/pdf', async () => {
  for (const actor of [student, faculty1, warden, security, admin, principal]) {
    const res = await ctx.request('GET', '/timetable/master/pdf', { token: actor.token });
    assert.equal(res.status, 403, `${actor.u.role} should be forbidden from master timetable PDF export`);
  }
});

test('Branch HOD can export Master Timetable PDF via /timetable/master/pdf and format=pdf', async () => {
  // Test dedicated endpoint /timetable/master/pdf
  const res = await ctx.request('GET', '/timetable/master/pdf?dayOfWeek=monday', { token: hodCse.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.ok(
    res.headers.get('content-disposition')?.includes('Master_Timetable_CSE_Monday.pdf'),
    `unexpected content-disposition: ${res.headers.get('content-disposition')}`
  );
  // Body must begin with PDF magic header %PDF-1.4
  const pdfString = typeof res.body === 'string' ? res.body : res.body.toString('latin1');
  assert.ok(pdfString.startsWith('%PDF-1.4'), 'Exported buffer must be valid PDF 1.4');

  // Test format=pdf on /timetable/master
  const fmtRes = await ctx.request('GET', '/timetable/master?format=pdf&dayOfWeek=tuesday', { token: hodCse.token });
  assert.equal(fmtRes.status, 200);
  assert.match(fmtRes.headers.get('content-type'), /application\/pdf/);
  assert.ok(
    fmtRes.headers.get('content-disposition')?.includes('Master_Timetable_CSE_Tuesday.pdf'),
    `unexpected content-disposition: ${fmtRes.headers.get('content-disposition')}`
  );
});

test('First-Year S&H HOD can export Year 1 cross-department Master Timetable PDF', async () => {
  const res = await ctx.request('GET', '/timetable/master/pdf?dayOfWeek=monday', { token: hodSh.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.ok(
    res.headers.get('content-disposition')?.includes('Master_Timetable_Science_Humanities_Monday.pdf'),
    `unexpected content-disposition: ${res.headers.get('content-disposition')}`
  );
  const pdfString = typeof res.body === 'string' ? res.body : res.body.toString('latin1');
  assert.ok(pdfString.startsWith('%PDF-1.4'), 'Exported buffer must be valid PDF 1.4');
});

