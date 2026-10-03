/**
 * Chat scope and HOD group approval.
 *
 *  - Student: own classmates + academic staff (faculty, HOD, principal,
 *    chairman, AO, dean). Never another class's students.
 *  - Faculty: students of their handling classes and Class In-Charge class +
 *    academic staff.
 *  - HOD: own-department students + students of classes they handle +
 *    academic staff. Groups: Custom / Academics / Faculty, approved by the
 *    principal; only the HOD edits, deletes and manages members.
 *
 * Every check goes through the HTTP API (and the socket for room joins).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, emitAck } from './helpers.js';

const CY = 'CSE (Cyber Security)';
let ctx;
let admin, principal, chairman, ao, dean, hod, hodEce, facIC, facH, facEce;
let stuA1, stuA2, stuB, stuY2, stuEce, stuEceB;

const names = (res) => (res.body.items || []).map((u) => u.name);
const pick = (actor, qs = '') => ctx.request('GET', `/users?context=picker&limit=50${qs}`, { token: actor.token });
const dm = (actor, other) => ctx.request('POST', '/chat/conversations', { token: actor.token, body: { participantIds: [String(other.u._id)] } });
const group = (actor, body) => ctx.request('POST', '/chat/conversations', { token: actor.token, body: { type: 'group', ...body } });
const ids = (...people) => people.map((x) => String(x.u._id));

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
  [stuA1, stuA2, stuB, stuY2, stuEce, stuEceB] = await Promise.all([
    mk({ name: 'Rahul A1', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'A1' }),
    mk({ name: 'Rahul A2', department: CY, section: 'A', year: 3, semester: 5, rollNo: 'A2' }),
    mk({ name: 'Rahul B', department: CY, section: 'B', year: 3, semester: 5, rollNo: 'B1' }),
    mk({ name: 'Rahul Y2', department: CY, section: 'A', year: 2, semester: 3, rollNo: 'Y2' }),
    mk({ name: 'Rahul Ece', department: 'ECE', section: 'A', year: 3, semester: 5, rollNo: 'E1' }),
    mk({ name: 'Rahul EceB', department: 'ECE', section: 'B', year: 3, semester: 5, rollNo: 'E2' }),
  ]);
  const { Subject, TimetableSlot } = ctx.models;
  const [cySub, eceSub] = await Subject.create([
    { name: 'Network Security', code: 'CY502', department: CY, semester: 5, year: 3, sections: ['B'] },
    { name: 'Signals', code: 'EC502', department: 'ECE', semester: 5, year: 3, sections: ['B'] },
  ]);
  const base = { dayOfWeek: 'monday', semester: 5, year: 3, isActive: true };
  await TimetableSlot.create([
    { ...base, subject: cySub._id, faculty: facH.u._id, department: CY, section: 'B', period: 1, startTime: '08:30', endTime: '09:15' },
    // The CY HOD also teaches one ECE class.
    { ...base, subject: eceSub._id, faculty: hod.u._id, department: 'ECE', section: 'B', period: 2, startTime: '09:15', endTime: '10:00' },
  ]);
});
after(async () => {
  await ctx.stop();
});

// ── Student ─────────────────────────────────────────────────────────

test('Student picker: own classmates and academic staff only — never another class', async () => {
  const res = await pick(stuA1);
  assert.equal(res.status, 200);
  const got = names(res);
  assert.ok(got.includes('Rahul A2'), 'classmate');
  for (const staff of ['Fac InCharge', 'Fac Handling', 'Fac Ece', 'HOD CY', 'HOD ECE', 'Principal', 'Chairman', 'AO', 'Dean']) {
    assert.ok(got.includes(staff), `${staff} is reachable`);
  }
  for (const other of ['Rahul B', 'Rahul Y2', 'Rahul Ece', 'Rahul EceB']) {
    assert.ok(!got.includes(other), `${other} (another class) must not be listed`);
  }
  // Searching by name cannot surface them either; nor can query parameters.
  const search = await pick(stuA1, '&q=Rahul');
  assert.deepEqual(names(search).sort(), ['Rahul A1', 'Rahul A2'], 'self and classmate only (the client hides self)');
  for (const qs of ['&section=B', '&department=ECE', '&year=2', '&role=student']) {
    assert.ok(!names(await pick(stuA1, qs)).some((n) => ['Rahul B', 'Rahul Y2', 'Rahul Ece', 'Rahul EceB'].includes(n)), qs);
  }
  // Picking a club's faculty advisor still works for a student.
  assert.ok(names(await pick(stuA1, '&role=faculty')).includes('Fac Ece'));
});

test('Student can start chats with classmates and any academic staff, not with other classes', async () => {
  for (const ok of [stuA2, facEce, hodEce, principal, chairman, ao, dean]) {
    const res = await dm(stuA1, ok);
    assert.ok([200, 201].includes(res.status), `${ok.u.name}: ${JSON.stringify(res.body)}`);
  }
  for (const no of [stuB, stuY2, stuEce]) {
    const res = await dm(stuA1, no);
    assert.equal(res.status, 403, no.u.name);
    assert.match(res.body.message, /classmates and campus staff/);
  }
});

test('An existing chat with another class is closed: hidden, unreadable, unwritable, no socket room', async () => {
  // A chat that predates the rule (created directly, as old data would be).
  const old = await ctx.models.Conversation.create({ type: 'private', participants: [stuA1.u._id, stuB.u._id], createdBy: stuA1.u._id });
  const id = String(old._id);

  const list = await ctx.request('GET', '/chat/conversations', { token: stuA1.token });
  assert.ok(!list.body.some((c) => c._id === id), 'not listed');
  for (const [method, path, body] of [
    ['GET', `/chat/conversations/${id}`],
    ['GET', `/chat/conversations/${id}/messages`],
    ['POST', `/chat/conversations/${id}/messages`, { body: 'hello' }],
  ]) {
    assert.equal((await ctx.request(method, path, { token: stuA1.token, body })).status, 403, `${method} ${path}`);
    assert.equal((await ctx.request(method, path, { token: stuB.token, body })).status, 403, `${method} ${path} (other side)`);
  }
  const socket = await ctx.connect(stuA1.token);
  assert.equal((await emitAck(socket, 'chat:join', id)).ok, false, 'no live room either');
});

test('A student may write to any HOD, and that HOD can answer', async () => {
  const conv = await dm(stuA1, hodEce);
  const id = conv.body._id;
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: stuA1.token, body: { body: 'Sir, a question' } })).status, 201);
  // HOD ECE cannot start a chat with a CY student on their own...
  assert.equal((await dm(hodEce, stuA2)).status, 403);
  // ...but the conversation the student started is open to them.
  const list = await ctx.request('GET', '/chat/conversations', { token: hodEce.token });
  assert.ok(list.body.some((c) => c._id === id));
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: hodEce.token, body: { body: 'Yes?' } })).status, 201);
});

// ── Faculty ────────────────────────────────────────────────────────

test('Faculty picker: Class In-Charge students and handling-class students, plus staff', async () => {
  const ic = names(await pick(facIC));
  assert.ok(ic.includes('Rahul A1') && ic.includes('Rahul A2'), 'their Class In-Charge class');
  assert.ok(!ic.includes('Rahul B') && !ic.includes('Rahul Y2') && !ic.includes('Rahul Ece'));
  assert.ok(ic.includes('Fac Ece') && ic.includes('Principal') && ic.includes('HOD ECE'), 'any academic staff');

  const h = names(await pick(facH));
  assert.ok(h.includes('Rahul B'), 'their handling class');
  assert.ok(!h.includes('Rahul A1') && !h.includes('Rahul Ece') && !h.includes('Rahul Y2'));

  assert.equal((await dm(facH, stuA1)).status, 403, 'a student outside their classes');
  assert.ok([200, 201].includes((await dm(facH, stuB)).status));
  assert.ok([200, 201].includes((await dm(facH, facEce)).status), 'any faculty on campus');
});

// ── HOD ────────────────────────────────────────────────────────────

test('HOD picker: own department, plus classes they handle elsewhere — not other departments', async () => {
  const got = names(await pick(hod));
  for (const n of ['Rahul A1', 'Rahul A2', 'Rahul B', 'Rahul Y2']) assert.ok(got.includes(n), `${n} (own department)`);
  assert.ok(got.includes('Rahul EceB'), 'ECE section B is a class the HOD handles');
  assert.ok(!got.includes('Rahul Ece'), 'ECE section A is not');
  assert.ok(got.includes('Fac Ece') && got.includes('Principal'));
  assert.equal((await dm(hod, stuEce)).status, 403);
});

test('HOD groups need a type and a reason, and go to the principal — not live until approved', async () => {
  assert.equal((await group(hod, { name: 'No type', reason: 'Because', participantIds: ids(stuA1) })).status, 422);
  assert.equal((await group(hod, { name: 'No reason', category: 'custom', participantIds: ids(stuA1) })).status, 422);

  const req = await group(hod, {
    name: 'CY Year 3 project', category: 'custom', reason: 'Coordinate the inter-section project',
    participantIds: ids(stuA1, stuB, stuY2, facEce),
  });
  assert.equal(req.status, 202, JSON.stringify(req.body));
  assert.equal(req.body.pending, true);
  const id = req.body._id;
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: stuA1.token })).status, 404, 'not live yet');

  // The principal sees who is in it and why.
  const queue = await ctx.request('GET', '/chat/requests', { token: principal.token });
  const r = queue.body.find((x) => x._id === id);
  assert.ok(r, 'listed for the principal');
  assert.equal(r.reason, 'Coordinate the inter-section project');
  assert.equal(r.category, 'custom');
  assert.equal(r.createdBy.name, 'HOD CY');
  assert.equal(r.participants.length, 5);
  const note = await ctx.request('GET', '/notifications', { token: principal.token });
  assert.ok(note.body.items.some((n) => n.link === '/admin/chat-requests' && /HOD/.test(n.message)));

  assert.equal((await ctx.request('PATCH', `/chat/requests/${id}`, { token: hod.token, body: { action: 'approve' } })).status, 403, 'not self-approved');
  const ok = await ctx.request('PATCH', `/chat/requests/${id}`, { token: principal.token, body: { action: 'approve' } });
  assert.equal(ok.body.status, 'active');
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: stuB.token })).status, 200, 'members see it once approved');
});

test('The principal can reject; and only reviews HOD requests (faculty ones stay with the admin)', async () => {
  const req = await group(hod, { name: 'Rejected one', category: 'faculty', reason: 'Staff coordination', participantIds: ids(facEce) });
  const rej = await ctx.request('PATCH', `/chat/requests/${req.body._id}`, { token: principal.token, body: { action: 'reject', reason: 'Use the department group' } });
  assert.equal(rej.body.status, 'rejected');
  const mine = await ctx.request('GET', '/chat/requests', { token: hod.token });
  assert.ok(mine.body.some((x) => x._id === req.body._id && x.rejectReason === 'Use the department group'));

  const facReq = await group(facIC, { name: 'Our class', participantIds: ids(stuA1) });
  assert.equal(facReq.status, 202);
  assert.ok(!(await ctx.request('GET', '/chat/requests', { token: principal.token })).body.some((x) => x._id === facReq.body._id));
  assert.equal((await ctx.request('PATCH', `/chat/requests/${facReq.body._id}`, { token: principal.token, body: { action: 'approve' } })).status, 404);
  assert.equal((await ctx.request('PATCH', `/chat/requests/${facReq.body._id}`, { token: admin.token, body: { action: 'approve' } })).body.status, 'active');
});

test('HOD group members: own-department and handling-class students, campus-wide faculty — nobody else', async () => {
  const body = (participantIds) => ({ name: 'Members', category: 'custom', reason: 'Testing members', participantIds });
  assert.equal((await group(hod, body(ids(stuEce)))).status, 403, 'another department’s student');
  assert.equal((await group(hod, body(ids(principal)))).status, 403, 'only faculty / HODs as staff');
  assert.equal((await group(hod, body(ids(stuEceB, facEce, hodEce)))).status, 202, 'handling class + faculty from any department');
});

test('Academics is one class; Faculty is staff only', async () => {
  const academic = (participantIds) => group(hod, { name: 'Y3 A', category: 'academic', reason: 'Class group', participantIds });
  assert.equal((await academic(ids(stuA1, stuB))).status, 422, 'two sections');
  assert.equal((await academic(ids(stuA1, stuY2))).status, 422, 'two years');
  const ok = await academic(ids(stuA1, stuA2, facEce));
  assert.equal(ok.status, 202, JSON.stringify(ok.body));
  const stored = await ctx.models.Conversation.findById(ok.body._id).lean();
  assert.deepEqual([stored.category, stored.linkedDepartment, stored.linkedYear, stored.linkedSection], ['academic', CY, 3, 'A']);

  assert.equal((await group(hod, { name: 'Staff', category: 'faculty', reason: 'Staff only', participantIds: ids(facEce, stuA1) })).status, 422);
});

test('Only the HOD edits, deletes and manages members of their group', async () => {
  const req = await group(hod, { name: 'Managed', category: 'academic', reason: 'Class group', participantIds: ids(stuA1, facIC) });
  await ctx.request('PATCH', `/chat/requests/${req.body._id}`, { token: principal.token, body: { action: 'approve' } });
  const id = req.body._id;

  // Members cannot edit, delete, add or remove.
  assert.equal((await ctx.request('PATCH', `/chat/conversations/${id}`, { token: facIC.token, body: { name: 'Hijack' } })).status, 403);
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}`, { token: stuA1.token })).status, 403);
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: facIC.token, body: { userIds: ids(stuA2) } })).status, 403);

  // The HOD can — within the group's class for an academic group.
  assert.equal((await ctx.request('PATCH', `/chat/conversations/${id}`, { token: hod.token, body: { name: 'Managed (renamed)' } })).body.name, 'Managed (renamed)');
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(stuA2) } })).status, 200);
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/members`, { token: hod.token, body: { userIds: ids(stuB) } })).status, 422, 'another section');
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}/members/${stuA2.u._id}`, { token: hod.token })).status, 200);
  assert.equal((await ctx.request('DELETE', `/chat/conversations/${id}`, { token: hod.token })).status, 200);
  assert.equal((await ctx.request('GET', `/chat/conversations/${id}`, { token: stuA1.token })).status, 404, 'deleted for everyone');
});

test('Group builder class list: the HOD’s own department only; not for students or faculty', async () => {
  const res = await ctx.request('GET', '/chat/group-class?year=3&section=A', { token: hod.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.students.map((s) => s.name).sort(), ['Rahul A1', 'Rahul A2']);
  const spoof = await ctx.request('GET', '/chat/group-class?year=3&section=A&department=ECE', { token: hod.token });
  assert.equal(spoof.body.department, CY, 'a sent department is ignored for an HOD');
  assert.ok(!spoof.body.students.some((s) => s.name === 'Rahul Ece'));
  for (const actor of [stuA1, facIC]) {
    assert.equal((await ctx.request('GET', '/chat/group-class?year=3&section=A', { token: actor.token })).status, 403);
  }
});
