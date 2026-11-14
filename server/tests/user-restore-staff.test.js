// The 15-day restore covers every staff login, not only students (see user-restore.test.js).
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

// ── Every login, not only students ────────────────────────────────────
const staffBody = (role, extra = {}) => {
  const id = uniq();
  const base = { role, name: `Staff ${role} ${id}`, email: `${role}.${id}@test.edu`, password: PASSWORD, employeeId: `E${id}`.toUpperCase() };
  if (role === 'faculty') Object.assign(base, { department: 'CSE', teachingYears: [3], teachingSections: ['A'] });
  if (role === 'hod') Object.assign(base, { department: 'CSE' });
  return { ...base, ...extra };
};

for (const role of ['faculty', 'hod', 'principal', 'security', 'warden', 'dean', 'ao', 'chairman', 'coe', 'office', 'transport']) {
  test(`a deleted ${role} login is restored with its records when created again`, async () => {
    const body = staffBody(role);
    const first = await req('POST', '/admin/users', admin, body);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    await ctx.models.Notification.create({ user: first.body._id, title: `${role} record` });
    assert.equal((await del(first.body._id)).status, 204);
    assert.equal(await ctx.models.User.findById(first.body._id), null, 'hidden while deleted');

    const again = await req('POST', '/admin/users', admin, body);
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal(again.body.restored, true);
    assert.equal(String(again.body._id), String(first.body._id));
    assert.equal(again.body.employeeId, body.employeeId);
    assert.equal(await ctx.models.Notification.countDocuments({ user: first.body._id, title: `${role} record` }), 1);
  });
}

test('Admin accounts are never deleted, so they never enter the restore window', async () => {
  const other = await ctx.createUser({ role: 'admin', employeeId: `AD-${uniq()}` });
  assert.equal((await del(other._id)).status, 403);
  assert.equal((await raw(other._id)).deletedAt, null);
});
