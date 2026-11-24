/**
 * Student and parent mobile numbers: exactly 10 digits on every path that sets
 * them, never the same number, and the parent-OTP temporary number is never the
 * student's own (and may be switched to while an OTP to the parent is live).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let env;
let admin;
let faculty;

const STUDENT = '9876500001';
const PARENT = '9876500002';

before(async () => {
  ctx = await startServer();
  ({ env } = await import('../src/config/env.js'));
  const a = await ctx.createUser({ role: 'admin', name: 'Admin', employeeId: 'E-MOB1' });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  const f = await ctx.createUser({ role: 'faculty', name: 'Class Faculty', department: 'CSE', section: 'A', teachingYears: [3], employeeId: 'E-MOB2' });
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
});
after(async () => ctx?.stop());

const rnd = () => Math.random().toString(36).slice(2, 8);
const newStudent = (over) => ({
  role: 'student', name: 'New Kid', email: `kid${rnd()}@test.edu`, password: 'Welcome@123', rollNo: `M${rnd().toUpperCase()}`,
  department: 'CSE', year: 3, section: 'A', semester: 5, stayType: 'hosteler', parentPhone: PARENT, ...over,
});
const create = (body) => ctx.request('POST', '/admin/users', { token: admin.token, body });

test('admin create: student and parent numbers must be exactly 10 digits and different', async () => {
  for (const [over, why] of [
    [{ parentPhone: '987650000' }, '9-digit parent'],
    [{ parentPhone: '98765000021' }, '11-digit parent'],
    [{ parentPhone: undefined }, 'missing parent'],
    [{ phone: '98765' }, 'short student'],
    [{ phone: PARENT }, 'same number'],
    [{ phone: `+91 ${PARENT}` }, 'same number, written differently'],
  ]) {
    const r = await create(newStudent(over));
    assert.equal(r.status, 422, `${why}: ${JSON.stringify(r.body)}`);
  }
  const ok = await create(newStudent({ phone: `+91 98765-00001`, parentPhone: `0${PARENT}` }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const stored = await ctx.models.User.findById(ok.body._id).lean();
  assert.equal(stored.phone, STUDENT, 'stored as the bare 10 digits');
  assert.equal(stored.parentPhone, PARENT);
});

test('every role: staff mobile numbers must be exactly 10 digits too', async () => {
  const hod = (phone) => create({ role: 'hod', name: 'New HOD', email: `hod${rnd()}@test.edu`, password: 'Welcome@123', employeeId: `E-${rnd()}`, department: 'ECE', phone });
  for (const bad of ['98765', '98765432101', '+1 555 0100', 'call me']) {
    const r = await hod(bad);
    assert.equal(r.status, 422, `${bad}: ${JSON.stringify(r.body)}`);
  }
  const ok = await hod('+91 98765-00009');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await ctx.models.User.findById(ok.body._id).lean()).phone, '9876500009', 'stored as the bare 10 digits');
  assert.equal((await hod('')).status, 201, 'the mobile stays optional');

  // Admin edit and the staff member's own profile follow the same rule.
  const staff = ok.body._id;
  assert.equal((await ctx.request('PATCH', `/admin/users/${staff}`, { token: admin.token, body: { phone: '12345' } })).status, 422);
  assert.equal((await ctx.request('PATCH', `/admin/users/${staff}`, { token: admin.token, body: { phone: '9876500010' } })).status, 200);
  assert.equal((await ctx.request('PUT', '/users/me', { token: faculty.token, body: { phone: '12345' } })).status, 422);
  assert.equal((await ctx.request('PUT', '/users/me', { token: faculty.token, body: { phone: '9876500011' } })).status, 200);
});

test('admin edit: a changed number must be 10 digits and not match the other one', async () => {
  const s = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, phone: STUDENT, parentPhone: PARENT });
  const patch = (body) => ctx.request('PATCH', `/admin/users/${s._id}`, { token: admin.token, body });
  assert.equal((await patch({ parentPhone: STUDENT })).status, 422);
  assert.equal((await patch({ phone: PARENT })).status, 422);
  assert.equal((await patch({ parentPhone: '12345678' })).status, 422);
  const ok = await patch({ parentPhone: '+91 91234 56780' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await ctx.models.User.findById(s._id).lean()).parentPhone, '9123456780');

  // An older record with a non-10-digit number is not blocked from unrelated edits.
  const legacy = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, parentPhone: '044-2345' });
  const r = await ctx.request('PATCH', `/admin/users/${legacy._id}`, { token: admin.token, body: { name: 'Renamed Student' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('own profile: a student mobile must be 10 digits and not the parent number', async () => {
  const s = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, parentPhone: PARENT });
  const me = await ctx.loginWeb(s);
  const put = (phone) => ctx.request('PUT', '/users/me', { token: me.token, body: { phone } });
  assert.equal((await put('98765')).status, 422);
  const same = await put(`+91 ${PARENT}`);
  assert.equal(same.status, 422);
  assert.match(same.body.message, /cannot be the same/);
  const ok = await put('98765 00001');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.phone, STUDENT);
});

async function pendingPass() {
  const s = await ctx.createUser({ name: `Otp Student ${rnd()}`, department: 'CSE', section: 'A', year: 3, phone: STUDENT, parentPhone: PARENT });
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: s._id, department: 'CSE', section: 'A', regarding: 'outing', description: 'Family function',
    fromDate: day, toDate: day, parentPhone: PARENT,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
  });
  return String(pass._id);
}
const sendOtp = (id, body) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: faculty.token, body });

test("parent OTP: the temporary number cannot be the student's own", async () => {
  const id = await pendingPass();
  const r = await sendOtp(id, { mobile: `+91 ${STUDENT}`, reason: 'Parent not answering' });
  assert.equal(r.status, 422);
  assert.match(r.body.message, /student's own/);
});

test('parent OTP: parent not answering, the faculty switches to a temporary number', async () => {
  const saved = env.otp.resendCooldownSeconds;
  env.otp.resendCooldownSeconds = 0;
  try {
    const id = await pendingPass();
    const first = await sendOtp(id);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const alt = await sendOtp(id, { mobile: '9123456780', reason: 'Father not answering, mother’s number' });
    assert.equal(alt.status, 200, JSON.stringify(alt.body));
    assert.equal(alt.body.maskedMobile, '******6780');
    const recs = await ctx.models.OutpassOtp.find({ gatePass: id }).sort({ createdAt: 1 }).lean();
    assert.deepEqual(recs.map((x) => x.status), ['superseded', 'active']);
  } finally {
    env.otp.resendCooldownSeconds = saved;
  }
});
