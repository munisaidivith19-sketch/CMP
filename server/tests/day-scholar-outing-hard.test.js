/**
 * Day scholar Outing — 20 hard / adversarial tests.
 *
 * Race conditions, replay, mass assignment, prototype pollution, type
 * confusion, stay-type tampering and changes mid-flight, cross-class access,
 * expiry, revocation, and the "no return step" rule under attack. Hostelers
 * must keep the existing behaviour throughout.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';
import { otpLimiter, verifyLimiter, writeLimiter } from '../src/middleware/rateLimit.js';

const REGISTERED = '9876504321';
const TYPED = '9123456780';
const OPEN = ['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority', 'approved', 'active'];

let ctx;
const staff = {};
let n = 0;

const post = (who, path, body) => ctx.request('POST', path, { token: who.token, body });
const outing = (s, body) => post(s, '/gate-pass/outing', body);
const valid = (extra = {}) => ({ subject: 'Bank visit', description: 'Need to visit the bank in town', parentPhone: TYPED, ...extra });
const review = (id, stage, who, action = 'forward') => ctx.request('PATCH', `/gate-pass/${id}/${stage}-review`, { token: who.token, body: { action } });
const codeOf = async (id) => (await ctx.models.GatePass.findById(id).select('+verificationCode').lean()).verificationCode;
const passOf = (id) => ctx.models.GatePass.findById(id).lean();
const outAt = (id, code, who = staff.security) => ctx.request('PATCH', `/gate-pass/${id}/out`, { token: who.token, body: { code } });
const verify = (code, who = staff.security) => post(who, '/gate-pass/verify', { code });

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} ${extra.tag || ''}`.trim(), employeeId: `E-${role}-${extra.tag || 'x'}`, ...extra, tag: undefined });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A', teachingYears: [3] });
  staff.facultyB = await make('faculty', { department: 'CSE', section: 'B', teachingYears: [3], tag: 'b' });
  staff.facultyEce = await make('faculty', { department: 'ECE', section: 'A', teachingYears: [3], tag: 'ece' });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.hodEce = await make('hod', { department: 'ECE', tag: 'ece' });
  staff.principal = await make('principal');
  staff.security = await make('security');
  staff.security2 = await make('security', { tag: '2' });
  staff.admin = await make('admin');
});
after(async () => {
  await ctx.stop();
});
// The write / verify / OTP limiters are real controls and stay on. Each test
// starts with a fresh allowance so one attack's burst does not starve the next.
beforeEach(async () => {
  for (const limiter of [writeLimiter, verifyLimiter, otpLimiter]) {
    for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await limiter.resetKey(ip);
  }
  if (staff.faculty) await otpLimiter.resetKey(`otp:${staff.faculty.u._id}`);
});

async function student(stayType = 'day_scholar', extra = {}) {
  n += 1;
  const u = await ctx.createUser({ name: `Hard Student ${n}`, rollNo: `HS${100 + n}`, department: 'CSE', section: 'A', year: 3, parentPhone: REGISTERED, stayType, ...extra });
  return { u, ...(await ctx.loginWeb(u)) };
}

async function approve(id) {
  assert.equal((await post(staff.faculty, `/gate-pass/${id}/parent-otp`)).status, 200);
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
  assert.equal((await post(staff.faculty, `/gate-pass/${id}/parent-otp/verify`, { otp: testOtpProvider.peek(rec._id) })).status, 200);
  assert.equal((await review(id, 'faculty', staff.faculty)).status, 200);
  assert.equal((await review(id, 'hod', staff.hod)).status, 200);
  assert.equal((await review(id, 'principal', staff.principal, 'approve')).status, 200);
  return rec;
}
async function approvedOuting(extra) {
  const s = await student('day_scholar', extra);
  const res = await outing(s, valid());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await approve(res.body._id);
  return { s, id: res.body._id, code: await codeOf(res.body._id) };
}

// 1
test('H01 race: 8 simultaneous Outing requests from one student create exactly one open pass', async () => {
  const s = await student();
  const results = await Promise.all(Array.from({ length: 8 }, () => outing(s, valid())));
  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, `statuses: ${results.map((r) => r.status).join(',')}`);
  assert.ok(results.every((r) => [201, 409].includes(r.status)));
  assert.equal(await ctx.models.GatePass.countDocuments({ student: s.u._id, status: { $in: OPEN } }), 1);
});

// 2
test('H02 race: two guards record OUT at the same moment — exactly one succeeds, the pass completes once', async () => {
  const { id, code } = await approvedOuting();
  const [a, b] = await Promise.all([outAt(id, code, staff.security), outAt(id, code, staff.security2)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const p = await passOf(id);
  assert.equal(p.status, 'completed');
  assert.ok(p.actualExit);
});

// 3
test('H03 replay: the exit code cannot be verified or used again after the Outing completes', async () => {
  const { id, code } = await approvedOuting();
  assert.equal((await outAt(id, code)).status, 200);
  assert.equal((await outAt(id, code)).status, 409);
  assert.equal((await verify(code)).status, 404, 'code consumed — unknown to the scanner');
  assert.equal((await outAt(id, 'ZZ99')).status, 409);
});

// 4
test('H04 no return step can be forced: return location, return credential and IN all refuse a completed Outing', async () => {
  const { s, id, code } = await approvedOuting();
  assert.equal((await outAt(id, code)).status, 200);
  const loc = await post(s, `/gate-pass/${id}/return-location/verify`, { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() });
  assert.notEqual(loc.status, 200);
  assert.notEqual((await ctx.request('GET', `/gate-pass/${id}/return-credential`, { token: s.token })).status, 200);
  const inRes = await ctx.request('PATCH', `/gate-pass/${id}/in`, { token: staff.security.token, body: { code: 'AB12' } });
  assert.notEqual(inRes.status, 200);
  const p = await passOf(id);
  assert.equal(p.actualReturn, undefined, 'no return is ever recorded');
  assert.equal(p.status, 'completed');
});

// 5
test('H05 mass assignment: client cannot flip type, status, student, dates or the outing flag', async () => {
  const s = await student();
  const other = await student();
  const res = await outing(s, valid({
    dayScholarOuting: false,
    passType: 'emergency',
    emergencyAuthority: 'principal',
    status: 'approved',
    student: String(other.u._id),
    department: 'ECE',
    section: 'Z',
    fromDate: '2020-01-01',
    toDate: '2040-01-01',
    actualExit: new Date().toISOString(),
    verificationCode: 'AB12',
    principalReview: { action: 'approved' },
  }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = await ctx.models.GatePass.findById(res.body._id).select('+verificationCode').lean();
  assert.equal(p.dayScholarOuting, true);
  assert.equal(p.passType, 'normal');
  assert.equal(p.status, 'pending_faculty');
  assert.equal(String(p.student), String(s.u._id));
  assert.equal(p.department, 'CSE');
  assert.equal(p.section, 'A');
  assert.equal(p.verificationCode, undefined);
  assert.equal(p.actualExit, undefined);
  assert.equal(p.principalReview?.action, undefined);
  assert.equal(new Date(p.toDate).getTime(), new Date(p.fromDate).getTime());
});

// 6
test('H06 a hosteler cannot smuggle in an outing (flag in body, or calling the Outing route)', async () => {
  const h = await student('hosteler');
  assert.equal((await outing(h, valid())).status, 403);
  const day = new Date().toISOString().slice(0, 10);
  const res = await post(h, '/gate-pass', {
    regarding: 'outing', description: 'Market visit', fromDate: day, toDate: day,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' },
    dayScholarOuting: true, subject: 'sneaky',
  });
  assert.equal(res.status, 201);
  const p = await passOf(res.body._id);
  assert.equal(p.dayScholarOuting, false, 'ignored: still a hosteler pass with the return step');
  assert.equal(p.subject, undefined);
});

// 7
test('H07 stay type comes from the database, not the request — and takes effect without re-login', async () => {
  const s = await student('hosteler');
  assert.equal((await outing(s, valid({ stayType: 'day_scholar' }))).status, 403, 'body stayType ignored');
  await ctx.models.User.updateOne({ _id: s.u._id }, { $set: { stayType: 'day_scholar' } });
  assert.equal((await outing(s, valid())).status, 201, 'the stored value is read on each request');
});

// 8
test('H08 stay type changed mid-flight: each pass keeps the rule it was created under', async () => {
  // An Outing created as a day scholar still completes on exit after the student becomes a hosteler.
  const { s, id, code } = await approvedOuting();
  await ctx.models.User.updateOne({ _id: s.u._id }, { $set: { stayType: 'hosteler' } });
  assert.equal((await outAt(id, code)).body.status, 'completed');

  // A hosteler pass still needs a return after the student becomes a day scholar.
  const h = await student('hosteler');
  const day = new Date().toISOString().slice(0, 10);
  const res = await post(h, '/gate-pass', {
    regarding: 'outing', description: 'Market visit', fromDate: day, toDate: day,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' },
  });
  await approve(res.body._id);
  await ctx.models.User.updateOne({ _id: h.u._id }, { $set: { stayType: 'day_scholar' } });
  const out = await outAt(res.body._id, await codeOf(res.body._id));
  assert.equal(out.body.status, 'active', 'still outside until they return');
});

// 9
test('H09 prototype pollution and operator payloads are rejected or inert', async () => {
  const s = await student();
  const polluted = JSON.parse('{"subject":"Bank visit","description":"Need to visit the bank","parentPhone":"9123456780","__proto__":{"status":"approved","dayScholarOuting":false},"constructor":{"prototype":{"isAdmin":true}}}');
  const res = await outing(s, polluted);
  assert.ok([201, 422].includes(res.status), JSON.stringify(res.body));
  if (res.status === 201) {
    const p = await passOf(res.body._id);
    assert.equal(p.status, 'pending_faculty');
    assert.equal(p.dayScholarOuting, true);
  }
  assert.equal({}.status, undefined, 'Object.prototype not polluted');
  assert.equal({}.isAdmin, undefined);
  const s2 = await student();
  for (const bad of [{ subject: { $gt: '' } }, { description: { $ne: null } }, { parentPhone: { $regex: '.*' } }, { supportingDocument: { url: { $ne: null } } }]) {
    assert.equal((await outing(s2, valid(bad))).status, 422, JSON.stringify(bad));
  }
  // A dotted top-level key is not the nested field: it is ignored, never stored.
  const dotted = await outing(s2, valid({ 'supportingDocument.url': { $ne: null } }));
  assert.equal(dotted.status, 201);
  assert.equal((await passOf(dotted.body._id)).supportingDocument?.url, undefined);
});

// 10
test('H10 type confusion and size limits on every field', async () => {
  const s = await student();
  const cases = [
    { subject: ['Bank', 'visit'] },
    { subject: 12345 },
    { subject: 'x' },
    { subject: 'x'.repeat(121) },
    { description: 'x'.repeat(501) },
    { description: true },
    { parentPhone: 9123456780 },
    { parentPhone: ['9123456780'] },
    { parentPhone: '9'.repeat(21) },
    { supportingDocument: { url: '/uploads/a.pdf', name: 'x'.repeat(201) } },
  ];
  for (const c of cases) assert.equal((await outing(s, valid(c))).status, 422, JSON.stringify(c).slice(0, 80));
  assert.equal(await ctx.models.GatePass.countDocuments({ student: s.u._id }), 0, 'nothing was written');
});

// 11
test('H11 a typed parent number (junk or real) is ignored: the pass always carries the registered number', async () => {
  for (const phone of ['------', '12345', TYPED]) {
    const s = await student();
    const res = await outing(s, valid({ parentPhone: phone }));
    assert.equal(res.status, 201, `${phone}: ${JSON.stringify(res.body)}`);
    assert.equal((await passOf(res.body._id)).parentPhone, REGISTERED, phone);
  }
});

// 12
test('H12 attachment link: only our uploads or https — no javascript:, data:, http:, or path traversal', async () => {
  const s = await student();
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://evil.example/a.pdf', '//evil.example/a.pdf', '/uploads/../.env', '/uploads/..%2F..%2F.env', 'JaVaScRiPt:alert(1)']) {
    assert.equal((await outing(s, valid({ supportingDocument: { url, name: 'a.pdf' } }))).status, 422, url);
  }
  const ok = await outing(s, valid({ supportingDocument: { url: '/uploads/documents/note.pdf', name: 'note.pdf', mimeType: 'application/pdf' } }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

// 13
test('H13 stored XSS: script in subject / description is stored as plain text and returned as JSON only', async () => {
  const s = await student();
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const res = await outing(s, valid({ subject: payload.slice(0, 100), description: payload }));
  assert.equal(res.status, 201);
  const view = await ctx.request('GET', `/gate-pass/${res.body._id}`, { token: staff.faculty.token });
  assert.match(view.headers.get('content-type'), /application\/json/);
  assert.equal(view.body.description, payload, 'returned verbatim as data — React renders it as text');
});

// 14
test('H14 cross-class: another section’s faculty, another department’s faculty and HOD cannot act on the Outing', async () => {
  const s = await student();
  const { body: pass } = await outing(s, valid());
  assert.equal((await post(staff.facultyB, `/gate-pass/${pass._id}/parent-otp`)).status, 403);
  assert.equal((await post(staff.facultyEce, `/gate-pass/${pass._id}/parent-otp`)).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${pass._id}`, { token: staff.facultyB.token })).status, 403);
  assert.equal((await ctx.request('GET', `/gate-pass/${pass._id}`, { token: staff.hodEce.token })).status, 403);
  assert.equal((await review(pass._id, 'faculty', staff.facultyB)).status, 403);
  assert.ok(!(await ctx.request('GET', '/gate-pass', { token: staff.facultyB.token })).body.passes.some((p) => p._id === pass._id));
});

// 15
test('H15 the number on the pass is the registered one at submission, frozen: a typed number never reaches it', async () => {
  const s = await student();
  const { body: pass } = await outing(s, valid());
  await ctx.models.User.updateOne({ _id: s.u._id }, { $set: { parentPhone: '9000011111' } });
  assert.equal((await post(staff.faculty, `/gate-pass/${pass._id}/parent-otp`)).status, 200);
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: pass._id }).sort({ createdAt: -1 }).lean();
  assert.ok(rec.parentMobileMasked.endsWith(REGISTERED.slice(-4)), rec.parentMobileMasked);
  // There is no endpoint for the student to change it after submitting.
  const patch = await ctx.request('PATCH', `/gate-pass/${pass._id}`, { token: s.token, body: { parentPhone: '9999999999' } });
  assert.ok([404, 405].includes(patch.status), String(patch.status));
  assert.equal((await passOf(pass._id)).parentPhone, REGISTERED);
});

// 16
test('H16 mismatch flag is for reviewers only, and is false now that the typed number is ignored', async () => {
  const s = await student();
  const { body: pass } = await outing(s, valid());
  const forStudent = await ctx.request('GET', `/gate-pass/${pass._id}`, { token: s.token });
  assert.equal(forStudent.body.parentPhoneDiffers, undefined);
  for (const who of [staff.faculty, staff.hod, staff.principal, staff.admin]) {
    const r = await ctx.request('GET', `/gate-pass/${pass._id}`, { token: who.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.parentPhoneDiffers, false);
    assert.ok(!JSON.stringify(r.body).includes(TYPED), 'the typed number is never stored or shown');
  }
});

// 17
test('H17 an approved but unused Outing stops working once its window closes, and cannot be used tomorrow', async () => {
  const { id, code } = await approvedOuting();
  await ctx.models.GatePass.updateOne({ _id: id }, { $set: { verificationExpiry: new Date(Date.now() - 60000) } });
  const out = await outAt(id, code);
  assert.notEqual(out.status, 200, JSON.stringify(out.body));
  const p = await passOf(id);
  assert.notEqual(p.status, 'completed');
  assert.equal(p.actualExit, undefined);
});

// 18
test('H18 revoked or cancelled Outing: code is dead, and a new Outing can then be requested', async () => {
  const { s, id, code } = await approvedOuting();
  assert.equal((await ctx.request('PATCH', `/gate-pass/${id}/revoke`, { token: staff.admin.token, body: { reason: 'Test revoke' } })).status, 200);
  assert.notEqual((await outAt(id, code)).status, 200);
  assert.equal((await outing(s, valid())).status, 201, 'a revoked pass does not block a new one');

  const c = await student();
  const { body: p2 } = await outing(c, valid());
  assert.equal((await ctx.request('PATCH', `/gate-pass/${p2._id}/cancel`, { token: c.token })).status, 200);
  assert.equal((await outing(c, valid())).status, 201);
});

// 19
test('H19 one open pass across all kinds: an open Emergency pass blocks an Outing and vice versa', async () => {
  const s = await student();
  const minutes = (m) => new Date(Date.now() + m * 60000).toISOString();
  const em = await post(s, '/gate-pass/emergency', { authority: 'principal', reason: 'Father in hospital', destination: 'City Hospital', leaveAt: minutes(10), expectedReturnAt: minutes(300) });
  assert.equal(em.status, 201, JSON.stringify(em.body));
  assert.equal((await outing(s, valid())).status, 409);

  const s2 = await student();
  assert.equal((await outing(s2, valid())).status, 201);
  const em2 = await post(s2, '/gate-pass/emergency', { authority: 'principal', reason: 'Father in hospital', destination: 'City Hospital', leaveAt: minutes(10), expectedReturnAt: minutes(300) });
  assert.equal(em2.status, 409);
});

// 20
test('H20 dashboards: a completed Outing is an exit, never "outside", never overdue — live and in history', async () => {
  const { id, code } = await approvedOuting();
  assert.equal((await outAt(id, code)).status, 200);
  // Pretend it happened two days ago and was due back long before now.
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
  await ctx.models.GatePass.updateOne({ _id: id }, { $set: { actualExit: twoDaysAgo, fromDate: twoDaysAgo, toDate: twoDaysAgo } });
  const key = new Date(twoDaysAgo.getTime() + 330 * 60000).toISOString().slice(0, 10);

  const live = await ctx.request('GET', '/gate-pass/dashboard', { token: staff.principal.token });
  assert.ok(!live.body.outsideStudents.some((p) => p._id === id));
  const overdue = await ctx.request('GET', '/gate-pass?status=overdue', { token: staff.admin.token });
  assert.ok(!overdue.body.passes.some((p) => p._id === id), 'never overdue');

  const hist = await ctx.request('GET', `/gate-pass/dashboard?date=${key}`, { token: staff.principal.token });
  assert.equal(hist.status, 200, JSON.stringify(hist.body));
  assert.ok(hist.body.exits.some((p) => p._id === id), 'counted as an exit that day');
  assert.ok(!hist.body.outsideStudents.some((p) => p._id === id), 'not outside at the end of that day');
  const sec = await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token });
  assert.ok(!sec.body.outsideStudents.some((p) => p._id === id));
});
