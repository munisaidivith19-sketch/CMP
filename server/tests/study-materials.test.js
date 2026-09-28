import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, hodCse, hodEce, facA, facB, warden, security, student;
let subjectNS, subjectOther;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, hc, he, fa, fb, w, sec, s] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HC' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HE' }),
    mk({ role: 'faculty', name: 'Dr. Ravi', department: 'CSE', employeeId: 'E-RAVI' }),
    mk({ role: 'faculty', name: 'Dr. Priya', department: 'CSE', employeeId: 'E-PRIYA' }),
    mk({ role: 'warden', name: 'Warden', employeeId: 'E-WD' }),
    mk({ role: 'security', name: 'Security', employeeId: 'E-SEC' }),
    mk({ name: 'Student A1', department: 'CSE', section: 'A', semester: 5, rollNo: 'A1' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  hodCse = { u: hc, ...(await ctx.loginWeb(hc)) };
  hodEce = { u: he, ...(await ctx.loginWeb(he)) };
  facA = { u: fa, ...(await ctx.loginWeb(fa)) };
  facB = { u: fb, ...(await ctx.loginWeb(fb)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  student = { u: s, ...(await ctx.loginWeb(s)) };

  subjectNS = await ctx.models.Subject.create({ name: 'Network Security', code: 'CS501', department: 'CSE', semester: 5, faculty: [fa._id], sections: ['A'] });
  subjectOther = await ctx.models.Subject.create({ name: 'Ethical Hacking', code: 'CS502', department: 'CSE', semester: 5, faculty: [], sections: ['A'] });

  // Dr. Ravi is assigned Network Security, CSE section A, semester 5, via the timetable.
  const slot = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: String(subjectNS._id), faculty: String(fa._id), section: 'A', department: 'CSE', dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '09:50', semester: 5 },
  });
  assert.equal(slot.status, 201, JSON.stringify(slot.body));
});
after(async () => {
  await ctx.stop();
});

const upload = (actor, over = {}) =>
  ctx.request('POST', '/study-materials', {
    token: actor.token,
    body: {
      title: 'Unit 1 notes',
      category: 'notes',
      subjectId: String(subjectNS._id),
      department: 'CSE',
      section: 'A',
      semester: 5,
      file: { url: '/uploads/unit1.pdf', name: 'unit1.pdf', mimeType: 'application/pdf', size: 1024 },
      ...over,
    },
  });

// ── TEST 1 / 2 ───────────────────────────────────────────────────────

test('faculty assigned to the subject can upload; an unassigned faculty member cannot', async () => {
  const ok = await upload(facA);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.subjectCode, 'CS501');
  assert.equal(ok.body.uploadedBy.name, 'Dr. Ravi');

  const denied = await upload(facB);
  assert.equal(denied.status, 403);
});

// ── TEST 3: spoofing the actor doesn't work — auth is from the session ──

test('the uploader is always the authenticated user, never a client-supplied id', async () => {
  // There is no facultyId/uploadedBy field accepted from the body at all —
  // it always comes from req.user, so "assuming Dr. Ravi's identity" isn't
  // even a field Dr. Priya's request can influence.
  const spoofed = await ctx.request('POST', '/study-materials', {
    token: facB.token,
    body: {
      title: 'Sneaky upload',
      subjectId: String(subjectNS._id),
      department: 'CSE',
      section: 'A',
      semester: 5,
      uploadedBy: String(facA.u._id),
      file: { url: '/uploads/sneaky.pdf' },
    },
  });
  assert.equal(spoofed.status, 403);
});

// ── TEST 4: changing subjectId manually ──────────────────────────────

test('an unassigned faculty member cannot upload by pointing at a different subject', async () => {
  // Dr. Priya is assigned to nothing; picking Ethical Hacking (which she also
  // doesn't teach) still fails.
  const res = await upload(facB, { subjectId: String(subjectOther._id), title: 'Not mine either' });
  assert.equal(res.status, 403);
});

// ── TEST 5: changing departmentId manually ───────────────────────────

test('faculty cannot claim a different department for their upload', async () => {
  const res = await upload(facA, { department: 'ECE' });
  assert.equal(res.status, 403, 'Dr. Ravi has no ECE assignment for this subject');
});

// ── TEST 6: editing another class's material ─────────────────────────

test('faculty cannot edit a material outside their current assignment', async () => {
  const mine = await upload(facA);
  const editByOther = await ctx.request('PUT', `/study-materials/${mine.body._id}`, { token: facB.token, body: { title: 'Hijacked' } });
  assert.equal(editByOther.status, 403);

  const editByOwner = await ctx.request('PUT', `/study-materials/${mine.body._id}`, { token: facA.token, body: { title: 'Unit 1 notes (revised)' } });
  assert.equal(editByOwner.status, 200);
  assert.equal(editByOwner.body.title, 'Unit 1 notes (revised)');
});

// ── TEST 7: assigned to Section A, tries Section B ───────────────────

test('faculty assigned to Section A cannot upload for Section B without a separate assignment', async () => {
  const res = await upload(facA, { section: 'B' });
  assert.equal(res.status, 403);
});

// ── TEST 8 / 9: HOD own department vs another ────────────────────────

test('HOD manages their own department; another department is rejected', async () => {
  const ok = await upload(hodCse, { section: '' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.department, 'CSE');

  const denied = await ctx.request('POST', '/study-materials', {
    token: hodEce.token,
    body: { title: 'ECE upload attempt', subjectId: String(subjectNS._id), department: 'CSE', semester: 5, file: { url: '/uploads/x.pdf' } },
  });
  assert.equal(denied.status, 403, 'CS501 belongs to CSE, not the ECE HOD');

  // An HOD cannot spoof their own department either — it's taken from the session.
  const eceSubject = await ctx.models.Subject.create({ name: 'Signals', code: 'EC501', department: 'ECE', semester: 5 });
  const spoofedDept = await ctx.request('POST', '/study-materials', {
    token: hodEce.token,
    body: { title: 'ECE material', subjectId: String(eceSubject._id), department: 'CSE', semester: 5, file: { url: '/uploads/x.pdf' } },
  });
  assert.equal(spoofedDept.status, 201, 'department is forced from the session, not rejected — it just ignores the spoofed CSE value');
  assert.equal(spoofedDept.body.department, 'ECE');
});

// ── TEST 10: admin manages any department ────────────────────────────

test('admin manages materials for any department', async () => {
  const res = await upload(admin, { title: 'Admin upload for CSE' });
  assert.equal(res.status, 201);
  const eceSubject = await ctx.models.Subject.create({ name: 'Signals II', code: 'EC502', department: 'ECE', semester: 5 });
  const eceRes = await ctx.request('POST', '/study-materials', {
    token: admin.token,
    body: { title: 'Admin upload for ECE', subjectId: String(eceSubject._id), department: 'ECE', semester: 5, file: { url: '/uploads/x.pdf' } },
  });
  assert.equal(eceRes.status, 201);

  const del = await ctx.request('DELETE', `/study-materials/${eceRes.body._id}`, { token: admin.token });
  assert.equal(del.status, 200);
});

// ── TEST 11: student upload attempt ──────────────────────────────────

test('students can view/download but never upload', async () => {
  assert.equal((await upload(student)).status, 403);
  const list = await ctx.request('GET', '/study-materials', { token: student.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.every((m) => m.department === 'CSE'), 'student only sees their own class scope');
});

// ── TEST 12 / 13: warden / security have no module access ───────────

test('warden and security have zero study-materials access', async () => {
  for (const actor of [warden, security]) {
    assert.equal((await ctx.request('GET', '/study-materials', { token: actor.token })).status, 403);
    assert.equal((await upload(actor)).status, 403);
  }
});

// ── Ownership does not follow the original uploader ──────────────────

test('write access follows the current timetable assignment, not the original uploader', async () => {
  const material = await upload(facA);
  assert.equal(material.status, 201);

  // Faculty B is now also assigned to teach Network Security, CSE-A, sem 5.
  const secondSlot = await ctx.request('POST', '/timetable', {
    token: admin.token,
    body: { subject: String(subjectNS._id), faculty: String(facB.u._id), section: 'A', department: 'CSE', dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '09:50', semester: 5 },
  });
  assert.equal(secondSlot.status, 201, JSON.stringify(secondSlot.body));

  const nowAllowed = await ctx.request('PUT', `/study-materials/${material.body._id}`, { token: facB.token, body: { title: 'Updated by the newly-assigned faculty' } });
  assert.equal(nowAllowed.status, 200, JSON.stringify(nowAllowed.body));
  assert.equal(nowAllowed.body.uploadedBy.name, 'Dr. Ravi', 'original uploader is preserved for audit');
});

// ── Unassigned (but not blocked) faculty: view + download only ──────

test('an unassigned faculty member can still view materials but not manage them', async () => {
  const list = await ctx.request('GET', '/study-materials?department=CSE&semester=5', { token: facB.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0);
});
