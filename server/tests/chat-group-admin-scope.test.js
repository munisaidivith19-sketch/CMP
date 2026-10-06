import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let hod, facCse, stu1, stu2, stuY4, siteAdmin;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [h, f, s1, s2, s4, a] = await Promise.all([
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-H1' }),
    mk({ role: 'faculty', name: 'Faculty CSE', department: 'CSE', employeeId: 'E-F1' }),
    mk({ name: 'Student One', department: 'CSE', section: 'A', semester: 5, rollNo: 'S1' }),
    mk({ name: 'Student Two', department: 'CSE', section: 'A', semester: 5, rollNo: 'S2' }),
    mk({ name: 'Student Final', department: 'CSE', section: 'B', semester: 7, rollNo: 'S4' }),
    mk({ role: 'admin', name: 'Site Admin' }),
  ]);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  [hod, facCse, stu1, stu2, stuY4, siteAdmin] = await Promise.all([h, f, s1, s2, s4, a].map(login));
});

after(async () => {
  await ctx.stop();
});

const ids = (...people) => people.map((x) => String(x.u._id));

test('a member promoted to group admin cannot widen the group beyond its creator’s scope', async () => {
  // HOD creates a Custom group — by its rules, students of CSE only.
  const g = await ctx.request('POST', '/chat/conversations', {
    token: hod.token,
    body: { type: 'group', name: 'CSE project', category: 'custom', reason: 'Project work', participantIds: ids(stu1, stu2) },
  });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const id = g.body._id;

  // HOD promotes a student to group admin (the UI offers this for any member).
  const promote = await ctx.request('PATCH', `/chat/conversations/${id}/admins/${stu1.u._id}`, { token: hod.token });
  assert.equal(promote.status, 200);

  // The promoted student tries to pull a faculty member into a students-only group.
  const addStaff = await ctx.request('POST', `/chat/conversations/${id}/members`, { token: stu1.token, body: { userIds: ids(facCse) } });
  assert.ok([403, 422].includes(addStaff.status), `staff must not enter a Custom group: ${addStaff.status}`);
  // The HOD themselves could not do that either.
  const hodAddStaff = await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(facCse) } });
  assert.ok([403, 422].includes(hodAddStaff.status));

  // Adding a CSE student is still within the group's scope.
  const addStudent = await ctx.request('POST', `/chat/conversations/${id}/members`, { token: stu1.token, body: { userIds: ids(stuY4) } });
  assert.equal(addStudent.status, 200, JSON.stringify(addStudent.body));

  const conv = await ctx.models.Conversation.findById(id).lean();
  assert.ok(!conv.participants.map(String).includes(String(facCse.u._id)));
});

test('a promoted group admin cannot remove the group’s creator; the creator can still leave, a site admin can still remove', async () => {
  const g = await ctx.request('POST', '/chat/conversations', {
    token: hod.token,
    body: { type: 'group', name: 'Takeover test', category: 'custom', reason: 'Testing', participantIds: ids(stu1, stu2) },
  });
  const id = g.body._id;
  await ctx.request('PATCH', `/chat/conversations/${id}/admins/${stu1.u._id}`, { token: hod.token });

  const kick = await ctx.request('DELETE', `/chat/conversations/${id}/members/${hod.u._id}`, { token: stu1.token });
  assert.equal(kick.status, 403);
  // Ordinary members can still be managed by the promoted admin.
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${stu2.u._id}`, { token: stu1.token })).status, 200);

  const conv = await ctx.models.Conversation.findById(id).lean();
  assert.ok(conv.participants.map(String).includes(String(hod.u._id)), 'creator still in the group');

  // Site admin oversight is unchanged.
  await ctx.models.Conversation.updateOne({ _id: id }, { $addToSet: { participants: siteAdmin.u._id } });
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${hod.u._id}`, { token: siteAdmin.token })).status, 200);
});
