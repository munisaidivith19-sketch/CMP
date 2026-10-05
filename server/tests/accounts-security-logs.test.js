/**
 * Class In-Charge student accounts, authorized password resets, the retired
 * email reset, and Admin → Security & Logs (Security Logs + OTP cards).
 */
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep, PASSWORD } from './helpers.js';
import { env } from '../src/config/env.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';
import { collegeSmsProvider } from '../src/services/otp/providers/collegeSmsProvider.js';

let ctx;
let admin, admin2, cic, cicOther, plainFaculty, hod, principal, studentA, studentB, otherYear;
const NON_ADMIN_ROLES = ['student', 'club_admin', 'faculty', 'hod', 'principal', 'dean', 'ao', 'chairman', 'warden', 'security', 'alumni'];
const nonAdmins = {};
let n = 0;

const req = (method, path, who, body, headers) => ctx.request(method, path, { token: who?.token, body, headers });
const logs = (filter) => ctx.models.SecurityLog.find(filter).sort({ createdAt: -1 }).lean();
const settle = () => sleep(150); // security records are written without blocking the response

before(async () => {
  ctx = await startServer();
  const make = (o) => ctx.createUser(o);
  const [a, a2, c, c2, pf, h, p, sa, sb, oy] = await Promise.all([
    make({ role: 'admin', name: 'Admin One' }),
    make({ role: 'admin', name: 'Admin Two' }),
    // Class In-Charge of CSE · 3rd year · section A · semester 5.
    make({ role: 'faculty', name: 'CIC Faculty', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3] }),
    make({ role: 'faculty', name: 'ECE CIC', department: 'ECE', section: 'B', inChargeYear: 2, inChargeSemester: 3, teachingYears: [2] }),
    // Teaches CSE 3A but is NOT a Class In-Charge.
    make({ role: 'faculty', name: 'Subject Faculty', department: 'CSE', teachingYears: [3], teachingSections: ['A'] }),
    make({ role: 'hod', name: 'HOD', department: 'CSE' }),
    make({ role: 'principal', name: 'Principal' }),
    make({ name: 'Rahul Kumar', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE041', parentPhone: '9876504321' }),
    make({ name: 'Other Section', department: 'CSE', section: 'B', year: 3, semester: 5, rollNo: '23CSE099', parentPhone: '9876500000' }),
    make({ name: 'Other Year', department: 'CSE', section: 'A', year: 2, semester: 3, rollNo: '24CSE001', parentPhone: '9876511111' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  admin2 = { u: a2, ...(await ctx.loginWeb(a2)) };
  cic = { u: c, ...(await ctx.loginWeb(c)) };
  cicOther = { u: c2, ...(await ctx.loginWeb(c2)) };
  plainFaculty = { u: pf, ...(await ctx.loginWeb(pf)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  studentA = { u: sa, ...(await ctx.loginWeb(sa)) };
  studentB = { u: sb, ...(await ctx.loginWeb(sb)) };
  otherYear = { u: oy };
  for (const role of NON_ADMIN_ROLES) {
    const extra = role === 'faculty' || role === 'hod' ? { department: 'CSE' } : {};
    const u = await make({ role, ...extra });
    nonAdmins[role] = { u, ...(await ctx.loginWeb(u)) };
  }
});
after(async () => {
  await ctx.stop();
});

const newStudentBody = (over = {}) => {
  n += 1;
  return { name: `New Student ${n}`, email: `new${n}@jnn.edu.in`, password: 'Welcome123', rollNo: `23cse2${n}`, stayType: 'day_scholar', parentPhone: '+91 98765 43210', ...over };
};

// ── Faculty (Class In-Charge) student creation ──────────────────────

test('Class In-Charge creates a student; department, year, section and semester come from their scope', async () => {
  const list = await req('GET', '/class-students', cic);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.scope, { department: 'CSE', year: 3, section: 'A', semester: 5 });
  assert.ok(list.body.items.some((s) => s.rollNo === '23CSE041'));
  assert.ok(!list.body.items.some((s) => ['23CSE099', '24CSE001'].includes(s.rollNo)), 'only their own class');

  const body = newStudentBody();
  const res = await req('POST', '/class-students', cic, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.password, undefined);
  const stored = await ctx.models.User.findOne({ email: body.email }).lean();
  assert.equal(stored.role, 'student');
  assert.equal(stored.department, 'CSE');
  assert.equal(stored.year, 3);
  assert.equal(stored.section, 'A');
  assert.equal(stored.semester, 5);
  assert.equal(stored.rollNo, body.rollNo.toUpperCase());
  assert.notEqual(stored.password, body.password, 'stored hashed');

  // Sending the same scope explicitly is accepted.
  const same = await req('POST', '/class-students', cic, newStudentBody({ department: 'CSE', year: 3, section: 'a', semester: 5 }));
  assert.equal(same.status, 201);

  // The new student can sign in.
  const login = await ctx.request('POST', '/auth/login', { body: { email: body.email, password: body.password } });
  assert.equal(login.status, 200);
});

test('backend rejects a Class In-Charge naming another department, year, section, semester or role', async () => {
  for (const over of [{ department: 'ECE' }, { year: 2 }, { section: 'B' }, { semester: 6 }, { role: 'admin' }, { role: 'faculty' }]) {
    const body = newStudentBody(over);
    const res = await req('POST', '/class-students', cic, body);
    assert.equal(res.status, 403, JSON.stringify(over));
    assert.equal(await ctx.models.User.exists({ email: body.email }), null, `nothing created for ${JSON.stringify(over)}`);
  }
  await settle();
  assert.ok((await logs({ event: 'USER_CREATED', success: false, reason: 'scope_tampering', actor: cic.u._id })).length >= 6);
});

test('faculty without Class In-Charge, and every other non-admin role, cannot create students', async () => {
  const body = newStudentBody();
  assert.equal((await req('POST', '/class-students', plainFaculty, body)).status, 403);
  assert.deepEqual((await req('GET', '/class-students', plainFaculty)).body, { scope: null, items: [] });
  for (const who of [hod, principal, studentA]) {
    assert.equal((await req('POST', '/class-students', who, newStudentBody())).status, 403);
  }
  // Faculty cannot use the admin endpoint either.
  assert.equal((await req('POST', '/admin/users', cic, { ...newStudentBody(), role: 'student', department: 'CSE', year: 3, section: 'A' })).status, 403);
  assert.equal(await ctx.models.User.exists({ email: body.email }), null);
  assert.equal((await req('POST', '/class-students', undefined, newStudentBody())).status, 401);
});

// ── Admin student management ────────────────────────────────────────

test('Admin creates and edits a student college-wide; changes are logged with old/new scope', async () => {
  const body = { ...newStudentBody(), role: 'student', department: 'ECE', year: 2, section: 'B', semester: 3 };
  const created = await req('POST', '/admin/users', admin, body);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const id = created.body._id;
  const edit = await req('PATCH', `/admin/users/${id}`, admin, { name: 'Renamed Student', email: `renamed${n}@jnn.edu.in`, section: 'C', parentPhone: '9000011111' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.name, 'Renamed Student');
  assert.equal(edit.body.section, 'C');

  // Email stays unique.
  assert.equal((await req('PATCH', `/admin/users/${id}`, admin, { email: studentA.u.email })).status, 409);

  await settle();
  const [createdLog] = await logs({ event: 'USER_CREATED', targetUser: id });
  assert.equal(String(createdLog.actor), String(admin.u._id));
  assert.equal(createdLog.actorRole, 'admin');
  const [scopeLog] = await logs({ event: 'ACADEMIC_SCOPE_CHANGED', targetUser: id });
  assert.equal(scopeLog.details.previous.section, 'B');
  assert.equal(scopeLog.details.new.section, 'C');
  const [updated] = await logs({ event: 'USER_UPDATED', targetUser: id });
  assert.ok(updated.details.fields.includes('name') && updated.details.fields.includes('email'));
  assert.ok(!JSON.stringify(updated).includes('9000011111'), 'changed values are not copied into USER_UPDATED');
});

test('role, enable/disable and Class In-Charge changes are recorded', async () => {
  const f = await ctx.createUser({ role: 'faculty', department: 'CSE', teachingYears: [1] });
  assert.equal((await req('PATCH', `/admin/users/${f._id}`, admin, { section: 'D', inChargeYear: 1, inChargeSemester: 2 })).status, 200);
  assert.equal((await req('PATCH', `/admin/users/${f._id}`, admin, { role: 'hod' })).status, 200);
  assert.equal((await req('PATCH', `/admin/users/${f._id}`, admin, { isActive: false })).status, 200);
  assert.equal((await req('PATCH', `/admin/users/${f._id}`, admin, { isActive: true })).status, 200);
  await settle();
  const events = (await logs({ targetUser: f._id })).map((l) => l.event);
  for (const e of ['CLASS_IN_CHARGE_CHANGED', 'ROLE_CHANGED', 'USER_DISABLED', 'USER_ENABLED', 'USER_UPDATED']) assert.ok(events.includes(e), e);
  const [role] = await logs({ event: 'ROLE_CHANGED', targetUser: f._id });
  assert.deepEqual(role.details, { previousRole: 'faculty', newRole: 'hod' });
});

// ── Authorized password reset ───────────────────────────────────────

test('Class In-Charge resets their student’s password without the old one; sessions are revoked', async () => {
  const s = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5 });
  const web = await ctx.loginWeb(s);
  const phone = await ctx.loginMobile(s);

  const mismatch = await req('POST', `/users/${s._id}/reset-password`, cic, { newPassword: 'Fresh1234', confirmPassword: 'Fresh12345' });
  assert.equal(mismatch.status, 422);
  const weak = await req('POST', `/users/${s._id}/reset-password`, cic, { newPassword: 'short', confirmPassword: 'short' });
  assert.equal(weak.status, 422);

  const res = await req('POST', `/users/${s._id}/reset-password`, cic, { newPassword: 'Fresh1234', confirmPassword: 'Fresh1234', reason: 'Forgot password' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.sessionsRevoked, 2);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  assert.equal((await req('GET', '/auth/me', web)).status, 401, 'web session revoked');
  assert.equal((await req('GET', '/auth/me', phone)).status, 401, 'mobile session revoked');
  const refresh = await ctx.request('POST', '/auth/refresh', { body: { refreshToken: phone.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  assert.equal(refresh.status, 401, 'refresh token dead');
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: s.email, password: PASSWORD } })).status, 401, 'old password gone');
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: s.email, password: 'Fresh1234' } })).status, 200);

  await settle();
  const [log] = await logs({ event: 'PASSWORD_RESET', targetUser: s._id });
  assert.equal(String(log.actor), String(cic.u._id));
  assert.equal(log.actorRole, 'faculty');
  assert.equal(log.targetRole, 'student');
  assert.equal(log.reason, 'Forgot password');
  assert.deepEqual(log.details.classInCharge, { department: 'CSE', year: 3, section: 'A', semester: 5 });
  assert.equal(log.client, 'web');
  assert.ok(log.ip && log.device && log.os && log.browser);
  assert.equal((await logs({ event: 'FORCED_LOGOUT', targetUser: s._id })).length, 1);
  const all = JSON.stringify(await ctx.models.SecurityLog.find({}).lean());
  assert.ok(!all.includes('Fresh1234') && !all.includes(PASSWORD), 'no password value in any security record');
  assert.ok(!/\$2[aby]\$/.test(all), 'no password hash in any security record');
});

test('faculty cannot reset passwords outside their class or for staff; other roles get 403', async () => {
  const body = { newPassword: 'Hijack1234', confirmPassword: 'Hijack1234' };
  const targets = [studentB.u, otherYear.u, plainFaculty.u, hod.u, principal.u, admin.u, cicOther.u];
  for (const t of targets) assert.equal((await req('POST', `/users/${t._id}/reset-password`, cic, body)).status, 403, `${t.name}`);
  // Not a Class In-Charge at all.
  assert.equal((await req('POST', `/users/${studentA.u._id}/reset-password`, plainFaculty, body)).status, 403);
  // A Class In-Charge of another class.
  assert.equal((await req('POST', `/users/${studentA.u._id}/reset-password`, cicOther, body)).status, 403);
  for (const role of ['student', 'hod', 'principal', 'dean', 'ao', 'chairman', 'warden', 'security']) {
    assert.equal((await req('POST', `/users/${studentA.u._id}/reset-password`, nonAdmins[role], body)).status, 403, role);
  }
  // Nothing changed.
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: studentA.u.email, password: 'Hijack1234' } })).status, 401);
  assert.equal((await req('GET', '/auth/me', studentA)).status, 200, 'victim session intact');
  await settle();
  assert.ok((await logs({ event: 'PASSWORD_RESET_FAILED' })).length >= targets.length + 10);
});

test('Admin resets any non-admin password; not their own and not another admin’s', async () => {
  const body = { newPassword: 'AdminSet123', confirmPassword: 'AdminSet123' };
  const f = await ctx.createUser({ role: 'faculty', department: 'CSE' });
  const fWeb = await ctx.loginWeb(f);
  assert.equal((await req('POST', `/users/${f._id}/reset-password`, admin, body)).status, 200);
  assert.equal((await req('GET', '/auth/me', fWeb)).status, 401);
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: f.email, password: 'AdminSet123' } })).status, 200);

  const s = await ctx.createUser({ department: 'ECE', section: 'C', year: 1, semester: 1 });
  assert.equal((await req('POST', `/users/${s._id}/reset-password`, admin, body)).status, 200, 'college-wide');

  assert.equal((await req('POST', `/users/${admin2.u._id}/reset-password`, admin, body)).status, 403);
  assert.equal((await req('POST', `/users/${admin.u._id}/reset-password`, admin, body)).status, 400);
  assert.equal((await req('POST', '/users/0123456789abcdef01234567/reset-password', admin, body)).status, 404);
  assert.equal((await req('POST', '/users/not-an-id/reset-password', admin, body)).status, 422);
  await settle();
  const [log] = await logs({ event: 'PASSWORD_RESET', targetUser: f._id });
  assert.equal(log.details.via, 'admin');
  assert.equal(log.targetRole, 'faculty');
});

test('self password change still requires the current password, and is logged (faculty included)', async () => {
  const f = await ctx.createUser({ role: 'faculty', department: 'CSE' });
  const web = await ctx.loginWeb(f);
  const wrong = await req('POST', '/auth/change-password', web, { currentPassword: 'Nope12345', newPassword: 'Changed123' });
  assert.equal(wrong.status, 400);
  const missing = await req('POST', '/auth/change-password', web, { newPassword: 'Changed123' });
  assert.equal(missing.status, 422);
  const ok = await req('POST', '/auth/change-password', web, { currentPassword: PASSWORD, newPassword: 'Changed123' });
  assert.equal(ok.status, 200);
  await settle();
  const records = await logs({ event: 'PASSWORD_CHANGED', targetUser: f._id });
  assert.deepEqual(records.map((r) => r.success).sort(), [false, true]);
  assert.ok(records.every((r) => r.actorRole === 'faculty'));
});

// ── Authentication events ───────────────────────────────────────────

test('login success / failure, logout and session creation are recorded with client details', async () => {
  const s = await ctx.createUser();
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: s.email, password: 'WrongPass1' } })).status, 401);
  assert.equal((await ctx.request('POST', '/auth/login', { body: { email: 'nobody@jnn.edu.in', password: 'WrongPass1' } })).status, 401);
  const phone = await ctx.loginMobile(s);
  await ctx.request('POST', '/auth/logout', { body: { refreshToken: phone.refreshToken }, headers: { 'x-client-platform': 'mobile' } });
  await settle();

  const [failed] = await logs({ event: 'LOGIN_FAILED', targetUser: s._id });
  assert.equal(failed.success, false);
  assert.equal(failed.reason, 'invalid_password');
  const [unknown] = await logs({ event: 'LOGIN_FAILED', identifier: 'nobody@jnn.edu.in' });
  assert.equal(unknown.reason, 'unknown_account');
  assert.equal(unknown.actor, undefined);

  const [ok] = await logs({ event: 'LOGIN_SUCCESS', targetUser: s._id });
  assert.equal(ok.client, 'mobile');
  assert.equal(ok.device, 'Mobile app · Pixel 8');
  assert.equal((await logs({ event: 'SESSION_CREATED', targetUser: s._id })).length, 1);
  const [out] = await logs({ event: 'LOGOUT', targetUser: s._id });
  assert.equal(out.actorRole, 'student');

  const all = JSON.stringify(await ctx.models.SecurityLog.find({}).lean());
  assert.ok(!all.includes('WrongPass1'), 'attempted passwords are never logged');
  assert.ok(!all.includes(phone.refreshToken) && !all.includes(phone.token), 'tokens are never logged');
});

test('a client cannot forge the actor, role or timestamp of a security record', async () => {
  const before = Date.now();
  await req('POST', '/auth/change-password', studentB, {
    currentPassword: 'definitely-wrong1',
    newPassword: 'Another123',
    actor: admin.u._id,
    actorRole: 'admin',
    createdAt: '2001-01-01T00:00:00Z',
  });
  await settle();
  const [rec] = await logs({ event: 'PASSWORD_CHANGED', targetUser: studentB.u._id });
  assert.equal(String(rec.actor), String(studentB.u._id));
  assert.equal(rec.actorRole, 'student');
  assert.ok(new Date(rec.createdAt).getTime() >= before - 1000);
});

test('security records are append-only at the model level', async () => {
  const rec = await ctx.models.SecurityLog.findOne({});
  await assert.rejects(ctx.models.SecurityLog.updateOne({ _id: rec._id }, { $set: { success: false } }), /append-only/);
  await assert.rejects(ctx.models.SecurityLog.findOneAndUpdate({ _id: rec._id }, { $set: { reason: 'x' } }), /append-only/);
  rec.reason = 'tampered';
  await assert.rejects(rec.save(), /append-only/);
});

// ── Security & Logs: Admin only ─────────────────────────────────────

const SECURITY_PATHS = ['/admin/security/summary', '/admin/security/logs', '/admin/security/otps'];

test('every Security & Logs API is Admin-only: all other roles get 403, anonymous 401', async () => {
  for (const path of SECURITY_PATHS) {
    assert.equal((await req('GET', path)).status, 401, path);
    for (const role of NON_ADMIN_ROLES) {
      const res = await req('GET', path, nonAdmins[role]);
      assert.equal(res.status, 403, `${role} ${path}`);
      assert.equal(res.body.items, undefined);
    }
    assert.equal((await req('GET', path, cic)).status, 403, `class in-charge ${path}`);
    assert.equal((await req('GET', path, admin)).status, 200, `admin ${path}`);
  }
  // No write verbs exist on the logs.
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal((await req(method, '/admin/security/logs', admin, {})).status, 404, method);
  }
});

test('Security Logs: summary cards, filters, search and validation', async () => {
  const summary = await req('GET', '/admin/security/summary', admin);
  assert.equal(summary.headers.get('cache-control'), 'no-store');
  for (const k of ['loginsToday', 'failedLoginsToday', 'passwordResetsToday', 'activeSessions']) assert.equal(typeof summary.body[k], 'number', k);
  assert.ok(summary.body.loginsToday > 0 && summary.body.failedLoginsToday > 0 && summary.body.passwordResetsToday > 0);

  const failed = await req('GET', '/admin/security/logs?event=LOGIN_FAILED&success=false&range=today', admin);
  assert.equal(failed.status, 200);
  assert.ok(failed.body.items.length > 0 && failed.body.items.every((l) => l.event === 'LOGIN_FAILED' && !l.success));

  const mobile = await req('GET', '/admin/security/logs?client=mobile', admin);
  assert.ok(mobile.body.items.length > 0 && mobile.body.items.every((l) => l.client === 'mobile'));

  const byRoll = await req('GET', '/admin/security/logs?q=23CSE041', admin);
  assert.ok(byRoll.body.items.length > 0);
  assert.ok(byRoll.body.items.every((l) => [l.actor?._id, l.targetUser?._id].includes(String(studentA.u._id))));

  const byRole = await req('GET', '/admin/security/logs?role=faculty', admin);
  assert.ok(byRole.body.items.every((l) => l.actorRole === 'faculty' || l.targetRole === 'faculty'));

  const yesterday = await req('GET', '/admin/security/logs?range=yesterday', admin);
  assert.equal(yesterday.body.total, 0);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await req('GET', `/admin/security/logs?range=custom&from=${day}&to=${day}`, admin)).status, 200);

  for (const bad of ['event=HACKED', 'role=root', 'success=maybe', 'client=tv', 'range=forever', 'from=yesterday', 'q[$ne]=x']) {
    const res = await req('GET', `/admin/security/logs?${bad}`, admin);
    assert.ok([400, 422].includes(res.status), `${bad} → ${res.status}`);
  }
  // Regex metacharacters are treated literally.
  assert.equal((await req('GET', `/admin/security/logs?q=${encodeURIComponent('.*(a+)+$')}`, admin)).status, 200);
  // Populated users carry no secrets.
  assert.ok(!JSON.stringify(failed.body).match(/"password"|tokenVersion|\$2[aby]\$/));
});

// ── OTP cards ───────────────────────────────────────────────────────

async function newPass(student) {
  const day = new Date().toISOString().slice(0, 10);
  const pass = await ctx.models.GatePass.create({
    student: student._id,
    department: student.department,
    section: student.section,
    regarding: 'outing',
    description: 'Family function',
    fromDate: day,
    toDate: day,
    parentPhone: student.parentPhone,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
  });
  return String(pass._id);
}
const sendOtp = (id, who = cic, body) => ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: who.token, body });
const verifyOtp = (id, otp, who = cic) => ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: who.token, body: { otp } });
const latestOtp = (id) => ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
const otpCards = async (qs = '') => (await req('GET', `/admin/security/otps${qs}`, admin)).body;

test('OTP: generated with SMS disabled, shown as its own card with every field, newest first; verification still works', async () => {
  assert.equal(env.otp.smsEnabled, false);
  const sendSpy = mock.method(collegeSmsProvider, 'sendOtp');
  const s1 = await ctx.createUser({ name: 'Card Student', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE501', parentPhone: '+91 90000 12345' });
  const s2 = await ctx.createUser({ name: 'Second Card', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE502', parentPhone: '9000067890' });
  const id1 = await newPass(s1);
  const id2 = await newPass(s2);

  const sent = await sendOtp(id1);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.match(sent.body.message, /generated/);
  assert.equal(sent.body.otpId, undefined, 'internal ids are not returned to faculty');
  await sleep(5);
  assert.equal((await sendOtp(id2)).status, 200);
  assert.equal(sendSpy.mock.callCount(), 0, 'no SMS while disabled');
  sendSpy.mock.restore();

  const body = await otpCards();
  assert.equal(body.smsEnabled, false);
  const [first, second] = body.items;
  assert.equal(String(first.gatePassId), id2, 'newest first');
  assert.equal(String(second.gatePassId), id1);
  const plain = testOtpProvider.peek((await latestOtp(id1))._id);
  assert.equal(second.otp, plain, 'card shows the real generated OTP');
  assert.equal(second.status, 'active');
  assert.ok(new Date(second.expiresAt) > new Date(second.createdAt));
  assert.deepEqual(second.student, { name: 'Card Student', rollNo: '23CSE501', department: 'CSE', year: 3, section: 'A' });
  assert.equal(second.parentMobile, '******2345');
  assert.equal(second.smsSent, false);

  // The OTP is stored only hashed + server-encrypted, never in plaintext.
  const raw = await ctx.models.OutpassOtp.findById(second.id).select('+otpHash +otpSealed').lean();
  assert.ok(raw.otpSealed && !raw.otpSealed.includes(plain));
  assert.ok(!Object.values(raw).includes(plain));

  // Verification still works and the card turns USED.
  assert.equal((await verifyOtp(id1, plain)).status, 200);
  assert.equal((await otpCards()).items.find((c) => String(c.gatePassId) === id1).status, 'used');

  await settle();
  const life = await logs({ entityId: (await ctx.models.GatePass.findById(id1))._id, event: /^OTP_/ });
  const names = life.map((l) => l.event);
  assert.ok(names.includes('OTP_CREATED') && names.includes('OTP_VERIFIED'));
  assert.ok(!names.includes('OTP_SENT'), 'OTP_SENT only when SMS is enabled');
  assert.ok(!JSON.stringify(life).includes(`"${plain}"`), 'OTP value never in a security record');
  assert.equal((await logs({ event: 'OTP_VIEWED', actor: admin.u._id })).length > 0, true);
});

test('OTP: expired, locked, failed and replaced statuses come from the backend lifecycle', async () => {
  const mk = (roll) => ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: roll, parentPhone: '9000055555' });
  const expired = await newPass(await mk('23CSE601'));
  await sendOtp(expired);
  await ctx.models.OutpassOtp.updateMany({ gatePass: expired }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await otpCards()).items.find((c) => String(c.gatePassId) === expired).status, 'expired', 'computed before any verify');
  assert.equal((await verifyOtp(expired, '0000')).status, 410);

  const locked = await newPass(await mk('23CSE602'));
  await sendOtp(locked, admin);
  const real = testOtpProvider.peek((await latestOtp(locked))._id);
  const wrong = String((Number(real) + 1) % 10000).padStart(4, '0');
  for (let i = 0; i < 5; i += 1) await verifyOtp(locked, wrong, admin);
  const lockedCard = (await otpCards()).items.find((c) => String(c.gatePassId) === locked);
  assert.equal(lockedCard.status, 'locked');
  assert.equal(lockedCard.attempts, 5);

  // Resend: the earlier OTP is replaced, the new one is a new card.
  const resend = await newPass(await mk('23CSE603'));
  await sendOtp(resend);
  await ctx.models.OutpassOtp.updateMany({ gatePass: resend }, { $set: { lastSentAt: new Date(Date.now() - 61000) } });
  assert.equal((await sendOtp(resend)).status, 200);
  const cards = (await otpCards()).items.filter((c) => String(c.gatePassId) === resend);
  assert.deepEqual(cards.map((c) => c.status), ['active', 'superseded']);

  // Status filter (expired includes active-but-past-expiry).
  const exp = await otpCards('?status=expired');
  assert.ok(exp.items.some((c) => String(c.gatePassId) === expired) && exp.items.every((c) => c.status === 'expired'));
  const lk = await otpCards('?status=locked');
  assert.ok(lk.items.every((c) => c.status === 'locked') && lk.items.length >= 1);

  // Student filters.
  assert.ok((await otpCards('?q=23CSE602')).items.every((c) => c.student.rollNo === '23CSE602'));
  assert.equal((await otpCards('?department=ECE')).total, 0);
  assert.ok((await otpCards('?department=CSE&year=3&section=a')).total >= 3);
  assert.equal((await req('GET', '/admin/security/otps?status=hacked', admin)).status, 422);

  await settle();
  const events = (await logs({ event: /^OTP_/ })).map((l) => l.event);
  for (const e of ['OTP_EXPIRED', 'OTP_LOCKED', 'OTP_FAILED', 'OTP_RESEND']) assert.ok(events.includes(e), e);
});

test('OTP: goes only to the registered parent mobile from the database; request-body numbers are ignored', async () => {
  const s = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE701', parentPhone: '9111122222' });
  const id = await newPass(s);
  // The admin updates the registered number after the pass was created: the new one is used.
  await ctx.models.User.updateOne({ _id: s._id }, { $set: { parentPhone: '9333344444' } });
  const sendSpy = mock.method(testOtpProvider, 'sendOtp');
  try {
    const res = await sendOtp(id, cic, { parentPhone: '9999999999', to: '9999999999', phone: '9999999999' });
    assert.equal(res.status, 200);
    assert.equal(sendSpy.mock.calls[0].arguments[0].to, '9333344444');
  } finally {
    sendSpy.mock.restore();
  }
  assert.equal((await latestOtp(id)).parentMobileMasked, '******4444');

  // No registered number anywhere → refused, nothing generated, event recorded.
  const none = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE702', parentPhone: '9444455555' });
  const noneId = await newPass(none);
  await ctx.models.User.updateOne({ _id: none._id }, { $unset: { parentPhone: 1 } });
  await ctx.models.GatePass.updateOne({ _id: noneId }, { $unset: { parentPhone: 1 } });
  const res = await sendOtp(noneId, cic, { parentPhone: '9999999999' });
  assert.equal(res.status, 422);
  assert.match(res.body.message, /no registered parent mobile/);
  assert.equal(await latestOtp(noneId), null);
  await settle();
  assert.equal((await logs({ event: 'OTP_FAILED', reason: 'no_parent_mobile' })).length, 1);
});

test('OTP values never reach non-admin APIs or the server console', async () => {
  const s = await ctx.createUser({ department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: '23CSE801', parentPhone: '9222233333' });
  const id = await newPass(s);
  const printed = [];
  const spies = ['log', 'info', 'warn', 'error'].map((m) => mock.method(console, m, (...a) => printed.push(a.join(' '))));
  try {
    assert.equal((await sendOtp(id)).status, 200);
  } finally {
    spies.forEach((sp) => sp.mock.restore());
  }
  const otp = testOtpProvider.peek((await latestOtp(id))._id);
  assert.ok(!printed.some((line) => line.includes(otp)), 'OTP not printed');

  const studentWeb = await ctx.loginWeb(s);
  for (const [who, path] of [
    [cic, `/gate-pass/${id}/parent-otp`],
    [cic, `/gate-pass/${id}`],
    [cic, '/gate-pass'],
    [studentWeb, `/gate-pass/${id}`],
    [studentWeb, '/gate-pass'],
    [cic, '/class-students'],
    [admin, '/admin/users'],
    [admin, '/admin/security/logs'],
  ]) {
    const res = await req('GET', path, who);
    assert.ok(!JSON.stringify(res.body).includes(`"otp":"${otp}"`), `${path} leaks no OTP`);
  }
});

// ── Login page message ──────────────────────────────────────────────

test('the retired reset endpoints point users to their Class In-Charge or Admin', async () => {
  const res = await ctx.request('POST', '/auth/forgot-password', { body: { email: studentA.u.email } });
  assert.equal(res.status, 410);
  assert.equal(res.body.message, 'Forgot your password? Contact your Class In-Charge or Admin to reset your password.');
});
