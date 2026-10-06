/**
 * HOD group requests, principal approval, group management and socket
 * security. (Chat scope itself: chat-scope.test.js — split so each file
 * stays inside the write rate limit, which every test request shares.)
 *
 *  - Student: own exact class (department + year + section + semester) +
 *    faculty, HOD, principal, chairman, AO, dean.
 *  - Faculty: Class In-Charge students + handling-class students + staff.
 *  - HOD: own-department students + staff. Groups:
 *      Custom    — own-department students only (any years / sections)
 *      Academics — own-department students of ONE class only
 *      Faculty   — faculty from anywhere on campus only
 *    Every group is a request the principal approves or rejects; only the
 *    requesting HOD manages the approved group.
 *
 * Every check goes through the HTTP API or the socket with real tokens.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, emitAck, nextEvent, noEvent } from './helpers.js';

const CY = 'CSE (Cyber Security)';
let ctx;
let admin, principal, chairman, ao, dean, hod, hodEce, facIC, facH, facEce;
let stuA1, stuA2, stuB, stuY2, stuSem6, stuEce;

const names = (res) => (res.body.items || []).map((u) => u.name);
const pick = (actor, qs = '') => ctx.request('GET', `/users?context=picker&limit=50${qs}`, { token: actor.token });
const dm = (actor, other) => ctx.request('POST', '/chat/conversations', { token: actor.token, body: { participantIds: [String(other.u._id)] } });
const group = (actor, body) => ctx.request('POST', '/chat/conversations', { token: actor.token, body: { type: 'group', ...body } });
const ids = (...people) => people.map((x) => String(x.u._id));
const review = (actor, id, action, extra = {}) => ctx.request('PATCH', `/chat/requests/${id}`, { token: actor.token, body: { action, ...extra } });
const OUTSIDERS_OF_A1 = ['Rahul B', 'Rahul Y2', 'Rahul Sem6', 'Rahul Ece'];

/** A created HOD group. */
async function approvedGroup(body) {
  const req = await group(hod, { reason: 'Coordination group', ...body });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.status, 'active');
  return req.body._id;
}

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  [admin, principal, chairman, ao, dean, hod, hodEce, facIC, facH, facEce] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'C-PR' }),
    mk({ role: 'chairman', name: 'Chairman', employeeId: 'C-CH' }),
    mk({ role: 'ao', name: 'AO', employeeId: 'C-AO' }),
    mk({ role: 'dean', name: 'Dean', employeeId: 'C-DN' }),
    mk({ role: 'hod', name: 'HOD CY', department: CY, employeeId: 'C-HOD' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'C-HODE' }),
    // Class In-Charge of CY Y3 A Sem 5, teaches nothing.
    mk({ role: 'faculty', name: 'Fac InCharge', department: CY, section: 'A', inChargeYear: 3, inChargeSemester: 5, employeeId: 'C-FIC' }),
    // Handles CY Y3 B only.
    mk({ role: 'faculty', name: 'Fac Handling', department: CY, employeeId: 'C-FH' }),
    mk({ role: 'faculty', name: 'Fac Ece', department: 'ECE', employeeId: 'C-FE' }),
  ]);
  [stuA1, stuA2, stuB, stuY2, stuSem6, stuEce] = await Promise.all([
    mk({ name: 'Rahul A1', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'A1' }),
    mk({ name: 'Rahul A2', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'A2' }),
    mk({ name: 'Rahul B', department: CY, section: 'B', year: 3, semester: 5, rollNo: 'B1' }),
    mk({ name: 'Rahul Y2', department: CY, section: 'A', year: 2, semester: 3, rollNo: 'Y2' }),
    // Same department, year and section — another semester.
    mk({ name: 'Rahul Sem6', department: CY, section: 'A', year: 3, semester: 6, rollNo: 'S6' }),
    mk({ name: 'Rahul Ece', department: 'ECE', section: 'A', year: 3, semester: 5, rollNo: 'E1' }),
  ]);
  const { Subject, TimetableSlot } = ctx.models;
  const [cySub, eceSub] = await Subject.create([
    { name: 'Network Security', code: 'CY502', department: CY, semester: 5, year: 3, sections: ['B'] },
    { name: 'Signals', code: 'EC502', department: 'ECE', semester: 5, year: 3, sections: ['A'] },
  ]);
  const base = { dayOfWeek: 'monday', semester: 5, year: 3, isActive: true };
  await TimetableSlot.create([
    { ...base, subject: cySub._id, faculty: facH.u._id, department: CY, section: 'B', period: 1, startTime: '08:30', endTime: '09:15' },
    // The CY HOD also teaches an ECE class — which grants no chat scope there.
    { ...base, subject: eceSub._id, faculty: hod.u._id, department: 'ECE', section: 'A', period: 2, startTime: '09:15', endTime: '10:00' },
  ]);
});
after(async () => {
  await ctx.stop();
});

// ── HOD group requests ─────────────────────────────────────────────

test('Direct group creation goes live immediately, while legacy pending requests remain reviewable', async () => {
  assert.equal((await group(hod, { name: 'No type', reason: 'Because', participantIds: ids(stuA1) })).status, 422);

  const req = await group(hod, { name: 'CY project', category: 'custom', reason: 'Coordinate the inter-section project', participantIds: ids(stuA1, stuB, stuY2) });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.status, 'active');
  const id = req.body._id;
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: stuA1.token })).status, 200, 'active group accessible');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: hod.token, body: { body: 'hello' } })).status, 201);

  // Seed a pending request in db to verify review endpoint continues to function for legacy/admin requests
  const pendingReq = await ctx.models.Conversation.create({
    name: 'Pending CY Group',
    type: 'group',
    category: 'custom',
    reason: 'Coordinate the inter-section project',
    participants: [hod.u._id, stuA1.u._id, stuB.u._id, stuY2.u._id],
    admins: [hod.u._id],
    createdBy: hod.u._id,
    status: 'pending',
    isActive: false,
  });

  const r = (await ctx.request('GET', '/chat/requests', { token: principal.token })).body.find((x) => x._id === String(pendingReq._id));
  assert.ok(r, 'the principal sees the pending request');
  assert.deepEqual([r.status, r.category, r.reason, r.createdBy.name, r.createdBy.department], ['pending', 'custom', 'Coordinate the inter-section project', 'HOD CY', CY]);
  const a1 = r.participants.find((p) => p.name === 'Rahul A1');
  assert.deepEqual([a1.rollNo, a1.department, a1.year, a1.section], ['A1', CY, 3, 'A'], 'student details for the review');
  assert.equal(r.participants.length - 1, 3, 'member count');
});

test('Approve creates the group once; the HOD owns it; the HOD is told', async () => {
  const req = await ctx.models.Conversation.create({
    name: 'Approve me',
    type: 'group',
    category: 'custom',
    reason: 'Testing approval',
    participants: [hod.u._id, stuA1.u._id, stuB.u._id],
    admins: [hod.u._id],
    createdBy: hod.u._id,
    status: 'pending',
    isActive: false,
  });
  const id = String(req._id);
  assert.equal((await review(hod, id, 'approve')).status, 403, 'an HOD cannot approve');
  assert.equal((await review(facIC, id, 'approve')).status, 403, 'faculty cannot approve');
  assert.equal((await review(stuA1, id, 'approve')).status, 403);

  const [first, second] = await Promise.all([review(principal, id, 'approve'), review(principal, id, 'approve')]);
  assert.deepEqual([first.status, second.status].sort(), [200, 404], 'a double approval decides once');
  assert.equal(await ctx.models.Conversation.countDocuments({ name: 'Approve me' }), 1, 'no duplicate group');

  const g = await ctx.request('GET', `/chat/conversations/${id}`, { token: stuB.token });
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.admins.map(String), [String(hod.u._id)], 'the requesting HOD is the owner');
  assert.ok((await ctx.request('GET', '/notifications', { token: hod.token })).body.items.some((n) => /approved/.test(n.title)));
});

test('Reject leaves no group; the reason reaches the HOD', async () => {
  const req = await ctx.models.Conversation.create({
    name: 'Reject me',
    type: 'group',
    category: 'faculty',
    reason: 'Staff coordination',
    participants: [hod.u._id, facEce.u._id],
    admins: [hod.u._id],
    createdBy: hod.u._id,
    status: 'pending',
    isActive: false,
  });
  const id = String(req._id);
  const rej = await review(principal, id, 'reject', { reason: 'Use the department group' });
  assert.equal(rej.body.status, 'rejected');
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: facEce.token })).status, 404, 'no group exists for members');
  const mine = await ctx.request('GET', '/chat/requests', { token: hod.token });
  assert.ok(mine.body.some((x) => x._id === id && x.status === 'rejected' && x.rejectReason === 'Use the department group'));
  assert.ok((await ctx.request('GET', '/notifications', { token: hod.token })).body.items.some((n) => /not approved/.test(n.title)));
});

test('Approval re-validates members: a member who left the department since the request blocks it', async () => {
  const mover = await ctx.createUser({ name: 'Mover', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'MV' });
  const req = await ctx.models.Conversation.create({
    name: 'Revalidate',
    type: 'group',
    category: 'custom',
    reason: 'Testing revalidation',
    participants: [hod.u._id, mover._id],
    admins: [hod.u._id],
    createdBy: hod.u._id,
    status: 'pending',
    isActive: false,
  });
  const id = String(req._id);
  await ctx.models.User.updateOne({ _id: mover._id }, { $set: { department: 'ECE' } });
  const res = await review(principal, id, 'approve');
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal((await ctx.models.Conversation.findById(id).lean()).status, 'pending', 'still pending, not approved');
});

test('Only an HOD creates Custom / Academics / Faculty groups; faculty creates class groups directly without approval', async () => {
  const fake = await group(facIC, { name: 'Sneaky', category: 'custom', reason: 'I am not an HOD', participantIds: ids(stuA1) });
  assert.equal(fake.status, 403);
  assert.equal((await group(stuA1, { name: 'No', category: 'custom', reason: 'Student', participantIds: ids(stuA2) })).status, 403);

  const facReq = await group(facIC, { name: 'Our class', participantIds: ids(stuA1) });
  assert.equal(facReq.status, 201);
  assert.equal(facReq.body.status, 'active');
  assert.equal(facReq.body.isActive, true);
  assert.ok(facReq.body.admins.some((a) => String(a._id || a) === String(facIC.u._id)));
});

test('Custom: own-department students from several classes — no other department, no staff', async () => {
  const body = (participantIds) => ({ name: 'Custom', category: 'custom', reason: 'Custom group test', participantIds });
  assert.equal((await group(hod, body(ids(stuA1, stuB, stuY2, stuSem6)))).status, 201, 'several years / sections / semesters of CY');
  assert.equal((await group(hod, body(ids(stuEce)))).status, 403, 'another department — even a class the HOD teaches there');
  assert.equal((await group(hod, body(ids(stuA1, facEce)))).status, 422, 'no staff in a Custom group');
});

test('Academics: one class of the HOD’s department, students only', async () => {
  const academic = (participantIds) => group(hod, { name: 'Y3 A', category: 'academic', reason: 'Class group', participantIds });
  assert.equal((await academic(ids(stuA1, stuB))).status, 422, 'two sections');
  assert.equal((await academic(ids(stuA1, stuY2))).status, 422, 'two years');
  assert.equal((await academic(ids(stuA1, facEce))).status, 422, 'no staff');
  assert.equal((await academic(ids(stuEce))).status, 403, 'another department');
  const ok = await academic(ids(stuA1, stuA2));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const stored = await ctx.models.Conversation.findById(ok.body._id).lean();
  assert.deepEqual([stored.category, stored.linkedDepartment, stored.linkedYear, stored.linkedSection], ['academic', CY, 3, 'A']);
});

test('Faculty group: faculty from the whole campus, no students, no other roles', async () => {
  const fg = (participantIds) => group(hod, { name: 'Staff', category: 'faculty', reason: 'Staff coordination', participantIds });
  assert.equal((await fg(ids(facEce, facIC, facH))).status, 201, 'faculty from any department');
  assert.equal((await fg(ids(facEce, stuA1))).status, 422, 'no students');
  assert.equal((await fg(ids(principal))).status, 403, 'not the principal or other roles');
});

test('Group management: only the requesting HOD — not members, not another HOD — and by the group’s rules', async () => {
  const id = await approvedGroup({ name: 'Managed', category: 'academic', participantIds: ids(stuA1, stuA2) });

  for (const actor of [stuA1, hodEce]) {
    assert.ok([403, 404].includes((await ctx.request('PATCH', `/chat/conversations/${id}`, { token: actor.token, body: { name: 'Hijack' } })).status));
    assert.ok([403, 404].includes((await ctx.request('DELETE', `/chat/conversations/${id}`, { token: actor.token })).status));
    assert.ok([403, 404].includes((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: actor.token, body: { userIds: ids(stuA2) } })).status));
  }
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${stuA2.u._id}`, { token: stuA1.token })).status, 403, 'a member cannot remove another');

  assert.equal((await ctx.request('PATCH', `/chat/conversations/${id}`, { token: hod.token, body: { name: 'Managed (renamed)' } })).body.name, 'Managed (renamed)');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(stuB) } })).status, 422, 'not this class');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(stuEce) } })).status, 403, 'another department');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(facEce) } })).status, 422, 'no staff');
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${stuA2.u._id}`, { token: hod.token })).status, 200);
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}`, { token: hod.token })).status, 200);
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: stuA1.token })).status, 404, 'deleted for everyone');
});

// ── Socket.IO ──────────────────────────────────────────────────────

test('Socket: a non-member cannot join or read; a removed member is evicted live', async () => {
  const id = await approvedGroup({ name: 'Live group', category: 'custom', participantIds: ids(stuA1, stuA2) });
  const [s1, s2, outsider] = await Promise.all([ctx.connect(stuA1.token), ctx.connect(stuA2.token), ctx.connect(stuB.token)]);

  assert.equal((await emitAck(outsider, 'chat:join', id)).ok, false, 'non-member join refused');
  assert.equal((await emitAck(outsider, 'chat:read', { conversationId: id })).ok, false, 'non-member read refused');
  assert.equal((await emitAck(s1, 'chat:join', id)).ok, true);
  assert.equal((await emitAck(s2, 'chat:join', id)).ok, true);

  // Authorised member: typing relays and messages arrive.
  const typing = nextEvent(s2, 'chat:typing', (p) => p.conversationId === id);
  s1.emit('chat:typing', { conversationId: id, isTyping: true });
  await typing;
  const arrives = nextEvent(s2, 'chat:message', (p) => p.conversationId === id);
  await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: stuA1.token, body: { body: 'hello group' } });
  await arrives;

  // The HOD removes A2: their socket leaves the room at once.
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${stuA2.u._id}`, { token: hod.token })).status, 200);
  const noTyping = noEvent(s2, 'chat:typing');
  const noMessage = noEvent(s2, 'chat:message');
  s1.emit('chat:typing', { conversationId: id, isTyping: true });
  await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: stuA1.token, body: { body: 'after removal' } });
  assert.ok(await noTyping, 'no typing events after removal');
  assert.ok(await noMessage, 'no messages after removal');

  // ...and cannot speak in it either.
  const silent = noEvent(s1, 'chat:typing');
  s2.emit('chat:typing', { conversationId: id, isTyping: true });
  assert.ok(await silent, 'a removed member’s typing is not relayed');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: stuA2.token, body: { body: 'let me back' } })).status, 403);
  assert.equal((await emitAck(s2, 'chat:join', id)).ok, false, 'cannot rejoin');
});

