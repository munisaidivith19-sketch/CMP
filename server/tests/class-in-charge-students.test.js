/**
 * Class In-Charge editing their own class's student details.
 *
 * The class comes from the faculty account (department + section + in-charge
 * year + semester). Everything outside it — another section, year, semester or
 * department, a staff account, an inactive account — is refused, the
 * department can never change here, and only the listed fields are written.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const CSE = 'CSE (Cyber Security)';

let ctx;
let inCharge, plainFaculty, otherInCharge, admin, hod;
let mine1, mine2, otherSection, otherYear, otherDept, staffUser, inactiveMine;

const edit = (id, body, who = inCharge) => ctx.request('PATCH', `/class-students/${id}`, { token: who.token, body });
const detail = (id, who = inCharge) => ctx.request('GET', `/class-students/${id}`, { token: who.token });

before(async () => {
  ctx = await startServer();
  const login = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  inCharge = await login({ role: 'faculty', name: 'In Charge', department: CSE, section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3], teachingSections: ['A'], employeeId: 'E-IC' });
  otherInCharge = await login({ role: 'faculty', name: 'Other In Charge', department: CSE, section: 'B', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3], teachingSections: ['B'], employeeId: 'E-IC2' });
  plainFaculty = await login({ role: 'faculty', name: 'No Class', department: CSE, employeeId: 'E-NC' });
  admin = await login({ role: 'admin', name: 'Admin' });
  hod = await login({ role: 'hod', name: 'HOD', department: CSE, employeeId: 'E-HOD' });

  const student = (o) => ctx.createUser({ department: CSE, section: 'A', year: 3, semester: 5, parentPhone: '9000000001', ...o });
  mine1 = await login({ name: 'Mine One', email: 'mine1@jnn.edu.in', rollNo: '301', department: CSE, section: 'A', year: 3, semester: 5, parentPhone: '9000000001' });
  mine2 = await student({ name: 'Mine Two', email: 'mine2@jnn.edu.in', rollNo: '302' });
  otherSection = await student({ name: 'Section B', section: 'B', rollNo: '401' });
  otherYear = await student({ name: 'Year Two', year: 2, semester: 3, rollNo: '201' });
  otherDept = await student({ name: 'ECE Student', department: 'ECE', rollNo: '501' });
  staffUser = await ctx.createUser({ role: 'faculty', name: 'Staff Same Section', department: CSE, section: 'A', employeeId: 'E-SS' });
  inactiveMine = await student({ name: 'Inactive', rollNo: '399', isActive: false });
});
after(async () => {
  await ctx.stop();
});

test('Detail: a Class In-Charge can open their own student with the details the form needs', async () => {
  const res = await detail(mine1.u._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.name, 'Mine One');
  assert.equal(res.body.parentPhone, '9000000001');
  assert.ok(!('password' in res.body) && !('tokenVersion' in res.body));
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('Detail: another class, a staff account, other faculty and other roles are refused', async () => {
  for (const target of [otherSection, otherYear, otherDept, staffUser]) assert.equal((await detail(target._id)).status, 403, target.name);
  assert.equal((await detail(mine1.u._id, plainFaculty)).status, 403);
  assert.equal((await detail(mine1.u._id, otherInCharge)).status, 403);
  for (const who of [admin, hod, mine1]) assert.equal((await detail(mine1.u._id, who)).status, 403);
});

test('Edit: name, email, roll number, mobiles and stay are saved for their own student', async () => {
  const res = await edit(mine2._id, {
    name: 'Mine Two Renamed',
    email: 'Mine2.New@jnn.edu.in',
    rollNo: '302A',
    phone: '9111111111',
    parentPhone: '9222222222',
    stayType: 'hosteler',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const saved = await ctx.models.User.findById(mine2._id).lean();
  assert.equal(saved.name, 'Mine Two Renamed');
  assert.equal(saved.email, 'mine2.new@jnn.edu.in');
  assert.equal(saved.rollNo, '302A');
  assert.equal(saved.phone, '9111111111');
  assert.equal(saved.parentPhone, '9222222222');
  assert.equal(saved.stayType, 'hosteler');

  const log = await ctx.models.SecurityLog.findOne({ event: 'USER_UPDATED', targetUser: mine2._id }).lean();
  assert.ok(log, 'the change is recorded in Security & Logs');
  assert.equal(String(log.actor), String(inCharge.u._id));
  assert.ok(!JSON.stringify(log).includes('9222222222'), 'the parent number itself is not copied into the log');
});

test('Edit: year / section / semester can move a student, after which they are no longer editable', async () => {
  const s = await ctx.createUser({ name: 'Mover', department: CSE, section: 'A', year: 3, semester: 5, rollNo: '350' });
  const res = await edit(s._id, { section: 'b' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.section, 'B');
  assert.equal(res.body.movedOutOfClass, true);
  assert.ok(await ctx.models.SecurityLog.exists({ event: 'ACADEMIC_SCOPE_CHANGED', targetUser: s._id }));
  // Now in section B: outside this in-charge's class, inside the other one's.
  assert.equal((await edit(s._id, { name: 'Back Again' })).status, 403);
  assert.equal((await edit(s._id, { section: 'A' }, otherInCharge)).status, 200);
});

test('Edit: a semester that does not belong to the year is refused', async () => {
  const res = await edit(mine1.u._id, { year: 3, semester: 2 });
  assert.equal(res.status, 422);
  assert.equal((await ctx.models.User.findById(mine1.u._id).lean()).semester, 5, 'nothing was written');
});

test('Edit: the department never changes here', async () => {
  const res = await edit(mine1.u._id, { department: 'ECE', name: 'Sneaky' });
  assert.equal(res.status, 403);
  const saved = await ctx.models.User.findById(mine1.u._id).lean();
  assert.equal(saved.department, CSE);
  assert.equal(saved.name, 'Mine One', 'the whole request is refused, not partly applied');
  // Sending the same department back unchanged is fine.
  assert.equal((await edit(mine1.u._id, { department: CSE })).status, 200);
});

test('Edit: students outside the class, staff and unknown accounts are all refused the same way', async () => {
  for (const target of [otherSection, otherYear, otherDept, staffUser]) {
    const res = await edit(target._id, { name: 'Hijacked' });
    assert.equal(res.status, 403, target.name);
    assert.notEqual((await ctx.models.User.findById(target._id).lean()).name, 'Hijacked');
  }
  assert.equal((await edit('64b000000000000000000000', { name: 'Ghost' })).status, 403);
  assert.equal((await edit('not-an-id', { name: 'Ghost' })).status, 422);
});

test('Edit: a suspended student of the class (shown on the Students page) can still be corrected', async () => {
  const res = await edit(inactiveMine._id, { rollNo: '399b' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const saved = await ctx.models.User.findById(inactiveMine._id).lean();
  assert.equal(saved.rollNo, '399B', 'roll numbers are stored upper-case, as on create');
  assert.equal(saved.isActive, false, 'editing never reactivates an account');
});

test('Edit: faculty without a class and other roles cannot use it', async () => {
  assert.equal((await edit(mine1.u._id, { name: 'Xavier' }, plainFaculty)).status, 403);
  assert.equal((await edit(mine1.u._id, { name: 'Xavier' }, otherInCharge)).status, 403);
  for (const who of [hod, admin, mine1]) assert.equal((await edit(mine1.u._id, { name: 'Xavier' }, who)).status, 403);
});

test('Edit: privilege and account fields are ignored (mass assignment)', async () => {
  const res = await edit(mine1.u._id, {
    role: 'admin',
    isActive: false,
    password: 'Hacked@123',
    tokenVersion: 99,
    inChargeYear: 3,
    employeeId: 'E-HACK',
  });
  assert.equal(res.status, 200);
  const saved = await ctx.models.User.findById(mine1.u._id).select('+password +tokenVersion').lean();
  assert.equal(saved.role, 'student');
  assert.equal(saved.isActive, true);
  assert.equal(saved.employeeId, undefined);
  assert.equal(saved.inChargeYear, undefined);
  // The student can still sign in with their own password.
  const login = await ctx.loginWeb(mine1.u);
  assert.ok(login.token);
});

test('Edit: duplicate email, bad values and operator injection are rejected', async () => {
  assert.equal((await edit(mine1.u._id, { email: 'mine2.new@jnn.edu.in' })).status, 409);
  assert.equal((await edit(mine1.u._id, { email: 'not-an-email' })).status, 422);
  assert.equal((await edit(mine1.u._id, { name: '' })).status, 422);
  assert.equal((await edit(mine1.u._id, { year: 7 })).status, 422);
  assert.equal((await edit(mine1.u._id, { section: 'Z' })).status, 422);
  assert.equal((await edit(mine1.u._id, { stayType: 'castle' })).status, 422);
  assert.equal((await edit(mine1.u._id, { phone: 'call me<script>' })).status, 422);
  assert.equal((await edit(mine1.u._id, { email: { $ne: null } })).status, 422);
  assert.equal((await edit(mine1.u._id, { rollNo: { $gt: '' } })).status, 422);
});
