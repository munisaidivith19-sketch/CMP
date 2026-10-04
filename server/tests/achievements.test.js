import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let studentCse;
let studentEce;
let faculty;
let hodCse;
let hodEce;
let principal;
let admin;
let warden;

before(async () => {
  ctx = await startServer();
  const [s1, s2, f, h1, h2, p, a, w] = await Promise.all([
    ctx.createUser({ name: 'CSE Student', department: 'CSE', section: 'A', rollNo: 'CSE01' }),
    ctx.createUser({ name: 'ECE Student', department: 'ECE', section: 'B', rollNo: 'ECE01' }),
    ctx.createUser({ role: 'faculty', name: 'Faculty Member', department: 'CSE' }),
    ctx.createUser({ role: 'hod', name: 'HOD CSE', department: 'CSE' }),
    ctx.createUser({ role: 'hod', name: 'HOD ECE', department: 'ECE' }),
    ctx.createUser({ role: 'principal', name: 'College Principal' }),
    ctx.createUser({ role: 'admin', name: 'System Admin' }),
    ctx.createUser({ role: 'warden', name: 'Hostel Warden' }),
  ]);

  studentCse = { u: s1, ...(await ctx.loginWeb(s1)) };
  studentEce = { u: s2, ...(await ctx.loginWeb(s2)) };
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  hodCse = { u: h1, ...(await ctx.loginWeb(h1)) };
  hodEce = { u: h2, ...(await ctx.loginWeb(h2)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
});

after(async () => {
  await ctx.stop();
});

test('Posting permissions: students, faculty and admin cannot post achievements', async () => {
  const payload = {
    title: 'Hackathon Winner',
    description: 'Won 1st prize in national AI hackathon',
    category: 'technical',
    level: 'national',
    position: 'winner',
    achievedOn: '2026-05-10',
    students: [studentCse.u._id],
  };

  const resStudent = await ctx.request('POST', '/achievements', { token: studentCse.token, body: payload });
  assert.equal(resStudent.status, 403, 'Student should be forbidden from posting');

  const resFaculty = await ctx.request('POST', '/achievements', { token: faculty.token, body: payload });
  assert.equal(resFaculty.status, 403, 'Faculty should be forbidden from posting');

  const resAdmin = await ctx.request('POST', '/achievements', { token: admin.token, body: payload });
  assert.equal(resAdmin.status, 403, 'Admin should be forbidden from posting (moderate only)');
});

test('Department scoping: HOD cannot tag students outside their department', async () => {
  const payload = {
    title: 'Inter-College Coding Cup',
    description: 'Winner of algorithmic coding contest',
    category: 'technical',
    level: 'state',
    position: 'winner',
    achievedOn: '2026-06-01',
    students: [studentEce.u._id], // ECE student tagged by CSE HOD
  };

  const res = await ctx.request('POST', '/achievements', { token: hodCse.token, body: payload });
  assert.equal(res.status, 403, 'HOD CSE must not be allowed to post for ECE student');
});

test('Valid creation: HOD posts for own department student', async () => {
  const payload = {
    title: 'Smart India Hackathon 2026 Winner',
    description: 'Secured 1st rank with 1 lakh cash prize in national finale',
    category: 'technical',
    level: 'national',
    position: 'winner',
    eventName: 'Smart India Hackathon',
    organizer: 'AICTE',
    achievedOn: '2026-08-15',
    students: [studentCse.u._id],
  };

  const res = await ctx.request('POST', '/achievements', { token: hodCse.token, body: payload });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, payload.title);
  assert.equal(res.body.departments[0], 'CSE');
  assert.equal(res.body.canEdit, true);

  // Check auto-announcement was created
  const Announcement = ctx.models.Announcement;
  const ann = await Announcement.findOne({ title: { $regex: 'Smart India Hackathon' } });
  assert.ok(ann, 'Announcement feed entry should be created automatically');

  // Check notification to tagged student
  const Notification = ctx.models.Notification;
  const notif = await Notification.findOne({ user: studentCse.u._id, type: 'achievement' });
  assert.ok(notif, 'Student should receive an in-app notification');
});

test('Principal can post across any department (multi-student team)', async () => {
  const payload = {
    title: 'Robotics Olympiad Gold Medal',
    description: 'Interdisciplinary team achieved Gold Medal at World Robotics League',
    category: 'competition',
    level: 'international',
    position: 'winner',
    achievedOn: '2026-09-01',
    students: [studentCse.u._id, studentEce.u._id],
  };

  const res = await ctx.request('POST', '/achievements', { token: principal.token, body: payload });
  assert.equal(res.status, 201);
  assert.equal(res.body.students.length, 2);
  assert.deepEqual(res.body.departments.sort(), ['CSE', 'ECE'].sort());
});

test('Input validations: future date and student limits', async () => {
  const futurePayload = {
    title: 'Future Award',
    description: 'Cannot happen in future',
    category: 'academic',
    level: 'college',
    achievedOn: '2030-01-01',
    students: [studentCse.u._id],
  };
  const resFuture = await ctx.request('POST', '/achievements', { token: principal.token, body: futurePayload });
  assert.equal(resFuture.status, 422, 'Future date must be rejected');

  const emptyStudents = {
    title: 'No Students',
    description: 'Missing students array',
    category: 'academic',
    level: 'college',
    achievedOn: '2026-01-01',
    students: [],
  };
  const resEmpty = await ctx.request('POST', '/achievements', { token: principal.token, body: emptyStudents });
  assert.equal(resEmpty.status, 422, 'Empty students array must be rejected');
});

test('Congratulate reaction: toggles count and user state', async () => {
  const createRes = await ctx.request('POST', '/achievements', {
    token: principal.token,
    body: {
      title: 'Best Paper Award',
      description: 'Published in IEEE Transactions',
      category: 'research',
      level: 'international',
      position: 'published',
      achievedOn: '2026-07-01',
      students: [studentCse.u._id],
    },
  });
  const id = createRes.body._id;

  // First congratulate
  const res1 = await ctx.request('POST', `/achievements/${id}/congratulate`, { token: studentEce.token });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.congratulated, true);
  assert.equal(res1.body.congratulationCount, 1);

  // Toggle off
  const res2 = await ctx.request('POST', `/achievements/${id}/congratulate`, { token: studentEce.token });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.congratulated, false);
  assert.equal(res2.body.congratulationCount, 0);
});

test('Student privacy opt-out: request hide and manager approval', async () => {
  const createRes = await ctx.request('POST', '/achievements', {
    token: principal.token,
    body: {
      title: 'Private Competition Result',
      description: 'A student who prefers privacy',
      category: 'other',
      level: 'college',
      achievedOn: '2026-08-01',
      students: [studentCse.u._id, studentEce.u._id],
    },
  });
  const id = createRes.body._id;

  // Student CSE submits hide request
  const hideRes = await ctx.request('POST', `/achievements/${id}/hide-request`, {
    token: studentCse.token,
    body: { reason: 'Prefer not to be showcased publicly.' },
  });
  assert.equal(hideRes.status, 201);

  // Check duplicate request is rejected with 409
  const dupRes = await ctx.request('POST', `/achievements/${id}/hide-request`, {
    token: studentCse.token,
    body: { reason: 'Another attempt' },
  });
  assert.equal(dupRes.status, 409);

  // Non-featured user cannot request hide
  const outsiderRes = await ctx.request('POST', `/achievements/${id}/hide-request`, {
    token: faculty.token,
    body: { reason: 'I am not even a student' },
  });
  assert.equal(outsiderRes.status, 403);

  // Fetch achievement details as poster to get the request id
  const detailRes = await ctx.request('GET', `/achievements/${id}`, { token: principal.token });
  assert.equal(detailRes.body.hideRequests.length, 1);
  const reqId = detailRes.body.hideRequests[0]._id;

  // Principal approves hide request
  const resolveRes = await ctx.request('PATCH', `/achievements/${id}/hide-request/${reqId}`, {
    token: principal.token,
    body: { action: 'approve' },
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.status, 'approved');

  // Verify student CSE was removed from achievement
  const updated = await ctx.models.Achievement.findById(id);
  assert.equal(updated.students.length, 1);
  assert.equal(String(updated.students[0]), String(studentEce.u._id));
});

test('Soft delete and Admin restore', async () => {
  const createRes = await ctx.request('POST', '/achievements', {
    token: principal.token,
    body: {
      title: 'Provisional Record',
      description: 'Will be deleted',
      category: 'academic',
      level: 'college',
      achievedOn: '2026-08-10',
      students: [studentCse.u._id],
    },
  });
  const id = createRes.body._id;

  // Admin deletes
  const delRes = await ctx.request('DELETE', `/achievements/${id}`, { token: admin.token });
  assert.equal(delRes.status, 200);

  // Normal user cannot get deleted achievement
  const getRes = await ctx.request('GET', `/achievements/${id}`, { token: studentCse.token });
  assert.equal(getRes.status, 404);

  // Admin can restore
  const restoreRes = await ctx.request('POST', `/achievements/${id}/restore`, { token: admin.token });
  assert.equal(restoreRes.status, 200);

  // Accessible again
  const getAgain = await ctx.request('GET', `/achievements/${id}`, { token: studentCse.token });
  assert.equal(getAgain.status, 200);
  assert.equal(getAgain.body.title, 'Provisional Record');
});

test('Export and Stats endpoints', async () => {
  const statsRes = await ctx.request('GET', '/achievements/stats', { token: hodCse.token });
  assert.equal(statsRes.status, 200);
  assert.ok(typeof statsRes.body.total === 'number');

  const exportCsv = await ctx.request('GET', '/achievements/export?format=csv', { token: hodCse.token });
  assert.equal(exportCsv.status, 200);
  assert.match(exportCsv.headers.get('content-type'), /text\/csv/);

  const exportPdf = await ctx.request('GET', '/achievements/export?format=pdf', { token: hodCse.token });
  assert.equal(exportPdf.status, 200);
  assert.match(exportPdf.headers.get('content-type'), /application\/pdf/);
});
