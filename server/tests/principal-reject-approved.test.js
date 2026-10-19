/**
 * After approving, the principal can still reject (revoke) a gate pass — but
 * only until the student exits. Once security records OUT the pass is "active"
 * and can no longer be revoked; the return must be recorded instead.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const PARENT = '9876504321';
const DAY = 86400000;
let ctx;
const staff = {};
let student;

const approvedPass = async (code, extra = {}) => {
  const now = Date.now();
  return ctx.models.GatePass.create({
    student: student.u._id,
    regarding: 'outing',
    description: 'Going home for the weekend',
    parentPhone: PARENT,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    department: 'CSE',
    section: 'A',
    fromDate: new Date(now - DAY),
    toDate: new Date(now + DAY),
    status: 'approved',
    principalReview: { by: staff.principal.u._id, at: new Date(), action: 'approved' },
    verificationCode: code,
    verificationExpiry: new Date(now + 2 * DAY),
    ...extra,
  });
};
const revoke = (who, id, reason = 'Campus lockdown') => ctx.request('PATCH', `/gate-pass/${id}/revoke`, { token: who.token, body: { reason } });

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `E-${role}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.principal = await make('principal');
  staff.hod = await make('hod', { department: 'CSE' });
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A' });
  staff.security = await make('security');
  student = await make('student', { name: 'Revoke Student', rollNo: 'RV01', department: 'CSE', section: 'A', year: 3, parentPhone: PARENT });
});

after(async () => ctx?.stop());

test('the principal sees their approved, not-yet-used passes and can reject one before exit', async () => {
  const pass = await approvedPass('RV2A');
  const list = await ctx.request('GET', '/gate-pass?status=approved', { token: staff.principal.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.passes.some((p) => p._id === String(pass._id)), 'approved pass is listed for the principal');

  const rv = await revoke(staff.principal, pass._id);
  assert.equal(rv.status, 200);
  assert.equal(rv.body.status, 'revoked');
  assert.equal(rv.body.revokeReason, 'Campus lockdown');

  // The exit code is dead: security can neither verify it nor record OUT with it.
  assert.equal((await ctx.request('POST', '/gate-pass/verify', { token: staff.security.token, body: { code: 'RV2A' } })).status, 404);
  assert.notEqual((await ctx.request('PATCH', `/gate-pass/${pass._id}/out`, { token: staff.security.token, body: { code: 'RV2A' } })).status, 200);

  const note = await ctx.request('GET', '/notifications', { token: student.token });
  assert.ok(note.body.items.some((n) => n.title === 'Gate pass revoked'), 'student is told');
  assert.equal((await revoke(staff.principal, pass._id)).status, 422, 'cannot revoke twice');
});

test('once the student has exited, the principal can no longer reject the pass', async () => {
  const pass = await approvedPass('RV3B');
  const out = await ctx.request('PATCH', `/gate-pass/${pass._id}/out`, { token: staff.security.token, body: { code: 'RV3B' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const rv = await revoke(staff.principal, pass._id);
  assert.equal(rv.status, 422);
  assert.match(rv.body.message, /already outside/i);
  assert.equal((await ctx.models.GatePass.findById(pass._id)).status, 'active', 'pass stays active');
});

test('only the principal (or admin) can reject an approved pass', async () => {
  const pass = await approvedPass('RV4C');
  for (const who of ['hod', 'faculty', 'security']) {
    assert.equal((await revoke(staff[who], pass._id)).status, 403, `${who} is refused`);
  }
  assert.equal((await revoke(student, pass._id)).status, 403, 'student is refused');
  assert.equal((await ctx.models.GatePass.findById(pass._id)).status, 'approved');
});
