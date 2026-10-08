import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, classInCharge;

before(async () => {
  ctx = await startServer();
  const login = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };

  [admin, classInCharge] = await Promise.all([
    login({ role: 'admin', name: 'Admin User' }),
    login({
      role: 'faculty',
      name: 'Class Faculty',
      department: 'CSE',
      section: 'A',
      inChargeYear: 2,
      inChargeSemester: 4,
      employeeId: 'EMP-CIC1',
    }),
  ]);
});

after(async () => {
  await ctx.stop();
});

test('Admin createUser: rejects duplicate email with 409', async () => {
  const first = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      name: 'Student One',
      email: 'dup_email@jnn.edu.in',
      password: 'Password123',
      role: 'student',
      department: 'CSE',
      year: 2,
      section: 'A',
      semester: 4,
      rollNo: '22CS101',
      phone: '9876543210',
      parentPhone: '9876543211',
      stayType: 'day_scholar',
    },
  });
  assert.equal(first.status, 201);

  const duplicate = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      name: 'Student Two',
      email: 'dup_email@jnn.edu.in',
      password: 'Password123',
      role: 'student',
      department: 'CSE',
      year: 2,
      section: 'A',
      semester: 4,
      rollNo: '22CS102',
      phone: '9876543212',
      parentPhone: '9876543213',
      stayType: 'day_scholar',
    },
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.message, /already (exists|in use)/i);
});

test('Admin createUser: rejects duplicate rollNo case-insensitively with 409', async () => {
  const duplicateRoll = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      name: 'Student Lower Roll',
      email: 'unique_email_1@jnn.edu.in',
      password: 'Password123',
      role: 'student',
      department: 'CSE',
      year: 2,
      section: 'A',
      semester: 4,
      rollNo: '22cs101', // Lowercase of existing 22CS101
      phone: '9876543214',
      parentPhone: '9876543215',
      stayType: 'day_scholar',
    },
  });
  assert.equal(duplicateRoll.status, 409);
  assert.match(duplicateRoll.body.message, /register number/i);
});

test('Admin createUser: rejects identical student mobile and parent mobile with 422', async () => {
  const samePhone = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      name: 'Student Identical Phone',
      email: 'phone_test@jnn.edu.in',
      password: 'Password123',
      role: 'student',
      department: 'CSE',
      year: 2,
      section: 'A',
      semester: 4,
      rollNo: '22CS103',
      phone: '+91 98765 43210',
      parentPhone: '9876543210',
      stayType: 'day_scholar',
    },
  });
  assert.equal(samePhone.status, 422);
  assert.match(samePhone.body.message, /cannot be the same/i);
});

test('Class In-Charge createClassStudent: enforces rollNo uniqueness and phone check', async () => {
  // Matching student & parent phone
  const samePhoneRes = await ctx.request('POST', '/class-students', {
    token: classInCharge.token,
    body: {
      title: 'Mr',
      gender: 'male',
      name: 'Class Student Dup Phone',
      email: 'cic_s1@jnn.edu.in',
      password: 'Password123',
      rollNo: '22CS201',
      stayType: 'day_scholar',
      phone: '9123456789',
      parentPhone: '9123456789',
    },
  });
  assert.equal(samePhoneRes.status, 422);

  // Success with distinct phones
  const successRes = await ctx.request('POST', '/class-students', {
    token: classInCharge.token,
    body: {
      title: 'Mr',
      gender: 'male',
      name: 'Class Student Success',
      email: 'cic_s1@jnn.edu.in',
      password: 'Password123',
      rollNo: '22CS201',
      stayType: 'day_scholar',
      phone: '9123456789',
      parentPhone: '9123456780',
    },
  });
  assert.equal(successRes.status, 201);

  // Duplicate rollNo attempt
  const dupRollRes = await ctx.request('POST', '/class-students', {
    token: classInCharge.token,
    body: {
      title: 'Mr',
      gender: 'male',
      name: 'Class Student Dup Roll',
      email: 'cic_s2@jnn.edu.in',
      password: 'Password123',
      rollNo: '22cs201',
      stayType: 'day_scholar',
      parentPhone: '9123456781',
    },
  });
  assert.equal(dupRollRes.status, 409);
  assert.match(dupRollRes.body.message, /register number/i);
});

test('Admin updateUser: rejects duplicate rollNo and identical phones', async () => {
  // Create student to update
  const created = await ctx.request('POST', '/admin/users', {
    token: admin.token,
    body: {
      name: 'Update Target',
      email: 'update_target@jnn.edu.in',
      password: 'Password123',
      role: 'student',
      department: 'CSE',
      year: 2,
      section: 'A',
      semester: 4,
      rollNo: '22CS301',
      phone: '9000000001',
      parentPhone: '9000000002',
      stayType: 'day_scholar',
    },
  });
  assert.equal(created.status, 201);
  const targetId = created.body._id;

  // Try updating rollNo to existing '22CS101'
  const dupRollUpdate = await ctx.request('PATCH', `/admin/users/${targetId}`, {
    token: admin.token,
    body: {
      rollNo: '22cs101',
    },
  });
  assert.equal(dupRollUpdate.status, 409);

  // Try updating phone to match parentPhone
  const samePhoneUpdate = await ctx.request('PATCH', `/admin/users/${targetId}`, {
    token: admin.token,
    body: {
      phone: '9000000002',
    },
  });
  assert.equal(samePhoneUpdate.status, 422);
});

