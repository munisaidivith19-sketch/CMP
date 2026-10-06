import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin;

before(async () => {
  ctx = await startServer();
  const a = await ctx.createUser({ role: 'admin', name: 'Admin' });
  admin = { u: a, ...(await ctx.loginWeb(a)) };
});
after(async () => {
  await ctx.stop();
});

const create = (body) => ctx.request('POST', '/admin/users', { token: admin.token, body });
const staff = (o) => ({ password: 'Welcome123', employeeId: `T-${o.email}`, ...o });

test('admin stores the title and gender chosen at login creation', async () => {
  const hod = await create(staff({ role: 'hod', name: 'Mohan Babu', title: 'Dr', gender: 'male', email: 'mohan@test.edu', department: 'CSE' }));
  assert.equal(hod.status, 201, JSON.stringify(hod.body));
  assert.equal(hod.body.title, 'Dr');
  assert.equal(hod.body.gender, 'male');

  const dean = await create(staff({ role: 'dean', name: 'Mitha', title: 'Ms', gender: 'female', email: 'mitha@test.edu' }));
  assert.equal(dean.status, 201, JSON.stringify(dean.body));
  assert.equal(dean.body.title, 'Ms');
});

test('title and gender are validated: only Ms/Mr/Dr and Male/Female, and Mr/Ms must match the gender', async () => {
  assert.ok([400, 422].includes((await create(staff({ role: 'ao', name: 'Bad Title', title: 'Sir', gender: 'male', email: 'bad1@test.edu' }))).status));
  assert.ok([400, 422].includes((await create(staff({ role: 'ao', name: 'Bad Gender', title: 'Dr', gender: 'other', email: 'bad2@test.edu' }))).status));
  assert.ok([400, 422].includes((await create(staff({ role: 'ao', name: 'Mismatch', title: 'Mr', gender: 'female', email: 'bad3@test.edu' }))).status));
  assert.ok([400, 422].includes((await create(staff({ role: 'ao', name: 'Mismatch', title: 'Ms', gender: 'male', email: 'bad4@test.edu' }))).status));
  assert.equal(await ctx.models.User.countDocuments({ email: /^bad\d@test\.edu$/ }), 0);
});

test('every query that selects a name also returns the title, including populate()', async () => {
  const u = await ctx.models.User.findOne({ email: 'mohan@test.edu' }).select('name').lean();
  assert.equal(u.title, 'Dr');
  // An exclusion projection is left untouched (title is already included).
  const v = await ctx.models.User.findOne({ email: 'mohan@test.edu' }).select('-bio').lean();
  assert.equal(v.title, 'Dr');
  // A projection without name does not gain the title.
  const w = await ctx.models.User.findOne({ email: 'mohan@test.edu' }).select('email').lean();
  assert.equal(w.title, undefined);
});

test('admin edits a principal’s name, title, gender, mobile and email', async () => {
  const pr = await create(staff({ role: 'principal', name: 'MOHANBABU', email: 'principal@test.edu' }));
  assert.equal(pr.status, 201, JSON.stringify(pr.body));
  const res = await ctx.request('PATCH', `/admin/users/${pr.body._id}`, {
    token: admin.token,
    body: { name: 'Mohan Babu', title: 'Dr', gender: 'male', phone: '9876543210', email: 'principal.new@test.edu' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const saved = await ctx.models.User.findById(pr.body._id).lean();
  assert.equal(saved.name, 'Mohan Babu');
  assert.equal(saved.title, 'Dr');
  assert.equal(saved.gender, 'male');
  assert.equal(saved.phone, '9876543210');
  assert.equal(saved.email, 'principal.new@test.edu');
});

test('admin can change the title and gender later, with the same rules', async () => {
  const user = await ctx.models.User.findOne({ email: 'mitha@test.edu' });
  const bad = await ctx.request('PATCH', `/admin/users/${user._id}`, { token: admin.token, body: { title: 'Mr' } });
  assert.ok([400, 422].includes(bad.status), String(bad.status));
  const ok = await ctx.request('PATCH', `/admin/users/${user._id}`, { token: admin.token, body: { title: 'Dr' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await ctx.models.User.findById(user._id).lean()).title, 'Dr');
});
