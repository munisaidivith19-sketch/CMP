/**
 * Regression tests for the findings of the 2026-10 security audit. Each test
 * reproduces an attack that succeeded before its fix.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, hodCse, facCse, facOther, stuA, stuOther, warden, security, alumni, principal;
let victimSubject;

const H = { 'x-client-platform': 'mobile' }; // mobile sessions: the web idle rule never interferes
const req = (method, path, who, body) => ctx.request(method, path, { token: who.token, body, headers: H });

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginMobile(u)) };
  };
  [admin, hodCse, facCse, facOther, stuA, stuOther, warden, security, alumni, principal] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E1' }),
    mk({ role: 'faculty', name: 'Fac CSE', department: 'CSE', employeeId: 'E2' }),
    mk({ role: 'faculty', name: 'Fac Other', department: 'ECE', employeeId: 'E3' }),
    mk({ name: 'Stu A', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1', parentPhone: '9000000001', stayType: 'hosteler' }),
    mk({ name: 'Stu Other', department: 'ECE', section: 'B', semester: 5, rollNo: 'B1', parentPhone: '9000000002', stayType: 'hosteler' }),
    mk({ role: 'warden', name: 'Warden' }),
    mk({ role: 'security', name: 'Guard' }),
    mk({ role: 'alumni', name: 'Alum' }),
    mk({ role: 'principal', name: 'Principal' }),
  ]);
  victimSubject = await ctx.models.Subject.create({ name: 'Signals', code: 'EC501', department: 'ECE', semester: 5 });
  await ctx.models.AttendanceCorrectionRequest.create({
    student: stuOther.u._id, subject: victimSubject._id, date: new Date('2026-09-01'), period: 1,
    currentStatus: 'absent', requestedStatus: 'present', reason: 'private medical reason',
  });
});
after(async () => {
  await ctx.stop();
});

// ── F1: self-service profile mass assignment ───────────────────────

test('F1: users cannot change their own department, year, roll no, parent phone or stay type', async () => {
  const attempts = [
    [hodCse, { department: 'ECE' }],
    [facCse, { department: 'ECE' }],
    [stuA, { department: 'ECE' }],
    [stuA, { year: 4 }],
    [stuA, { rollNo: 'B1' }],
    [stuA, { parentPhone: '9999999999' }],
    [stuA, { stayType: 'day_scholar' }],
  ];
  for (const [who, body] of attempts) {
    const res = await req('PUT', '/users/me', who, body);
    assert.equal(res.status, 403, `${who.u.role} ${JSON.stringify(body)}`);
  }
  const hod = await ctx.models.User.findById(hodCse.u._id).lean();
  const stu = await ctx.models.User.findById(stuA.u._id).lean();
  assert.equal(hod.department, 'CSE');
  assert.deepEqual([stu.department, stu.year, stu.rollNo, stu.parentPhone, stu.stayType], ['CSE', 3, 'A1', '9000000001', 'hosteler']);

  // Sending the unchanged values (what the profile form does) and editing the
  // real self-service fields still works.
  const ok = await req('PUT', '/users/me', stuA, { name: 'Stu A Renamed', bio: 'hi', department: 'CSE', year: 3, rollNo: 'A1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.name, 'Stu A Renamed');
});

// ── F2: gate pass parent OTP sent to a student-chosen number ───────

test('F2: a gate pass always uses the registered parent number, never one typed by the student', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const res = await req('POST', '/gate-pass', stuA, {
    regarding: 'outing', description: 'Weekend at home', fromDate: day, toDate: day,
    parentPhone: '9123456789', // the student's own phone
    destination: { state: 'TN', district: 'Chennai', area: 'Adyar' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const pass = await ctx.models.GatePass.findById(res.body._id).lean();
  assert.equal(pass.parentPhone, '9000000001');

  // No number on file → refused, rather than trusting the request.
  const noPhone = await ctx.createUser({ name: 'No Phone', department: 'CSE', section: 'A', semester: 5, rollNo: 'A9' });
  const s = await ctx.loginMobile(noPhone);
  const refused = await ctx.request('POST', '/gate-pass', {
    token: s.token, headers: H,
    body: { regarding: 'outing', description: 'Weekend at home', fromDate: day, toDate: day, parentPhone: '9123456789', destination: { state: 'TN', district: 'Chennai', area: 'Adyar' } },
  });
  assert.equal(refused.status, 422);
  await ctx.models.GatePass.deleteMany({ student: stuA.u._id });
});

// ── F3: attendance correction requests readable by any role ────────

test('F3: warden, security and alumni cannot list attendance correction requests', async () => {
  for (const who of [warden, security, alumni]) {
    const res = await req('GET', '/attendance/corrections', who);
    assert.equal(res.status, 403, who.u.role);
  }
  // Out-of-department staff still see nothing; college-wide roles keep access.
  assert.equal((await req('GET', '/attendance/corrections', facCse)).body.requests.length, 0);
  assert.equal((await req('GET', '/attendance/corrections', hodCse)).body.requests.length, 0);
  assert.equal((await req('GET', '/attendance/corrections', principal)).body.requests.length, 1);
});

// ── F4: gate pass list fails open ──────────────────────────────────

test('F4: roles outside the gate-pass workflow cannot list passes; security cannot widen its status scope', async () => {
  const pass = await ctx.models.GatePass.create({
    student: stuOther.u._id, department: 'ECE', section: 'B', regarding: 'outing', description: 'trip',
    destination: { state: 'TN', district: 'Chennai', area: 'Adyar' }, fromDate: new Date(), toDate: new Date(),
    parentPhone: '9000000002', status: 'pending_faculty',
  });
  assert.equal((await req('GET', '/gate-pass', warden)).status, 403);
  const sec = await req('GET', '/gate-pass?status=pending_faculty', security);
  assert.equal(sec.status, 200);
  assert.equal(sec.body.passes.length, 0, 'security only ever sees approved / active / completed passes');
  await ctx.models.GatePass.deleteOne({ _id: pass._id });
});

// ── F5: moderation reports used to delete content beyond the role ──

test('F5: faculty and HOD cannot delete clubs, events or announcements through a moderation report', async () => {
  const club = await ctx.models.Club.create({
    name: 'Robotics Club', slug: 'robotics-club', description: 'A club for building robots together.', category: 'technical',
    status: 'approved', createdBy: admin.u._id, admins: [admin.u._id], members: [admin.u._id],
  });
  const ann = await ctx.models.Announcement.create({ title: 'Exam schedule', content: 'Exams start Monday.', author: admin.u._id, audience: { scope: 'all' } });

  for (const [who, targetType, targetId] of [
    [facCse, 'club', club._id],
    [hodCse, 'announcement', ann._id],
  ]) {
    const filed = await req('POST', '/reports', who, { targetType, targetId: String(targetId), reason: 'spam' });
    assert.equal(filed.status, 201, JSON.stringify(filed.body));
    const resolved = await req('PATCH', `/reports/${filed.body.id}`, who, { action: 'delete' });
    assert.equal(resolved.status, 403, `${who.u.role} deleting a ${targetType}`);
  }
  assert.ok(await ctx.models.Club.exists({ _id: club._id }));
  assert.ok(await ctx.models.Announcement.exists({ _id: ann._id }));

  // An admin still can.
  const report = await ctx.models.Report.findOne({ targetType: 'club', status: 'pending' });
  assert.equal((await req('PATCH', `/reports/${report._id}`, admin, { action: 'delete' })).status, 200);
  assert.equal(await ctx.models.Club.exists({ _id: club._id }), null);
});

// ── F6: low-attendance notices to any student, any text ────────────

test('F6: faculty can only warn students of their own classes, with a bounded message', async () => {
  const res = await req('POST', `/attendance/notify/${stuOther.u._id}`, facCse, { message: 'Click http://evil.example to fix your attendance' });
  assert.equal(res.status, 403);
  assert.equal(await ctx.models.Notification.countDocuments({ user: stuOther.u._id, title: 'Low Attendance Warning' }), 0);

  const long = await req('POST', `/attendance/notify/${stuA.u._id}`, admin, { message: 'x'.repeat(2000) });
  assert.equal(long.status, 422);
});

// ── F7: regex injection in alumni search ───────────────────────────

// Not a finding (every alumni search already escapes its query) — kept as a guard.
test('F7 (guard): alumni search treats the query as text, not as a regular expression', async () => {
  for (const path of ['/alumni?search=(a%2B)%2B%24', '/alumni/jobs?search=(', '/alumni/events?search=[']) {
    const res = await req('GET', path, admin);
    assert.notEqual(res.status, 500, `${path} → ${JSON.stringify(res.body)}`);
  }
});

// ── F8: database-stored uploads could never be served ──────────────

test('F8: files kept in MongoDB are served by their generated name', async () => {
  const filename = '3f2b6c1e-8a4d-4f8e-9c2a-1b2c3d4e5f60.txt';
  await ctx.models.StoredFile.create({ filename, mimeType: 'text/plain', data: Buffer.from('hello') });
  const res = await fetch(`${ctx.base}/uploads/${filename}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hello');
  // Traversal never reaches the filesystem or the database: at most the web
  // app's index page comes back, never a server file.
  for (const p of ['..%2F..%2Fpackage.json', '%2e%2e%2f%2e%2e%2fpackage.json', '..%5C..%5Cpackage.json', 'x%00.txt']) {
    const body = await (await fetch(`${ctx.base}/uploads/${p}`)).text();
    assert.ok(!body.includes('campusconnect-server'), p);
  }
});

// ── F9: stored XSS through alumni-supplied links ───────────────────

test('F9: alumni event and profile links must be http(s) — no javascript: URLs', async () => {
  const soon = new Date(Date.now() + 7 * 86400000);
  const base = {
    title: 'Alumni meetup', type: 'networking', mode: 'online', description: 'An online meetup for alumni and students.',
    startsAt: soon.toISOString(), endsAt: new Date(soon.getTime() + 3600000).toISOString(),
  };
  for (const meetingLink of ['javascript:alert(document.cookie)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', ' javascript:alert(1)']) {
    const res = await req('POST', '/alumni/events', admin, { ...base, meetingLink });
    assert.equal(res.status, 422, meetingLink);
  }
  const ok = await req('POST', '/alumni/events', admin, { ...base, meetingLink: 'https://meet.example.com/abc' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const patched = await req('PATCH', `/alumni/events/${ok.body._id}`, admin, { meetingLink: 'javascript:alert(1)' });
  assert.equal(patched.status, 422);

  const prof = await req('PUT', '/alumni/me', alumni, { linkedin: 'javascript:alert(1)' });
  assert.equal(prof.status, 422);
  const good = await req('PUT', '/alumni/me', alumni, { linkedin: 'https://www.linkedin.com/in/someone' });
  assert.notEqual(good.status, 500);
  assert.doesNotMatch(String(good.body.message || ''), /LinkedIn URL/, JSON.stringify(good.body));
});

// ── F10: self sign-up still open on the API after it was removed from the UI ──

test('F10: public self-registration is disabled — accounts come from the administrator', async () => {
  const res = await ctx.request('POST', '/auth/register', {
    body: { name: 'Intruder', email: 'intruder@jnn.edu.in', password: 'Password123', department: 'CSE', year: 3, rollNo: 'A1' },
  });
  assert.equal(res.status, 403);
  assert.equal(await ctx.models.User.exists({ email: 'intruder@jnn.edu.in' }), null);
});

// ── F-phone: phone numbers accepted free text (incl. markup) ───────

test('phone numbers must be digits/+/spaces/dashes/brackets on self-service and admin edits', async () => {
  for (const phone of ['<script>x</script>', 'call me', '98400{$gt}']) {
    const res = await req('PUT', '/users/me', stuA, { phone });
    assert.equal(res.status, 422, `self ${phone}`);
    const adm = await req('PATCH', `/admin/users/${stuA.u._id}`, admin, { parentPhone: phone });
    assert.equal(adm.status, 422, `admin parentPhone ${phone}`);
  }
  const stu = await ctx.models.User.findById(stuA.u._id).lean();
  assert.equal(stu.parentPhone, '9000000001');

  // Real formats (and clearing the field) still work.
  for (const phone of ['+91 98400 12345', '(044) 2345-6789', '']) {
    const res = await req('PUT', '/users/me', stuA, { phone });
    assert.equal(res.status, 200, `self ${phone}: ${JSON.stringify(res.body)}`);
  }
});
