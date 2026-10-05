/**
 * Day scholar Outing pass.
 *
 * A day scholar requests a same-day Outing (subject, description, the parent
 * number they type, optional attachment). It runs the normal approval chain
 * (Class In-Charge with parent OTP → HOD → Principal) and has no return step:
 * security's OUT completes it. Hostelers keep the existing pass unchanged.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { testOtpProvider } from '../src/services/otp/providers/testOtpProvider.js';

const REGISTERED = '9876504321';
const TYPED = '9123456780';

let ctx;
const staff = {};
let n = 0;

const outing = (student, body) => ctx.request('POST', '/gate-pass/outing', { token: student.token, body });
const validOuting = (extra = {}) => ({ subject: 'Dental appointment', description: 'Dentist visit in town this afternoon', parentPhone: TYPED, ...extra });
const review = (id, stage, who, action = 'forward') => ctx.request('PATCH', `/gate-pass/${id}/${stage}-review`, { token: who.token, body: { action } });
const storedCode = async (id) => (await ctx.models.GatePass.findById(id).select('+verificationCode').lean()).verificationCode;

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `E-${role}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A', teachingYears: [3] });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.principal = await make('principal');
  staff.security = await make('security');
  staff.admin = await make('admin');
});
after(async () => {
  await ctx.stop();
});

async function newStudent(stayType) {
  n += 1;
  const u = await ctx.createUser({ name: `Student ${n}`, rollNo: `DS${100 + n}`, department: 'CSE', section: 'A', year: 3, parentPhone: REGISTERED, ...(stayType ? { stayType } : {}) });
  return { u, ...(await ctx.loginWeb(u)) };
}

/** Parent OTP → faculty forward → HOD → principal approve. */
async function approve(id) {
  assert.equal((await ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: staff.faculty.token })).status, 200);
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
  const ok = await ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: staff.faculty.token, body: { otp: testOtpProvider.peek(rec._id) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await review(id, 'faculty', staff.faculty)).status, 200);
  assert.equal((await review(id, 'hod', staff.hod)).status, 200);
  assert.equal((await review(id, 'principal', staff.principal, 'approve')).status, 200);
  return rec;
}

test('A day scholar creates an Outing for today with subject, description, typed parent number and an attachment', async () => {
  const s = await newStudent('day_scholar');
  const res = await outing(s, validOuting({ supportingDocument: { url: '/uploads/note.pdf', name: 'note.pdf', mimeType: 'application/pdf' } }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.dayScholarOuting, true);
  assert.equal(res.body.passType, 'normal');
  assert.equal(res.body.status, 'pending_faculty', 'the normal approval chain');
  assert.equal(res.body.subject, 'Dental appointment');
  assert.equal(res.body.parentPhone, TYPED);
  assert.equal(res.body.supportingDocument.name, 'note.pdf');
  assert.equal(res.body.fromDate, res.body.toDate, 'one day');
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  assert.equal(res.body.fromDate.slice(0, 10), today, 'today, from the server clock');
  assert.equal(res.body.department, 'CSE', 'class comes from the account');
});

test('The attachment is optional; dates and destination sent by the client are ignored', async () => {
  const s = await newStudent('day_scholar');
  const res = await outing(s, validOuting({ fromDate: '2031-01-01', toDate: '2031-02-01', destination: { area: 'Goa' }, department: 'ECE', status: 'approved' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.supportingDocument?.url, undefined);
  assert.notEqual(res.body.fromDate.slice(0, 4), '2031');
  assert.equal(res.body.destination?.area, undefined);
  assert.equal(res.body.department, 'CSE');
  assert.equal(res.body.status, 'pending_faculty');
});

test('Outing validation: subject, description and a valid parent number are required', async () => {
  const s = await newStudent('day_scholar');
  assert.equal((await outing(s, validOuting({ subject: '' }))).status, 422);
  assert.equal((await outing(s, validOuting({ description: 'hi' }))).status, 422);
  assert.equal((await outing(s, validOuting({ parentPhone: '' }))).status, 422);
  assert.equal((await outing(s, validOuting({ parentPhone: 'call-me<b>' }))).status, 422);
  assert.equal((await outing(s, validOuting({ parentPhone: { $ne: null } }))).status, 422);
  assert.equal((await outing(s, validOuting({ supportingDocument: { url: 'javascript:alert(1)' } }))).status, 422);
  assert.equal((await outing(s, validOuting({ supportingDocument: { url: 'http://evil.example/x' } }))).status, 422);
});

test('Only day scholars can request an Outing; hostelers (and accounts with no stay type) cannot', async () => {
  for (const stay of ['hosteler', undefined]) {
    const s = await newStudent(stay);
    const res = await outing(s, validOuting());
    assert.equal(res.status, 403, String(stay));
  }
  assert.equal((await outing(staff.faculty, validOuting())).status, 403, 'staff cannot');
});

test('A day scholar cannot use the hosteler gate pass; hostelers still can, unchanged', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const body = { regarding: 'home', description: 'Weekend at home', fromDate: day, toDate: day, destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } };
  const ds = await newStudent('day_scholar');
  assert.equal((await ctx.request('POST', '/gate-pass', { token: ds.token, body })).status, 403);

  const hosteler = await newStudent('hosteler');
  const res = await ctx.request('POST', '/gate-pass', { token: hosteler.token, body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.dayScholarOuting, false);
  assert.equal(res.body.parentPhone, REGISTERED, 'hostelers still use the registered number');
});

test('Only one open pass at a time', async () => {
  const s = await newStudent('day_scholar');
  assert.equal((await outing(s, validOuting())).status, 201);
  assert.equal((await outing(s, validOuting())).status, 409);
});

test('Parent OTP goes to the typed number; reviewers are warned when it differs from the registered one', async () => {
  const s = await newStudent('day_scholar');
  const { body: pass } = await outing(s, validOuting());

  const list = await ctx.request('GET', '/gate-pass', { token: staff.faculty.token });
  const row = list.body.passes.find((p) => p._id === pass._id);
  assert.ok(row, 'the class in-charge sees it');
  assert.equal(row.parentPhoneDiffers, true);
  const detail = await ctx.request('GET', `/gate-pass/${pass._id}`, { token: staff.faculty.token });
  assert.equal(detail.body.parentPhoneDiffers, true);
  assert.ok(!JSON.stringify(detail.body).includes(REGISTERED), 'the registered number itself is not sent');

  const mine = await ctx.request('GET', `/gate-pass/${pass._id}`, { token: s.token });
  assert.equal(mine.body.parentPhoneDiffers, undefined, 'the flag is for reviewers only');

  assert.equal((await ctx.request('POST', `/gate-pass/${pass._id}/parent-otp`, { token: staff.faculty.token })).status, 200);
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: pass._id }).sort({ createdAt: -1 }).lean();
  assert.ok(rec.parentMobileMasked.endsWith(TYPED.slice(-4)), `OTP went to the typed number (${rec.parentMobileMasked})`);

  const same = await newStudent('day_scholar');
  const { body: samePass } = await outing(same, validOuting({ parentPhone: `+91 ${REGISTERED}`.replace('+91 ', '') }));
  const sameRow = (await ctx.request('GET', `/gate-pass/${samePass._id}`, { token: staff.faculty.token })).body;
  assert.equal(sameRow.parentPhoneDiffers, false);
});

test('Approval chain is unchanged: no OTP, no forward; HOD and Principal cannot be skipped', async () => {
  const s = await newStudent('day_scholar');
  const { body: pass } = await outing(s, validOuting());
  assert.equal((await review(pass._id, 'faculty', staff.faculty)).status, 422, 'parent OTP still required');
  assert.equal((await review(pass._id, 'principal', staff.principal, 'approve')).status, 422);
  assert.equal((await review(pass._id, 'hod', staff.hod)).status, 422);
});

test('Security OUT completes the Outing: no return step, never "outside"', async () => {
  const s = await newStudent('day_scholar');
  const { body: pass } = await outing(s, validOuting());
  await approve(pass._id);
  const code = await storedCode(pass._id);
  assert.ok(code);

  const out = await ctx.request('PATCH', `/gate-pass/${pass._id}/out`, { token: staff.security.token, body: { code } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.status, 'completed');
  assert.ok(out.body.actualExit);
  assert.equal(out.body.overdue, false);

  // The code is spent, and nothing about returning applies.
  assert.equal((await ctx.request('PATCH', `/gate-pass/${pass._id}/out`, { token: staff.security.token, body: { code } })).status, 409);
  const back = await ctx.request('POST', `/gate-pass/${pass._id}/return-location/verify`, {
    token: s.token,
    body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
  });
  assert.notEqual(back.status, 200, 'no return verification for an Outing');
  assert.notEqual((await ctx.request('GET', `/gate-pass/${pass._id}/return-credential`, { token: s.token })).status, 200);

  const dash = await ctx.request('GET', '/gate-pass/dashboard', { token: staff.principal.token });
  assert.ok(!dash.body.outsideStudents.some((p) => p._id === pass._id), 'not listed as outside');
  assert.ok(dash.body.todayExits >= 1, 'the exit still counts as an exit today');
  const sec = await ctx.request('GET', '/gate-pass/dashboard/security', { token: staff.security.token });
  assert.ok(!sec.body.outsideStudents.some((p) => p._id === pass._id));

  // After it completes, the student may request another outing.
  assert.equal((await outing(s, validOuting())).status, 201);
});

test('A hosteler pass still becomes active on OUT and keeps the return flow', async () => {
  const s = await newStudent('hosteler');
  const day = new Date().toISOString().slice(0, 10);
  const { body: pass } = await ctx.request('POST', '/gate-pass', {
    token: s.token,
    body: { regarding: 'outing', description: 'Market visit', fromDate: day, toDate: day, destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } },
  });
  const rec = await approve(pass._id);
  assert.ok(rec.parentMobileMasked.endsWith(REGISTERED.slice(-4)), 'hostelers: OTP to the registered number');
  const out = await ctx.request('PATCH', `/gate-pass/${pass._id}/out`, { token: staff.security.token, body: { code: await storedCode(pass._id) } });
  assert.equal(out.status, 200);
  assert.equal(out.body.status, 'active', 'unchanged: outside until they return');
  const back = await ctx.request('POST', `/gate-pass/${pass._id}/return-location/verify`, {
    token: s.token,
    body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
  });
  assert.equal(back.status, 200, JSON.stringify(back.body));
});
