import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

// The Science & Humanities HOD owns every department's 1st year; branch HODs own years 2–4.

let ctx;
let fyHod, cseHod, fresher, senior;
let fresherPass, seniorPass;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [fy, ch, s1, s3] = await Promise.all([
    mk({ role: 'hod', name: 'HOD First Year', department: 'Science & Humanities', employeeId: 'E-FY' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-CSE' }),
    mk({ name: 'Fresher', department: 'CSE', section: 'A', semester: 1, rollNo: 'F1' }),
    mk({ name: 'Senior', department: 'CSE', section: 'A', semester: 5, rollNo: 'S5' }),
  ]);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  [fyHod, cseHod, fresher, senior] = await Promise.all([fy, ch, s1, s3].map(login));

  const pass = (s) => ({
    student: s.u._id,
    department: 'CSE',
    section: 'A',
    description: 'Going home',
    regarding: 'outing',
    fromDate: new Date(),
    toDate: new Date(Date.now() + 86400000),
    parentPhone: '9800000000',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' },
    status: 'pending_hod',
  });
  [fresherPass, seniorPass] = await ctx.models.GatePass.create([pass(fresher), pass(senior)]);
});

after(async () => {
  await ctx.stop();
});

const queue = async (who) => (await ctx.request('GET', '/gate-pass', { token: who.token })).body.passes.map((p) => String(p._id));

test('gate pass: a 1st-year pass goes to the Science & Humanities HOD, not the branch HOD', async () => {
  const fyQ = await queue(fyHod);
  const cseQ = await queue(cseHod);
  assert.ok(fyQ.includes(String(fresherPass._id)));
  assert.ok(!fyQ.includes(String(seniorPass._id)), '1st-year HOD does not see a 3rd-year pass');
  assert.ok(cseQ.includes(String(seniorPass._id)));
  assert.ok(!cseQ.includes(String(fresherPass._id)), 'branch HOD does not see a 1st-year pass');

  // Direct object access follows the same rule.
  assert.equal((await ctx.request('GET', `/gate-pass/${seniorPass._id}`, { token: fyHod.token })).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${fresherPass._id}`, { token: cseHod.token })).status, 403);

  // And so does acting on it.
  assert.equal((await ctx.request('PATCH', `/gate-pass/${fresherPass._id}/hod-review`, { token: cseHod.token, body: { action: 'forward' } })).status, 403);
  assert.equal((await ctx.request('PATCH', `/gate-pass/${seniorPass._id}/hod-review`, { token: fyHod.token, body: { action: 'forward' } })).status, 403);
  const ok = await ctx.request('PATCH', `/gate-pass/${fresherPass._id}/hod-review`, { token: fyHod.token, body: { action: 'forward' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'pending_principal');
});

test('timetable: the 1st-year HOD cannot write years 2–4, a branch HOD cannot write year 1', async () => {
  const subject = (o) => ({ name: 'Test Subject', code: `T${Math.floor(Math.random() * 1e6)}`, department: 'CSE', ...o });
  assert.equal((await ctx.request('POST', '/subjects', { token: fyHod.token, body: subject({ semester: 5 }) })).status, 403);
  assert.equal((await ctx.request('POST', '/subjects', { token: cseHod.token, body: subject({ semester: 1 }) })).status, 403);
  const fyOk = await ctx.request('POST', '/subjects', { token: fyHod.token, body: subject({ semester: 1 }) });
  assert.equal(fyOk.status, 201, JSON.stringify(fyOk.body));
  const cseOk = await ctx.request('POST', '/subjects', { token: cseHod.token, body: subject({ semester: 5 }) });
  assert.equal(cseOk.status, 201, JSON.stringify(cseOk.body));

  // Neither can edit the other's subject by id.
  assert.equal((await ctx.request('PUT', `/subjects/${cseOk.body._id}`, { token: fyHod.token, body: { name: 'Renamed' } })).status, 403);
  assert.equal((await ctx.request('PUT', `/subjects/${fyOk.body._id}`, { token: cseHod.token, body: { name: 'Renamed' } })).status, 403);
  // Nor move a subject into the other's years.
  assert.equal((await ctx.request('PUT', `/subjects/${fyOk.body._id}`, { token: fyHod.token, body: { semester: 5 } })).status, 403);
  assert.equal((await ctx.request('PUT', `/subjects/${cseOk.body._id}`, { token: cseHod.token, body: { semester: 2 } })).status, 403);
});

test('daily attendance summary: a branch HOD cannot reach 1st-year students by asking for year 1', async () => {
  const names = async (who, qs) => {
    const r = await ctx.request('GET', `/attendance/summary/students${qs}`, { token: who.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.students.map((s) => s.name);
  };
  assert.ok(!(await names(cseHod, '')).includes('Fresher'));
  assert.ok(!(await names(cseHod, '?year=1')).includes('Fresher'), 'year=1 must not widen a branch HOD into 1st year');
  assert.ok(!(await names(cseHod, '?semester=1')).includes('Fresher'));
  assert.ok((await names(cseHod, '')).includes('Senior'));
  // The 1st-year HOD sees the fresher, never the senior.
  assert.ok((await names(fyHod, '')).includes('Fresher'));
  assert.ok(!(await names(fyHod, '?year=3')).includes('Senior'));
  const tally = await ctx.request('GET', '/attendance/summary?year=1', { token: cseHod.token });
  assert.equal(tally.body.students.total, 0);
});
