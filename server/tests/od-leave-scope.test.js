import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { addDays, dayKey, today } from '../src/utils/dates.js';
import { FIRST_YEAR_HOD_DEPT } from '../src/constants.js';

/**
 * OD / Leave review is object-scoped: a reviewer may act only on requests
 * from the students they are responsible for — the same scope the review
 * queue lists — never on any request whose id they learn.
 */
let ctx;
const u = {};
let n = 900;

const make = async (role, extra = {}) => {
  n += 1;
  const user = await ctx.createUser({ role, name: `${role} ${n}`, employeeId: `ODS-${role}-${n}`, ...extra });
  return { u: user, ...(await ctx.loginWeb(user)) };
};
const student = async (extra) => {
  n += 1;
  return make('student', { rollNo: `ODS${n}`, ...extra });
};

const newRequest = async (who, offset, overrides = {}) => {
  const res = await ctx.request('POST', '/attendance/od-leave', {
    token: who.token,
    body: {
      requestType: 'leave',
      category: 'Medical / Sick Leave',
      fromDate: dayKey(addDays(today(), offset)),
      toDate: dayKey(addDays(today(), offset)),
      description: 'Doctor appointment in the morning.',
      ...overrides,
    },
  });
  return res;
};
const review = (who, id, action, reason) =>
  ctx.request('PATCH', `/attendance/od-leave/${id}/review`, { token: who.token, body: { action, ...(reason ? { reason } : {}) } });

before(async () => {
  ctx = await startServer();
  u.facultyCseA = await make('faculty', { department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5 });
  u.facultyCseB = await make('faculty', { department: 'CSE', section: 'B', inChargeYear: 3, inChargeSemester: 5 });
  u.facultyCseA2 = await make('faculty', { department: 'CSE', section: 'A', inChargeYear: 2, inChargeSemester: 3 });
  u.facultyEce = await make('faculty', { department: 'ECE', section: 'A' });
  u.hodCse = await make('hod', { department: 'CSE' });
  u.hodEce = await make('hod', { department: 'ECE' });
  u.hodFirstYear = await make('hod', { department: FIRST_YEAR_HOD_DEPT });
  u.studentCseA3 = await student({ department: 'CSE', section: 'A', year: 3, semester: 5 });
  u.studentFirstYear = await student({ department: 'CSE', section: 'A', year: 1, semester: 1 });
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('faculty outside the class cannot forward or reject the request (another section, year or department)', async () => {
  const created = await newRequest(u.studentCseA3, 10);
  assert.equal(created.status, 201);
  const id = created.body._id;

  for (const outsider of [u.facultyCseB, u.facultyCseA2, u.facultyEce]) {
    const fwd = await review(outsider, id, 'forward');
    assert.equal(fwd.status, 403, 'an out-of-scope faculty must not forward');
    const rej = await review(outsider, id, 'reject', 'Not my student');
    assert.equal(rej.status, 403, 'an out-of-scope faculty must not reject');
  }
  const { ODLeaveRequest } = ctx.models;
  assert.equal((await ODLeaveRequest.findById(id)).status, 'pending_faculty');

  // ...and the queue never lists it for them either.
  for (const outsider of [u.facultyCseB, u.facultyCseA2, u.facultyEce]) {
    const list = await ctx.request('GET', '/attendance/od-leave/reviews', { token: outsider.token });
    assert.equal(list.status, 200);
    assert.ok(!list.body.requests.some((r) => r._id === id), 'out-of-scope faculty must not see the request');
  }

  // The class in-charge can.
  const ok = await review(u.facultyCseA, id, 'forward');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'pending_hod');
});

test('an HOD can review only their own department (and only the first-year HOD reviews first years)', async () => {
  const created = await newRequest(u.studentCseA3, 11);
  const id = created.body._id;
  assert.equal((await review(u.facultyCseA, id, 'forward')).status, 200);

  assert.equal((await review(u.hodEce, id, 'forward')).status, 403, 'another department HOD must not forward');
  assert.equal((await review(u.hodEce, id, 'reject', 'Nope')).status, 403);
  assert.equal((await review(u.hodFirstYear, id, 'forward')).status, 403, 'the first-year HOD must not act on a 3rd-year request');
  const ok = await review(u.hodCse, id, 'forward');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'pending_principal');

  // A first-year request goes to the first-year HOD, never the branch HOD.
  const first = await newRequest(u.studentFirstYear, 12);
  const { ODLeaveRequest } = ctx.models;
  await ODLeaveRequest.updateOne({ _id: first.body._id }, { status: 'pending_hod' });
  assert.equal((await review(u.hodCse, first.body._id, 'forward')).status, 403);
  assert.equal((await review(u.hodFirstYear, first.body._id, 'forward')).status, 200);
});

test('the first-year HOD is notified when a first-year request is forwarded', async () => {
  const { ODLeaveRequest, Notification } = ctx.models;
  const created = await newRequest(u.studentFirstYear, 13);
  // No faculty is in charge of this first-year class in this fixture: move it on directly.
  await ODLeaveRequest.updateOne({ _id: created.body._id }, { status: 'pending_faculty' });
  const fy = await make('faculty', { department: 'CSE', section: 'A', inChargeYear: 1, inChargeSemester: 1 });
  const before = await Notification.countDocuments({ user: u.hodFirstYear.u._id });
  assert.equal((await review(fy, created.body._id, 'forward')).status, 200);
  const afterCount = await Notification.countDocuments({ user: u.hodFirstYear.u._id });
  assert.equal(afterCount, before + 1, 'the Science & Humanities HOD must be notified');
});

test('a student with no class on file is refused instead of being filed under Section A / Year 1', async () => {
  const noClass = await student({ department: 'CSE', year: 3, semester: 5 });
  await ctx.models.User.updateOne({ _id: noClass.u._id }, { $unset: { section: 1 } });
  const res = await newRequest(noClass, 40);
  assert.equal(res.status, 422);
  assert.equal(await ctx.models.ODLeaveRequest.countDocuments({ student: noClass.u._id }), 0);
});

test('create rejects unsafe or malformed input instead of storing it', async () => {
  const bad = [
    { document: { url: 'javascript:alert(1)', name: 'x.pdf' }, requestType: 'od' },
    { document: { url: '/uploads/../../etc/passwd', name: 'x.pdf' }, requestType: 'od' },
    { requestType: 'vacation' },
    { category: { $gt: '' } },
    { description: ['an', 'array'] },
    { fromDate: 'not-a-date', toDate: 'not-a-date' },
  ];
  for (const [i, overrides] of bad.entries()) {
    const res = await newRequest(u.studentCseA3, 20 + i, overrides);
    assert.equal(res.status, 422, `case ${i} must be rejected: ${JSON.stringify(overrides)}`);
  }

  // Unknown document fields are never stored.
  const ok = await newRequest(u.studentCseA3, 30, {
    requestType: 'od',
    category: 'Paper Presentation',
    document: { url: 'https://example.com/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', owner: 'admin', $where: '1' },
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(Object.keys(ok.body.document).sort(), ['mimeType', 'name', 'url']);
});
