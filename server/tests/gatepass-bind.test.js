/**
 * Bulk gate-pass approval ("Bind"): class in-charge groups parent-verified
 * requests → HOD forwards / rejects (whole group or single students) →
 * principal approves / rejects → codes issued by the queue, 5 at a time.
 *
 * Every write here passes the shared per-IP write limiter (40/min), so the
 * large groups used to exercise the queue are seeded directly in the database;
 * the decisions themselves always go through the API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { env } from '../src/config/env.js';
import { processCodeQueue } from '../src/services/gatePassCodeQueue.js';
import { GATE_CODE_PATTERN } from '../src/models/GatePass.js';

let ctx;
const u = {};
let n = 0;
const BATCH = env.gatePass.codeBatchSize;
const INTERVAL = env.gatePass.codeBatchIntervalMs;

const login = async (overrides) => {
  const user = await ctx.createUser(overrides);
  return { u: user, ...(await ctx.loginWeb(user)) };
};

before(async () => {
  ctx = await startServer();
  u.faculty = await login({ role: 'faculty', name: 'CSE-A In-Charge', department: 'CSE', section: 'A', teachingYears: [3, 2] });
  u.facultyB = await login({ role: 'faculty', name: 'CSE-B In-Charge', department: 'CSE', section: 'B', teachingYears: [3] });
  u.hod = await login({ role: 'hod', name: 'CSE HOD', department: 'CSE' });
  u.hodEce = await login({ role: 'hod', name: 'ECE HOD', department: 'ECE' });
  u.principal = await login({ role: 'principal', name: 'Principal' });
  u.admin = await login({ role: 'admin', name: 'Admin' });
  u.student = await login({ name: 'Plain Student', department: 'CSE', section: 'A', year: 3 });
});
after(async () => {
  if (ctx) await ctx.stop();
});

/** A parent-verified request (the OTP step itself is covered by outpass-otp.test.js). */
async function verifiedPass({ year = 3, section = 'A', department = 'CSE', status = 'parent_verified', ...extra } = {}) {
  n += 1;
  const student = await ctx.createUser({ name: `Bind Student ${n}`, rollNo: `22CS${String(n).padStart(3, '0')}`, department, section, year, phone: `90000${String(n).padStart(5, '0')}` });
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: student._id,
    department,
    section,
    regarding: 'home',
    description: 'Semester holidays',
    fromDate: day,
    toDate: day,
    parentPhone: '9876500000',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    status,
    ...(status !== 'pending_faculty' ? { parentVerifiedAt: new Date(), parentVerifiedBy: u.faculty.u._id } : {}),
    ...extra,
  });
  return { student, pass, id: String(pass._id) };
}

/** A group already at `status` with `count` students waiting at the matching stage. */
async function seedGroup(status, count) {
  const group = await ctx.models.GatePassBindGroup.create({
    name: `Seeded ${status} ${n}`,
    title: 'Seeded',
    reason: 'Seeded group for tests',
    createdBy: u.faculty.u._id,
    status,
    department: 'CSE',
    year: 3,
    section: 'A',
    semester: 5,
  });
  const passes = [];
  for (let i = 0; i < count; i += 1) passes.push(await verifiedPass({ status, bindGroup: group._id }));
  return { group, id: String(group._id), passes };
}

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const createGroup = (who, body) => req('POST', '/gate-pass/bind-groups', who, body);
const bind = (passId, groupId, who = u.faculty) => req('POST', `/gate-pass/${passId}/bind`, who, { groupId });
const passOf = (id) => ctx.models.GatePass.findById(id).select('+verificationCode').lean();

let groupId; // the main group, walked through the whole flow
let draftGroupId; // another faculty's group, never sent
let s1;
let s2;
let s3;

test('Create a bind group: faculty only, validated, no mass assignment', async () => {
  assert.equal((await createGroup(u.student, { name: 'X', title: 'Y', reason: 'Z reason' })).status, 403);
  assert.equal((await createGroup(u.hod, { name: 'Team', title: 'Trip', reason: 'Industrial visit' })).status, 403);
  const bad = await createGroup(u.faculty, { name: 'Team', title: 'Trip' });
  assert.equal(bad.status, 422, 'reason is required');

  const res = await createGroup(u.faculty, { name: 'Pongal batch', title: 'Pongal holidays', reason: 'Going home for Pongal', status: 'approved', createdBy: String(u.hod.u._id), department: 'ECE' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'open', 'status cannot be set by the client');
  assert.equal(String(res.body.createdBy._id), String(u.faculty.u._id), 'owner always comes from the session');
  assert.equal(res.body.department, undefined, 'class is set by the first bound student, never the request');
  assert.deepEqual(res.body.members, []);
  groupId = res.body._id;
});

test('Bind: needs parent OTP, own class only, own group only, one class per group, no double bind', async () => {
  const pendingOtp = await verifiedPass({ status: 'pending_faculty' });
  assert.equal((await bind(pendingOtp.id, groupId)).status, 422, 'no bind before the parent OTP is verified');

  s1 = await verifiedPass();
  assert.equal((await bind(s1.id, groupId, u.facultyB)).status, 403, 'section B faculty cannot bind a section A student');

  const other = await createGroup(u.facultyB, { name: 'B group', title: 'B trip', reason: 'Other faculty group' });
  assert.equal(other.status, 201);
  assert.equal((await bind(s1.id, other.body._id)).status, 404, "cannot bind into another faculty's group");
  draftGroupId = other.body._id;

  const ok = await bind(s1.id, groupId);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.department, 'CSE');
  assert.equal(ok.body.year, 3);
  assert.equal(ok.body.section, 'A');
  assert.equal(ok.body.members.length, 1);
  const m = ok.body.members[0];
  assert.equal(m.student.name, s1.student.name);
  assert.ok(m.student.phone && m.student.department && m.student.year && m.student.section, 'name, department, year, section and mobile are shown');

  assert.equal((await bind(s1.id, groupId)).status, 409, 'already bound');

  const yearTwo = await verifiedPass({ year: 2 });
  const mixed = await bind(yearTwo.id, groupId);
  assert.equal(mixed.status, 422, 'a group holds one class only');

  // A bound request cannot be forwarded on its own.
  const fwd = await req('PATCH', `/gate-pass/${s1.id}/faculty-review`, u.faculty, { action: 'forward' });
  assert.equal(fwd.status, 422);

  s2 = await verifiedPass();
  assert.equal((await bind(s2.id, groupId)).status, 200);
  const un = await req('DELETE', `/gate-pass/${s2.id}/bind`, u.faculty);
  assert.equal(un.status, 200);
  assert.equal(un.body.members.length, 1);
  assert.equal((await bind(s2.id, groupId)).status, 200);
  s3 = await verifiedPass();
  assert.equal((await bind(s3.id, groupId)).status, 200);
});

test('Confirm & send to HOD: owner only; students move to the HOD together; group then locked', async () => {
  const notOwner = await req('POST', `/gate-pass/bind-groups/${groupId}/submit`, u.facultyB);
  assert.equal(notOwner.status, 404, 'another faculty cannot see or send this group');

  const res = await req('POST', `/gate-pass/bind-groups/${groupId}/submit`, u.faculty);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending_hod');
  for (const s of [s1, s2, s3]) {
    const p = await passOf(s.id);
    assert.equal(p.status, 'pending_hod');
    assert.equal(p.facultyReview.action, 'forwarded');
  }
  const late = await verifiedPass();
  assert.equal((await bind(late.id, groupId)).status, 422, 'a sent group cannot take new students');
});

test('HOD: scoped to their class; rejects one student, then forwards the group', async () => {
  assert.equal((await req('GET', `/gate-pass/bind-groups/${groupId}`, u.hodEce)).status, 404, 'other-department HOD cannot see it');
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${groupId}/hod-review`, u.hodEce, { action: 'forward' })).status, 404);
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${groupId}/hod-review`, u.principal, { action: 'forward' })).status, 403, 'principal cannot act as HOD');

  // The bound requests are decided only through the group.
  assert.equal((await req('PATCH', `/gate-pass/${s1.id}/hod-review`, u.hod, { action: 'forward' })).status, 422);
  const queue = await req('GET', '/gate-pass?bind=none', u.hod);
  assert.ok(!queue.body.passes.some((p) => p.bindGroup), 'individual review queue leaves bound requests out');

  const list = await req('GET', '/gate-pass/bind-groups', u.hod);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((g) => g._id === groupId));

  const drop = await req('PATCH', `/gate-pass/bind-groups/${groupId}/members/${s3.id}/reject`, u.hod, { reason: 'Internal exam' });
  assert.equal(drop.status, 200, JSON.stringify(drop.body));
  assert.equal((await passOf(s3.id)).status, 'rejected');
  assert.equal((await passOf(s3.id)).rejectedStage, 'hod');

  const fwd = await req('PATCH', `/gate-pass/bind-groups/${groupId}/hod-review`, u.hod, { action: 'forward' });
  assert.equal(fwd.status, 200, JSON.stringify(fwd.body));
  assert.equal(fwd.body.status, 'pending_principal');
  assert.equal((await passOf(s1.id)).status, 'pending_principal');
  assert.equal((await passOf(s3.id)).status, 'rejected', 'a rejected student does not travel on');
});

test('Principal: rejects one student, approves the group once; codes are queued, not issued at once', async () => {
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${groupId}/principal-review`, u.hod, { action: 'approve' })).status, 403);

  const list = await req('GET', '/gate-pass/bind-groups?status=pending_principal', u.principal);
  const g = list.body.find((x) => x._id === groupId);
  assert.ok(g, 'principal sees the group');
  assert.equal(g.department, 'CSE');
  assert.equal(g.year, 3);

  const s4 = await verifiedPass({ status: 'pending_principal', bindGroup: groupId });
  const drop = await req('PATCH', `/gate-pass/bind-groups/${groupId}/members/${s4.id}/reject`, u.principal, { reason: 'Attendance shortage' });
  assert.equal(drop.status, 200);
  assert.equal((await passOf(s4.id)).rejectedStage, 'principal');

  const ok = await req('PATCH', `/gate-pass/bind-groups/${groupId}/principal-review`, u.principal, { action: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'approved');
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${groupId}/principal-review`, u.principal, { action: 'approve' })).status, 422, 'approval happens once');

  for (const s of [s1, s2]) {
    const p = await passOf(s.id);
    assert.equal(p.status, 'approved');
    assert.equal(p.verificationCode, undefined, 'no code yet — the queue issues it');
    assert.equal(p.codeIssue.state, 'queued');
    assert.ok(p.codeIssue.scheduledAt);
    assert.ok(p.verificationExpiry);
  }

  // The student is told when the QR and code will be generated.
  const stu = await ctx.loginWeb(s1.student);
  const qr = await req('GET', `/gate-pass/${s1.id}/qr`, stu);
  assert.equal(qr.status, 409);
  assert.match(qr.body.message, /Your QR code and code will be generated at /);
  assert.equal(qr.body.codeQueued, true);
  assert.ok(qr.body.generateAt);
  const mine = await req('GET', '/gate-pass', stu);
  assert.equal(mine.body.passes[0].codeIssue.state, 'queued');
  assert.equal(mine.body.passes[0].bindGroup.name, 'Pongal batch');

  const done = await processCodeQueue({ now: new Date(Date.now() + INTERVAL) });
  assert.equal(done.issued, 2);
  const after = await req('GET', `/gate-pass/${s1.id}/qr`, stu);
  assert.equal(after.status, 200);
  assert.match(after.body.code, GATE_CODE_PATTERN);
  assert.match(after.body.qr, /^data:image\/png;base64,/);
  assert.equal((await passOf(s1.id)).codeIssue.state, 'issued');
});

test('Queue: a large group is issued at most 5 codes per tick, in scheduled batches, all unique', async () => {
  const { id, passes } = await seedGroup('pending_principal', 12);
  const t0 = Date.now();
  const ok = await req('PATCH', `/gate-pass/bind-groups/${id}/principal-review`, u.principal, { action: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.counts.codesWaiting, 12);

  const docs = await ctx.models.GatePass.find({ _id: { $in: passes.map((p) => p.pass._id) } }).lean();
  const slots = docs.map((d) => Math.round((d.codeIssue.scheduledAt.getTime() - t0) / INTERVAL)).sort((a, b) => a - b);
  // Up to 5 per interval: 5 now, 5 one interval later, 2 after that.
  assert.deepEqual(
    Object.values(slots.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {})),
    [BATCH, BATCH, 12 - 2 * BATCH]
  );

  const tick = (offset) => processCodeQueue({ now: new Date(t0 + offset + 1000) });
  assert.equal((await tick(0)).issued, BATCH, 'first tick: one batch of 5');
  assert.equal((await tick(0)).issued, 0, 'the next batch is not due yet');
  assert.equal((await tick(INTERVAL)).issued, BATCH);
  assert.equal((await tick(2 * INTERVAL)).issued, 12 - 2 * BATCH);

  const issued = await ctx.models.GatePass.find({ _id: { $in: passes.map((p) => p.pass._id) } }).select('+verificationCode').lean();
  const codes = issued.map((p) => p.verificationCode);
  assert.ok(codes.every((c) => GATE_CODE_PATTERN.test(c)));
  assert.equal(new Set(codes).size, 12, 'every code is unique');
  assert.ok(issued.every((p) => p.status === 'approved' && p.codeIssue.state === 'issued'));
});

test('Queue: a failed QR/code generation is retried automatically — no new approval', async () => {
  const { id, passes } = await seedGroup('pending_principal', 3);
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${id}/principal-review`, u.principal, { action: 'approve' })).status, 200);

  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error('simulated QR renderer failure');
  };
  const now = Date.now() + 1000;
  const first = await processCodeQueue({ now: new Date(now), render: flaky });
  assert.equal(first.failed, 1);
  assert.equal(first.issued, 2);

  const failed = (await ctx.models.GatePass.find({ _id: { $in: passes.map((p) => p.pass._id) } }).select('+verificationCode').lean()).find((p) => !p.verificationCode);
  assert.equal(failed.status, 'approved', 'still approved — nobody has to approve it again');
  assert.equal(failed.codeIssue.state, 'queued');
  assert.equal(failed.codeIssue.attempts, 1);
  assert.ok(failed.codeIssue.scheduledAt.getTime() > now, 'retry is scheduled for later');

  const retry = await processCodeQueue({ now: new Date(failed.codeIssue.scheduledAt.getTime() + 1) });
  assert.equal(retry.issued, 1);
  const healed = await passOf(failed._id);
  assert.match(healed.verificationCode, GATE_CODE_PATTERN);
  assert.equal(healed.codeIssue.state, 'issued');
  assert.equal((await ctx.models.GatePassBindGroup.findById(id).lean()).status, 'approved');
});

test('Queue: a stuck claim is picked up again; a revoked pass never gets a code', async () => {
  const { id, passes } = await seedGroup('pending_principal', 2);
  assert.equal((await req('PATCH', `/gate-pass/bind-groups/${id}/principal-review`, u.principal, { action: 'approve' })).status, 200);
  const [a, b] = passes;
  await ctx.models.GatePass.updateOne({ _id: a.pass._id }, { $set: { 'codeIssue.state': 'processing', 'codeIssue.claimedAt': new Date(Date.now() - 10 * 60000) } });
  assert.equal((await req('PATCH', `/gate-pass/${b.id}/revoke`, u.principal, { reason: 'Disciplinary' })).status, 200);

  const res = await processCodeQueue({ now: new Date(Date.now() + 1000) });
  assert.equal(res.issued, 1);
  assert.match((await passOf(a.id)).verificationCode, GATE_CODE_PATTERN);
  const revoked = await passOf(b.id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.verificationCode, undefined);
});

test('HOD rejects the entire group; rejecting the last student closes a group', async () => {
  const whole = await seedGroup('pending_hod', 2);
  const res = await req('PATCH', `/gate-pass/bind-groups/${whole.id}/hod-review`, u.hod, { action: 'reject', reason: 'Exams next week' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'rejected');
  for (const p of whole.passes) {
    const doc = await passOf(p.id);
    assert.equal(doc.status, 'rejected');
    assert.equal(doc.rejectedReason, 'Exams next week');
  }

  const single = await seedGroup('pending_hod', 1);
  const drop = await req('PATCH', `/gate-pass/bind-groups/${single.id}/members/${single.passes[0].id}/reject`, u.hod, {});
  assert.equal(drop.status, 200);
  assert.equal(drop.body.status, 'rejected', 'no students left → group closed');
});

test('Open group can be deleted by its owner; its requests return to the normal queue', async () => {
  const g = await createGroup(u.faculty, { name: 'Temp', title: 'Temp', reason: 'Will be deleted' });
  const s = await verifiedPass();
  assert.equal((await bind(s.id, g.body._id)).status, 200);
  const del = await req('DELETE', `/gate-pass/bind-groups/${g.body._id}`, u.faculty);
  assert.equal(del.status, 200);
  assert.equal((await passOf(s.id)).bindGroup, undefined);
  assert.equal((await passOf(s.id)).status, 'parent_verified');
});

test('Read access: students and other roles are refused; malformed ids and filters fail safely', async () => {
  assert.equal((await req('GET', '/gate-pass/bind-groups', u.student)).status, 403);
  assert.equal((await req('GET', `/gate-pass/bind-groups/${groupId}`, u.student)).status, 403);
  assert.equal((await req('GET', `/gate-pass/bind-groups/${groupId}`, u.facultyB)).status, 404);
  assert.equal((await req('GET', `/gate-pass/bind-groups/${draftGroupId}`, u.principal)).status, 404, 'a draft stays with its faculty');
  assert.equal((await req('GET', `/gate-pass/bind-groups/${draftGroupId}`, u.hod)).status, 404);
  assert.equal((await req('GET', '/gate-pass/bind-groups/not-an-id', u.faculty)).status, 422);
  assert.equal((await req('GET', '/gate-pass/bind-groups?status[$ne]=x', u.admin)).status, 422);
  const own = await req('GET', '/gate-pass/bind-groups', u.faculty);
  assert.equal(own.status, 200);
  assert.ok(own.body.every((g) => String(g.createdBy._id) === String(u.faculty.u._id)), 'faculty see only their own groups');
  const noAuth = await ctx.request('GET', '/gate-pass/bind-groups');
  assert.equal(noAuth.status, 401);
});
