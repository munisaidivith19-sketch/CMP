/**
 * Regressions found by API fuzzing: malformed input must be a 4xx, never a
 * 500. Query strings can carry arrays (?search[]=a) or objects
 * (?search[x]=y), and a "list" body field can arrive as a string, number,
 * object or null.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin;
before(async () => {
  ctx = await startServer();
  admin = await ctx.loginMobile(await ctx.createUser({ role: 'admin' }));
});
after(async () => {
  await ctx.stop();
});

const mobile = { 'x-client-platform': 'mobile', 'user-agent': 'okhttp/4.12.0' };
const call = (method, path, body) => ctx.request(method, path, { token: admin.token, body, headers: mobile });

test('alumni list searches accept only a string search term (array / object → no crash)', async () => {
  for (const base of ['/alumni', '/alumni/events', '/alumni/jobs', '/alumni/invites']) {
    for (const q of ['search[]=a&search[]=b', 'search[x]=y', 'search=%20%20']) {
      const res = await call('GET', `${base}?${q}`);
      assert.ok(res.status < 500, `${base}?${q} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
});

test('a list field (tags) sent as a non-list is a 422, never a 500', async () => {
  const club = { name: 'Fuzz Club', description: 'A club created by the fuzz regression test.', category: 'technical' };
  const event = { title: 'Fuzz event', description: 'An event created by the fuzz test.', venue: 'Hall', startDate: new Date(Date.now() + 864e5).toISOString(), endDate: new Date(Date.now() + 9e7).toISOString() };
  for (const tags of ['exam', 42, { a: 1 }, null]) {
    for (const [path, body] of [['/clubs', club], ['/events', event], ['/discussions', { title: 'Fuzz question', body: 'Enough detail for a discussion.' }]]) {
      const res = await call('POST', path, { ...body, tags });
      assert.ok(res.status < 500, `${path} tags=${JSON.stringify(tags)} → ${res.status} ${JSON.stringify(res.body)}`);
      if (tags !== null) assert.equal(res.status, 422, `${path} tags=${JSON.stringify(tags)}`);
    }
  }
});
