/**
 * Gate pass overview for AO / Dean / Chairman (same cards as the principal),
 * the college-wide "history" view of a past day, and the scope rules around
 * both: who may look back, what a past day contains, and that the
 * AO / Dean / Chairman request list stays limited to what was sent to them.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const COLLEGE = ['admin', 'principal', 'ao', 'dean', 'chairman'];
const PARENT = '9876504321';

let ctx;
const staff = {};
let D; // a past campus day, YYYY-MM-DD
let pOutsideOverdue, pEmergencyAo;

// Campus time is Asia/Kolkata (UTC+05:30).
const istKey = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const at = (key, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${key}T00:00:00Z`) + (h * 60 + m - 330) * 60000);
};
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const dash = (who, q = '') => ctx.request('GET', `/gate-pass/dashboard${q}`, { token: who.token });

before(async () => {
  ctx = await startServer();
  const make = async (role, extra = {}) => {
    const u = await ctx.createUser({ role, name: `${role} user`, employeeId: `E-${role}`, ...extra });
    return { u, ...(await ctx.loginWeb(u)) };
  };
  for (const role of COLLEGE) staff[role] = await make(role);
  staff.faculty = await make('faculty', { department: 'CSE', section: 'A' });
  staff.hod = await make('hod', { department: 'CSE' });
  staff.security = await make('security');
  staff.warden = await make('warden');

  D = istKey(Date.now() - 10 * 86400000);
  const students = [];
  for (let i = 1; i <= 4; i += 1) {
    students.push(await ctx.createUser({ name: `Gate Student ${i}`, rollNo: `GS${i}`, department: 'CSE', section: 'A', year: 3, parentPhone: PARENT }));
  }
  students.push(await make('student', { name: 'Gate Student Me', rollNo: 'GS9', department: 'CSE', section: 'A', year: 3, parentPhone: PARENT }));
  staff.student = students[4];

  const { GatePass } = ctx.models;
  const normal = (student, extra) => ({
    student: student._id,
    regarding: 'outing',
    description: 'Going home for the weekend',
    parentPhone: PARENT,
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Tambaram' },
    department: 'CSE',
    section: 'A',
    ...extra,
  });
  const passes = await GatePass.create([
    // Left and came back on D.
    normal(students[0], { fromDate: at(D, '00:00'), toDate: at(D, '00:00'), status: 'completed', actualExit: at(D, '10:00'), actualReturn: at(D, '18:00') }),
    // Left on D, back the next day: an exit on D and outside when D ended.
    normal(students[1], { fromDate: at(D, '00:00'), toDate: at(shift(D, 1), '00:00'), status: 'completed', actualExit: at(D, '11:00'), actualReturn: at(shift(D, 1), '09:00') }),
    // Left the day before D and never returned, due back two days before D: outside and overdue.
    normal(students[2], { fromDate: at(shift(D, -2), '00:00'), toDate: new Date(`${shift(D, -2)}T00:00:00Z`), status: 'active', actualExit: at(shift(D, -1), '09:00') }),
    // An emergency request raised on D and sent to the AO.
    {
      student: students[3]._id,
      passType: 'emergency',
      emergencyAuthority: 'ao',
      description: 'Father admitted to hospital',
      destination: { area: 'Chennai General Hospital' },
      fromDate: at(D, '12:00'),
      toDate: at(D, '20:00'),
      parentPhone: PARENT,
      department: 'CSE',
      section: 'A',
      status: 'pending_authority',
    },
  ]);
  pOutsideOverdue = passes[2];
  pEmergencyAo = passes[3];
  // Pin createdAt: only the emergency request was raised on D.
  const created = [shift(D, -3), shift(D, -3), shift(D, -3), D];
  await Promise.all(passes.map((p, i) => GatePass.collection.updateOne({ _id: p._id }, { $set: { createdAt: at(created[i], '08:00') } })));
});
after(async () => {
  await ctx.stop();
});

test('AO, Dean and Chairman get the same live overview cards as the principal', async () => {
  for (const role of COLLEGE) {
    const res = await dash(staff[role]);
    assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
    for (const key of ['pending', 'studentsOutside', 'overdue', 'todayExits', 'todayReturns', 'outsideStudents']) {
      assert.ok(key in res.body, `${role} sees ${key}`);
    }
    assert.ok(res.body.outsideStudents.some((p) => String(p._id) === String(pOutsideOverdue._id)));
    assert.ok(!res.body.history);
  }
});

test('History: a past day shows that day’s exits, returns, requests and who was outside when it ended', async () => {
  for (const role of COLLEGE) {
    const res = await dash(staff[role], `?date=${D}`);
    assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.history, true);
    assert.equal(res.body.date, D);
    assert.equal(res.body.todayExits, 2, 'two students left on D');
    assert.equal(res.body.todayReturns, 1, 'one student came back on D');
    assert.equal(res.body.requests, 1, 'one request was raised on D');
    assert.equal(res.body.studentsOutside, 2, 'one left on D, one was already out — both still outside at day end');
    assert.equal(res.body.overdue, 1);
    assert.deepEqual(res.body.exits.map((p) => p.student.rollNo), ['GS1', 'GS2'], 'exits in time order');
    assert.deepEqual(res.body.returns.map((p) => p.student.rollNo), ['GS1']);
  }
});

test('History: today’s date is the live view; a future or malformed date is refused', async () => {
  const today = istKey(Date.now());
  const live = await dash(staff.principal, `?date=${today}`);
  assert.equal(live.status, 200);
  assert.ok(!live.body.history, 'today = the live dashboard');
  assert.equal((await dash(staff.principal, `?date=${shift(today, 2)}`)).status, 422);
  assert.equal((await dash(staff.principal, '?date=not-a-date')).status, 422);
  assert.equal((await dash(staff.principal, '?date[$gt]=2020-01-01')).status, 422);
});

test('History is college-wide only; the live dashboard for other roles is unchanged', async () => {
  for (const role of ['faculty', 'hod', 'security']) {
    assert.equal((await dash(staff[role], `?date=${D}`)).status, 403, `${role} cannot look back`);
  }
  for (const role of ['faculty', 'hod', 'security']) {
    assert.equal((await dash(staff[role])).status, 200, `${role} still has the live dashboard`);
  }
  assert.equal((await dash(staff.student)).status, 403);
  assert.equal((await dash(staff.student, `?date=${D}`)).status, 403);
  assert.equal((await dash(staff.warden)).status, 403);
});

test('AO / Dean / Chairman see a masked parent number except on emergency requests sent to them', async () => {
  const live = await dash(staff.ao);
  const row = live.body.outsideStudents.find((p) => String(p._id) === String(pOutsideOverdue._id));
  assert.ok(row);
  assert.notEqual(row.parentPhone, PARENT, 'not in the AO’s approval chain: masked');
  assert.ok(row.student.name, 'the student is identified so the profile can be opened');

  const principal = await dash(staff.principal);
  const pRow = principal.body.outsideStudents.find((p) => String(p._id) === String(pOutsideOverdue._id));
  assert.equal(pRow.parentPhone, PARENT, 'principal unchanged');

  const own = await ctx.request('GET', `/gate-pass/${pEmergencyAo._id}`, { token: staff.ao.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.parentPhone, PARENT, 'their own emergency request is unchanged');
});

test('Requests tab: AO / Dean / Chairman still list only the emergency requests sent to them', async () => {
  const ao = await ctx.request('GET', `/gate-pass?date=${D}`, { token: staff.ao.token });
  assert.equal(ao.status, 200);
  assert.deepEqual(ao.body.passes.map((p) => String(p._id)), [String(pEmergencyAo._id)]);

  const aoAll = await ctx.request('GET', '/gate-pass', { token: staff.ao.token });
  assert.ok(aoAll.body.passes.every((p) => p.passType === 'emergency' && p.emergencyAuthority === 'ao'));

  for (const role of ['dean', 'chairman']) {
    const res = await ctx.request('GET', '/gate-pass', { token: staff[role].token });
    assert.equal(res.status, 200);
    assert.equal(res.body.passes.length, 0, `${role} sees no other authority’s requests`);
  }
  // A normal pass is still not openable by an emergency authority.
  assert.equal((await ctx.request('GET', `/gate-pass/${pOutsideOverdue._id}`, { token: staff.dean.token })).status, 403);
});

test('Profile from a gate pass: college-wide roles can open the student’s profile', async () => {
  const studentId = pOutsideOverdue.student;
  for (const role of COLLEGE) {
    const res = await ctx.request('GET', `/users/${studentId}`, { token: staff[role].token });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.rollNo, 'GS3');
  }
  assert.equal((await ctx.request('GET', `/users/${studentId}`, { token: staff.security.token })).status, 403);
});
