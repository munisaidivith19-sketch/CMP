/**
 * Regression tests for the Skill Wallet defects found in the 2026-10 security
 * audit (docs/recent-features/SECURITY_AUDIT_AND_BUGFIX_REPORT.md):
 *
 *  SW-1  A later reviewer's "reject" / "request changes" left the earlier
 *        approval in place, so a rejected revision could still go public.
 *  SW-2  The Principal could grant themselves the certificate_verifier
 *        designation (only innovation_coordinator self-grants were refused).
 *  SW-3  A certificate decision was not bound to the version the verifier
 *        looked at: the student could swap the image after the verifier
 *        opened it and the verifier's "verified" applied to the new image.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { images, multipart, day } from './skill-wallet-fixtures.js';

const { startServer } = await import('./helpers.js');

let ctx;
let owner;
let hodCse;
let coordinator;
let principal;
let student;
let incharge;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  [owner, hodCse, coordinator, principal, student, incharge] = await Promise.all(
    [
      mk({ name: 'Owner', department: 'CSE', section: 'A', year: 3, rollNo: 'SA301' }),
      mk({ role: 'hod', name: 'HOD CSE', department: 'CSE' }),
      mk({ role: 'faculty', name: 'Coordinator', department: 'ECE' }),
      mk({ role: 'principal', name: 'Principal' }),
      mk({ name: 'Cert Student', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'SA302' }),
      mk({ role: 'faculty', name: 'In Charge', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5 }),
    ].map(async (p) => login(await p))
  );
  const g = await req('POST', '/skill-wallet/management/designations', principal, { userId: coordinator.u._id, capability: 'innovation_coordinator', scope: 'campus' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
});

after(async () => {
  await ctx.stop();
});

test('SW-1: a later reject of the same revision withdraws the approval; the project cannot go public', async () => {
  const p = await req('POST', '/skill-wallet/projects', owner, {
    title: 'Campus Water Monitor',
    domain: 'iot_hardware',
    description: 'Tank level sensors with LoRa uplink and an alerting dashboard.',
    skills: ['lora'],
    stage: 'developing',
    startedAt: day(-30),
    mode: 'solo',
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const pid = p.body._id;
  assert.equal((await req('POST', `/skill-wallet/projects/${pid}/submit`, owner)).status, 200);

  const d = await req('GET', `/skill-wallet/review/projects/${pid}`, hodCse);
  const scores = Object.fromEntries(d.body.rubric.criteria.map((c) => [c.key, 7]));
  const approve = await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, hodCse, { revision: d.body.revision, scores, decision: 'approve' });
  assert.equal(approve.status, 201, JSON.stringify(approve.body));

  const reject = await req('POST', `/skill-wallet/review/projects/${pid}/reviews`, coordinator, {
    revision: d.body.revision,
    scores,
    decision: 'reject',
    reason: 'Prototype evidence does not match the description',
  });
  assert.equal(reject.status, 201, JSON.stringify(reject.body));
  assert.equal(reject.body.status, 'rejected');
  assert.equal(reject.body.approvedRevision, null, 'the rejection withdraws the approval of that revision');

  const pub = await req('GET', `/skill-wallet/projects/${pid}/publication`, owner);
  assert.equal(pub.body.canRequestPublic, false);
  const go = await req('PUT', `/skill-wallet/projects/${pid}/publication`, owner, { audience: 'public', confirmPublic: true });
  assert.equal(go.status, 409, 'a rejected revision is never published publicly');
  const stored = await ctx.models.InnovationProject.findById(pid).lean();
  assert.equal(stored.visibility, 'private');
  assert.equal(stored.facultyScore, null, 'no faculty score without an approval');
});

test('SW-2: the Principal cannot grant themselves any Skill Wallet designation', async () => {
  for (const capability of ['certificate_verifier', 'project_reviewer', 'innovation_coordinator']) {
    const r = await req('POST', '/skill-wallet/management/designations', principal, { userId: principal.u._id, capability, scope: 'campus' });
    assert.equal(r.status, 422, capability);
  }
  assert.equal(await ctx.models.SkillWalletDesignation.countDocuments({ user: principal.u._id }), 0);
  // Granting someone else still works.
  const other = await req('POST', '/skill-wallet/management/designations', principal, { userId: incharge.u._id, capability: 'certificate_verifier', scope: 'department', department: 'CSE' });
  assert.equal(other.status, 201, JSON.stringify(other.body));
});

test('SW-3: a certificate decision applies only to the version the verifier opened', async () => {
  const created = await multipart(ctx, 'POST', '/skill-wallet/certifications', {
    token: student.token,
    fields: { hallTicket: 'NPTEL24CS7654321', courseName: 'Cloud Computing', startDate: day(-120), endDate: day(-30), durationWeeks: 12, credits: 3, institution: 'iit_madras' },
    file: await images.png(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body._id;

  const opened = await req('GET', `/skill-wallet/review/certifications/${id}`, incharge);
  assert.equal(opened.status, 200);
  assert.equal(typeof opened.body.version, 'number', 'the detail tells the verifier which version they saw');

  // A decision must say which version it is about.
  assert.equal((await req('POST', `/skill-wallet/review/certifications/${id}/decision`, incharge, { decision: 'verified' })).status, 422);

  // The student swaps the image after the verifier opened it.
  const swap = await multipart(ctx, 'PUT', `/skill-wallet/certifications/${id}`, { token: student.token, file: await images.jpeg(), filename: 'c.jpg', type: 'image/jpeg' });
  assert.equal(swap.status, 200, JSON.stringify(swap.body));

  const stale = await req('POST', `/skill-wallet/review/certifications/${id}/decision`, incharge, { decision: 'verified', version: opened.body.version });
  assert.equal(stale.status, 409, 'the verifier never saw the new image');
  assert.equal((await ctx.models.NptelCertification.findById(id).lean()).status, 'pending');

  const fresh = await req('GET', `/skill-wallet/review/certifications/${id}`, incharge);
  const ok = await req('POST', `/skill-wallet/review/certifications/${id}/decision`, incharge, { decision: 'verified', version: fresh.body.version });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'verified');
});
