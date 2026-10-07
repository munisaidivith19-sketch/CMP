import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { D, setupAnnouncementCast } from './announcement-fixtures.js';

// Announcement tampering: an HOD cannot widen their audience by editing the
// request, invalid audiences and unsafe image URLs are rejected, edits cannot move
// an announcement out of scope, and pinning is confined to the author's own posts.

let ctx, tok, u, post, visibleTo;

before(async () => {
  ({ ctx, tok, u, post, visibleTo } = await setupAnnouncementCast());
});

after(() => ctx?.stop());

async function assertAudience(id, yes, no) {
  for (const k of yes) assert.ok(await visibleTo(k, id), `${k} should see the announcement`);
  for (const k of no) assert.ok(!(await visibleTo(k, id)), `${k} must not see the announcement`);
}

test('HOD cannot reach another department or 1st year by tampering with the request', async () => {
  assert.equal((await post('hod', { scope: 'department', department: 'ECE' })).status, 403);
  assert.equal((await post('hod', { scope: 'year', department: 'ECE', year: 3 })).status, 403);
  assert.equal((await post('hod', { scope: 'year', year: 3 })).status, 403, 'no department = all departments');
  assert.equal((await post('hod', { scope: 'section', department: 'ECE', year: 3, section: 'A' })).status, 403);
  assert.equal((await post('hod', { scope: 'year', department: D, year: 1 })).status, 403, '1st year belongs to S&H HOD');
});

test('invalid audiences are rejected', async () => {
  const bad = [
    { scope: 'department' },
    { scope: 'department', department: 'Hacking Dept' },
    { scope: 'department', department: { $ne: '' } },
    { scope: 'year', department: D },
    { scope: 'year', department: D, year: 9 },
    { scope: 'section', year: 3, section: 'A' },
    { scope: 'section', department: D, year: 3, section: 'Z' },
    { scope: 'section', department: D, year: 3, section: ['A', 'B'] },
    { scope: 'galaxy' },
  ];
  for (const audience of bad) {
    const r = await post('principal', audience);
    assert.ok([400, 422].includes(r.status), `${JSON.stringify(audience)} → ${r.status}`);
  }
});

test('optional image: uploaded or https images only', async () => {
  const ok = await post('principal', { scope: 'all' }, { image: '/uploads/abc.png' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.image, '/uploads/abc.png');
  assert.equal(ok.body.author.name, u.principal.name, 'the card names who shared it');
  assert.ok(ok.body.createdAt, 'the card shows when it was shared');

  for (const image of ['javascript:alert(1)', 'http://evil.test/x.png', '/uploads/../.env', '/uploads/%2e%2e/secret', 'data:image/svg+xml,<svg onload=alert(1)>', { $gt: '' }]) {
    const r = await post('principal', { scope: 'all' }, { image });
    assert.equal(r.status, 422, `${JSON.stringify(image)} → ${r.status}`);
  }

  // Removing the image on edit.
  const cleared = await ctx.request('PUT', `/announcements/${ok.body._id}`, { token: tok.principal, body: { image: '' } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.image, undefined);
});

test('editing cannot move an announcement outside the author’s scope', async () => {
  const r = await post('hod', { scope: 'section', department: D, year: 3, section: 'A' });
  const moved = await ctx.request('PUT', `/announcements/${r.body._id}`, {
    token: tok.hod,
    body: { audience: { scope: 'all' } },
  });
  assert.equal(moved.status, 403);
  const other = await ctx.request('PUT', `/announcements/${r.body._id}`, {
    token: tok.hod,
    body: { audience: { scope: 'department', department: 'ECE' } },
  });
  assert.equal(other.status, 403);
  // Same audience + new text is fine.
  const same = await ctx.request('PUT', `/announcements/${r.body._id}`, {
    token: tok.hod,
    body: { title: 'Updated notice', audience: { scope: 'section', department: D, year: 3, section: 'A' } },
  });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  // Another HOD cannot touch it at all.
  assert.equal((await ctx.request('PUT', `/announcements/${r.body._id}`, { token: tok.eceHod, body: { title: 'Hijacked' } })).status, 403);
  assert.equal((await ctx.request('DELETE', `/announcements/${r.body._id}`, { token: tok.eceHod })).status, 403);
});

test('pinning: Principal / Admin pin anything; others only their own visible announcements', async () => {
  const main = await post('principal', { scope: 'all' });
  const sec = await post('hod', { scope: 'section', department: D, year: 3, section: 'A' });
  assert.equal((await ctx.request('PATCH', `/announcements/${main.body._id}/pin`, { token: tok.faculty })).status, 403);
  assert.equal((await ctx.request('PATCH', `/announcements/${sec.body._id}/pin`, { token: tok.eceFaculty })).status, 404, 'not visible → not found');
  assert.equal((await ctx.request('PATCH', `/announcements/${sec.body._id}/pin`, { token: tok.y3a })).status, 403);
  const own = await ctx.request('PATCH', `/announcements/${sec.body._id}/pin`, { token: tok.hod });
  assert.equal(own.status, 200);
  assert.equal(own.body.isPinned, true);
  const p = await ctx.request('PATCH', `/announcements/${main.body._id}/pin`, { token: tok.principal });
  assert.equal(p.status, 200);
  assert.equal(p.body.isPinned, true);
});
