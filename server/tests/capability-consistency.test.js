/**
 * What the server tells the UI a role can do must match what the API then
 * lets that role do. The Skill Wallet review workspace offered every staff
 * role a "Project reviews" tab, whose queue answered 403 to confined roles
 * (COE, Office) — a broken page in COE's own menu.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { ROLES } from '../src/constants.js';

let ctx;
before(async () => {
  ctx = await startServer();
});
after(async () => {
  await ctx.stop();
});

const STUDENTS = ['student', 'club_admin', 'alumni'];
const WEB_ONLY = ['super_admin'];

test('Skill Wallet: canReviewProjects is true exactly when the review queue opens', async () => {
  for (const role of ROLES.filter((r) => !STUDENTS.includes(r) && !WEB_ONLY.includes(r))) {
    const u = await ctx.createUser({ role, department: ['faculty', 'hod'].includes(role) ? 'CSE' : undefined });
    const { token } = await ctx.loginMobile(u);
    const headers = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };
    const me = await ctx.request('GET', '/skill-wallet/review/me', { token, headers });
    if (me.status !== 200) continue; // a role with no Skill Wallet access at all gets no workspace
    const queue = await ctx.request('GET', '/skill-wallet/review/queue?status=submitted', { token, headers });
    if (me.body.canReviewProjects) assert.equal(queue.status, 200, `${role}: tab offered but queue → ${queue.status}`);
    if (queue.status !== 200) assert.equal(me.body.canReviewProjects, false, `${role}: queue refused but tab offered`);
  }
});

test('Skill Wallet: COE is offered certificate verification only, never project reviews', async () => {
  const coe = await ctx.loginMobile(await ctx.createUser({ role: 'coe' }));
  const me = await ctx.request('GET', '/skill-wallet/review/me', { token: coe.token, headers: { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' } });
  assert.equal(me.status, 200);
  assert.equal(me.body.canReviewProjects, false);
});
