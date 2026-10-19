import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { day } from './skill-wallet-fixtures.js';

const { startServer } = await import('./helpers.js');

let ctx;
let owner;
let b;
let c;
let d;
let e;
let faculty;
let alumnus;
let inactive;
let hod;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });

const project = async (who, over = {}) => {
  const res = await req('POST', '/skill-wallet/projects', who, {
    title: 'Campus Energy Monitor',
    domain: 'iot_hardware',
    description: 'Per-block energy metering with anomaly alerts.',
    stage: 'developing',
    startedAt: day(-30),
    mode: 'team',
    ...over,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};

const invite = (who, pid, rollNo, message) => req('POST', `/skill-wallet/projects/${pid}/invitations`, who, { rollNo, message });

/** Notifications are sent after the response: poll briefly. */
async function notesFor(userId, min = 1) {
  let rows = [];
  for (let i = 0; i < 20; i += 1) {
    rows = await ctx.models.Notification.find({ user: userId, type: 'skill_wallet' }).sort({ createdAt: 1 }).lean();
    if (rows.length >= min) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return rows;
}

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  const users = await Promise.all([
    mk({ name: 'Owner', department: 'CSE', section: 'A', year: 3, rollNo: '21CS001' }),
    mk({ name: 'Bhavya', department: 'CSE', section: 'A', year: 3, rollNo: '21CS002' }),
    mk({ name: 'Charan', department: 'ECE', section: 'B', year: 3, rollNo: '21EC003' }),
    mk({ name: 'Divya', department: 'CSE', section: 'B', year: 2, rollNo: '22CS004' }),
    mk({ name: 'Eshwar', department: 'CSE', section: 'B', year: 2, rollNo: '22CS005' }),
    mk({ role: 'faculty', name: 'Faculty', department: 'CSE', employeeId: 'F-9', rollNo: 'FAC001' }),
    mk({ role: 'alumni', name: 'Alumnus', rollNo: '18CS009' }).catch(() => null),
    mk({ name: 'Inactive', department: 'CSE', section: 'A', year: 3, rollNo: '21CS099', isActive: false }),
    mk({ role: 'hod', name: 'HOD', department: 'CSE' }),
  ]);
  [owner, b, c, d, e, faculty] = await Promise.all(users.slice(0, 6).map(login));
  alumnus = users[6];
  inactive = users[7];
  hod = await login(users[8]);
});

after(async () => {
  await ctx.stop();
});

test('Valid roll-number lookup creates a pending invitation and notifies the invitee without private data', async () => {
  const p = await project(owner);
  const res = await invite(owner, p._id, ' 21cs002 ', 'Join us for the hardware side');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending');
  assert.deepEqual(Object.keys(res.body.invitee).sort(), ['department', 'name', 'title', 'year'].filter((k) => k in res.body.invitee).sort());
  const raw = JSON.stringify(res.body);
  for (const leak of ['email', 'phone', 'rollNo', '21CS002', String(b.u._id)]) assert.equal(raw.includes(leak), false, leak);

  const stored = await ctx.models.TeamInvitation.findById(res.body._id).lean();
  assert.equal(String(stored.invitee), String(b.u._id));
  assert.equal(String(stored.inviter), String(owner.u._id));

  const notes = await notesFor(b.u._id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'Team project invitation');
  assert.equal(notes[0].message.includes('Campus Energy Monitor'), false, 'no project title in push-able payload');
  assert.match(notes[0].link, /^\/skill-wallet/);

  // The invitee sees the project title and inviter inside the app.
  const inbox = await req('GET', '/skill-wallet/invitations', b);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.pendingCount, 1);
  assert.equal(inbox.body.items[0].project.title, 'Campus Energy Monitor');
  assert.equal(inbox.body.items[0].inviter.name, 'Owner');
});

test('Invalid, ineligible, inactive and staff roll numbers get the same refusal', async () => {
  const p = await project(owner, { title: 'Ineligible checks' });
  const notFound = await invite(owner, p._id, 'NOPE404');
  assert.equal(notFound.status, 404);
  for (const roll of ['FAC001', '21CS099', ...(alumnus ? ['18CS009'] : [])]) {
    const r = await invite(owner, p._id, roll);
    assert.equal(r.status, 404, roll);
    assert.equal(r.body.message, notFound.body.message, 'no account-type enumeration');
  }
  assert.equal((await invite(owner, p._id, "x'; drop")).status, 422);
  assert.equal((await invite(owner, p._id, { $ne: null })).status, 422, 'operator injection refused');
  assert.ok(inactive);
});

test('Self-invitation, duplicate pending invitation and solo-project invitations are prevented', async () => {
  const p = await project(owner, { title: 'Dup checks' });
  assert.equal((await invite(owner, p._id, '21CS001')).status, 422);
  assert.equal((await invite(owner, p._id, '21EC003')).status, 201);
  assert.equal((await invite(owner, p._id, '21ec003')).status, 409);
  const parallel = await Promise.all([invite(owner, p._id, '22CS004'), invite(owner, p._id, '22CS004'), invite(owner, p._id, '22CS004')]);
  assert.equal(parallel.filter((r) => r.status === 201).length, 1, 'only one pending invitation under a race');
  assert.equal(await ctx.models.TeamInvitation.countDocuments({ project: p._id, invitee: d.u._id, status: 'pending' }), 1);

  const solo = await project(owner, { title: 'Solo', mode: 'solo' });
  assert.equal((await invite(owner, solo._id, '21CS002')).status, 409);
  // Only the owner invites; a stranger does not even learn that the project exists.
  assert.equal((await invite(b, p._id, '22CS005')).status, 404);
});

test('A pending invitation grants no access; only the invitee can answer', async () => {
  const p = await project(owner, { title: 'Secret Pending' });
  const inv = (await invite(owner, p._id, '22CS005')).body;
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}`, e)).status, 404);
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}/team`, e)).status, 404);
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}`, e, { title: 'x' })).status, 404);
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}/publication`, e)).status, 404);

  for (const who of [owner, b, faculty, hod]) {
    assert.equal((await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, who)).status, who === faculty || who === hod ? 403 : 404);
    assert.equal((await req('POST', `/skill-wallet/invitations/${inv._id}/decline`, who)).status, who === faculty || who === hod ? 403 : 404);
  }
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, status: 'active' }), 1);
  assert.equal((await ctx.models.TeamInvitation.findById(inv._id).lean()).status, 'pending');
});

test('Acceptance creates membership exactly once, is idempotent, and notifies the owner', async () => {
  const p = await project(owner, { title: 'Accept once' });
  const inv = (await invite(owner, p._id, '21CS002')).body;
  const before = (await notesFor(owner.u._id, 0)).length;
  const first = await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, b);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'accepted');
  const again = await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, b);
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyAccepted, true);
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, user: b.u._id, status: 'active' }), 1);
  assert.equal((await ctx.models.InnovationProject.findById(p._id).lean()).memberCount, 2);
  // Declining after accepting is refused.
  assert.equal((await req('POST', `/skill-wallet/invitations/${inv._id}/decline`, b)).status, 409);

  // Now the member has access.
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}`, b)).status, 200);
  const notes = await notesFor(owner.u._id, before + 1);
  assert.ok(notes.some((n) => n.title === 'Invitation accepted'));
});

test('Concurrent acceptance is race-safe', async () => {
  const p = await project(owner, { title: 'Race' });
  const inv = (await invite(owner, p._id, '21EC003')).body;
  const results = await Promise.all(Array.from({ length: 6 }, () => req('POST', `/skill-wallet/invitations/${inv._id}/accept`, c)));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, user: c.u._id, status: 'active' }), 1);
  assert.equal((await ctx.models.InnovationProject.findById(p._id).lean()).memberCount, 2);

  // Accept racing decline: exactly one outcome wins.
  const p2 = await project(owner, { title: 'Race 2' });
  const inv2 = (await invite(owner, p2._id, '21EC003')).body;
  const [a, dcl] = await Promise.all([
    req('POST', `/skill-wallet/invitations/${inv2._id}/accept`, c),
    req('POST', `/skill-wallet/invitations/${inv2._id}/decline`, c),
  ]);
  const status = (await ctx.models.TeamInvitation.findById(inv2._id).lean()).status;
  const members = await ctx.models.TeamMembership.countDocuments({ project: p2._id, user: c.u._id, status: 'active' });
  assert.ok(['accepted', 'declined'].includes(status));
  assert.equal(members, status === 'accepted' ? 1 : 0);
  assert.equal([a, dcl].filter((r) => r.status === 200).length, 1, 'one winner');
});

test('Decline creates no membership and keeps the outcome', async () => {
  const p = await project(owner, { title: 'Decline' });
  const inv = (await invite(owner, p._id, '22CS004')).body;
  const r = await req('POST', `/skill-wallet/invitations/${inv._id}/decline`, d);
  assert.equal(r.status, 200);
  assert.equal((await req('POST', `/skill-wallet/invitations/${inv._id}/decline`, d)).body.alreadyDeclined, true);
  assert.equal((await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, d)).status, 409);
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, user: d.u._id }), 0);
  const stored = await ctx.models.TeamInvitation.findById(inv._id).lean();
  assert.equal(stored.status, 'declined');
  assert.ok(stored.respondedAt);
  // A new invitation is possible after a decline (history is kept).
  assert.equal((await invite(owner, p._id, '22CS004')).status, 201);
  assert.equal(await ctx.models.TeamInvitation.countDocuments({ project: p._id, invitee: d.u._id }), 2);
});

test('Cancellation (owner only) and expired invitations', async () => {
  const p = await project(owner, { title: 'Cancel' });
  const inv = (await invite(owner, p._id, '22CS005')).body;
  const byInvitee = await req('DELETE', `/skill-wallet/invitations/${inv._id}`, e);
  assert.equal(byInvitee.status, 404, `invitee cannot cancel ${JSON.stringify(byInvitee.body)}`);
  assert.equal((await req('DELETE', `/skill-wallet/invitations/${inv._id}`, b)).status, 404, 'stranger cannot cancel');
  assert.equal((await req('DELETE', `/skill-wallet/invitations/${inv._id}`, owner)).status, 200);
  assert.equal((await req('DELETE', `/skill-wallet/invitations/${inv._id}`, owner)).status, 200, 'idempotent');
  const acc = await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, e);
  assert.equal(acc.status, 409);
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, user: e.u._id }), 0);

  const inv2 = (await invite(owner, p._id, '22CS005')).body;
  await ctx.models.TeamInvitation.updateOne({ _id: inv2._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const late = await req('POST', `/skill-wallet/invitations/${inv2._id}/accept`, e);
  assert.equal(late.status, 410);
  assert.equal((await ctx.models.TeamInvitation.findById(inv2._id).lean()).status, 'expired');
  assert.equal(await ctx.models.TeamMembership.countDocuments({ project: p._id, user: e.u._id }), 0);
  assert.equal((await req('DELETE', `/skill-wallet/invitations/${inv2._id}`, owner)).status, 410, 'expired cannot be cancelled');
});

test('Team size limit counts members and pending invitations', async () => {
  const { env } = await import('../src/config/env.js');
  const p = await project(owner, { title: 'Full team' });
  await ctx.models.InnovationProject.updateOne({ _id: p._id }, { $set: { memberCount: env.skillWallet.maxTeamSize } });
  assert.equal((await invite(owner, p._id, '21CS002')).status, 409);
});

test('Member removal, leaving, ownership transfer rules', async () => {
  const p = await project(owner, { title: 'Membership rules' });
  const i1 = (await invite(owner, p._id, '21CS002')).body;
  const i2 = (await invite(owner, p._id, '21EC003')).body;
  await req('POST', `/skill-wallet/invitations/${i1._id}/accept`, b);
  await req('POST', `/skill-wallet/invitations/${i2._id}/accept`, c);
  const i3 = (await invite(owner, p._id, '22CS004')).body;

  // Members cannot invite or remove; the owner cannot leave without transferring.
  assert.equal((await invite(b, p._id, '22CS005')).status, 403);
  assert.equal((await req('DELETE', `/skill-wallet/projects/${p._id}/team/${c.u._id}`, b)).status, 404);
  assert.equal((await req('POST', `/skill-wallet/projects/${p._id}/team/leave`, owner)).status, 422);
  // Solo switch refused while the team has members.
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}`, owner, { mode: 'solo' })).status, 409);

  // Transfer only to an active member.
  assert.equal((await req('POST', `/skill-wallet/projects/${p._id}/team/transfer`, owner, { userId: String(d.u._id) })).status, 422);
  assert.equal((await req('POST', `/skill-wallet/projects/${p._id}/team/transfer`, owner, { userId: String(b.u._id) })).status, 200);
  const after1 = await ctx.models.InnovationProject.findById(p._id).lean();
  assert.equal(String(after1.owner), String(b.u._id));
  assert.equal((await ctx.models.TeamInvitation.findById(i3._id).lean()).status, 'cancelled', 'pending invitations end on transfer');
  // Old owner is now an ordinary member and may leave.
  assert.equal((await req('POST', `/skill-wallet/projects/${p._id}/team/leave`, owner)).status, 200);
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}`, owner)).status, 404, 'access ends with membership');
  // New owner removes a member.
  assert.equal((await req('DELETE', `/skill-wallet/projects/${p._id}/team/${c.u._id}`, b)).status, 200);
  assert.equal((await req('GET', `/skill-wallet/projects/${p._id}`, c)).status, 404);
  assert.equal((await ctx.models.InnovationProject.findById(p._id).lean()).memberCount, 1);
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}`, b, { mode: 'solo' })).status, 200, 'solo once alone');
});

test('Team public publication needs every member\'s consent; a late joiner narrows it again', async () => {
  const p = await project(owner, { title: 'Team Publish' });
  const inv = (await invite(owner, p._id, '21CS002')).body;
  await req('POST', `/skill-wallet/invitations/${inv._id}/accept`, b);
  await req('POST', `/skill-wallet/projects/${p._id}/submit`, owner);
  const det = await req('GET', `/skill-wallet/review/projects/${p._id}`, hod);
  assert.equal(det.status, 200);
  const scores = Object.fromEntries(det.body.rubric.criteria.map((x) => [x.key, 7]));
  assert.equal((await req('POST', `/skill-wallet/review/projects/${p._id}/reviews`, hod, { revision: det.body.revision, scores, decision: 'approve' })).status, 201);

  const reqd = await req('PUT', `/skill-wallet/projects/${p._id}/publication`, owner, { audience: 'public', confirmPublic: true });
  assert.equal(reqd.status, 200);
  assert.equal(reqd.body.visibility, 'private', 'waiting for the teammate');
  assert.equal(reqd.body.publicRequest.waitingFor, 1);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 404);
  // Members cannot change publication themselves.
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}/publication`, b, { audience: 'college' })).status, 403);

  const ok = await req('POST', `/skill-wallet/projects/${p._id}/publication/consent`, b, { decision: 'grant' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.visibility, 'public');
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 200);

  // Withdrawal by any member drops it to college-only immediately.
  const w = await req('POST', `/skill-wallet/projects/${p._id}/publication/consent`, b, { decision: 'withdraw' });
  assert.equal(w.body.visibility, 'college');
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 404);

  // Public again, then a new member joins: back to college-only.
  await req('PUT', `/skill-wallet/projects/${p._id}/publication`, owner, { audience: 'public', confirmPublic: true });
  await req('POST', `/skill-wallet/projects/${p._id}/publication/consent`, b, { decision: 'grant' });
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 200);
  const inv3 = (await invite(owner, p._id, '22CS005')).body;
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 200, 'a pending invitee changes nothing');
  await req('POST', `/skill-wallet/invitations/${inv3._id}/accept`, e);
  assert.equal((await ctx.models.InnovationProject.findById(p._id).lean()).visibility, 'college');
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 404);
});

test('A notification failure does not fail the invitation', async () => {
  const p = await project(owner, { title: 'Notify failure' });
  const Notification = ctx.models.Notification;
  const original = Notification.insertMany;
  Notification.insertMany = async () => {
    throw new Error('simulated notification store outage');
  };
  const errors = console.error;
  console.error = () => {};
  try {
    const res = await invite(owner, p._id, '22CS004');
    assert.equal(res.status, 201);
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    Notification.insertMany = original;
    console.error = errors;
  }
  assert.equal(await ctx.models.TeamInvitation.countDocuments({ project: p._id, status: 'pending' }), 1);
});
