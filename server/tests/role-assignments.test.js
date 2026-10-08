import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, staff1, staff2, staff3;

before(async () => {
  ctx = await startServer();
  const login = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };

  [admin, staff1, staff2, staff3] = await Promise.all([
    login({ role: 'admin', name: 'Admin User' }),
    login({
      role: 'faculty',
      name: 'Staff One',
      department: 'CSE',
      section: 'A',
      inChargeYear: 2,
      inChargeSemester: 4,
      employeeId: 'EMP-ST1',
    }),
    login({
      role: 'faculty',
      name: 'Staff Two',
      department: 'CSE',
      section: 'B',
      inChargeYear: 3,
      inChargeSemester: 6,
      employeeId: 'EMP-ST2',
    }),
    login({
      role: 'faculty',
      name: 'Staff Three',
      department: 'CSE',
      employeeId: 'EMP-ST3',
    }),
  ]);

  // Seed students in Class 1 (CSE Yr 2 Sec A Sem 4) and Class 2 (CSE Yr 3 Sec B Sem 6)
  await Promise.all([
    ctx.createUser({ name: 'C1 S1', email: 'c1_s1@jnn.edu.in', rollNo: 'C1_001', department: 'CSE', year: 2, section: 'A', semester: 4 }),
    ctx.createUser({ name: 'C1 S2', email: 'c1_s2@jnn.edu.in', rollNo: 'C1_002', department: 'CSE', year: 2, section: 'A', semester: 4 }),
    ctx.createUser({ name: 'C1 S3', email: 'c1_s3@jnn.edu.in', rollNo: 'C1_003', department: 'CSE', year: 2, section: 'A', semester: 4 }),
    ctx.createUser({ name: 'C2 S1', email: 'c2_s1@jnn.edu.in', rollNo: 'C2_001', department: 'CSE', year: 3, section: 'B', semester: 6 }),
    ctx.createUser({ name: 'C2 S2', email: 'c2_s2@jnn.edu.in', rollNo: 'C2_002', department: 'CSE', year: 3, section: 'B', semester: 6 }),
    ctx.createUser({ name: 'C2 S3', email: 'c2_s3@jnn.edu.in', rollNo: 'C2_003', department: 'CSE', year: 3, section: 'B', semester: 6 }),
    ctx.createUser({ name: 'C2 S4', email: 'c2_s4@jnn.edu.in', rollNo: 'C2_004', department: 'CSE', year: 3, section: 'B', semester: 6 }),
  ]);
});

after(async () => {
  await ctx.stop();
});

test('Overview: returns classes, hods and faculty directory', async () => {
  const res = await ctx.request('GET', '/admin/role-assignments/overview', { token: admin.token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.classes));
  assert.ok(Array.isArray(res.body.hods));
  assert.ok(Array.isArray(res.body.facultyList));

  // Verify Class 1 has 3 students and Class 2 has 4 students
  const c1 = res.body.classes.find(
    (c) => c.department === 'CSE' && c.year === 2 && c.section === 'A' && c.semester === 4
  );
  assert.ok(c1, 'Class 1 should exist');
  assert.equal(c1.studentCount, 3);
  assert.equal(c1.inCharge?.email, staff1.u.email);

  const c2 = res.body.classes.find(
    (c) => c.department === 'CSE' && c.year === 3 && c.section === 'B' && c.semester === 6
  );
  assert.ok(c2, 'Class 2 should exist');
  assert.equal(c2.studentCount, 4);
  assert.equal(c2.inCharge?.email, staff2.u.email);
});

test('Class In-Charge visibility: Staff 1 sees 3 students and Staff 2 sees 4 students', async () => {
  const s1Res = await ctx.request('GET', '/class-students', { token: staff1.token });
  assert.equal(s1Res.status, 200);
  assert.equal(s1Res.body.scope.year, 2);
  assert.equal(s1Res.body.scope.section, 'A');
  assert.equal(s1Res.body.items.length, 3);

  const s2Res = await ctx.request('GET', '/class-students', { token: staff2.token });
  assert.equal(s2Res.status, 200);
  assert.equal(s2Res.body.scope.year, 3);
  assert.equal(s2Res.body.scope.section, 'B');
  assert.equal(s2Res.body.items.length, 4);
});

test('Swap: Atomically swaps Class 1 and Class 2 between Staff 1 and Staff 2 with ZERO data loss', async () => {
  const swapRes = await ctx.request('POST', '/admin/role-assignments/swap-class-in-charge', {
    token: admin.token,
    body: {
      faculty1Id: staff1.u._id,
      faculty2Id: staff2.u._id,
    },
  });
  assert.equal(swapRes.status, 200);

  // Log in again to get fresh tokens post session-rotation
  const staff1New = await ctx.loginWeb(staff1.u);
  const staff2New = await ctx.loginWeb(staff2.u);

  // Staff 1 now sees Class 2 (4 students) and NO LONGER sees Class 1
  const s1After = await ctx.request('GET', '/class-students', { token: staff1New.token });
  assert.equal(s1After.status, 200);
  assert.equal(s1After.body.scope.year, 3);
  assert.equal(s1After.body.scope.section, 'B');
  assert.equal(s1After.body.items.length, 4);
  assert.ok(s1After.body.items.every((st) => st.rollNo.startsWith('C2_')));

  // Staff 2 now sees Class 1 (3 students) and NO LONGER sees Class 2
  const s2After = await ctx.request('GET', '/class-students', { token: staff2New.token });
  assert.equal(s2After.status, 200);
  assert.equal(s2After.body.scope.year, 2);
  assert.equal(s2After.body.scope.section, 'A');
  assert.equal(s2After.body.items.length, 3);
  assert.ok(s2After.body.items.every((st) => st.rollNo.startsWith('C1_')));
});

test('Unassign: Relieving Staff 1 to regular faculty hides students with ZERO data loss', async () => {
  const unassignRes = await ctx.request('POST', '/admin/role-assignments/unassign-class-in-charge', {
    token: admin.token,
    body: {
      facultyId: staff1.u._id,
    },
  });
  assert.equal(unassignRes.status, 200);

  const staff1New = await ctx.loginWeb(staff1.u);
  const s1Res = await ctx.request('GET', '/class-students', { token: staff1New.token });
  assert.equal(s1Res.status, 200);
  assert.equal(s1Res.body.scope, null);
  assert.equal(s1Res.body.items.length, 0);

  // Verify class 2 students still exist in DB (4 students untouched)
  const overviewRes = await ctx.request('GET', '/admin/role-assignments/overview', { token: admin.token });
  const c2 = overviewRes.body.classes.find(
    (c) => c.department === 'CSE' && c.year === 3 && c.section === 'B' && c.semester === 6
  );
  assert.equal(c2.studentCount, 4);
  assert.equal(c2.inCharge, null);
});

test('Assign: Appointing Staff 3 as Class In-Charge of Class 2 grants immediate access', async () => {
  const assignRes = await ctx.request('POST', '/admin/role-assignments/assign-class-in-charge', {
    token: admin.token,
    body: {
      facultyId: staff3.u._id,
      department: 'CSE',
      year: 3,
      section: 'B',
      semester: 6,
    },
  });
  assert.equal(assignRes.status, 200);

  const staff3New = await ctx.loginWeb(staff3.u);
  const s3Res = await ctx.request('GET', '/class-students', { token: staff3New.token });
  assert.equal(s3Res.status, 200);
  assert.equal(s3Res.body.scope.year, 3);
  assert.equal(s3Res.body.scope.section, 'B');
  assert.equal(s3Res.body.items.length, 4);
});

test('HOD Management: Promoting Staff 3 to HOD auto-clears in-charge assignment', async () => {
  const setHodRes = await ctx.request('POST', '/admin/role-assignments/set-hod', {
    token: admin.token,
    body: {
      department: 'CSE',
      facultyId: staff3.u._id,
    },
  });
  assert.equal(setHodRes.status, 200);
  assert.equal(setHodRes.body.hod.role, 'hod');

  // Verify Staff 3 is now HOD and inCharge is cleared
  const staff3New = await ctx.loginWeb(staff3.u);
  assert.equal(staff3New.user.role, 'hod');
  assert.equal(staff3New.user.inChargeYear, undefined);
  assert.equal(staff3New.user.inChargeSemester, undefined);
});

test('HOD Demotion: Demoting Staff 3 to regular faculty switches role back to faculty', async () => {
  const demoteRes = await ctx.request('POST', '/admin/role-assignments/demote-hod', {
    token: admin.token,
    body: {
      hodId: staff3.u._id,
    },
  });
  assert.equal(demoteRes.status, 200);
  assert.equal(demoteRes.body.user.role, 'faculty');

  const staff3New = await ctx.loginWeb(staff3.u);
  assert.equal(staff3New.user.role, 'faculty');
});

test('Access control: non-admins cannot read or change role assignments', async () => {
  const hod = await ctx.createUser({ role: 'hod', department: 'ECE', email: 'ra_hod@jnn.edu.in' });
  const principal = await ctx.createUser({ role: 'principal', email: 'ra_principal@jnn.edu.in' });
  const tokens = [
    (await ctx.loginWeb(staff3.u)).token,
    (await ctx.loginWeb(hod)).token,
    (await ctx.loginWeb(principal)).token,
  ];
  const calls = [
    ['GET', '/admin/role-assignments/overview'],
    ['POST', '/admin/role-assignments/assign-class-in-charge', { facultyId: staff3.u._id, department: 'CSE', year: 1, section: 'A', semester: 2 }],
    ['POST', '/admin/role-assignments/swap-class-in-charge', { faculty1Id: staff1.u._id, faculty2Id: staff2.u._id }],
    ['POST', '/admin/role-assignments/unassign-class-in-charge', { facultyId: staff2.u._id }],
    ['POST', '/admin/role-assignments/set-hod', { department: 'CSE', facultyId: staff3.u._id }],
    ['POST', '/admin/role-assignments/demote-hod', { hodId: hod._id }],
  ];
  for (const token of tokens) {
    for (const [method, path, body] of calls) {
      const res = await ctx.request(method, path, { token, body });
      assert.equal(res.status, 403, `${method} ${path} should be forbidden`);
    }
  }
  const anon = await ctx.request('GET', '/admin/role-assignments/overview');
  assert.equal(anon.status, 401);
});

test('HOD Management: only faculty (or an existing HOD) can be appointed HOD', async () => {
  const student = await ctx.createUser({ name: 'RA Student', email: 'ra_student@jnn.edu.in', rollNo: 'RA_001', department: 'CSE', year: 1, section: 'A', semester: 2 });
  const principal = await ctx.createUser({ role: 'principal', email: 'ra_principal2@jnn.edu.in' });
  for (const target of [student, principal, admin.u]) {
    const res = await ctx.request('POST', '/admin/role-assignments/set-hod', {
      token: admin.token,
      body: { department: 'CSE', facultyId: target._id },
    });
    assert.equal(res.status, 400, `${target.role} must not become HOD`);
  }
  // The admin's own session survived (not demoted / revoked by a self-promotion).
  const still = await ctx.request('GET', '/admin/role-assignments/overview', { token: admin.token });
  assert.equal(still.status, 200);
  const stuLogin = await ctx.loginWeb(student);
  assert.notEqual(stuLogin.user.role, 'hod');
});
