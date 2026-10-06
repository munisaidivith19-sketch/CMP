/**
 * Automated test suite for:
 * 1. Gate Pass 4 Card Popups & Role-Scoped Visibility (Class In-Charge, HOD, Principal/Admin)
 * 2. Stage labels for pending requests (Waiting for Class In-Charge, Waiting for HOD, Waiting for Principal)
 * 3. Institutional Mass Outpass Authorization (Principal only)
 * 4. Strict Zero Duplication guarantee for generated security verification codes
 * 5. Immediate QR code accessibility for hostellers without filing individual requests
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
const users = {};
let studentCseA, studentCseB, studentEceA, hosteller1, hosteller2, hosteller3;
let passCseA, passCseB, passEceA;

before(async () => {
  ctx = await startServer();

  let empIdx = 100;
  const make = async (role, extra = {}) => {
    empIdx += 1;
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: extra.employeeId || `EMP-${role}-${empIdx}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };

  users.principal = await make('principal');
  users.admin = await make('admin');
  users.hodCse = await make('hod', { department: 'CSE' });
  users.facultyCseA = await make('faculty', { department: 'CSE', section: 'A' });
  users.facultyCseB = await make('faculty', { department: 'CSE', section: 'B' });
  users.warden = await make('warden');

  // Create students across departments and sections
  studentCseA = await ctx.createUser({
    role: 'student',
    name: 'Student CSE A',
    rollNo: 'CSEA01',
    department: 'CSE',
    section: 'A',
    year: 3,
    stayType: 'hosteler',
    parentPhone: '9876500001',
  });
  studentCseB = await ctx.createUser({
    role: 'student',
    name: 'Student CSE B',
    rollNo: 'CSEB01',
    department: 'CSE',
    section: 'B',
    year: 3,
    stayType: 'hosteler',
    parentPhone: '9876500002',
  });
  studentEceA = await ctx.createUser({
    role: 'student',
    name: 'Student ECE A',
    rollNo: 'ECEA01',
    department: 'ECE',
    section: 'A',
    year: 2,
    stayType: 'hosteler',
    parentPhone: '9876500003',
  });

  // Additional hosteller students for mass outpass testing
  hosteller1 = await ctx.createUser({
    role: 'student',
    name: 'Hosteller One',
    rollNo: 'HOST01',
    department: 'CSE',
    section: 'A',
    year: 2,
    stayType: 'hosteler',
    parentPhone: '9876500011',
  });
  hosteller2 = await ctx.createUser({
    role: 'student',
    name: 'Hosteller Two',
    rollNo: 'HOST02',
    department: 'ECE',
    section: 'B',
    year: 3,
    stayType: 'hosteler',
    parentPhone: '9876500012',
  });
  hosteller3 = await ctx.createUser({
    role: 'student',
    name: 'Hosteller Three',
    rollNo: 'HOST03',
    department: 'MECH',
    section: 'A',
    year: 4,
    stayType: 'hosteler',
    parentPhone: '9876500013',
  });

  users.studentCseA = { u: studentCseA, ...(await ctx.loginWeb(studentCseA)) };
  users.hosteller1 = { u: hosteller1, ...(await ctx.loginWeb(hosteller1)) };

  const { GatePass } = ctx.models;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);

  // Pass 1: Pending faculty for CSE A student
  passCseA = await GatePass.create({
    student: studentCseA._id,
    department: 'CSE',
    section: 'A',
    regarding: 'home',
    description: 'Visiting family in hometown',
    fromDate: now,
    toDate: tomorrow,
    parentPhone: '9876500001',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Guindy' },
    status: 'pending_faculty',
  });

  // Pass 2: Pending HOD for CSE B student
  passCseB = await GatePass.create({
    student: studentCseB._id,
    department: 'CSE',
    section: 'B',
    regarding: 'outing',
    description: 'Medical appointment',
    fromDate: now,
    toDate: tomorrow,
    parentPhone: '9876500002',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' },
    status: 'pending_hod',
  });

  // Pass 3: Active pass (Outside now) for ECE A student
  passEceA = await GatePass.create({
    student: studentEceA._id,
    department: 'ECE',
    section: 'A',
    regarding: 'outing',
    description: 'Project seminar',
    fromDate: now,
    toDate: tomorrow,
    actualExit: now,
    parentPhone: '9876500003',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T Nagar' },
    status: 'active',
  });
});

after(async () => {
  await ctx.stop();
});

test('1. Access Control: Only Principal (or Admin) can authorize Institutional Mass Outpass', async () => {
  const fromDate = new Date().toISOString();
  const toDate = new Date(Date.now() + 2 * 86400000).toISOString();
  const body = {
    fromDate,
    toDate,
    regarding: 'home',
    description: 'Semester Break Institutional Mass Outpass',
  };

  // Student receives 403
  const resStudent = await ctx.request('POST', '/gate-pass/mass-approve', { token: users.studentCseA.token, body });
  assert.equal(resStudent.status, 403, 'Student should be forbidden');

  // Faculty receives 403
  const resFaculty = await ctx.request('POST', '/gate-pass/mass-approve', { token: users.facultyCseA.token, body });
  assert.equal(resFaculty.status, 403, 'Faculty should be forbidden');

  // HOD receives 403
  const resHod = await ctx.request('POST', '/gate-pass/mass-approve', { token: users.hodCse.token, body });
  assert.equal(resHod.status, 403, 'HOD should be forbidden');

  // Warden receives 403
  const resWarden = await ctx.request('POST', '/gate-pass/mass-approve', { token: users.warden.token, body });
  assert.equal(resWarden.status, 403, 'Warden should be forbidden');
});

test('2. Role Scoping in 4 Dashboard Card Popups', async () => {
  // Class In-Charge (CSE Sec A)
  const resFaculty = await ctx.request('GET', '/gate-pass/dashboard', { token: users.facultyCseA.token });
  assert.equal(resFaculty.status, 200);
  assert.ok(Array.isArray(resFaculty.body.pendingStudents));
  // Faculty CSE A sees passCseA (department: CSE, section: A) but NOT passCseB (Sec B) or passEceA (ECE)
  const facultyPendingIds = resFaculty.body.pendingStudents.map((p) => String(p._id));
  assert.ok(facultyPendingIds.includes(String(passCseA._id)), 'Faculty should see their class pending pass');
  assert.ok(!facultyPendingIds.includes(String(passCseB._id)), 'Faculty should NOT see other section pass');
  assert.ok(!facultyPendingIds.includes(String(passEceA._id)), 'Faculty should NOT see other department pass');

  // HOD (CSE)
  const resHod = await ctx.request('GET', '/gate-pass/dashboard', { token: users.hodCse.token });
  assert.equal(resHod.status, 200);
  const hodPendingIds = resHod.body.pendingStudents.map((p) => String(p._id));
  assert.ok(hodPendingIds.includes(String(passCseA._id)), 'HOD should see CSE Sec A pass');
  assert.ok(hodPendingIds.includes(String(passCseB._id)), 'HOD should see CSE Sec B pass');
  assert.ok(!hodPendingIds.includes(String(passEceA._id)), 'HOD should NOT see ECE pass');

  // Principal (College-Wide)
  const resPrincipal = await ctx.request('GET', '/gate-pass/dashboard', { token: users.principal.token });
  assert.equal(resPrincipal.status, 200);
  const principalPendingIds = resPrincipal.body.pendingStudents.map((p) => String(p._id));
  assert.ok(principalPendingIds.includes(String(passCseA._id)), 'Principal sees CSE Sec A');
  assert.ok(principalPendingIds.includes(String(passCseB._id)), 'Principal sees CSE Sec B');
  // Outside students check: passEceA is active
  const outsideIds = resPrincipal.body.outsideStudents.map((p) => String(p._id));
  assert.ok(outsideIds.includes(String(passEceA._id)), 'Principal sees active outside pass from ECE');

  // Principal dashboard includes hostelSummary with inside & outside counts
  assert.ok(resPrincipal.body.hostelSummary, 'Principal dashboard must return hostelSummary');
  assert.ok(typeof resPrincipal.body.hostelSummary.total === 'number');
  assert.ok(typeof resPrincipal.body.hostelSummary.inside === 'number');
  assert.ok(typeof resPrincipal.body.hostelSummary.outside === 'number');
});

test('3. Stage Labeling for Pending Requests', async () => {
  const resPrincipal = await ctx.request('GET', '/gate-pass/dashboard', { token: users.principal.token });
  assert.equal(resPrincipal.status, 200);

  const pendingA = resPrincipal.body.pendingStudents.find((p) => String(p._id) === String(passCseA._id));
  assert.ok(pendingA, 'Found passCseA');
  assert.equal(pendingA.stageLabel, 'Waiting for Class In-Charge review');

  const pendingB = resPrincipal.body.pendingStudents.find((p) => String(p._id) === String(passCseB._id));
  assert.ok(pendingB, 'Found passCseB');
  assert.equal(pendingB.stageLabel, 'Waiting for HOD approval');
});

test('4. Institutional Mass Outpass Authorization & Zero Duplication Guarantee', async () => {
  const fromDate = new Date().toISOString();
  const toDate = new Date(Date.now() + 3 * 86400000).toISOString();
  const body = {
    fromDate,
    toDate,
    regarding: 'home',
    description: 'Annual Festival Mass Outpass Authorization',
  };

  const res = await ctx.request('POST', '/gate-pass/mass-approve', { token: users.principal.token, body });
  assert.equal(res.status, 201, `Failed to mass approve: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.ok(res.body.count > 0, 'Should have issued passes for eligible hostellers');

  // Query all passes created with this description
  const { GatePass } = ctx.models;
  const massPasses = await GatePass.find({ description: body.description }).select('+verificationCode').lean();
  assert.ok(massPasses.length >= 4, 'Multiple hostellers should have received passes');

  // Verify status is approved for all
  for (const pass of massPasses) {
    assert.equal(pass.status, 'approved', 'Every pass should be approved');
    assert.ok(pass.verificationCode, 'Every pass must have a verification code');
    assert.equal(pass.verificationCode.length, 4, 'Verification code must be 4 characters');
  }

  // STRICT ZERO DUPLICATION CHECK
  const codes = massPasses.map((p) => p.verificationCode);
  const uniqueCodes = new Set(codes);
  assert.equal(uniqueCodes.size, codes.length, `Strict zero duplicate codes guarantee violated! Codes: ${codes.join(', ')}`);
});

test('5. Hosteller Dashboard Immediate QR Availability without Requesting', async () => {
  // Query hosteller1's passes (they did not file any request)
  const res = await ctx.request('GET', '/gate-pass', { token: users.hosteller1.token });
  assert.equal(res.status, 200);

  const approvedPass = res.body.passes.find((p) => p.status === 'approved');
  assert.ok(approvedPass, 'Hosteller should have an approved pass waiting on their dashboard');

  // Verify QR code endpoint works directly for the hosteller
  const qrRes = await ctx.request('GET', `/gate-pass/${approvedPass._id}/qr`, { token: users.hosteller1.token });
  assert.equal(qrRes.status, 200);
  assert.ok(qrRes.body.qr, 'Must return QR data URL');
  assert.ok(qrRes.body.code, 'Must return 4-character code');
  assert.equal(qrRes.body.code.length, 4);
  assert.equal(qrRes.body.status, 'approved');
});
