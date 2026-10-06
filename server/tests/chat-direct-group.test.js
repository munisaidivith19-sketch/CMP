import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const CY = 'CSE (Cyber Security)';
let ctx;
let admin, principal, hod, fac1, fac2, stu1, stu2, stu3;

const ids = (...people) => people.map((x) => String(x.u._id));
const group = (actor, body) => ctx.request('POST', '/chat/conversations', { token: actor.token, body: { type: 'group', ...body } });

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };

  [admin, principal, hod, fac1, fac2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'PR-1' }),
    mk({ role: 'hod', name: 'HOD CY', department: CY, employeeId: 'HOD-1' }),
    mk({ role: 'faculty', name: 'Fac One', department: CY, section: 'A', inChargeYear: 3, inChargeSemester: 5, employeeId: 'FAC-1' }),
    mk({ role: 'faculty', name: 'Fac Two', department: CY, employeeId: 'FAC-2' }),
  ]);

  [stu1, stu2, stu3] = await Promise.all([
    mk({ name: 'Student 1', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'CY01' }),
    mk({ name: 'Student 2', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'CY02' }),
    mk({ name: 'Student 3', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'CY03' }),
  ]);
});

after(async () => {
  await ctx.stop();
});

test('Students cannot create group chats (403 Forbidden)', async () => {
  const res = await group(stu1, {
    name: 'Student study group',
    participantIds: ids(stu2, stu3),
  });
  assert.equal(res.status, 403);
  assert.match(res.body.message, /Only admins, HODs and faculty can create group chats/);
});

test('Faculty creates group directly without approval (201 Created, status active, creator is group admin)', async () => {
  const res = await group(fac1, {
    name: 'Class A Mentorship',
    participantIds: ids(stu1, stu2),
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.isActive, true);
  assert.equal(res.body.pending, undefined);
  assert.ok(res.body.admins.some((a) => String(a._id || a) === String(fac1.u._id)), 'Fac1 is in admins');

  // Verify group is immediately accessible by participants without admin review
  const viewRes = await ctx.request('GET', `/chat/conversations/${res.body._id}`, { token: stu1.token });
  assert.equal(viewRes.status, 200);
  assert.equal(viewRes.body.name, 'Class A Mentorship');
});

test('HOD creates group directly without approval (201 Created, optional reason)', async () => {
  const res = await group(hod, {
    name: 'CY Department Working Group',
    category: 'custom',
    participantIds: ids(stu1, stu2),
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.isActive, true);
  assert.ok(res.body.admins.some((a) => String(a._id || a) === String(hod.u._id)), 'HOD is in admins');

  // Verify conversation is active in the database
  const stored = await ctx.models.Conversation.findById(res.body._id).lean();
  assert.equal(stored.status, 'active');
  assert.equal(stored.isActive, true);
});

test('Only group admins can add members to an existing group', async () => {
  const created = await group(fac1, {
    name: 'Security Lab Group',
    participantIds: ids(stu1),
  });
  assert.equal(created.status, 201);
  const convId = created.body._id;

  // Regular member stu1 tries to add stu2 -> should fail with 403
  const failAdd = await ctx.request('POST', `/chat/conversations/${convId}/members`, {
    token: stu1.token,
    body: { userIds: ids(stu2) },
  });
  assert.equal(failAdd.status, 403);
  assert.match(failAdd.body.message, /Only group admins can add members/);

  // Group admin fac1 adds stu2 -> should succeed with 200
  const successAdd = await ctx.request('POST', `/chat/conversations/${convId}/members`, {
    token: fac1.token,
    body: { userIds: ids(stu2) },
  });
  assert.equal(successAdd.status, 200);
  assert.ok(successAdd.body.participants.some((p) => String(p._id || p) === String(stu2.u._id)));
});

test('Group Admin management: promote and demote group admins', async () => {
  const created = await group(fac1, {
    name: 'Capstone Projects',
    participantIds: ids(stu1, stu2),
  });
  assert.equal(created.status, 201);
  const convId = created.body._id;

  // Regular member stu1 tries to promote stu2 -> fails with 403
  const failToggle = await ctx.request('PATCH', `/chat/conversations/${convId}/admins/${stu2.u._id}`, {
    token: stu1.token,
  });
  assert.equal(failToggle.status, 403);

  // Group admin fac1 promotes stu1 to group admin -> succeeds
  const promote = await ctx.request('PATCH', `/chat/conversations/${convId}/admins/${stu1.u._id}`, {
    token: fac1.token,
  });
  assert.equal(promote.status, 200);
  assert.ok(promote.body.admins.some((a) => String(a._id || a) === String(stu1.u._id)), 'stu1 is now an admin');

  // Now stu1 (as a group admin) CAN add members
  const stu1Add = await ctx.request('POST', `/chat/conversations/${convId}/members`, {
    token: stu1.token,
    body: { userIds: ids(stu3) },
  });
  assert.equal(stu1Add.status, 200);
  assert.ok(stu1Add.body.participants.some((p) => String(p._id || p) === String(stu3.u._id)));

  // Demote stu1 from group admin
  const demote = await ctx.request('PATCH', `/chat/conversations/${convId}/admins/${stu1.u._id}`, {
    token: fac1.token,
  });
  assert.equal(demote.status, 200);
  assert.ok(!demote.body.admins.some((a) => String(a._id || a) === String(stu1.u._id)), 'stu1 is no longer an admin');

  // After demotion, stu1 can no longer add members
  const stu1AddAgain = await ctx.request('POST', `/chat/conversations/${convId}/members`, {
    token: stu1.token,
    body: { userIds: ids(stu3) },
  });
  assert.equal(stu1AddAgain.status, 403);
});

