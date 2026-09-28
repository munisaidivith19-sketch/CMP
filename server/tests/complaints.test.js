import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, faculty, hod, principal, dean, ao, chairman, warden, student, student2, otherFaculty;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, f, h, p, d, ao_, c, w, s1, s2, f2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'faculty', name: 'Fac CSE', department: 'CSE', section: 'A', employeeId: 'E-1' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-PR' }),
    mk({ role: 'dean', name: 'Dean', employeeId: 'E-DEAN' }),
    mk({ role: 'ao', name: 'AO', employeeId: 'E-AO' }),
    mk({ role: 'chairman', name: 'Chairman', employeeId: 'E-CH' }),
    mk({ role: 'warden', name: 'Warden', employeeId: 'E-WD' }),
    mk({ name: 'Stu One', department: 'CSE', section: 'A', rollNo: '01' }),
    mk({ name: 'Stu Two', department: 'CSE', section: 'A', rollNo: '02' }),
    mk({ role: 'faculty', name: 'Fac Other', department: 'ECE', section: 'A', employeeId: 'E-2' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  dean = { u: d, ...(await ctx.loginWeb(d)) };
  ao = { u: ao_, ...(await ctx.loginWeb(ao_)) };
  chairman = { u: c, ...(await ctx.loginWeb(c)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  student = { u: s1, ...(await ctx.loginWeb(s1)) };
  student2 = { u: s2, ...(await ctx.loginWeb(s2)) };
  otherFaculty = { u: f2, ...(await ctx.loginWeb(f2)) };
});
after(async () => {
  await ctx.stop();
});

const create = (actor, body) => ctx.request('POST', '/complaints', { token: actor.token, body });

// ── 1. Creation & role gating ──────────────────────────────────────

test('student can create a complaint; faculty/HOD/admin cannot', async () => {
  const ok = await create(student, {
    category: 'academics', subCategory: 'subject', escalateTo: 'faculty',
    description: 'The subject material is outdated and incomplete.',
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.currentAuthorityRole, 'faculty');
  assert.equal(ok.body.status, 'SUBMITTED');

  const asFaculty = await create(faculty, { category: 'academics', subCategory: 'subject', escalateTo: 'hod', description: 'x'.repeat(15) });
  assert.equal(asFaculty.status, 403);
  const asHod = await create(hod, { category: 'academics', subCategory: 'subject', escalateTo: 'hod', description: 'x'.repeat(15) });
  assert.equal(asHod.status, 403);
  const asAdmin = await create(admin, { category: 'academics', subCategory: 'subject', escalateTo: 'hod', description: 'x'.repeat(15) });
  assert.equal(asAdmin.status, 403);
});

// ── 2. Anonymous privacy ────────────────────────────────────────────

test('anonymous complaint hides identity from faculty/HOD/principal/dean/ao/warden but not chairman/admin', async () => {
  const res = await create(student, {
    anonymous: true, category: 'ragging_harassment', escalateTo: 'hod',
    description: 'A senior student has been harassing juniors in the hostel corridor.',
  });
  assert.equal(res.status, 201);
  const id = res.body._id;
  // The owner always sees their own complaint's identity — anonymity hides it
  // from everyone else, not from the complainant themselves.
  assert.equal(String(res.body.student), String(student.u._id));

  for (const viewer of [faculty, hod, principal, dean, ao, warden]) {
    const got = await ctx.request('GET', `/complaints/${id}`, { token: viewer.token });
    if (viewer === hod) {
      assert.equal(got.status, 200);
      assert.equal(got.body.student, undefined, `${viewer.u.role} must not see identity`);
      assert.equal(got.body.identityHidden, true);
    } else {
      // Not the current authority and not chairman/admin — should be forbidden entirely.
      assert.equal(got.status, 403, `${viewer.u.role} should not be able to view an unrelated complaint`);
    }
  }

  const asChairman = await ctx.request('GET', `/complaints/${id}`, { token: chairman.token });
  assert.equal(asChairman.status, 200);
  assert.ok(asChairman.body.student, 'chairman must see identity');
  assert.equal(asChairman.body.identityHidden, false);

  const asAdmin = await ctx.request('GET', `/complaints/${id}`, { token: admin.token });
  assert.equal(asAdmin.status, 200);
  assert.ok(asAdmin.body.student, 'admin must see identity');

  // The identity reveal must be audited.
  const activity = await ctx.models.Activity.findOne({ action: 'complaint.identity_access' });
  assert.ok(activity, 'identity access must be logged');
});

test('the complainant can always see their own complaint, another student cannot', async () => {
  const res = await create(student, { category: 'infrastructure', subCategory: 'network', escalateTo: 'hod', description: 'Wifi is down in the whole CSE block.' });
  const id = res.body._id;
  const own = await ctx.request('GET', `/complaints/${id}`, { token: student.token });
  assert.equal(own.status, 200);
  const other = await ctx.request('GET', `/complaints/${id}`, { token: student2.token });
  assert.equal(other.status, 403);
});

// ── 3. Routing correctness per category / escalate-to ───────────────

test('routes to the correct authority per category and escalate-to target', async () => {
  const toFaculty = await create(student, { category: 'academics', subCategory: 'attendance', escalateTo: 'faculty', description: 'Attendance was marked incorrectly for last week.' });
  assert.equal(toFaculty.body.currentAuthorityRole, 'faculty');
  assert.equal(String(toFaculty.body.currentAuthorityUserId), String(faculty.u._id));

  const toHod = await create(student, { category: 'infrastructure', subCategory: 'water', escalateTo: 'hod', description: 'No drinking water on the third floor.' });
  assert.equal(String(toHod.body.currentAuthorityUserId), String(hod.u._id));

  const toWarden = await create(student, { category: 'hostel', subCategory: 'mess', escalateTo: 'warden', description: 'The hostel mess food quality has been very poor lately.' });
  assert.equal(String(toWarden.body.currentAuthorityUserId), String(warden.u._id));

  const toChairman = await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'chairman', description: 'Escalating directly to the chairman for review.' });
  assert.equal(String(toChairman.body.currentAuthorityUserId), String(chairman.u._id));

  const invalid = await create(student, { category: 'ragging_harassment', escalateTo: 'faculty', description: 'Faculty should not be a valid target here.' });
  assert.equal(invalid.status, 422);
});

test('faculty/HOD only see complaints currently assigned to them', async () => {
  await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'faculty', description: 'Complaint routed to CSE section A faculty.' });
  const list = await ctx.request('GET', '/complaints', { token: faculty.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.complaints.every((c) => String(c.currentAuthorityUserId) === String(faculty.u._id)));

  const otherList = await ctx.request('GET', '/complaints', { token: otherFaculty.token });
  assert.equal(otherList.body.complaints.length, 0, 'unrelated faculty must see nothing');
});

// ── 4. 8-hour gate + escalation chain ───────────────────────────────

test('NOT RESOLVED is blocked before 8 hours and walks faculty -> hod -> principal -> dean -> chairman', async () => {
  const res = await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'faculty', description: 'Escalation chain walk test complaint.' });
  const id = res.body._id;

  const tooSoon = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(tooSoon.status, 422);

  const forceReady = async () => ctx.models.Complaint.updateOne({ _id: id }, { $set: { notResolvedAvailableAt: new Date(Date.now() - 1000) } });

  await forceReady();
  const toHod = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(toHod.status, 200, JSON.stringify(toHod.body));
  assert.equal(toHod.body.currentAuthorityRole, 'hod');
  assert.equal(toHod.body.status, 'ESCALATED');

  await forceReady();
  const toPrincipal = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(toPrincipal.body.currentAuthorityRole, 'principal');

  await forceReady();
  const toDean = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(toDean.body.currentAuthorityRole, 'dean');

  await forceReady();
  const toChairman = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(toChairman.body.currentAuthorityRole, 'chairman');

  // Already at the final authority: no further escalation, status just records NOT_RESOLVED.
  await forceReady();
  const final = await ctx.request('PATCH', `/complaints/${id}/not-resolved`, { token: student.token });
  assert.equal(final.body.currentAuthorityRole, 'chairman');
  assert.equal(final.body.status, 'NOT_RESOLVED');

  const history = await ctx.models.ComplaintHistory.find({ complaint: id }).sort({ timestamp: 1 }).lean();
  const escalations = history.filter((h) => h.action === 'escalated');
  assert.equal(escalations.length, 4);
});

test('a student cannot bypass the wait by tampering with the request body', async () => {
  const res = await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'faculty', description: 'Client cannot force early escalation.' });
  const attempt = await ctx.request('PATCH', `/complaints/${res.body._id}/not-resolved`, {
    token: student.token,
    body: { notResolvedAvailableAt: new Date(0).toISOString() },
  });
  assert.equal(attempt.status, 422, 'server must ignore client-supplied timing fields');
});

// ── 5. Authorization on status changes / cancellation ───────────────

test('only the current authority (or admin) can update status; unauthorized users are rejected', async () => {
  const res = await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'faculty', description: 'Only the assigned faculty may act on this.' });
  const id = res.body._id;

  const byOtherFaculty = await ctx.request('PATCH', `/complaints/${id}/authority-update`, { token: otherFaculty.token, body: { status: 'IN_REVIEW' } });
  assert.equal(byOtherFaculty.status, 403);

  const byStudent = await ctx.request('PATCH', `/complaints/${id}/authority-update`, { token: student.token, body: { status: 'IN_REVIEW' } });
  assert.equal(byStudent.status, 403);

  const byAssigned = await ctx.request('PATCH', `/complaints/${id}/authority-update`, { token: faculty.token, body: { status: 'IN_REVIEW', comment: 'Looking into it.' } });
  assert.equal(byAssigned.status, 200);
  assert.equal(byAssigned.body.status, 'IN_REVIEW');
});

test('cancel is owner-only and only while still open', async () => {
  const res = await create(student, { category: 'academics', subCategory: 'subject', escalateTo: 'faculty', description: 'Cancellable while still submitted.' });
  const id = res.body._id;

  const byOther = await ctx.request('PATCH', `/complaints/${id}/cancel`, { token: student2.token });
  assert.equal(byOther.status, 404);

  const ok = await ctx.request('PATCH', `/complaints/${id}/cancel`, { token: student.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'CANCELLED');

  const again = await ctx.request('PATCH', `/complaints/${id}/cancel`, { token: student.token });
  assert.equal(again.status, 422);
});

test('attachment URLs must come from the upload endpoint (safe URL validation)', async () => {
  const bad = await create(student, {
    category: 'infrastructure', subCategory: 'network', escalateTo: 'hod', description: 'Attachment must be validated.',
    attachments: [{ url: 'javascript:alert(1)', name: 'evil.txt' }],
  });
  assert.equal(bad.status, 422);
});

// ── 6. Admin filters & pagination ───────────────────────────────────

test('admin/chairman can filter and page through all complaints', async () => {
  for (let i = 0; i < 3; i += 1) {
    await create(student, { category: 'infrastructure', subCategory: 'classroom', escalateTo: 'hod', description: `Broken projector in room ${i}.` });
  }
  const page1 = await ctx.request('GET', '/complaints?limit=2&page=1&category=infrastructure', { token: admin.token });
  assert.equal(page1.status, 200);
  assert.ok(page1.body.complaints.length <= 2);
  assert.ok(page1.body.pagination.total >= 3);

  const dashboard = await ctx.request('GET', '/complaints/dashboard', { token: chairman.token });
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.total >= 3);

  const forbidden = await ctx.request('GET', '/complaints/dashboard', { token: faculty.token });
  assert.equal(forbidden.status, 403);
});
