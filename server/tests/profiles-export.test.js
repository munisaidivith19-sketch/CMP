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

test('Profiles Directory PDF: never prints an account password, and is not cached', async () => {
  const res = await fetch(`${ctx.base}/api/users/export-pdf`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(!text.includes('Password@123'), 'the seed password must not be in the directory');
  assert.ok(!/Universal Account Password/i.test(text));
});

// ── Filtered export + security log (synthetic names only) ──
const pdfText = async (res) => Buffer.from(await res.arrayBuffer()).toString('latin1');
const exportAs = (who, q) => fetch(`${ctx.base}/api/users/export-pdf?${new URLSearchParams(q)}`, { headers: { Authorization: `Bearer ${who.token}` } });

test('Profiles Directory PDF: students of one department, year and section only', async () => {
  await Promise.all([
    ctx.createUser({ name: 'Filter Pupil Alpha', department: 'ECE', year: 2, section: 'B', semester: 3, rollNo: 'FLT-1' }),
    ctx.createUser({ name: 'Filter Pupil Bravo', department: 'ECE', year: 2, section: 'C', semester: 3, rollNo: 'FLT-2' }),
    ctx.createUser({ name: 'Filter Pupil Charlie', department: 'ECE', year: 3, section: 'B', semester: 5, rollNo: 'FLT-3' }),
    ctx.createUser({ name: 'Filter Pupil Delta', department: 'VLSI', year: 2, section: 'B', semester: 3, rollNo: 'FLT-4' }),
    ctx.createUser({ role: 'faculty', name: 'Filter Teacher Echo', department: 'ECE', employeeId: 'FLT-F1' }),
  ]);
  const res = await exportAs(admin, { role: 'student', department: 'ECE', year: 2, section: 'B' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /Profiles_Directory_Students_ECE_2nd_Year_Section_B\.pdf/);
  const text = await pdfText(res);
  assert.ok(text.includes('Filter Pupil Alpha'), 'the chosen class is listed');
  for (const other of ['Filter Pupil Bravo', 'Filter Pupil Charlie', 'Filter Pupil Delta', 'Filter Teacher Echo']) {
    assert.ok(!text.includes(other), `${other} is outside the selection`);
  }

  const fac = await pdfText(await exportAs(principal, { role: 'faculty', department: 'ECE' }));
  assert.ok(fac.includes('Filter Teacher Echo'));
  assert.ok(!fac.includes('Filter Pupil Alpha'), 'a faculty export has no students');
});

test('Profiles Directory PDF: every download is in the security log with who, what and how many', async () => {
  const before = await ctx.models.SecurityLog.countDocuments({ event: 'DATA_EXPORTED' });
  assert.equal((await exportAs(admin, { role: 'student', department: 'ECE', year: 2, section: 'B' })).status, 200);
  const log = await ctx.models.SecurityLog.findOne({ event: 'DATA_EXPORTED', success: true }).sort({ createdAt: -1 }).lean();
  assert.equal(await ctx.models.SecurityLog.countDocuments({ event: 'DATA_EXPORTED' }), before + 1);
  assert.equal(String(log.actor), String(admin.u._id));
  assert.equal(log.actorRole, 'admin');
  assert.equal(log.details.report, 'profiles_directory');
  assert.equal(log.details.role, 'student');
  assert.equal(log.details.department, 'ECE');
  assert.equal(log.details.year, 2);
  assert.equal(log.details.section, 'B');
  assert.equal(log.details.records, 1);
  assert.ok(log.ip, 'the IP is recorded');
});

test('Profiles Directory PDF: refused attempts are logged too; bad filters are rejected', async () => {
  assert.equal((await exportAs(student, { role: 'student' })).status, 403);
  const denied = await ctx.models.SecurityLog.findOne({ event: 'DATA_EXPORTED', success: false, actor: student.u._id }).lean();
  assert.ok(denied, 'the refused attempt is in the security log');
  assert.match(denied.reason, /not allowed/);
  assert.equal((await exportAs(admin, { role: 'student', department: 'Nope' })).status, 422);
  assert.equal((await exportAs(admin, { role: 'robots' })).status, 422);
  assert.equal((await exportAs(admin, { role: 'student', section: 'Z' })).status, 422);
});
