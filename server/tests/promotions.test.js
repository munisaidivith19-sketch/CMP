// Semester promotion: Principal only, previews change nothing, year follows semester, undo restores.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

let ctx;
let principal;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`.toUpperCase();

before(async () => {
  ctx = await startServer();
  const u = await ctx.createUser({ role: 'principal', employeeId: 'P-1' });
  principal = { u, ...(await ctx.loginWeb(u)) };
});
after(async () => {
  await ctx.stop();
});

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const student = (semester, extra = {}) => ctx.createUser({ department: 'ECE', section: 'A', semester, year: semester ? Math.ceil(semester / 2) : undefined, rollNo: `R${uniq()}`, ...extra });
const fresh = (u) => ctx.models.User.findById(u._id).lean();
const byRoll = (...students) => ({ kind: 'student', rollNos: students.map((s) => s.rollNo) });
const preview = (body) => req('POST', '/promotions/preview', principal, body);
const apply = (body) => req('POST', '/promotions', principal, { password: PASSWORD, ...body });
const undo = (id) => req('POST', `/promotions/${id}/undo`, principal, { password: PASSWORD });
const outcomeOf = (res, s) => res.body.rows.find((r) => String(r.student) === String(s._id));

test('only the Principal can preview, apply, list or undo', async () => {
  const s = await student(1);
  const body = { scope: byRoll(s), password: PASSWORD };
  for (const role of ['admin', 'super_admin', 'hod', 'faculty', 'student']) {
    const extra = role === 'student' ? { rollNo: `R${uniq()}` } : { employeeId: `E-${uniq()}` };
    const who = await ctx.loginWeb(await ctx.createUser({ role, department: 'ECE', ...extra }));
    assert.equal((await req('POST', '/promotions/preview', who, body)).status, 403, role);
    assert.equal((await req('POST', '/promotions', who, body)).status, 403, role);
    assert.equal((await req('GET', '/promotions', who)).status, 403, role);
  }
  assert.equal((await fresh(s)).semester, 1);
});

test('a preview shows what would happen and changes nothing', async () => {
  const s = await student(1);
  const res = await preview({ scope: byRoll(s) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.counts.promoted, 1);
  assert.equal(outcomeOf(res, s).to.semester, 2);
  assert.equal((await fresh(s)).semester, 1);
  assert.equal(await ctx.models.PromotionBatch.countDocuments({ 'items.student': s._id }), 0);
});

test('applying needs the Principal\'s password', async () => {
  const s = await student(1);
  const wrong = await req('POST', '/promotions', principal, { scope: byRoll(s), password: 'Wrong@12345' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'PASSWORD_INCORRECT');
  assert.equal((await req('POST', '/promotions', principal, { scope: byRoll(s) })).status, 422);
  assert.equal((await fresh(s)).semester, 1);
});

test('the year follows the semester at every step', async () => {
  for (const [from, to, year] of [[1, 2, 1], [2, 3, 2], [3, 4, 2], [4, 5, 3], [5, 6, 3], [6, 7, 4], [7, 8, 4]]) {
    const s = await student(from);
    assert.equal((await apply({ scope: byRoll(s) })).status, 201);
    const after = await fresh(s);
    assert.deepEqual([after.semester, after.year, after.section, after.role], [to, year, 'A', 'student'], `from semester ${from}`);
  }
});

test('finishing semester 8 marks the student graduated, and undo makes them a student again', async () => {
  const s = await student(8);
  const session = await ctx.loginWeb(s);
  const res = await apply({ scope: byRoll(s) });
  assert.equal(res.body.counts.graduated, 1);
  const grad = await fresh(s);
  assert.equal(grad.role, 'alumni');
  assert.ok(grad.graduatedAt);
  assert.equal(grad.semester, undefined);
  assert.equal(grad.section, undefined);
  assert.equal((await req('GET', '/auth/me', session)).status, 401, 'signs in again with the new role');

  assert.equal((await undo(res.body.id)).status, 200);
  const back = await fresh(s);
  assert.deepEqual([back.role, back.semester, back.year, back.section, back.graduatedAt], ['student', 8, 4, 'A', undefined]);
});

test('scopes: one section, one year, one department and the whole college', async () => {
  const dept = `Scope ${uniq()}`;
  const a1 = await student(1, { department: dept, section: 'A' });
  const b1 = await student(1, { department: dept, section: 'B' });
  const a3 = await student(3, { department: dept, section: 'A' });
  const other = await student(1, { department: `${dept} Other`, section: 'A' });
  const covered = async (scope) => {
    const res = await preview({ scope });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.rows.map((r) => String(r.student));
  };
  assert.deepEqual(await covered({ kind: 'section', department: dept, year: 1, section: 'a' }), [String(a1._id)]);
  assert.deepEqual((await covered({ kind: 'year', department: dept, year: 1 })).sort(), [String(a1._id), String(b1._id)].sort());
  assert.deepEqual((await covered({ kind: 'department', department: dept })).sort(), [String(a1._id), String(a3._id), String(b1._id)].sort());
  const all = await covered({ kind: 'college' });
  for (const s of [a1, b1, a3, other]) assert.ok(all.includes(String(s._id)));
  assert.equal((await preview({ scope: { kind: 'section', department: dept, year: 1 } })).status, 422);
  assert.equal((await preview({ scope: { kind: 'department' } })).status, 422);
  assert.equal((await preview({ scope: { kind: 'student', rollNos: [] } })).status, 422);
  assert.equal((await preview({ scope: { kind: 'everyone' } })).status, 422);
});

test('students can be held back or moved to another semester, with the year following', async () => {
  const dept = `Hold ${uniq()}`;
  const normal = await student(2, { department: dept });
  const held = await student(2, { department: dept });
  const ahead = await student(2, { department: dept });
  const behind = await student(4, { department: dept });
  const res = await apply({
    scope: { kind: 'department', department: dept },
    holdBack: [String(held._id)],
    moves: [{ student: String(ahead._id), semester: 5 }, { student: String(behind._id), semester: 3 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual([res.body.counts.promoted, res.body.counts.heldBack, res.body.counts.moved], [1, 1, 2]);
  assert.equal((await fresh(normal)).semester, 3);
  assert.equal((await fresh(held)).semester, 2);
  const a = await fresh(ahead);
  assert.deepEqual([a.semester, a.year], [5, 3]);
  const b = await fresh(behind);
  assert.deepEqual([b.semester, b.year], [3, 2]);
  assert.equal((await preview({ scope: byRoll(normal), moves: [{ student: String(normal._id), semester: 9 }] })).status, 422);
});

test('students who cannot move now are skipped and named, not silently changed', async () => {
  const inactive = await student(3, { isActive: false });
  const blank = await student(undefined);
  const outside = await student(3);
  await ctx.models.GatePass.create({
    student: outside._id, department: 'ECE', section: 'A', passType: 'normal', regarding: 'home', description: 'Going home for the weekend',
    fromDate: new Date(), toDate: new Date(Date.now() + 86400000), parentPhone: '9000000001',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Home' }, status: 'active', actualExit: new Date(),
  });
  const res = await preview({ scope: byRoll(inactive, blank, outside) });
  assert.equal(res.body.counts.skipped, 3);
  assert.equal(outcomeOf(res, inactive).reason, 'inactive');
  assert.equal(outcomeOf(res, blank).reason, 'no_semester');
  assert.equal(outcomeOf(res, outside).reason, 'on_gate_pass');
  assert.equal((await apply({ scope: byRoll(inactive, blank, outside) })).status, 422, 'nothing to promote');
  assert.equal((await fresh(outside)).semester, 3);
});

test('promoting the same students again needs a clear yes; undo clears the warning', async () => {
  const s = await student(1);
  const first = await apply({ scope: byRoll(s) });
  assert.equal((await preview({ scope: byRoll(s) })).body.recentlyPromoted, 1);
  const repeat = await apply({ scope: byRoll(s) });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.code, 'RECENTLY_PROMOTED');
  assert.equal((await fresh(s)).semester, 2);

  await undo(first.body.id);
  assert.equal((await fresh(s)).semester, 1);
  assert.equal((await preview({ scope: byRoll(s) })).body.recentlyPromoted, 0);

  await apply({ scope: byRoll(s) });
  assert.equal((await apply({ scope: byRoll(s), acknowledgeRecent: true })).status, 201);
  assert.equal((await fresh(s)).semester, 3);
});

test('undo restores everyone, leaves anyone changed since, needs the password and works once', async () => {
  const dept = `Undo ${uniq()}`;
  const s1 = await student(2, { department: dept });
  const s2 = await student(4, { department: dept });
  const res = await apply({ scope: { kind: 'department', department: dept } });
  assert.equal(res.status, 201);
  await ctx.models.User.updateOne({ _id: s2._id }, { $set: { semester: 7, year: 4 } }); // an Admin edited this student afterwards

  assert.equal((await req('POST', `/promotions/${res.body.id}/undo`, principal, { password: 'Wrong@12345' })).status, 403);
  assert.equal((await fresh(s1)).semester, 3, 'a wrong password changes nothing');

  const undone = await undo(res.body.id);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.deepEqual(undone.body.undoResult, { restored: 1, notRestored: 1 });
  const a = await fresh(s1);
  assert.deepEqual([a.semester, a.year], [2, 1]);
  assert.equal((await fresh(s2)).semester, 7, 'the later change is kept');
  assert.equal((await undo(res.body.id)).status, 409);
  assert.equal((await undo('0123456789abcdef01234567')).status, 404);
});

test('history lists promotions, and a batch shows each student before and after', async () => {
  const s = await student(1);
  const res = await apply({ scope: byRoll(s) });
  const list = await req('GET', '/promotions?limit=5', principal);
  assert.equal(list.status, 200);
  const row = list.body.items.find((b) => b.id === res.body.id);
  assert.equal(row.counts.promoted, 1);
  assert.equal(row.items, undefined);
  const one = await req('GET', `/promotions/${res.body.id}`, principal);
  assert.equal(one.body.items[0].from.semester, 1);
  assert.equal(one.body.items[0].to.semester, 2);
  assert.ok(await ctx.models.AuditLog.exists({ action: 'STUDENTS_PROMOTED' }));
});

test('a chosen semester promotes only the students in it (Semester 5 → 6), and must belong to the year', async () => {
  const dept = `SEM${uniq()}`;
  const odd = await student(5, { department: dept, section: 'B' });
  const even = await student(6, { department: dept, section: 'B' });
  const res = await preview({ scope: { kind: 'section', department: dept, year: 3, section: 'B', semester: 5 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(outcomeOf(res, odd).to.semester, 6);
  assert.equal(outcomeOf(res, even), undefined, 'semester 6 is not in this promotion');

  const byYear = await preview({ scope: { kind: 'year', department: dept, year: 3, semester: 6 } });
  assert.equal(outcomeOf(byYear, even).to.semester, 7);
  assert.equal(outcomeOf(byYear, even).to.year, 4);
  assert.equal(outcomeOf(byYear, odd), undefined);

  assert.equal((await preview({ scope: { kind: 'year', year: 3, semester: 2 } })).status, 422);
  assert.equal((await preview({ scope: { kind: 'year', year: 3, semester: 9 } })).status, 422);

  const done = await apply({ scope: { kind: 'section', department: dept, year: 3, section: 'B', semester: 5 } });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal((await fresh(odd)).semester, 6);
  assert.equal((await fresh(even)).semester, 6);
  const batch = await ctx.models.PromotionBatch.findOne({ 'items.student': odd._id }).lean();
  assert.equal(batch.scope.semester, 5);
});
