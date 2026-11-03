// The password rule, and new accounts choosing their own password at first sign-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { passwordProblem } from '../src/utils/passwordPolicy.js';

let ctx;
let admin;
let n = 0;
const STRONG = 'Campus@123';
const MOBILE = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };

before(async () => {
  ctx = await startServer();
  const u = await ctx.createUser({ role: 'admin' });
  admin = { u, ...(await ctx.loginWeb(u)) };
});
after(async () => {
  await ctx.stop();
});

const newUser = (password = STRONG, extra = {}) => {
  n += 1;
  return { role: 'security', title: 'Mr', gender: 'male', name: `Guard ${n}`, email: `new.guard${n}@jnn.edu.in`, employeeId: `PP-${n}`, phone: `98765${String(10000 + n)}`, password, ...extra };
};
const create = (body) => ctx.request('POST', '/admin/users', { token: admin.token, body });
const signIn = (email, password = STRONG) => ctx.request('POST', '/auth/login', { body: { email, password }, headers: MOBILE });
// Any route the gate covers (notifications stay open so the app can show them).
const probe = (token) => ctx.request('GET', '/announcements', { token, headers: MOBILE });

test('the rule: every part is required', () => {
  assert.equal(passwordProblem('Campus@123'), null);
  for (const weak of ['Ab1$', 'campus@123', 'CAMPUS@123', 'Campus@abc', 'Campus1234', 'Campus 123', `${'A'.repeat(70)}a1$`, null]) {
    assert.ok(passwordProblem(weak), String(weak));
  }
});

test('creating an account refuses a weak password and says what is missing', async () => {
  const cases = [['Ab1$', /8–72/], ['campus@123', /capital/], ['CAMPUS@123', /small/], ['Campus@abc', /number/], ['Campus1234', /symbol/]];
  for (const [weak, message] of cases) {
    const res = await create(newUser(weak));
    assert.equal(res.status, 422, weak);
    assert.match(JSON.stringify(res.body), message, weak);
  }
});

test('a new account must choose its own password before anything else, then continues', async () => {
  const body = newUser();
  const created = await create(body);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const first = await signIn(body.email);
  assert.equal(first.status, 200);
  assert.equal(first.body.user.mustChangePassword, true);
  const token = first.body.accessToken;
  assert.equal((await probe(token)).body.code, 'PASSWORD_CHANGE_REQUIRED');

  const change = (b) => ctx.request('POST', '/auth/change-password', { token, headers: MOBILE, body: b });
  assert.equal((await change({ currentPassword: STRONG, newPassword: 'weakpass1' })).status, 422, 'the new password meets the rule too');
  assert.equal((await change({ currentPassword: 'Wrong@1234', newPassword: 'MyOwn#Pass9' })).status, 400);
  assert.equal((await change({ currentPassword: STRONG, newPassword: STRONG })).status, 422, 'must be different');
  assert.equal((await probe(token)).status, 403, 'still blocked');

  const done = await change({ currentPassword: STRONG, newPassword: 'MyOwn#Pass9' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.user.mustChangePassword, false);
  assert.notEqual((await probe(done.body.accessToken)).body?.code, 'PASSWORD_CHANGE_REQUIRED');

  const again = await signIn(body.email, 'MyOwn#Pass9');
  assert.equal(again.body.user.mustChangePassword, false, 'not asked a second time');
  assert.equal((await signIn(body.email)).status, 401, 'the first password no longer works');
});

test('a student added by their Class In-Charge is asked too', async () => {
  const f = await ctx.createUser({ role: 'faculty', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3] });
  const cic = await ctx.loginWeb(f);
  n += 1;
  const email = `new.student${n}@jnn.edu.in`;
  const res = await ctx.request('POST', '/class-students', { token: cic.token, body: { title: 'Ms', gender: 'female', name: `Student ${n}`, email, password: STRONG, rollNo: `PP${n}`, stayType: 'hosteler', parentPhone: '9876504321', phone: '9876500000' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await signIn(email)).body.user.mustChangePassword, true);
});

test('existing accounts are not affected: an old weak password still signs in and is not forced to change', async () => {
  const u = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A', password: 'oldpass12' });
  const res = await ctx.request('POST', '/auth/login', { body: { email: u.email, password: 'oldpass12' }, headers: MOBILE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.mustChangePassword, false);
  assert.equal(passwordProblem(PASSWORD), null, 'the test helper password meets the rule');
});
