import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { images, hostile, multipart, fetchFile, day, sharp } from './skill-wallet-fixtures.js';

const { startServer } = await import('./helpers.js');
const { getPrivate } = await import('../src/utils/privateStorage.js');

let ctx;
let owner;
let mate;
let stranger;
let hodCse;
let hodEce;
let faculty;
let principal;
let coordinator;
let reviewer;
let superAdmin;
let policyAdmin;

const valid = (over = {}) => ({
  title: 'Smart Irrigation Controller',
  domain: 'iot_hardware',
  description: 'Soil-moisture driven irrigation with an ESP32 and a mobile dashboard.',
  skills: ['ESP32', 'mqtt', 'React Native', 'esp32'],
  stage: 'developing',
  startedAt: day(-60),
  mode: 'solo',
  ...over,
});

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const users = await Promise.all([
    mk({ name: 'Owner', department: 'CSE', section: 'A', year: 3, rollNo: 'P301' }),
    mk({ name: 'Mate', department: 'CSE', section: 'A', year: 3, rollNo: 'P302' }),
    mk({ name: 'Stranger', department: 'ECE', section: 'B', year: 2, rollNo: 'P201' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE' }),
    mk({ role: 'faculty', name: 'Faculty', department: 'CSE' }),
    mk({ role: 'principal', name: 'Principal' }),
    mk({ role: 'faculty', name: 'Coordinator', department: 'ECE' }),
    mk({ role: 'faculty', name: 'Reviewer', department: 'ECE' }),
    mk({ role: 'super_admin', name: 'Super Admin' }),
  ]);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  [owner, mate, stranger, hodCse, hodEce, faculty, principal, coordinator, reviewer] = await Promise.all(users.slice(0, 9).map(login));
  superAdmin = await login(users[9]);
  policyAdmin = await login(await mk({ role: 'admin', name: 'Ops Admin', employeeId: 'E-SW1', policyManaged: true, policies: [{ module: 'attendance', actions: ['view'] }] }));
  // The Principal designates a campus-wide innovation coordinator.
  const g = await req('POST', '/skill-wallet/management/designations', principal, { userId: coordinator.u._id, capability: 'innovation_coordinator', scope: 'campus' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
});

after(async () => {
  await ctx.stop();
});

// ── Validation ─────────────────────────────────────────────────────

test('Required fields and domain validation', async () => {
  for (const k of ['title', 'domain', 'description', 'stage', 'startedAt']) {
    const body = valid();
    delete body[k];
    const res = await req('POST', '/skill-wallet/projects', owner, body);
    assert.equal(res.status, 422, `missing ${k}`);
  }
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ domain: 'astrology' }))).status, 422);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ mode: 'club' }))).status, 422);
});

test('Skills are parsed, normalised, de-duplicated and bounded', async () => {
  const res = await req('POST', '/skill-wallet/projects', owner, valid({ skills: 'ESP32, mqtt ,  React   Native,esp32' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.skills, ['esp32', 'mqtt', 'react native']);
  const many = Array.from({ length: 21 }, (_, i) => `skill${i}`);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ skills: many }))).status, 422);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ skills: ['<script>'] }))).status, 422);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ skills: ['x'.repeat(41)] }))).status, 422);
});

test('Developing stage: end date rejected on the server and stored as null', async () => {
  const withEnd = await req('POST', '/skill-wallet/projects', owner, valid({ endedAt: day(-1) }));
  assert.equal(withEnd.status, 422);
  const ok = await req('POST', '/skill-wallet/projects', owner, valid({ endedAt: '' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.endedAt, null);
});

test('Implemented stage: end date required, not before start, not in future', async () => {
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ stage: 'implemented' }))).status, 422);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ stage: 'implemented', endedAt: day(-90) }))).status, 422, 'before start');
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ stage: 'implemented', endedAt: day(10) }))).status, 422, 'future');
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ startedAt: day(10) }))).status, 422, 'future start');
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ startedAt: '2024-02-30' }))).status, 422, 'impossible date');
  const ok = await req('POST', '/skill-wallet/projects', owner, valid({ stage: 'implemented', endedAt: day(-1) }));
  assert.equal(ok.status, 201);

  // implemented → developing clears the end date; sending one with developing is refused.
  const refuse = await req('PUT', `/skill-wallet/projects/${ok.body._id}`, owner, { stage: 'developing', endedAt: day(-1) });
  assert.equal(refuse.status, 422);
  const back = await req('PUT', `/skill-wallet/projects/${ok.body._id}`, owner, { stage: 'developing' });
  assert.equal(back.status, 200);
  assert.equal(back.body.endedAt, null);
  const stored = await ctx.models.InnovationProject.findById(ok.body._id).lean();
  assert.equal(stored.endedAt, null);
  // developing → implemented without an end date is refused.
  assert.equal((await req('PUT', `/skill-wallet/projects/${ok.body._id}`, owner, { stage: 'implemented' })).status, 422);
});

test('Safe URL validation for GitHub and Google Drive', async () => {
  const bad = [
    { githubUrl: 'javascript:alert(1)' },
    { githubUrl: 'data:text/html,<script>alert(1)</script>' },
    { githubUrl: 'http://github.com/a/b' },
    { githubUrl: 'https://gitlab.com/a/b' },
    { githubUrl: 'https://github.com/onlyowner' },
    { githubUrl: 'https://user:pass@github.com/a/b' },
    { githubUrl: 'https://github.com.evil.io/a/b' },
    { driveUrl: 'https://drive.google.com.evil.io/x' },
    { driveUrl: 'https://127.0.0.1/file' },
    { driveUrl: 'ftp://drive.google.com/x' },
  ];
  for (const b of bad) assert.equal((await req('POST', '/skill-wallet/projects', owner, valid(b))).status, 422, JSON.stringify(b));
  const ok = await req('POST', '/skill-wallet/projects', owner, valid({ githubUrl: 'https://github.com/vexon/irrigation', driveUrl: 'https://drive.google.com/drive/folders/abc123' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.githubUrl, 'https://github.com/vexon/irrigation');
});

// ── Images ─────────────────────────────────────────────────────────

test('Project image upload: validated by content, re-encoded in its own format, private', async () => {
  const spoof = await multipart(ctx, 'POST', '/skill-wallet/assets/project-image', { token: owner.token, file: hostile.pdf, filename: 'x.png', type: 'image/png' });
  assert.equal(spoof.status, 415);
  const gif = await multipart(ctx, 'POST', '/skill-wallet/assets/project-image', { token: owner.token, file: await images.gif(), filename: 'x.gif', type: 'image/gif' });
  assert.equal(gif.status, 415);

  const up = await multipart(ctx, 'POST', '/skill-wallet/assets/project-image', { token: owner.token, file: await images.jpegWithExif(), filename: 'photo.jpg', type: 'image/jpeg' });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.mimeType, 'image/jpeg', 'project images keep their format (no forced WebP)');
  const file = await fetchFile(ctx, up.body.url);
  assert.equal(file.status, 200);
  assert.equal((await sharp(file.bytes).metadata()).exif, undefined, 'metadata stripped');

  // Another student cannot attach someone else's upload.
  const steal = await req('POST', '/skill-wallet/projects', stranger, valid({ imageAssetId: up.body.assetId }));
  assert.equal(steal.status, 422);
  // The uploader's URL is bound to them: the stranger has no access through the asset id.
  const created = await req('POST', '/skill-wallet/projects', owner, valid({ title: 'With image', imageAssetId: up.body.assetId }));
  assert.equal(created.status, 201);
  assert.ok(created.body.imageUrl);
  assert.equal((await fetchFile(ctx, `/api/skill-wallet/files/${up.body.assetId}`)).status, 404);
});

// ── Access ─────────────────────────────────────────────────────────

test('Owner / team authorization and IDOR: private projects are invisible to others', async () => {
  const p = (await req('POST', '/skill-wallet/projects', owner, valid({ title: 'Private idea' }))).body;
  assert.equal(p.visibility, 'private', 'new projects start private');
  for (const who of [stranger, mate, faculty, hodCse, principal, coordinator]) {
    assert.equal((await req('GET', `/skill-wallet/projects/${p._id}`, who)).status, 404, `${who.u.name} must not read a private draft`);
    assert.equal((await req('GET', `/skill-wallet/gallery/${p._id}`, who)).status, 404);
  }
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}`, stranger, { title: 'Hijacked' })).status, 404);
  assert.equal((await req('DELETE', `/skill-wallet/projects/${p._id}`, stranger)).status, 404);
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}/publication`, stranger, { audience: 'college' })).status, 404);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 404);
  // Staff cannot create student projects.
  assert.equal((await req('POST', '/skill-wallet/projects', faculty, valid())).status, 403);
});

test('Super Admin and confined roles get no Skill Wallet access from their role', async () => {
  for (const who of [superAdmin, policyAdmin]) {
    for (const path of ['/skill-wallet/gallery', '/skill-wallet/review/queue', '/skill-wallet/management/overview', '/skill-wallet/projects']) {
      assert.equal((await req('GET', path, who)).status, 403, `${who.u.name} ${path}`);
    }
    assert.equal((await req('PUT', `/skill-wallet/projects/000000000000000000000000/publication`, who, { audience: 'public', confirmPublic: true })).status, 403);
  }
});

// ── Review, publication and gallery ────────────────────────────────

let pid;

test('Approval does not publish; public needs approval of the current revision', async () => {
  const p = (await req('POST', '/skill-wallet/projects', owner, valid({ title: 'Flood Alert Mesh', githubUrl: 'https://github.com/vexon/flood' }))).body;
  pid = p._id;
  // Public before approval is refused.
  const early = await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public', confirmPublic: true });
  assert.equal(early.status, 409);
  // Reviewers cannot see a draft that was never submitted.
  assert.equal((await req('GET', `/skill-wallet/review/projects/${pid}`, hodCse)).status, 404);

  assert.equal((await req('POST', `/skill-wallet/projects/${pid}/submit`, owner)).status, 200);
  // HOD of the department sees it; HOD of another department does not.
  assert.equal((await req('GET', `/skill-wallet/review/projects/${pid}`, hodCse)).status, 200);
  assert.equal((await req('GET', `/skill-wallet/review/projects/${pid}`, hodEce)).status, 404);
  assert.equal((await req('GET', `/skill-wallet/review/projects/${pid}`, reviewer)).status, 404, 'unassigned faculty');

  // Coordinator assigns a reviewer; the reviewer can now see and decide.
  const assign = await req('PUT', `/skill-wallet/management/projects/${pid}/reviewers`, coordinator, { reviewerIds: [reviewer.u._id] });
  assert.equal(assign.status, 200, JSON.stringify(assign.body));
  const detail = await req('GET', `/skill-wallet/review/projects/${pid}`, reviewer);
  assert.equal(detail.status, 200);
  const scores = Object.fromEntries(detail.body.rubric.criteria.map((c) => [c.key, 8]));
  const review = await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, reviewer, {
    revision: detail.body.revision,
    scores,
    feedback: 'Strong prototype.',
    internalNotes: 'Consider for IIC showcase — do not share yet.',
    decision: 'approve',
    recommendFunding: true,
  });
  assert.equal(review.status, 201, JSON.stringify(review.body));
  assert.equal(review.body.status, 'approved');
  assert.equal(review.body.visibility, 'private', 'approval never publishes');
  assert.equal(review.body.review.totalScore, 80);

  const stored = await ctx.models.InnovationProject.findById(pid).lean();
  assert.equal(stored.visibility, 'private');
  assert.equal(stored.published, null);
  assert.equal(stored.facultyScore, 80);
  // The funding recommendation is a note only.
  const rec = await ctx.models.InnovationRecommendation.findOne({ project: pid }).lean();
  assert.equal(rec.kind, 'funding');
  assert.equal(rec.status, 'open');

  // Students see feedback but never internal notes.
  const mine = await req('GET', `/skill-wallet/projects/${pid}`, owner);
  assert.equal(mine.body.reviews[0].feedback, 'Strong prototype.');
  assert.equal(JSON.stringify(mine.body).includes('do not share yet'), false);
  // Duplicate review of the same revision is refused.
  assert.equal((await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, reviewer, { revision: detail.body.revision, scores, decision: 'approve' })).status, 409);
  // Incomplete rubric refused.
  assert.equal((await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, hodCse, { revision: detail.body.revision, scores: { originality: 5 }, decision: 'approve' })).status, 422);
});

test('College-only: visible to signed-in college users, not to visitors; public only after explicit choice', async () => {
  // Explicit public confirmation is required.
  assert.equal((await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public' })).status, 422);
  const college = await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'college' });
  assert.equal(college.status, 200);
  assert.equal(college.body.visibility, 'college');
  assert.equal((await req('GET', `/skill-wallet/gallery/${pid}`, stranger)).status, 200, 'college user sees it');
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`)).status, 404, 'visitor does not');
  const pub = await ctx.request('GET', '/skill-wallet/public/gallery');
  assert.equal(pub.body.items.some((i) => i._id === pid), false);

  const go = await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public', confirmPublic: true });
  assert.equal(go.status, 200, JSON.stringify(go.body));
  assert.equal(go.body.visibility, 'public', 'solo project: owner confirmation is enough');
  const visitor = await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`);
  assert.equal(visitor.status, 200);
  const list = await ctx.request('GET', '/skill-wallet/public/gallery?q=flood');
  assert.ok(list.body.items.some((i) => i._id === pid));
});

test('Public responses never contain private data or internal user IDs', async () => {
  const visitor = await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`);
  const raw = JSON.stringify(visitor.body);
  for (const id of [owner.u._id, reviewer.u._id, coordinator.u._id]) assert.equal(raw.includes(String(id)), false, 'no user ids');
  for (const word of ['internalNotes', 'do not share yet', 'rollNo', 'P301', 'hallTicket', 'invitation', 'email', 'reviewers']) {
    assert.equal(raw.includes(word), false, word);
  }
  assert.equal(visitor.body.team[0].name, 'Owner');
  assert.equal(visitor.body.facultyScore, 80);
  const board = await ctx.request('GET', '/skill-wallet/public/leaderboard?board=faculty');
  assert.equal(board.status, 200);
  assert.match(board.body.criteria.note, /Likes and comments do not affect/);
  assert.equal(JSON.stringify(board.body).includes(String(owner.u._id)), false);
});

test('Public assets are individually authorized; unpublishing removes public access', async () => {
  const up = await multipart(ctx, 'POST', '/skill-wallet/assets/project-image', { token: owner.token, file: await images.png() });
  const p = (await req('POST', '/skill-wallet/projects', owner, valid({ title: 'Asset Test', imageAssetId: up.body.assetId }))).body;
  await req('POST', `/skill-wallet/projects/${p._id}/submit`, owner);
  const d = await req('GET', `/skill-wallet/review/projects/${p._id}`, hodCse);
  const scores = Object.fromEntries(d.body.rubric.criteria.map((c) => [c.key, 6]));
  assert.equal((await req('POST', `/skill-wallet/review/projects/${p._id}/reviews`, hodCse, { revision: d.body.revision, scores, decision: 'approve' })).status, 201);
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}/publication`, owner, { audience: 'public', confirmPublic: true })).status, 200);

  const pub = await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`);
  assert.ok(pub.body.imageUrl);
  assert.equal((await fetchFile(ctx, pub.body.imageUrl)).status, 200, 'published image visible to visitors');

  // A NEW image on the live copy is not public (only the published copy's image is).
  const up2 = await multipart(ctx, 'POST', '/skill-wallet/assets/project-image', { token: owner.token, file: await images.webp(), filename: 'n.webp', type: 'image/webp' });
  const edited = await req('PUT', `/skill-wallet/projects/${p._id}`, owner, { imageAssetId: up2.body.assetId });
  assert.equal(edited.status, 200);
  const live = await ctx.models.InnovationProject.findById(p._id).lean();
  const { signAssetToken } = await import('../src/services/skillWallet/assets.js');
  assert.equal((await fetchFile(ctx, `/api/skill-wallet/files/${signAssetToken(String(live.image), 'p')}`)).status, 404, 'unpublished live image is not public');
  assert.equal((await fetchFile(ctx, `/api/skill-wallet/files/${signAssetToken(String(live.image), String(stranger.u._id))}`)).status, 404, 'nor visible to another student');
  // The gallery still shows the approved, published revision.
  const still = await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`);
  assert.equal(still.status, 200);
  assert.equal(still.body.title, 'Asset Test');

  // Unpublish: the public URL that worked a moment ago stops working.
  assert.equal((await req('PUT', `/skill-wallet/projects/${p._id}/publication`, owner, { audience: 'private' })).status, 200);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${p._id}`)).status, 404);
  assert.equal((await fetchFile(ctx, pub.body.imageUrl)).status, 404, 'previously issued public URL is dead');
  assert.equal((await req('GET', `/skill-wallet/gallery/${p._id}`, stranger)).status, 404);
  // The old published image (no longer used anywhere) was removed from storage.
  const oldAsset = await ctx.models.SkillWalletAsset.findById(up.body.assetId).lean();
  assert.equal(oldAsset.status, 'deleted');
  assert.equal(await getPrivate(oldAsset.storageKey), null);
});

test('Material revision requires renewed review before the public copy changes', async () => {
  const before = await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`);
  assert.equal(before.body.title, 'Flood Alert Mesh');
  const edit = await req('PUT', `/skill-wallet/projects/${pid}`, owner, { title: 'Flood Alert Mesh v2' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.revision, 2);
  assert.equal(edit.body.review.status, 'draft', 'approval does not carry over to a new revision');
  // Public copy unchanged.
  const still = await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`);
  assert.equal(still.body.title, 'Flood Alert Mesh');
  // Re-publishing the new revision publicly needs re-approval.
  assert.equal((await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public', confirmPublic: true })).status, 409);
  // A cosmetic (skills only) change does not create a revision.
  const cosmetic = await req('PUT', `/skill-wallet/projects/${pid}`, owner, { skills: ['lora', 'mesh'] });
  assert.equal(cosmetic.body.revision, 2);
  // Reviewing a stale revision is refused.
  await req('POST', `/skill-wallet/projects/${pid}/submit`, owner);
  const d = await req('GET', `/skill-wallet/review/projects/${pid}`, reviewer);
  const scores = Object.fromEntries(d.body.rubric.criteria.map((c) => [c.key, 9]));
  assert.equal((await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, reviewer, { revision: 1, scores, decision: 'approve' })).status, 409);
  assert.equal((await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, reviewer, { revision: 2, scores, decision: 'approve' })).status, 201);
  // Approval alone still does not change the public copy...
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`)).body.title, 'Flood Alert Mesh');
  // ...the owner's explicit re-publication does.
  assert.equal((await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public', confirmPublic: true })).status, 200);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`)).body.title, 'Flood Alert Mesh v2');
});

test('Unauthorized users cannot publish, hide or moderate', async () => {
  assert.equal((await req('PUT', `/skill-wallet/projects/${pid}/publication`, hodCse, { audience: 'private' })).status, 403);
  assert.equal((await req('PUT', `/skill-wallet/projects/${pid}/publication`, principal, { audience: 'private' })).status, 403);
  assert.equal((await req('POST', `/skill-wallet/management/projects/${pid}/hide`, hodCse, { reason: 'Not allowed' })).status, 403);
  assert.equal((await req('POST', `/skill-wallet/management/projects/${pid}/hide`, principal, { reason: 'Not allowed' })).status, 403, 'Principal role is not a moderator');
  assert.equal((await req('POST', '/skill-wallet/management/designations', coordinator, { userId: faculty.u._id, capability: 'project_reviewer' })).status, 403, 'only the Principal designates');
  assert.equal((await req('POST', '/skill-wallet/management/designations', principal, { userId: principal.u._id, capability: 'innovation_coordinator' })).status, 422, 'no self-grant');
});

test('Moderation hides content everywhere; interactions and reports work for college users', async () => {
  const like = await req('POST', `/skill-wallet/projects/${pid}/like`, stranger);
  assert.equal(like.status, 200);
  assert.equal(like.body.liked, true);
  assert.equal((await req('POST', `/skill-wallet/projects/${pid}/like`, stranger)).body.liked, false, 'toggle');
  await req('POST', `/skill-wallet/projects/${pid}/like`, stranger);
  const c = await req('POST', `/skill-wallet/projects/${pid}/comments`, stranger, { body: 'Great work!' });
  assert.equal(c.status, 201);
  const rep = await req('POST', `/skill-wallet/projects/${pid}/report`, mate, { reason: 'spam', commentId: c.body._id });
  assert.equal(rep.status, 201);
  assert.equal((await req('POST', `/skill-wallet/projects/${pid}/report`, mate, { reason: 'spam', commentId: c.body._id })).status, 409);
  // Visitors never see comments.
  assert.equal((await ctx.request('GET', `/skill-wallet/projects/${pid}/comments`)).status, 401);

  const reports = await req('GET', '/skill-wallet/management/reports', coordinator);
  const r = reports.body.items[0];
  assert.equal((await req('PATCH', `/skill-wallet/management/reports/${r._id}`, coordinator, { action: 'hide_comment', note: 'Spam comment' })).status, 200);
  assert.equal((await req('GET', `/skill-wallet/projects/${pid}/comments`, mate)).body.items.length, 0);

  assert.equal((await req('POST', `/skill-wallet/management/projects/${pid}/hide`, coordinator, { reason: 'Under investigation' })).status, 200);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`)).status, 404);
  assert.equal((await req('GET', `/skill-wallet/gallery/${pid}`, stranger)).status, 404);
  assert.equal((await ctx.request('GET', '/skill-wallet/public/leaderboard')).body.items.some((i) => i.project._id === pid), false);
  assert.equal((await req('POST', `/skill-wallet/projects/${pid}/like`, stranger)).status, 404);
  // The team still sees its own project, flagged as hidden.
  const mine = await req('GET', `/skill-wallet/projects/${pid}`, owner);
  assert.equal(mine.body.hidden, true);
  assert.equal((await req('POST', `/skill-wallet/management/projects/${pid}/unhide`, coordinator, {})).status, 200);
  assert.equal((await ctx.request('GET', `/skill-wallet/public/gallery/${pid}`)).status, 200);
  const audits = await ctx.models.AuditLog.countDocuments({ action: 'SKILL_WALLET_MODERATION' });
  assert.ok(audits >= 3);
});

test('Protected contact requests reveal email only after the owner accepts', async () => {
  const sent = await req('POST', `/skill-wallet/projects/${pid}/contact`, stranger, { message: 'Can we collaborate on LoRa?' });
  assert.equal(sent.status, 201);
  let mine = await req('GET', '/skill-wallet/contact-requests?box=sent', stranger);
  assert.equal(mine.body.items[0].person.email, undefined);
  const inbox = await req('GET', '/skill-wallet/contact-requests', owner);
  assert.equal((await req('POST', `/skill-wallet/contact-requests/${inbox.body.items[0]._id}/respond`, mate, { decision: 'accept' })).status, 404, 'only the owner answers');
  assert.equal((await req('POST', `/skill-wallet/contact-requests/${inbox.body.items[0]._id}/respond`, owner, { decision: 'accept' })).status, 200);
  mine = await req('GET', '/skill-wallet/contact-requests?box=sent', stranger);
  assert.equal(mine.body.items[0].person.email, owner.u.email);
});

test('Profile links: validation, ownership, visibility in portfolio', async () => {
  const bad = [
    { platform: 'github', url: 'https://gitlab.com/me' },
    { platform: 'linkedin', url: 'javascript:alert(1)' },
    { platform: 'leetcode', url: 'http://leetcode.com/u/me' },
    { platform: 'other', url: 'https://example.com/me' }, // custom needs a name
    { platform: 'portfolio', url: 'https://localhost/me' },
    { platform: 'portfolio', url: 'https://10.0.0.1/me' },
    { platform: 'myspace', url: 'https://myspace.com/me' },
  ];
  for (const b of bad) assert.equal((await req('POST', '/skill-wallet/profile-links', owner, b)).status, 422, JSON.stringify(b));
  const gh = await req('POST', '/skill-wallet/profile-links', owner, { platform: 'github', url: 'https://github.com/owner-dev', visibility: 'college' });
  assert.equal(gh.status, 201);
  assert.equal(gh.body.displayName, 'GitHub');
  const thm = await req('POST', '/skill-wallet/profile-links', owner, { platform: 'tryhackme', url: 'https://tryhackme.com/p/owner', visibility: 'private' });
  assert.equal(thm.status, 201);
  const custom = await req('POST', '/skill-wallet/profile-links', owner, { platform: 'other', displayName: 'Devpost', url: 'https://devpost.com/owner' });
  assert.equal(custom.status, 201);
  assert.equal((await req('PUT', `/skill-wallet/profile-links/${gh.body._id}`, stranger, { visibility: 'public' })).status, 404);
  assert.equal((await req('DELETE', `/skill-wallet/profile-links/${gh.body._id}`, stranger)).status, 404);
  const pf = await req('GET', `/skill-wallet/portfolio/${owner.u._id}`, stranger);
  const urls = pf.body.links.map((l) => l.url);
  assert.ok(urls.includes('https://github.com/owner-dev'));
  assert.equal(urls.includes('https://tryhackme.com/p/owner'), false, 'private link hidden');
});

test('Configurable domains and versioned rubric (campus coordinators only)', async () => {
  const cfg = (await req('GET', '/skill-wallet/config', owner)).body;
  assert.ok(cfg.domains.some((d) => d.key === 'iot_hardware'));
  assert.equal((await req('PUT', '/skill-wallet/config', hodCse, { domains: cfg.domains })).status, 403);
  // Removing an in-use domain is refused; retiring it is allowed.
  const without = cfg.domains.filter((d) => d.key !== 'iot_hardware');
  assert.equal((await req('PUT', '/skill-wallet/config', coordinator, { domains: without })).status, 422);
  const retired = cfg.domains.map((d) => (d.key === 'iot_hardware' ? { ...d, active: false } : d)).concat([{ key: 'agritech', label: 'AgriTech' }]);
  assert.equal((await req('PUT', '/skill-wallet/config', coordinator, { domains: retired })).status, 200);
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid())).status, 422, 'retired domain not offered for new projects');
  assert.equal((await req('POST', '/skill-wallet/projects', owner, valid({ domain: 'agritech' }))).status, 201);
  // Rubric weights must total 100; a change bumps the version.
  const crit = cfg.rubric.criteria.map((c) => ({ ...c }));
  crit[0].weight += 5;
  assert.equal((await req('PUT', '/skill-wallet/config', coordinator, { rubric: { criteria: crit } })).status, 422);
  crit[1].weight -= 5;
  const r = await req('PUT', '/skill-wallet/config', coordinator, { rubric: { criteria: crit } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rubric.version, cfg.rubric.version + 1);
});
