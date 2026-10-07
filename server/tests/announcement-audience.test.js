import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { D, setupAnnouncementCast } from './announcement-fixtures.js';

// Announcement audiences: the main (campus-wide) announcement is Principal-only;
// department / year / section announcements are Principal + HOD (own scope) and
// reach only that department / year / section — including through notifications,
// the dashboard and search. Everything is enforced server-side.

let ctx, tok, u, post, visibleTo;

before(async () => {
  ({ ctx, tok, u, post, visibleTo } = await setupAnnouncementCast());
});

after(() => ctx?.stop());

async function assertAudience(id, yes, no) {
  for (const k of yes) assert.ok(await visibleTo(k, id), `${k} should see the announcement`);
  for (const k of no) assert.ok(!(await visibleTo(k, id)), `${k} must not see the announcement`);
}

test('main announcement: only the Principal publishes it, and it reaches the whole campus', async () => {
  for (const who of ['admin', 'hod', 'faculty', 'chairman', 'y3a', 'security']) {
    const r = await post(who, { scope: 'all' });
    assert.equal(r.status, 403, `${who} must not publish the main announcement`);
  }
  // No audience at all defaults to the main announcement — same rule.
  assert.equal((await ctx.request('POST', '/announcements', { token: tok.faculty, body: { title: 'Sneaky', content: 'No audience given.' } })).status, 403);

  const r = await post('principal', { scope: 'all' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await assertAudience(r.body._id, ['y3a', 'eceY2a', 'y1a', 'faculty', 'eceFaculty', 'hod', 'chairman', 'dean', 'ao', 'admin', 'security'], []);
});

test('department / year / section posting is limited to the Principal and HODs', async () => {
  for (const who of ['faculty', 'admin', 'chairman', 'dean', 'ao', 'y3a', 'security']) {
    assert.equal((await post(who, { scope: 'department', department: D })).status, 403, `${who} dept`);
  }
  for (const who of ['faculty', 'y3a']) {
    assert.equal((await post(who, { scope: 'year', department: D, year: 3 })).status, 403, `${who} year`);
    assert.equal((await post(who, { scope: 'section', department: D, year: 3, section: 'A' })).status, 403, `${who} section`);
  }
});

test('department announcement reaches only that department', async () => {
  const r = await post('hod', { scope: 'department', department: D });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.audience, { scope: 'department', department: D });
  await assertAudience(r.body._id, ['y3a', 'y2a', 'faculty', 'hod', 'principal', 'chairman'], ['eceY3a', 'eceFaculty', 'eceHod', 'security']);
});

test('year announcement reaches only that department + year', async () => {
  const r = await post('hod', { scope: 'year', department: D, year: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await assertAudience(r.body._id, ['y3a', 'y3b', 'faculty', 'principal'], ['y2a', 'y1a', 'eceY3a', 'eceFaculty', 'security']);
});

test('section announcement reaches only that department + year + section', async () => {
  const r = await post('hod', { scope: 'section', department: D, year: 3, section: 'a' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.audience.section, 'A');
  await assertAudience(r.body._id, ['y3a', 'faculty', 'principal'], ['y3b', 'y2a', 'eceY3a', 'eceFaculty']);
});

test('Principal can address one year across all departments', async () => {
  const r = await post('principal', { scope: 'year', year: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await assertAudience(r.body._id, ['y2a', 'eceY2a'], ['y3a', 'eceY3a', 'y1a']);
  // …and any single department / section.
  const s = await post('principal', { scope: 'section', department: 'ECE', year: 3, section: 'A' });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  await assertAudience(s.body._id, ['eceY3a', 'eceFaculty'], ['y3a', 'eceY2a', 'faculty']);
});

test('First-year HOD posts to 1st year only, in any department', async () => {
  const r = await post('fyHod', { scope: 'year', year: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await assertAudience(r.body._id, ['y1a', 'eceY1a', 'fyHod'], ['y2a', 'eceY3a']);
  const s = await post('fyHod', { scope: 'section', department: 'ECE', year: 1, section: 'A' });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  await assertAudience(s.body._id, ['eceY1a'], ['y1a']);
  assert.equal((await post('fyHod', { scope: 'year', department: D, year: 2 })).status, 403);
  assert.equal((await post('fyHod', { scope: 'department', department: D })).status, 403);
});

test('dashboard and search never leak another class’s announcements', async () => {
  const marker = `Zebra${Date.now()}`;
  const r = await post('hod', { scope: 'section', department: D, year: 3, section: 'A' }, { title: `${marker} section notice` });
  assert.equal(r.status, 201);
  const search = async (who) => (await ctx.request('GET', `/search?q=${marker}`, { token: tok[who] })).body;
  const has = (body) => JSON.stringify(body).includes(r.body._id);
  assert.ok(has(await search('y3a')));
  assert.ok(!has(await search('y3b')));
  assert.ok(!has(await search('eceY3a')));
  assert.ok(!has(await search('eceFaculty')));
  const dash = await ctx.request('GET', '/dashboard', { token: tok.eceY3a });
  assert.ok(!JSON.stringify(dash.body).includes(r.body._id));
});

test('notifications go only to the announcement audience', async () => {
  const r = await post('hod', { scope: 'section', department: D, year: 3, section: 'B' }, { title: 'Section B lab moved' });
  assert.equal(r.status, 201);
  const Notification = ctx.models.Notification;
  const noted = (who) => Notification.exists({ user: u[who]._id, type: 'announcement', title: /Section B lab moved/ });
  for (let i = 0; i < 40 && !(await noted('y3b')); i++) await new Promise((res) => setTimeout(res, 50));
  assert.ok(await noted('y3b'));
  assert.ok(await noted('faculty'));
  for (const who of ['y3a', 'y2a', 'eceY3a', 'eceFaculty', 'security']) assert.ok(!(await noted(who)), `${who} must not be notified`);
});
