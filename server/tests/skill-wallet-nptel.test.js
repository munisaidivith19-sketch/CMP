import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PRIVATE_DIR, sharp, images, hostile, bombPng, truncatedJpeg, multipart, fetchFile, storedFiles, isWebpBytes, day } from './skill-wallet-fixtures.js';

const { startServer } = await import('./helpers.js');
const { convertCertificateToWebp, sniffImageFormat } = await import('../src/services/skillWallet/imagePipeline.js');
const { getPrivate } = await import('../src/utils/privateStorage.js');

let ctx;
let s1;
let s2;
let sEce;
let incharge;
let otherFaculty;
let hodCse;
let hodEce;
let coe;
let principal;

const fields = (over = {}) => ({
  hallTicket: 'NPTEL24CS1234567',
  courseName: 'Programming in Java',
  startDate: day(-120),
  endDate: day(-30),
  durationWeeks: 12,
  credits: 3,
  institution: 'iit_madras',
  ...over,
});

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, b, c, f, f2, h1, h2, co, p] = await Promise.all([
    mk({ name: 'Asha', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'CSE301' }),
    mk({ name: 'Bala', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'CSE302' }),
    mk({ name: 'Chitra', department: 'ECE', section: 'B', year: 2, semester: 3, rollNo: 'ECE201' }),
    mk({ role: 'faculty', name: 'In Charge', department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5 }),
    mk({ role: 'faculty', name: 'Other Faculty', department: 'CSE' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE' }),
    mk({ role: 'coe', name: 'COE' }),
    mk({ role: 'principal', name: 'Principal' }),
  ]);
  const login = async (u) => ({ u, ...(await ctx.loginWeb(u)) });
  [s1, s2, sEce, incharge, otherFaculty, hodCse, hodEce, coe, principal] = await Promise.all([a, b, c, f, f2, h1, h2, co, p].map(login));
});

after(async () => {
  await ctx.stop();
});

// ── Pipeline (unit) ─────────────────────────────────────────────────

test('PNG, JPEG and WebP are converted to a real, decodable WebP (bytes + decoder)', async () => {
  for (const make of [images.png, images.jpeg, images.webp]) {
    const input = await make();
    const out = await convertCertificateToWebp(input);
    assert.equal(out.mimeType, 'image/webp');
    assert.ok(isWebpBytes(out.buffer), 'RIFF....WEBP signature');
    assert.equal(sniffImageFormat(out.buffer), 'webp');
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 240);
    // WebP input is re-encoded too, never stored as-is.
    assert.notDeepEqual(out.buffer, input);
  }
});

test('Conversion strips EXIF metadata', async () => {
  const input = await images.jpegWithExif();
  assert.ok((await sharp(input).metadata()).exif, 'fixture carries EXIF');
  const out = await convertCertificateToWebp(input);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(out.buffer.includes(Buffer.from('SecretModel')), false);
});

test('Unsupported formats are rejected before decoding: PDF, SVG, GIF, HEIC, BMP, TIFF, text', async () => {
  const inputs = { pdf: hostile.pdf, svg: hostile.svg, heic: hostile.heic, bmp: hostile.bmp, text: hostile.text, gif: await images.gif(), tiff: await images.tiff() };
  for (const [name, buf] of Object.entries(inputs)) {
    await assert.rejects(convertCertificateToWebp(buf), (e) => e.status === 415 && e.code === 'UNSUPPORTED_FORMAT', name);
  }
});

test('Corrupted, oversized, too-small and bomb-shaped images are rejected', async () => {
  await assert.rejects(convertCertificateToWebp(await truncatedJpeg()), (e) => [422].includes(e.status), 'truncated');
  await assert.rejects(convertCertificateToWebp(await images.wide()), (e) => e.code === 'IMAGE_TOO_LARGE', 'too wide');
  await assert.rejects(convertCertificateToWebp(await images.small()), (e) => e.code === 'IMAGE_TOO_SMALL', 'too small');
  await assert.rejects(convertCertificateToWebp(await bombPng()), (e) => ['IMAGE_TOO_LARGE', 'CORRUPT_IMAGE'].includes(e.code), 'bomb');
  await assert.rejects(convertCertificateToWebp(await images.png(), { maxBytes: 100 }), (e) => e.status === 413, 'byte limit');
  await assert.rejects(convertCertificateToWebp(Buffer.alloc(0)), (e) => e.status === 400, 'empty');
});

// ── API ─────────────────────────────────────────────────────────────

test('Valid submission: stored as WebP in private storage, pending, student from session', async () => {
  const before = storedFiles().length;
  const res = await multipart(ctx, 'POST', '/skill-wallet/certifications', {
    token: s1.token,
    fields: fields({ student: String(s2.u._id), status: 'verified' }), // both must be ignored
    file: await images.jpeg(),
    filename: 'cert.jpg',
    type: 'image/jpeg',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'pending', 'upload never verifies');
  assert.equal(res.body.hallTicketMasked, '••••4567');
  assert.equal(res.body.hallTicket, undefined, 'list view never carries the full hall ticket');

  const files = storedFiles();
  assert.equal(files.length, before + 1, 'exactly one stored file (the WebP), no original');
  assert.ok(files.every((f) => f.endsWith('.webp') && !f.endsWith('.part')));

  const cert = await ctx.models.NptelCertification.findById(res.body._id).select('+hallTicketEnc').lean();
  assert.equal(String(cert.student), String(s1.u._id));
  assert.notEqual(cert.hallTicketEnc, 'NPTEL24CS1234567', 'hall ticket encrypted at rest');
  const asset = await ctx.models.SkillWalletAsset.findById(cert.image).lean();
  assert.equal(asset.mimeType, 'image/webp');
  assert.match(asset.storageKey, /^sw\/[0-9a-f-]{36}\.webp$/);
  const stored = await getPrivate(asset.storageKey);
  assert.ok(isWebpBytes(stored));
  assert.equal((await sharp(stored).metadata()).format, 'webp');

  // The signed URL serves the WebP to the owner, without caching.
  const file = await fetchFile(ctx, res.body.imageUrl);
  assert.equal(file.status, 200);
  assert.equal(file.type, 'image/webp');
  assert.match(file.cache, /no-store/);
  assert.ok(isWebpBytes(file.bytes));
});

test('Certificate files live outside the public /uploads route', async () => {
  const [asset] = await ctx.models.SkillWalletAsset.find({ kind: 'certificate' }).lean();
  const name = asset.storageKey.slice(3);
  const res = await fetch(`${ctx.base}/uploads/${name}`);
  assert.notEqual(res.status, 200);
  assert.ok(storedFiles().includes(name), `stored in the private directory ${PRIVATE_DIR}`);
});

test('MIME / extension spoofing is rejected and nothing is stored', async () => {
  const before = storedFiles().length;
  const cases = [
    { file: hostile.pdf, filename: 'cert.png', type: 'image/png' },
    { file: hostile.svg, filename: 'cert.jpg', type: 'image/jpeg' },
    { file: await images.gif(), filename: 'cert.webp', type: 'image/webp' },
    { file: hostile.heic, filename: 'cert.png', type: 'image/png' },
    { file: await images.tiff(), filename: 'cert.jpeg', type: 'image/jpeg' },
    { file: hostile.bmp, filename: 'cert.png', type: 'image/png' },
  ];
  for (const [i, c] of cases.entries()) {
    const res = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ hallTicket: `SPOOF00${i}X`, courseName: `Course ${i}` }), ...c });
    assert.equal(res.status, 415, `${c.filename}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(storedFiles().length, before, 'no file stored for refused uploads');
  assert.equal(await ctx.models.NptelCertification.countDocuments({ student: s2.u._id }), 0, 'no record created');
  assert.equal(await ctx.models.HallTicketClaim.countDocuments({ student: s2.u._id }), 0, 'no hall ticket claim left behind');
});

test('Corrupted and oversized uploads are rejected without leftovers', async () => {
  const before = storedFiles().length;
  const corrupt = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ hallTicket: 'CORRUPT001' }), file: await truncatedJpeg(), filename: 'c.jpg', type: 'image/jpeg' });
  assert.equal(corrupt.status, 422);
  const big = Buffer.concat([await images.png(), Buffer.alloc(6 * 1024 * 1024)]);
  const tooBig = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ hallTicket: 'TOOBIG001' }), file: big });
  assert.equal(tooBig.status, 413);
  const bomb = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ hallTicket: 'BOMB0001' }), file: await bombPng() });
  assert.ok([413, 422].includes(bomb.status));
  const missing = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ hallTicket: 'NOFILE001' }) });
  assert.equal(missing.status, 400);
  assert.equal(storedFiles().length, before);
  assert.equal(storedFiles().some((f) => f.endsWith('.part')), false, 'no partial files');
});

test('Field validation: dates, duration, credits, institution "other"', async () => {
  const bad = [
    fields({ endDate: day(-200) }), // before start
    fields({ endDate: day(30) }), // future
    fields({ durationWeeks: 0 }),
    fields({ credits: 2.3 }),
    fields({ institution: 'mit' }),
    fields({ institution: 'other' }), // needs a name
    fields({ hallTicket: '12' }),
  ];
  for (const f of bad) {
    const res = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: f, file: await images.png() });
    assert.equal(res.status, 422, JSON.stringify(f));
  }
  const ok = await multipart(ctx, 'POST', '/skill-wallet/certifications', {
    token: s2.token,
    fields: fields({ hallTicket: 'OTHER00001', courseName: 'Cloud Computing', institution: 'other', institutionOther: 'IIIT Hyderabad' }),
    file: await images.webp(),
    filename: 'c.webp',
    type: 'image/webp',
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.institution.label, 'IIIT Hyderabad');
});

test('Duplicate detection and hall ticket ownership across students', async () => {
  const dupCourse = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s1.token, fields: fields({ hallTicket: 'DIFFERENT01' }), file: await images.png() });
  assert.equal(dupCourse.status, 409, 'same course twice for one student');
  const stolen = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s2.token, fields: fields({ courseName: 'Data Structures' }), file: await images.png() });
  assert.equal(stolen.status, 409, "another student's hall ticket");
  assert.match(stolen.body.message, /another student/);
  assert.equal(stolen.body.message.includes('Asha'), false, 'never names the other student');
});

test('Unauthorized certificate access is denied (other student, unrelated staff, signed URL reuse)', async () => {
  const [mine] = (await ctx.request('GET', '/skill-wallet/certifications', { token: s1.token })).body.items;
  assert.equal((await ctx.request('GET', `/skill-wallet/certifications/${mine._id}`, { token: s2.token })).status, 404);
  assert.equal((await ctx.request('GET', `/skill-wallet/review/certifications/${mine._id}`, { token: s2.token })).status, 404);
  assert.equal((await ctx.request('GET', `/skill-wallet/review/certifications/${mine._id}`, { token: otherFaculty.token })).status, 404);
  assert.equal((await ctx.request('GET', `/skill-wallet/review/certifications/${mine._id}`, { token: hodEce.token })).status, 404);
  assert.equal((await ctx.request('GET', '/skill-wallet/review/certifications', { token: principal.token })).status, 403, 'Principal role alone is not a verifier');
  // A URL minted for s1 cannot be re-bound: tampering breaks the signature.
  const token = mine.imageUrl.split('/').pop();
  const [p, sig] = token.split('.');
  const payload = Buffer.from(p, 'base64url').toString().replace(String(s1.u._id), String(s2.u._id));
  const forged = `/api/skill-wallet/files/${Buffer.from(payload).toString('base64url')}.${sig}`;
  assert.equal((await fetchFile(ctx, forged)).status, 404);
  // Asset IDs alone grant nothing.
  const cert = await ctx.models.NptelCertification.findById(mine._id).lean();
  assert.equal((await fetchFile(ctx, `/api/skill-wallet/files/${cert.image}`)).status, 404);
});

test('Verification: scoped verifiers decide with reasons; history is kept; only pending can be decided', async () => {
  const [mine] = (await ctx.request('GET', '/skill-wallet/certifications', { token: s1.token })).body.items;
  // The class in-charge sees it in the queue and may view the hall ticket.
  const queue = await ctx.request('GET', '/skill-wallet/review/certifications', { token: incharge.token });
  assert.equal(queue.status, 200);
  assert.ok(queue.body.items.some((c) => c._id === mine._id));
  const detail = await ctx.request('GET', `/skill-wallet/review/certifications/${mine._id}`, { token: incharge.token });
  assert.equal(detail.body.hallTicket, 'NPTEL24CS1234567');
  // Image visible to the verifier through its own signed URL.
  assert.equal((await fetchFile(ctx, detail.body.imageUrl)).status, 200);

  // Reason required for a correction request.
  const noReason = await ctx.request('POST', `/skill-wallet/review/certifications/${mine._id}/decision`, { token: incharge.token, body: { decision: 'correction_requested' } });
  assert.equal(noReason.status, 422);
  const corr = await ctx.request('POST', `/skill-wallet/review/certifications/${mine._id}/decision`, { token: incharge.token, body: { decision: 'correction_requested', reason: 'Credits do not match the certificate', version: detail.body.version } });
  assert.equal(corr.status, 200);
  // Cannot decide again until the student resubmits.
  const again = await ctx.request('POST', `/skill-wallet/review/certifications/${mine._id}/decision`, { token: hodCse.token, body: { decision: 'verified', version: detail.body.version } });
  assert.equal(again.status, 409);

  // Student fixes and resubmits with a new image; old image file is removed.
  const oldCert = await ctx.models.NptelCertification.findById(mine._id).lean();
  const oldAsset = await ctx.models.SkillWalletAsset.findById(oldCert.image).lean();
  const fix = await multipart(ctx, 'PUT', `/skill-wallet/certifications/${mine._id}`, { token: s1.token, fields: { credits: 4 }, file: await images.png() });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.equal(fix.body.status, 'pending');
  assert.equal(await getPrivate(oldAsset.storageKey), null, 'replaced certificate image deleted');

  // COE verifies campus-wide (the version it opened).
  const coeView = await ctx.request('GET', `/skill-wallet/review/certifications/${mine._id}`, { token: coe.token });
  const ok = await ctx.request('POST', `/skill-wallet/review/certifications/${mine._id}/decision`, { token: coe.token, body: { decision: 'verified', version: coeView.body.version } });
  assert.equal(ok.status, 200);
  const hist = await ctx.request('GET', `/skill-wallet/certifications/${mine._id}`, { token: s1.token });
  assert.deepEqual(hist.body.history.map((h) => h.action), ['submitted', 'correction_requested', 'resubmitted', 'verified']);
  assert.equal(hist.body.status, 'verified');
  // Verified certificates are locked for the student.
  const locked = await multipart(ctx, 'PUT', `/skill-wallet/certifications/${mine._id}`, { token: s1.token, fields: { credits: 5 } });
  assert.equal(locked.status, 409);

  // A notification reached the student without the hall ticket (delivery is asynchronous).
  let notes = [];
  for (let i = 0; i < 40 && notes.length < 2; i += 1) {
    notes = await ctx.models.Notification.find({ user: s1.u._id, type: 'skill_wallet' }).lean();
    if (notes.length < 2) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(notes.length >= 2, `notifications: ${notes.length}`);
  assert.ok(notes.every((n) => !JSON.stringify(n).includes('NPTEL24CS1234567')));
  // Audit trail recorded without the hall ticket.
  const audits = await ctx.models.AuditLog.find({ action: 'SKILL_WALLET_CERT_DECISION' }).lean();
  assert.equal(audits.length, 2);
  assert.ok(audits.every((a) => !JSON.stringify(a).includes('NPTEL24CS1234567')));
});

test('Concurrent verifier decisions: exactly one wins', async () => {
  const created = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: s1.token, fields: fields({ hallTicket: 'RACE000001', courseName: 'Operating Systems' }), file: await images.png() });
  assert.equal(created.status, 201);
  const { version } = (await ctx.request('GET', `/skill-wallet/review/certifications/${created.body._id}`, { token: incharge.token })).body;
  const results = await Promise.all([
    ctx.request('POST', `/skill-wallet/review/certifications/${created.body._id}/decision`, { token: incharge.token, body: { decision: 'verified', version } }),
    ctx.request('POST', `/skill-wallet/review/certifications/${created.body._id}/decision`, { token: hodCse.token, body: { decision: 'rejected', reason: 'Not a valid certificate', version } }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await ctx.models.CertificationReview.countDocuments({ certification: created.body._id, action: { $in: ['verified', 'rejected'] } }), 1);
});

test('Deleting a certificate removes its file and keeps history', async () => {
  const created = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: sEce.token, fields: fields({ hallTicket: 'ECEDEL0001', courseName: 'Signals' }), file: await images.png() });
  assert.equal(created.status, 201);
  const cert = await ctx.models.NptelCertification.findById(created.body._id).lean();
  const asset = await ctx.models.SkillWalletAsset.findById(cert.image).lean();
  assert.ok(await getPrivate(asset.storageKey));
  assert.equal((await ctx.request('DELETE', `/skill-wallet/certifications/${cert._id}`, { token: sEce.token })).status, 200);
  assert.equal(await getPrivate(asset.storageKey), null);
  assert.equal((await fetchFile(ctx, created.body.imageUrl)).status, 404);
  assert.equal(await ctx.models.CertificationReview.countDocuments({ certification: cert._id }), 2);
  // The claim was released: the number can be entered again (by its owner).
  const again = await multipart(ctx, 'POST', '/skill-wallet/certifications', { token: sEce.token, fields: fields({ hallTicket: 'ECEDEL0001', courseName: 'Signals' }), file: await images.png() });
  assert.equal(again.status, 201);
});

test('Hall tickets never appear in portfolio responses', async () => {
  const res = await ctx.request('GET', `/skill-wallet/portfolio/${s1.u._id}`, { token: s2.token });
  assert.equal(res.status, 200);
  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes('NPTEL24CS1234567'), false);
  assert.equal(raw.includes('hallTicket'), false);
  assert.ok(res.body.certifications.length >= 1, 'verified certificate listed');
  assert.ok(res.body.certifications.every((c) => c.status === 'verified'));
});
