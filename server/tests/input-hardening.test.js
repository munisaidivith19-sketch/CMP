import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { addDays, dayKey, today } from '../src/utils/dates.js';

/** Wrong-typed bodies are refused with 422 — never a 500 from code that assumed a string. */
let ctx;
let principal;

before(async () => {
  ctx = await startServer();
  const p = await ctx.createUser({ role: 'principal', name: 'Principal H', employeeId: 'HARD-P-1' });
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  await ctx.createUser({ role: 'student', name: 'Hosteler H', rollNo: 'HARD001', department: 'CSE', section: 'A', year: 2, stayType: 'hosteler', parentPhone: '9000000001' });
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('achievements: an image path that climbs out of /uploads/ is refused', async () => {
  const student = await ctx.models.User.findOne({ rollNo: 'HARD001' });
  const body = (url) => ({
    title: 'Hackathon winners',
    description: 'Won the state level hackathon with a campus safety app.',
    category: 'technical',
    level: 'state',
    achievedOn: dayKey(today()),
    students: [String(student._id)],
    images: [{ url, mimeType: 'image/png' }],
  });
  for (const url of ['/uploads/../api/admin/users', '/uploads/%2e%2e/secret', '/uploads/..%5c..%5cwin.ini', 'javascript:alert(1)']) {
    const res = await ctx.request('POST', '/achievements', { token: principal.token, body: body(url) });
    assert.equal(res.status, 422, `${url} must be refused`);
  }
  const ok = await ctx.request('POST', '/achievements', { token: principal.token, body: body('/uploads/images/a.png') });
  assert.equal(ok.status, 201);
});

test('mass outpass: non-string destination fields are a 422, not a server error', async () => {
  const base = { fromDate: dayKey(addDays(today(), 1)), toDate: dayKey(addDays(today(), 2)), description: 'Pongal holidays' };
  for (const destination of [{ state: ['TN'] }, { district: { $ne: '' } }, { area: 42 }, 'Chennai']) {
    const res = await ctx.request('POST', '/gate-pass/mass-approve', { token: principal.token, body: { ...base, destination } });
    assert.equal(res.status, 422, `destination ${JSON.stringify(destination)} must be rejected`);
  }
  const ok = await ctx.request('POST', '/gate-pass/mass-approve', { token: principal.token, body: { ...base, destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Home' } } });
  assert.equal(ok.status < 300, true, `valid request accepted (got ${ok.status})`);
});
