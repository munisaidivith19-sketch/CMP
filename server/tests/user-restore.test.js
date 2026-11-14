// Deleting an account keeps it (soft delete); creating the same email again
// restores that account — same _id — so every record linked to it comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, startServer } from './helpers.js';

let ctx;
let admin;
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });

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
const del = (id) => req('DELETE', `/admin/users/${id}`, admin);
const raw = (id) => ctx.models.User.findOne({ _id: id }).setOptions({ withDeleted: true }).lean();

test('deleting hides the account everywhere but keeps it and its records', async () => {
  const { body, user } = await createStudent();
  await ctx.models.Notification.create({ user: user._id, title: 'Kept record' });

  assert.equal((await del(user._id)).status, 204);

  // Gone for the app: lookups, counts, sign-in.
  assert.equal(await ctx.models.User.findById(user._id), null);
  assert.equal(await ctx.models.User.exists({ email: body.email }), null);
  assert.equal(await ctx.models.User.countDocuments({ _id: user._id }), 0);
  const [agg] = await ctx.models.User.aggregate([{ $match: { email: body.email } }, { $count: 'n' }]);
  assert.equal(agg, undefined);
  const login = await ctx.request('POST', '/auth/login', { body: { email: body.email, password: PASSWORD } });
  assert.notEqual(login.status, 200);

  // Still stored, marked deleted, records untouched.
  const kept = await raw(user._id);
  assert.ok(kept.deletedAt);
  assert.equal(kept.isActive, false);
  assert.equal(await ctx.models.Notification.countDocuments({ user: user._id, title: 'Kept record' }), 1);
});

test('creating the same email again restores the same account with its records', async () => {
  const { body, user } = await createStudent();
  await ctx.models.Notification.create({ user: user._id, title: 'Old record' });
  await ctx.models.User.updateOne({ _id: user._id }, { $set: { skills: ['robotics'] } });
  assert.equal((await del(user._id)).status, 204);

  const again = await req('POST', '/admin/users', admin, { ...body, name: 'Restored Kid', section: 'B' });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, true);
  assert.equal(String(again.body._id), String(user._id), 'same account id');

  const stored = await raw(user._id);
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.isActive, true);
  assert.equal(stored.name, body.name, 'old details kept, not the new form');
  assert.equal(stored.section, 'A');
  assert.equal(stored.role, 'student');
  assert.deepEqual(stored.skills, ['robotics'], 'profile data kept');
  assert.equal(await ctx.models.Notification.countDocuments({ user: user._id, title: 'Old record' }), 1);

  // Signs in again with the new password (after the forced first change).
  await ctx.models.User.updateOne({ _id: user._id }, { mustChangePassword: false });
  const login = await ctx.loginWeb({ email: body.email });
  assert.equal(String(login.user._id || login.user.id), String(user._id));
});

test('a brand-new email still creates a brand-new account', async () => {
  const res = await req('POST', '/admin/users', admin, studentBody());
  assert.equal(res.status, 201);
  assert.equal(res.body.restored, false);
});

test('a deleted account comes back with its past role, whatever role the form says', async () => {
  const { body, user } = await createStudent();
  assert.equal((await del(user._id)).status, 204);
  const asFaculty = await req('POST', '/admin/users', admin, {
    role: 'faculty', name: 'Other Name', email: body.email, password: PASSWORD, employeeId: `F${uniq()}`, department: 'CSE', teachingYears: [3], teachingSections: ['A'],
  });
  assert.equal(asFaculty.status, 201, JSON.stringify(asFaculty.body));
  assert.equal(asFaculty.body.restored, true);
  assert.equal(String(asFaculty.body._id), String(user._id));
  const stored = await raw(user._id);
  assert.equal(stored.role, 'student', 'past role');
  assert.equal(stored.name, body.name);
  assert.equal(stored.rollNo, body.rollNo);
  assert.equal(stored.employeeId, undefined, 'the form’s details are not applied');
});

test('restoring needs authority over the past role', async () => {
  const studentOnly = await ctx.loginWeb(await ctx.createUser({
    role: 'admin', employeeId: `SO-${uniq()}`, policyManaged: true,
    policies: [{ module: 'user_management', actions: ['view', 'create', 'delete'] }],
  }));
  const f = await req('POST', '/admin/users', admin, {
    role: 'faculty', name: 'Staff Back', email: `staff.${uniq()}@test.edu`, password: PASSWORD, employeeId: `F${uniq()}`, department: 'CSE', teachingYears: [3], teachingSections: ['A'],
  });
  assert.equal(f.status, 201);
  assert.equal((await del(f.body._id)).status, 204);
  const sneaky = await req('POST', '/admin/users', studentOnly, studentBody({ email: f.body.email }));
  assert.equal(sneaky.status, 403, 'a student-only admin cannot bring back a faculty account');
  assert.ok((await raw(f.body._id)).deletedAt);
});

test('a register number held by a different deleted account is refused with a clear message', async () => {
  const { body, user } = await createStudent();
  assert.equal((await del(user._id)).status, 204);
  const other = await req('POST', '/admin/users', admin, studentBody({ rollNo: body.rollNo }));
  assert.equal(other.status, 409);
  assert.match(other.body.message, new RegExp(body.email.replace(/[.]/g, '\\.')));
});

test('restoring never brings back old additional policies', async () => {
  const { body, user } = await createStudent();
  await ctx.models.User.updateOne({ _id: user._id }, { $set: { policies: [{ module: 'security_logs', actions: ['view'] }] } });
  assert.equal((await del(user._id)).status, 204);
  const again = await req('POST', '/admin/users', admin, body);
  assert.equal(again.status, 201);
  assert.deepEqual((await raw(user._id)).policies, []);
});

test('an account deleted before soft delete is re-created under its old id', async () => {
  const { body, user } = await createStudent();
  await ctx.models.Notification.create({ user: user._id, title: 'Orphaned record' });
  // The old behaviour: the document removed outright, the security log kept.
  await ctx.models.User.deleteOne({ _id: user._id });
  assert.equal(await raw(user._id), null);
  await ctx.models.SecurityLog.create({
    event: 'USER_DELETED', success: true, targetUser: user._id, targetRole: 'student',
    entityType: 'user', entityId: user._id, details: { name: body.name, email: body.email },
  });

  const again = await req('POST', '/admin/users', admin, body);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, true);
  assert.equal(String(again.body._id), String(user._id));
  assert.equal(await ctx.models.Notification.countDocuments({ user: again.body._id, title: 'Orphaned record' }), 1);
});

test('a Class In-Charge re-creating a deleted student of their class restores it', async () => {
  const cicUser = await ctx.createUser({ role: 'faculty', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, teachingYears: [3], employeeId: `CIC-${uniq()}` });
  const cic = await ctx.loginWeb(cicUser);
  const id = uniq();
  const body = { name: `Class Kid ${id}`, email: `classkid.${id}@test.edu`, password: 'Welcome@123', rollNo: `CK${id}`, stayType: 'day_scholar', title: 'Mr', gender: 'male', parentPhone: '+91 98765 43210' };
  const first = await req('POST', '/class-students', cic, body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await del(first.body._id)).status, 204);

  const again = await req('POST', '/class-students', cic, body);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, true);
  assert.equal(String(again.body._id), String(first.body._id));

  // A deleted student of another class is not theirs to bring back.
  const other = await createStudent({ section: 'B' });
  assert.equal((await del(other.user._id)).status, 204);
  const refused = await req('POST', '/class-students', cic, { ...body, email: other.body.email, rollNo: `CX${uniq()}` });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /Ask an Admin/);
});

// ── The 15-day window ─────────────────────────────────────────────────
const expire = (id) =>
  ctx.models.User.updateOne({ _id: id, deletedAt: { $ne: null } }, { $set: { deletedAt: new Date(Date.now() - 16 * 24 * 3600000) } });

test('deleting sets the account to be removed 15 days later', async () => {
  const { user } = await createStudent();
  const before = Date.now();
  assert.equal((await del(user._id)).status, 204);
  const kept = await raw(user._id);
  const days = (new Date(kept.purgeAt).getTime() - before) / (24 * 3600000);
  assert.ok(days > 14.99 && days < 15.01, `purgeAt ${days} days after deletion`);
});

test('after the window the job removes the account for good, and the email makes a new account', async () => {
  const { purgeDeletedUsers } = await import('../src/services/userRestore.js');
  const { body, user } = await createStudent();
  const inWindow = await createStudent();
  assert.equal((await del(user._id)).status, 204);
  assert.equal((await del(inWindow.user._id)).status, 204);
  await expire(user._id);

  const { purged } = await purgeDeletedUsers();
  assert.ok(purged >= 1);
  assert.equal(await raw(user._id), null, 'removed for good');
  assert.ok((await raw(inWindow.user._id)).deletedAt, 'an account still inside its window is kept');
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(await ctx.models.SecurityLog.exists({ event: 'USER_PURGED', targetUser: user._id }));

  const again = await req('POST', '/admin/users', admin, body);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, false);
  assert.notEqual(String(again.body._id), String(user._id), 'a brand-new account');
});

test('re-creating after the window but before the job runs also makes a new account', async () => {
  const { body, user } = await createStudent();
  assert.equal((await del(user._id)).status, 204);
  await expire(user._id);
  const again = await req('POST', '/admin/users', admin, body);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.restored, false);
  assert.notEqual(String(again.body._id), String(user._id));
  assert.equal(await raw(user._id), null);
});

test('a register number freed by an ended window can be reused', async () => {
  const { body, user } = await createStudent();
  assert.equal((await del(user._id)).status, 204);
  await expire(user._id);
  const other = await req('POST', '/admin/users', admin, studentBody({ rollNo: body.rollNo }));
  assert.equal(other.status, 201, JSON.stringify(other.body));
});

test('an old hard deletion outside the window is not relinked', async () => {
  const { body, user } = await createStudent();
  await ctx.models.User.deleteOne({ _id: user._id });
  const log = await ctx.models.SecurityLog.create({
    event: 'USER_DELETED', success: true, targetUser: user._id, targetRole: 'student',
    entityType: 'user', entityId: user._id, details: { name: body.name, email: body.email },
  });
  await ctx.models.SecurityLog.collection.updateOne({ _id: log._id }, { $set: { createdAt: new Date(Date.now() - 16 * 24 * 3600000) } });
  const again = await req('POST', '/admin/users', admin, body);
  assert.equal(again.status, 201);
  assert.equal(again.body.restored, false);
  assert.notEqual(String(again.body._id), String(user._id));
});
