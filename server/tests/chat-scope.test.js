/**
 * Chat scope, HOD group requests and principal approval, socket security.
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

/** An approved HOD group. */
async function approvedGroup(body) {
  const req = await group(hod, { reason: 'Coordination group', ...body });
  assert.equal(req.status, 202, JSON.stringify(req.body));
  const ok = await review(principal, req.body._id, 'approve');
  assert.equal(ok.body.status, 'active', JSON.stringify(ok.body));
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

// ── Student ─────────────────────────────────────────────────────────

test('Student search: own exact class and academic staff — never another section, year, semester or department', async () => {
  const res = await pick(stuA1);
  assert.equal(res.status, 200);
  const got = names(res);
  assert.ok(got.includes('Rahul A2'), 'classmate');
  for (const staff of ['Fac InCharge', 'Fac Handling', 'Fac Ece', 'HOD CY', 'HOD ECE', 'Principal', 'Chairman', 'AO', 'Dean']) {
    assert.ok(got.includes(staff), `${staff} is reachable`);
  }
  for (const other of OUTSIDERS_OF_A1) assert.ok(!got.includes(other), `${other} must not be listed`);

  // Searching by name, or sending scope parameters, cannot surface them.
  assert.deepEqual(names(await pick(stuA1, '&q=Rahul')).sort(), ['Rahul A1', 'Rahul A2']);
  for (const qs of ['&section=B', '&department=ECE', '&year=2', '&semester=6', '&role=student', '&departmentId=ECE&sectionId=B', '&programId=ECE']) {
    assert.ok(!names(await pick(stuA1, qs)).some((n) => OUTSIDERS_OF_A1.includes(n)), qs);
  }
});

test('Student direct chats: classmates and any academic staff; another class is refused even by id', async () => {
  for (const ok of [stuA2, facEce, hodEce, principal, chairman, ao, dean]) {
    const res = await dm(stuA1, ok);
    assert.ok([200, 201].includes(res.status), `${ok.u.name}: ${JSON.stringify(res.body)}`);
  }
  for (const no of [stuB, stuY2, stuSem6, stuEce]) {
    const res = await dm(stuA1, no);
    assert.equal(res.status, 403, no.u.name);
  }
  // Extra body fields cannot widen it.
  const spoof = await ctx.request('POST', '/chat/conversations', {
    token: stuA1.token,
    body: { participantIds: ids(stuB), department: CY, section: 'B', year: 3, role: 'faculty', targetUserId: String(stuB.u._id) },
  });
  assert.equal(spoof.status, 403);
});

test('Student profiles: classmates and staff open; another class’s student is refused', async () => {
  for (const ok of [stuA2, facEce, hodEce, principal]) {
    assert.equal((await ctx.request('GET', `/users/${ok.u._id}`, { token: stuA1.token })).status, 200, ok.u.name);
  }
  for (const no of [stuB, stuY2, stuSem6, stuEce]) {
    assert.equal((await ctx.request('GET', `/users/${no.u._id}`, { token: stuA1.token })).status, 403, no.u.name);
  }
});

test('An existing out-of-scope chat is closed over REST and the socket alike', async () => {
  const old = await ctx.models.Conversation.create({ type: 'private', participants: [stuA1.u._id, stuB.u._id], createdBy: stuA1.u._id });
  const id = String(old._id);
  assert.ok(!(await ctx.request('GET', '/chat/conversations', { token: stuA1.token })).body.some((c) => c._id === id), 'not listed');
  for (const [method, path, body] of [
    ['GET', `/chat/conversations/${id}`],
    ['GET', `/chat/conversations/${id}/messages`],
    ['POST', `/chat/conversations/${id}/messages`, { body: 'hello' }],
    ['PATCH', `/chat/conversations/${id}/read`],
  ]) {
    assert.equal((await ctx.request(method, path, { token: stuA1.token, body })).status, 403, `${method} ${path}`);
    assert.equal((await ctx.request(method, path, { token: stuB.token, body })).status, 403, `${method} ${path} (other side)`);
  }
  const socket = await ctx.connect(stuA1.token);
  assert.equal((await emitAck(socket, 'chat:join', id)).ok, false, 'no live room');
  assert.equal((await emitAck(socket, 'chat:read', { conversationId: id })).ok, false, 'no read receipts');
});

test('A student may write to any HOD, and that HOD can answer', async () => {
  const conv = await dm(stuA1, hodEce);
  const id = conv.body._id;
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: stuA1.token, body: { body: 'Sir, a question' } })).status, 201);
  assert.equal((await dm(hodEce, stuA2)).status, 403, 'the HOD cannot start one with another department’s student');
  assert.ok((await ctx.request('GET', '/chat/conversations', { token: hodEce.token })).body.some((c) => c._id === id));
  assert.equal((await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: hodEce.token, body: { body: 'Yes?' } })).status, 201);
});

// ── Faculty ────────────────────────────────────────────────────────

test('Faculty: Class In-Charge and handling-class students, all staff — nobody else', async () => {
  const ic = names(await pick(facIC));
  assert.ok(ic.includes('Rahul A1') && ic.includes('Rahul A2'), 'Class In-Charge class');
  for (const n of ['Rahul B', 'Rahul Y2', 'Rahul Sem6', 'Rahul Ece']) assert.ok(!ic.includes(n), `${n} hidden from the in-charge`);
  for (const n of ['Fac Ece', 'Fac Handling', 'HOD CY', 'HOD ECE', 'Principal', 'Chairman', 'AO', 'Dean']) assert.ok(ic.includes(n), `${n} visible`);

  const h = names(await pick(facH));
  assert.ok(h.includes('Rahul B'), 'handling class');
  for (const n of ['Rahul A1', 'Rahul Y2', 'Rahul Ece']) assert.ok(!h.includes(n), `${n} hidden`);
  assert.ok(!names(await pick(facH, '&q=Rahul+A1&section=A&department=' + encodeURIComponent(CY))).includes('Rahul A1'), 'search cannot leak');

  assert.equal((await dm(facH, stuA1)).status, 403);
  assert.ok([200, 201].includes((await dm(facH, stuB)).status));
  assert.ok([200, 201].includes((await dm(facH, facEce)).status), 'any faculty on campus');
  assert.ok([200, 201].includes((await dm(facIC, dean)).status));
});

// ── HOD scope ──────────────────────────────────────────────────────

test('HOD: own-department students only — not another department, even a class the HOD teaches there', async () => {
  const got = names(await pick(hod));
  for (const n of ['Rahul A1', 'Rahul A2', 'Rahul B', 'Rahul Y2', 'Rahul Sem6']) assert.ok(got.includes(n), `${n} (own department)`);
  assert.ok(!got.includes('Rahul Ece'), 'another department');
  assert.ok(got.includes('Fac Ece') && got.includes('Principal'), 'staff campus-wide');
  for (const qs of ['&department=ECE', '&departmentId=ECE', '&q=Rahul+Ece']) assert.ok(!names(await pick(hod, qs)).includes('Rahul Ece'), qs);
  assert.equal((await dm(hod, stuEce)).status, 403);
});

test('Group builder class list: the HOD’s own department only', async () => {
  const res = await ctx.request('GET', '/chat/group-class?year=3&section=A', { token: hod.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.students.map((s) => s.name).sort(), ['Rahul A1', 'Rahul A2', 'Rahul Sem6']);
  const spoof = await ctx.request('GET', '/chat/group-class?year=3&section=A&department=ECE', { token: hod.token });
  assert.equal(spoof.body.department, CY, 'a sent department is ignored');
  for (const actor of [stuA1, facIC]) {
    assert.equal((await ctx.request('GET', '/chat/group-class?year=3&section=A', { token: actor.token })).status, 403);
  }
});
