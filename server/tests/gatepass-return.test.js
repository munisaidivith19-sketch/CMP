import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { env } from '../src/config/env.js';
import { EARTH_RADIUS_M, distanceMeters } from '../src/utils/geo.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';
import { generateGatePassSecurityCode } from '../src/models/GatePass.js';

let ctx;
let security;
let security2;
let classFaculty; // CSE year 3 section A — assigned to the returning students' class
let otherSection; // CSE year 3 section B
let otherYear; // CSE section A, but year 2
let deptFaculty; // CSE, no class
let hod;
let admin;
let n = 0;

const PHONE = '9876504321';
const COLLEGE = () => ({ latitude: env.location.collegeLatitude, longitude: env.location.collegeLongitude });
/** A reading `meters` due north of the college point (exact for a meridian offset). */
const north = (meters, extra = {}) => ({
  latitude: COLLEGE().latitude + (meters / EARTH_RADIUS_M) * (180 / Math.PI),
  longitude: COLLEGE().longitude,
  accuracy: 15,
  timestamp: Date.now(),
  ...extra,
});
const LOCATION_KEYS = ['latitude', 'longitude', 'distanceMeters', 'accuracy'];
const hasLocationData = (data) =>
  Boolean(data) && typeof data === 'object' && Object.entries(data).some(([k, v]) => LOCATION_KEYS.includes(k) || hasLocationData(v));

before(async () => {
  ctx = await startServer();
  const [sec, sec2, cf, os, oy, df, h, a] = await Promise.all([
    ctx.createUser({ role: 'security', name: 'Gatekeeper', employeeId: 'S-1' }),
    ctx.createUser({ role: 'security', name: 'Second Guard', employeeId: 'S-2' }),
    ctx.createUser({ role: 'faculty', name: 'Class Faculty', department: 'CSE', section: 'A', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Section B Faculty', department: 'CSE', section: 'B', teachingYears: [3] }),
    ctx.createUser({ role: 'faculty', name: 'Year 2 Faculty', department: 'CSE', section: 'A', teachingYears: [2] }),
    ctx.createUser({ role: 'faculty', name: 'Dept Faculty', department: 'CSE' }),
    ctx.createUser({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'H-1' }),
    ctx.createUser({ role: 'admin', name: 'Admin' }),
  ]);
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  security2 = { u: sec2, ...(await ctx.loginWeb(sec2)) };
  classFaculty = { u: cf, ...(await ctx.loginWeb(cf)) };
  otherSection = { u: os, ...(await ctx.loginWeb(os)) };
  otherYear = { u: oy, ...(await ctx.loginWeb(oy)) };
  deptFaculty = { u: df, ...(await ctx.loginWeb(df)) };
  hod = { u: h, ...(await ctx.loginWeb(h)) };
  admin = { u: a, ...(await ctx.loginWeb(a)) };
});
after(async () => {
  await ctx.stop();
});

/** A new CSE-3A student with a pass in `status` (default: outside campus). */
async function passFor(status = 'active', extra = {}) {
  n += 1;
  const u = await ctx.createUser({ name: `Returning Student ${n}`, rollNo: `R${100 + n}`, department: 'CSE', section: 'A', year: 3 });
  const day = new Date().toISOString().slice(0, 10);
  const out = status === 'active' || status === 'completed';
  const pass = await ctx.models.GatePass.create({
    student: u._id,
    department: 'CSE',
    section: 'A',
    regarding: 'outing',
    description: 'Family function',
    fromDate: day,
    toDate: day,
    parentPhone: PHONE,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    status,
    ...(['approved', 'active'].includes(status) ? { verificationCode: generateGatePassSecurityCode(), verificationExpiry: new Date(Date.now() + 86400000) } : {}),
    ...(out ? { actualExit: new Date(Date.now() - 3600000) } : {}),
    ...(status === 'completed' ? { actualReturn: new Date() } : {}),
    ...extra,
  });
  return { id: String(pass._id), student: { u, ...(await ctx.loginWeb(u)) } };
}

const checkLocation = (id, who, body) => ctx.request('POST', `/gate-pass/${id}/return-location/verify`, { token: who.token, body });
const scan = (code, who = security) => ctx.request('POST', '/gate-pass/return/verify', { token: who.token, body: { code } });
const inside = (id, code, who = security) => ctx.request('PATCH', `/gate-pass/${id}/in`, { token: who.token, body: { code } });
const checks = (id) => ctx.models.ReturnLocationCheck.find({ gatePass: id }).sort({ _id: 1 }).lean();
const parentMessagesFor = (name) => testOtpProvider.sentMessages().filter((m) => m.message.includes(`${name} has returned`));
const returnNotices = async (who, id) =>
  (await ctx.request('GET', '/notifications?limit=50', { token: who.token })).body.items.filter((x) => x.title === '🔔 Student Returned to Campus' && x.link === `/gate-pass/${id}`);

/** Location check → credential, for tests about what happens after. */
async function verifiedPass() {
  const p = await passFor();
  const res = await checkLocation(p.id, p.student, north(120));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { ...p, credential: res.body };
}

test('student verifies their own outside pass: server computes distance and issues a temporary return QR + code', async () => {
  const { id, student } = await passFor();
  const res = await checkLocation(id, student, north(120));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.verified, true);
  assert.match(res.body.code, /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4}$/);
  assert.match(res.body.payload, /^CCRT:[A-Za-z0-9_-]{32}$/);
  assert.ok(res.body.qr.startsWith('data:image/png;base64,'));
  assert.ok(!res.body.payload.includes(student.u.name) && !res.body.payload.includes(id), 'QR holds only an opaque token');
  const minutes = (new Date(res.body.expiresAt) - Date.now()) / 60000;
  assert.ok(minutes > env.location.returnCredentialMinutes - 0.2 && minutes <= env.location.returnCredentialMinutes);
  assert.ok(!hasLocationData(res.body), 'no geofence numbers in the response');

  const [rec] = await checks(id);
  assert.equal(rec.result, 'verified');
  assert.ok(rec.verifiedAt && Math.abs(new Date(rec.verifiedAt) - Date.now()) < 5000, 'server timestamp');
  assert.ok(Math.abs(rec.distanceMeters - 120) < 0.05, `server-computed distance ${rec.distanceMeters}`);
  assert.equal(rec.student.toString(), student.u._id.toString());

  const pass = await ctx.models.GatePass.findById(id).lean();
  assert.equal(pass.status, 'active', 'location alone never completes the pass');
  assert.equal(pass.actualReturn, undefined);
  assert.ok(pass.returnLocationVerifiedAt);

  const again = await ctx.request('GET', `/gate-pass/${id}/return-credential`, { token: student.token });
  assert.equal(again.status, 200);
  assert.equal(again.body.code, res.body.code);
});

test('another student cannot verify someone else’s pass', async () => {
  const { id } = await passFor();
  const other = await passFor();
  assert.equal((await checkLocation(id, other.student, north(50))).status, 404);
  assert.equal((await ctx.request('GET', `/gate-pass/${id}/return-credential`, { token: other.student.token })).status, 404);
  assert.equal((await checks(id)).length, 0);
});

test('only an approved pass that has been used to exit can start a return', async () => {
  const blocked = ['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'approved', 'rejected', 'cancelled', 'revoked', 'expired', 'completed'];
  for (const status of blocked) {
    const { id, student } = await passFor(status);
    const res = await checkLocation(id, student, north(10));
    assert.equal(res.status, 422, `${status}: ${JSON.stringify(res.body)}`);
    assert.ok(!res.body.code, `${status}: no credential`);
    assert.equal((await checks(id)).length, 0, `${status}: nothing recorded`);
  }
  // "active" without a recorded exit is not a real exit either.
  const { id, student } = await passFor('active', { actualExit: null });
  assert.equal((await checkLocation(id, student, north(10))).status, 422);
});

test('300 m geofence: 150/250/299/300 m accepted, 301 m rejected without a credential', async () => {
  const { id, student } = await passFor();
  for (const m of [150, 250, 299, 300]) {
    const res = await checkLocation(id, student, north(m));
    assert.equal(res.status, 200, `${m} m: ${JSON.stringify(res.body)}`);
  }
  const before = (await ctx.models.GatePass.findById(id).select('+returnCode').lean()).returnCode;
  const res = await checkLocation(id, student, north(301));
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'outside_geofence');
  assert.equal(res.body.message, 'Your current location could not be verified as being within the campus area. Please enter the campus and try again.');
  assert.ok(!hasLocationData(res.body) && !/\d+\s*m\b/.test(res.body.message), 'rejection reveals no distance');
  assert.equal((await ctx.models.GatePass.findById(id).select('+returnCode').lean()).returnCode, before, 'a failed check issues nothing');
  const recs = await checks(id);
  assert.equal(recs.at(-1).result, 'rejected');
  assert.equal(recs.at(-1).rejectionReason, 'outside_geofence');
});

test('GPS accuracy above the configured limit is rejected', async () => {
  const { id, student } = await passFor();
  const res = await checkLocation(id, student, north(20, { accuracy: env.location.maxAccuracyMeters + 1 }));
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'low_accuracy');
  assert.equal(res.body.message, 'Your current location is not accurate enough. Please move to an open area and try again.');
  assert.equal((await checkLocation(id, student, north(20, { accuracy: env.location.maxAccuracyMeters }))).status, 200);
});

test('stale (or future-dated) readings are rejected using the server clock', async () => {
  const { id, student } = await passFor();
  const max = env.location.maxAgeSeconds * 1000;
  for (const offset of [-(max + 1000), max + 1000, -10 * 60000]) {
    const res = await checkLocation(id, student, north(20, { timestamp: Date.now() + offset }));
    assert.equal(res.status, 422, `offset ${offset}`);
    assert.equal(res.body.errors[0].code, 'stale_location');
    assert.equal(res.body.message, 'Your location information is outdated. Please try again.');
  }
  assert.equal((await checkLocation(id, student, north(20, { timestamp: new Date(Date.now() - 5000).toISOString() }))).status, 200);
});

test('impossible or missing coordinates are rejected before anything is recorded', async () => {
  const { id, student } = await passFor();
  const bad = [
    { latitude: 91 }, { latitude: -90.0001 }, { latitude: 'abc' }, { latitude: null },
    { longitude: 181 }, { longitude: -180.5 }, { longitude: '' },
    { accuracy: -1 }, { accuracy: undefined }, { timestamp: 'yesterday' }, { timestamp: undefined },
  ];
  for (const override of bad) {
    const res = await checkLocation(id, student, { ...north(10), ...override });
    assert.equal(res.status, 422, JSON.stringify(override));
  }
  assert.equal((await checks(id)).length, 0);
});

test('client claims of distance or verification are ignored', async () => {
  const { id, student } = await passFor();
  const res = await checkLocation(id, student, { ...north(5000), distanceMeters: 0, distance: 0, locationVerified: true, verified: true });
  assert.equal(res.status, 422);
  assert.equal(res.body.errors[0].code, 'outside_geofence');
  const [rec] = await checks(id);
  assert.ok(Math.abs(rec.distanceMeters - 5000) < 0.1, 'server computed its own distance');
  assert.equal(rec.distanceMeters, Math.round(distanceMeters(COLLEGE(), north(5000)) * 100) / 100);
});

test('security: scanning the QR or typing the code only validates — the pass stays open, nobody is notified', async () => {
  const { id, student, credential } = await verifiedPass();
  const sentBefore = parentMessagesFor(student.u.name).length;

  const byCode = await scan(credential.code.toLowerCase());
  assert.equal(byCode.status, 200, JSON.stringify(byCode.body));
  assert.equal(byCode.body.nextAction, 'inside');
  assert.equal(byCode.body.status, 'return_verification_ready');
  assert.equal(byCode.body.pass._id, id);
  assert.equal(byCode.body.pass.student.name, student.u.name);
  assert.equal(byCode.body.pass.student.section, 'A');
  assert.equal(byCode.body.pass.student.year, 3);
  assert.match(byCode.body.passRef, /^GP-[0-9A-F]{6}$/);
  assert.equal(byCode.body.pass.returnToken, undefined);
  assert.equal(byCode.body.pass.returnCode, undefined);

  const byQr = await scan(credential.payload);
  assert.equal(byQr.status, 200);
  assert.equal(byQr.body.pass._id, id);

  const pass = await ctx.models.GatePass.findById(id).lean();
  assert.equal(pass.status, 'active');
  assert.equal(pass.actualReturn, undefined);
  assert.equal(parentMessagesFor(student.u.name).length, sentBefore, 'no parent message on location check or scan');
  assert.equal((await returnNotices(classFaculty, id)).length, 0, 'no faculty notice before STUDENT IS INSIDE');
});

test('only security (or admin) can scan or complete a return; the student cannot complete their own', async () => {
  const { id, student, credential } = await verifiedPass();
  for (const who of [student, classFaculty, hod]) {
    assert.equal((await scan(credential.code, who)).status, 403);
    assert.equal((await inside(id, credential.code, who)).status, 403);
  }
  assert.equal((await ctx.models.GatePass.findById(id)).status, 'active');
});

test('wrong, foreign or exit codes are rejected', async () => {
  const a = await verifiedPass();
  const b = await verifiedPass();
  assert.equal((await scan('ZZ99')).status, 404);
  assert.equal((await scan('CCRT:notarealtokennotarealtoken')).status, 404);
  assert.equal((await scan('12345')).status, 422);
  assert.equal((await inside(a.id, 'ZZ99')).status, 422);
  assert.equal((await inside(a.id, b.credential.code)).status, 422, "another pass's code does not work here");
  assert.equal((await inside(a.id, b.credential.payload)).status, 422, "another pass's QR does not work here");
  const exitCode = (await ctx.models.GatePass.findById(a.id).select('+verificationCode').lean()).verificationCode;
  assert.equal((await inside(a.id, exitCode)).status, 422, 'the exit code is not a return code');
  assert.equal((await ctx.models.GatePass.findById(a.id)).status, 'active');
});

test('return credentials expire', async () => {
  const { id, student, credential } = await verifiedPass();
  await ctx.models.GatePass.updateOne({ _id: id }, { returnCredentialExpiresAt: new Date(Date.now() - 1000) });
  assert.equal((await scan(credential.code)).status, 410);
  assert.equal((await inside(id, credential.code)).status, 422);
  assert.equal((await ctx.request('GET', `/gate-pass/${id}/return-credential`, { token: student.token })).status, 410);
  // A fresh location check gives a new, working credential; the old one stays dead.
  const fresh = await checkLocation(id, student, north(60));
  assert.equal(fresh.status, 200);
  if (fresh.body.code !== credential.code) assert.equal((await scan(credential.code)).status, 404);
  assert.equal((await scan(fresh.body.code)).status, 200);
});

test('STUDENT IS INSIDE completes the pass once, consumes every credential, then notifies parent and the assigned faculty only', async () => {
  const { id, student, credential } = await verifiedPass();
  const before = Date.now();
  const res = await inside(id, credential.code);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'completed');
  assert.ok(new Date(res.body.actualReturn).getTime() >= before - 1000, 'server return time');
  assert.equal(String(res.body.returnVerifiedBy._id || res.body.returnVerifiedBy), String(security.u._id));

  const stored = await ctx.models.GatePass.findById(id).select('+returnToken +returnCode +verificationCode').lean();
  assert.equal(stored.returnToken, undefined);
  assert.equal(stored.returnCode, undefined);
  assert.equal(stored.verificationCode, undefined);

  // Replays: same code, same QR, a second guard — all refused.
  assert.equal((await scan(credential.code)).status, 404);
  assert.equal((await scan(credential.payload)).status, 404);
  assert.equal((await inside(id, credential.code)).status, 409);
  assert.equal((await inside(id, credential.code, security2)).status, 409);
  assert.equal((await checkLocation(id, student, north(10))).status, 422, 'no new return attempt after completion');

  const sent = parentMessagesFor(student.u.name);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '******4321');
  assert.match(
    sent[0].message,
    new RegExp(`^Dear Parent, ${student.u.name} has returned to the college campus on \\d{2}/\\d{2}/\\d{4} at \\d{1,2}:\\d{2} (AM|PM)\\. This is an automated notification from JNN INSTITUTE OF ENGINEERING\\.$`)
  );

  const [notice] = await returnNotices(classFaculty, id);
  assert.ok(notice, 'assigned class faculty notified');
  assert.match(notice.message, new RegExp(`^${student.u.name} — Roll No: ${student.u.rollNo} has returned to the campus\\.\\nDate: \\d{2}/\\d{2}/\\d{4}\\nTime: \\d{2}:\\d{2}:\\d{2}$`));
  for (const who of [otherSection, otherYear, deptFaculty, hod, admin, security]) {
    assert.equal((await returnNotices(who, id)).length, 0, `${who.u.name} not notified`);
  }
});

test('two guards pressing STUDENT IS INSIDE at once complete the pass exactly once', async () => {
  const { id, student, credential } = await verifiedPass();
  const results = await Promise.all([inside(id, credential.code), inside(id, credential.payload, security2)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(parentMessagesFor(student.u.name).length, 1, 'one parent message');
  assert.equal((await returnNotices(classFaculty, id)).length, 1, 'one faculty notice');
});

test('privacy: location is read only per explicit check and never appears in other gate pass APIs', async () => {
  const { id, student } = await verifiedPass();
  assert.equal((await checks(id)).length, 1, 'one reading per check — no tracking');

  const pass = await ctx.models.GatePass.findById(id).lean();
  assert.ok(!hasLocationData(pass), 'gate pass record holds no coordinates');
  const views = [
    await ctx.request('GET', `/gate-pass/${id}`, { token: student.token }),
    await ctx.request('GET', '/gate-pass', { token: student.token }),
    await ctx.request('GET', `/gate-pass/${id}`, { token: classFaculty.token }),
    await ctx.request('GET', '/gate-pass', { token: classFaculty.token }),
    await ctx.request('GET', '/gate-pass/dashboard', { token: admin.token }),
    await ctx.request('GET', '/gate-pass/dashboard/security', { token: security.token }),
  ];
  for (const v of views) {
    assert.equal(v.status, 200);
    assert.ok(!hasLocationData(v.body), 'no location data in unrelated APIs');
  }
  await inside(id, (await ctx.request('GET', `/gate-pass/${id}/return-credential`, { token: student.token })).body.code);
  assert.equal((await checks(id)).length, 1, 'completing the return reads no location');
});
