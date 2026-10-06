import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let student;
let faculty;
let hod;
let admin;
let principal;

before(async () => {
  ctx = await startServer();
  const [s, f, h, a, p] = await Promise.all([
    ctx.createUser({ role: 'student', department: 'CSE', section: 'A' }),
    ctx.createUser({ role: 'faculty', department: 'CSE' }),
    ctx.createUser({ role: 'hod', department: 'CSE' }),
    ctx.createUser({ role: 'admin' }),
    ctx.createUser({ role: 'principal' }),
  ]);

  student = { u: s, ...(await ctx.loginWeb(s)) };
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('Profiles Directory PDF: unauthenticated request returns 401', async () => {
  const res = await ctx.request('GET', '/users/export-pdf');
  assert.equal(res.status, 401);
});

test('Profiles Directory PDF: student returns 403 Forbidden', async () => {
  const res = await ctx.request('GET', '/users/export-pdf', { token: student.token });
  assert.equal(res.status, 403);
});

test('Profiles Directory PDF: faculty returns 403 Forbidden', async () => {
  const res = await ctx.request('GET', '/users/export-pdf', { token: faculty.token });
  assert.equal(res.status, 403);
});

test('Profiles Directory PDF: HOD returns 403 Forbidden', async () => {
  const res = await ctx.request('GET', '/users/export-pdf', { token: hod.token });
  assert.equal(res.status, 403);
});

test('Profiles Directory PDF: admin returns 200 OK with application/pdf', async () => {
  const res = await ctx.request('GET', '/users/export-pdf', { token: admin.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
});

test('Profiles Directory PDF: principal returns 200 OK with application/pdf', async () => {
  const res = await ctx.request('GET', '/users/export-pdf', { token: principal.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
});
