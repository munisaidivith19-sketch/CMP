// Permanently deleting an account needs the delete action of the module that governs its role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const admin = async (policies) => {
  const u = await ctx.createUser({ role: 'admin', employeeId: `DA-${uniq()}`, policyManaged: policies !== undefined, policies: policies || [] });
  return ctx.loginWeb(u);
};
const student = (department = 'CSE') => ctx.createUser({ name: 'Delete Kid', department, section: 'A', rollNo: `DK${uniq()}`.toUpperCase() });
const staff = () => ctx.createUser({ role: 'faculty', name: 'Delete Staff', department: 'CSE', employeeId: `DS-${uniq()}` });
const del = (who, target) => ctx.request('DELETE', `/admin/users/${target._id}`, { token: who.token });
const exists = (target) => ctx.models.User.exists({ _id: target._id });

test('an Admin without the delete action cannot delete, whatever else it holds', async () => {
  const reader = await admin([{ module: 'user_management', actions: ['view'] }]);
  const manager = await admin([{ module: 'user_management', actions: ['view', 'create', 'edit', 'suspend', 'roles', 'export'] }]);
  const s = await student();
  assert.equal((await del(reader, s)).status, 403);
  assert.equal((await del(manager, s)).status, 403);
  assert.ok(await exists(s));
});

test('the delete action deletes student accounts, not staff accounts', async () => {
  const who = await admin([{ module: 'user_management', actions: ['view', 'delete'] }]);
  const s = await student();
  assert.equal((await del(who, s)).status, 204);
  assert.equal(await exists(s), null);
  const f = await staff();
  assert.equal((await del(who, f)).status, 403);
  assert.ok(await exists(f));
});

test('Staff Management delete covers staff accounts only', async () => {
  const who = await admin([{ module: 'staff_management', actions: ['view', 'delete'] }]);
  const f = await staff();
  assert.equal((await del(who, f)).status, 204);
  const s = await student();
  assert.equal((await del(who, s)).status, 403);
});

test('a department-scoped delete stays inside its department', async () => {
  const who = await admin([{ module: 'user_management', actions: ['view', 'delete'], scope: 'department', department: 'CSE' }]);
  const ece = await student('ECE');
  assert.equal((await del(who, ece)).status, 403);
  assert.ok(await exists(ece));
  assert.equal((await del(who, await student('CSE'))).status, 204);
});

test('Admin accounts are never deleted by another Admin, and an unrestricted Admin keeps deleting others', async () => {
  const legacy = await admin();
  const holder = await admin([{ module: 'user_management', actions: ['view', 'delete'] }, { module: 'staff_management', actions: ['view', 'delete'] }]);
  const other = await ctx.createUser({ role: 'admin', employeeId: `DA-${uniq()}` });
  assert.equal((await del(legacy, other)).status, 403);
  assert.equal((await del(holder, other)).status, 403);
  assert.ok(await exists(other));
  assert.equal((await del(legacy, await student())).status, 204);
});
