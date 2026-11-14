// The 15-day restore for club admins and alumni (see user-restore.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, startServer } from './helpers.js';

let ctx;
let admin;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const del = (id) => req('DELETE', `/admin/users/${id}`, admin);
const raw = (id) => ctx.models.User.findOne({ _id: id }).setOptions({ withDeleted: true }).lean();

before(async () => {
  ctx = await startServer();
  const a = await ctx.createUser({ role: 'admin', employeeId: `RA-${uniq()}` });
  admin = await ctx.loginWeb(a);
});
after(async () => {
  await ctx.stop();
});

const studentBody = (extra = {}) => {
  const id = uniq();
  return {
    role: 'student', name: `Restore Kid ${id}`, email: `restore.${id}@test.edu`, password: PASSWORD,
    rollNo: `RS${id}`.toUpperCase(), department: 'CSE', year: 3, section: 'A', stayType: 'hosteler', parentPhone: '9111111111',
    ...extra,
  };
};
const createStudent = async (extra) => {
  const body = studentBody(extra);
  const res = await req('POST', '/admin/users', admin, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { body, user: res.body };
};

test('a deleted club admin re-created as a student comes back as a club admin', async () => {
  const { body, user } = await createStudent({ role: 'club_admin' });
  assert.equal((await del(user._id)).status, 204);
  const again = await req('POST', '/admin/users', admin, { ...body, role: 'student' });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, true);
  assert.equal(String(again.body._id), String(user._id));
  assert.equal(again.body.role, 'club_admin', 'past role');
});

test('a deleted alumni login is restored when the alumni invite is claimed again', async () => {
  const { hashToken } = await import('../src/utils/tokens.js');
  const email = `alum.${uniq()}@test.edu`;
  const first = await req('POST', '/admin/users', admin, { role: 'alumni', name: 'Old Alum', email, password: PASSWORD, department: 'CSE' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  await ctx.models.AlumniProfile.create({ user: first.body._id, gradYear: 2020, company: 'Old Co' });
  await ctx.models.Notification.create({ user: first.body._id, title: 'Alumni record' });
  assert.equal((await del(first.body._id)).status, 204);

  const token = `t${uniq()}`.padEnd(40, '0');
  await ctx.models.AlumniInvite.create({
    email, name: 'Back Alum', department: 'CSE', gradYear: 2020, company: 'New Co',
    tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000),
  });
  const claim = await ctx.request('POST', `/auth/alumni-claim/${token}`, { body: { password: 'Alumni@123', accept: true } });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(String(claim.body.user._id || claim.body.user.id), String(first.body._id), 'same account');
  assert.equal(await ctx.models.AlumniProfile.countDocuments({ user: first.body._id }), 1, 'profile reused, not duplicated');
  assert.equal((await ctx.models.AlumniProfile.findOne({ user: first.body._id }).lean()).company, 'Old Co', 'old profile kept');
  assert.equal(await ctx.models.Notification.countDocuments({ user: first.body._id, title: 'Alumni record' }), 1);
});
