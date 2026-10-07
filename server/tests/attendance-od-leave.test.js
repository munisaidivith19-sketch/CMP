import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { clock } from '../src/utils/clock.js';
import { addDays, campusParts, dayKey, toDay, today } from '../src/utils/dates.js';
import { checkODLeaveCutoff } from '../src/controllers/odLeaveController.js';

let ctx;
const users = {};
let studentCse, facultyCse, hodCse, principal;
let subjectCse, sessionToday;

before(async () => {
  ctx = await startServer();

  let empIdx = 200;
  const make = async (role, extra = {}) => {
    empIdx += 1;
    const u = await ctx.createUser({
      role,
      name: `${role} user ${empIdx}`,
      employeeId: extra.employeeId || `EMP-${role}-${empIdx}`,
      ...extra,
    });
    return { u, ...(await ctx.loginWeb(u)) };
  };

  users.principal = await make('principal');
  users.hodCse = await make('hod', { department: 'CSE' });
  users.facultyCse = await make('faculty', { department: 'CSE', section: 'A' });

  studentCse = await ctx.createUser({
    role: 'student',
    name: 'Gautham CSE',
    rollNo: '22CS001',
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
  });
  users.studentCse = { u: studentCse, ...(await ctx.loginWeb(studentCse)) };

  // Create a CSE subject and timetable slot
  const { Subject, TimetableSlot, AttendanceSession, AttendanceRecord } = ctx.models;
  subjectCse = await Subject.create({
    code: 'CS501',
    name: 'Distributed Systems',
    department: 'CSE',
    year: 3,
    semester: 5,
    sections: ['A'],
    faculty: [users.facultyCse.u._id],
    isActive: true,
  });

  const slot = await TimetableSlot.create({
    subject: subjectCse._id,
    faculty: users.facultyCse.u._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    dayOfWeek: campusParts(clock.now()).weekday,
    period: 1,
    startTime: '09:00',
    endTime: '10:00',
    room: 'CS-101',
    isActive: true,
  });

  // Create held session for today
  sessionToday = await AttendanceSession.create({
    timetableSlot: slot._id,
    date: today(),
    period: 1,
    startTime: '09:00',
    endTime: '10:00',
    subject: subjectCse._id,
    subjectName: subjectCse.name,
    subjectCode: subjectCse.code,
    faculty: users.facultyCse.u._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    room: 'CS-101',
    createdBy: users.facultyCse.u._id,
  });
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('1. Cut-off Rule: checkODLeaveCutoff validation unit tests', () => {
  // Scenario A: Request for tomorrow at 2:00 PM (14:00) today -> ALLOWED
  const simNowBefore5 = new Date('2026-10-07T14:00:00+05:30');
  const simTomorrow = new Date('2026-10-08T00:00:00+05:30');
  const res1 = checkODLeaveCutoff(simTomorrow, simNowBefore5);
  assert.equal(res1.allowed, true);

  // Scenario B: Request for tomorrow at 5:05 PM (17:05) today -> REFUSED
  const simNowAfter5 = new Date('2026-10-07T17:05:00+05:30');
  const res2 = checkODLeaveCutoff(simTomorrow, simNowAfter5);
  assert.equal(res2.allowed, false);
  assert.match(res2.reason, /5:00 PM/);

  // Scenario C: Request for same day -> REFUSED
  const res3 = checkODLeaveCutoff(simNowBefore5, simNowBefore5);
  assert.equal(res3.allowed, false);

  // Scenario D: Request for 3 days in future at any time -> ALLOWED
  const simFuture = new Date('2026-10-10T00:00:00+05:30');
  const res4 = checkODLeaveCutoff(simFuture, simNowAfter5);
  assert.equal(res4.allowed, true);
});

test('2. Student creates OD request with compulsory supporting document validation', async () => {
  const futureStart = dayKey(addDays(today(), 3));
  const futureEnd = dayKey(addDays(today(), 4));

  // Scenario A: Missing document -> 422 Unprocessable Entity
  const failRes = await ctx.request('POST', '/attendance/od-leave', {
    token: users.studentCse.token,
    body: {
      requestType: 'od',
      category: 'Paper Presentation',
      fromDate: futureStart,
      toDate: futureEnd,
      description: 'Presenting research paper at IEEE International Conference.',
    },
  });
  assert.equal(failRes.status, 422);
  assert.match(failRes.body.message, /Supporting document is compulsory/);

  // Scenario B: With document -> 201 Created
  const res = await ctx.request('POST', '/attendance/od-leave', {
    token: users.studentCse.token,
    body: {
      requestType: 'od',
      category: 'Paper Presentation',
      fromDate: futureStart,
      toDate: futureEnd,
      description: 'Presenting research paper at IEEE International Conference.',
      document: { url: 'https://example.com/invitation.pdf', name: 'invitation.pdf' },
    },
  });

  assert.equal(res.status, 201);
  const body = res.body;
  assert.equal(body.requestType, 'od');
  assert.equal(body.status, 'pending_faculty');
  assert.equal(body.daysCount, 2);
  assert.equal(body.department, 'CSE');
  assert.equal(body.document.url, 'https://example.com/invitation.pdf');
});

test('3. 3-Tier Approval Workflow: Faculty -> HOD -> Principal', async () => {
  const futureStart = dayKey(addDays(today(), 5));
  const futureEnd = dayKey(addDays(today(), 5));

  // Step 1: Student submits request (with compulsory document)
  const createRes = await ctx.request('POST', '/attendance/od-leave', {
    token: users.studentCse.token,
    body: {
      requestType: 'od',
      category: 'Technical Symposium',
      fromDate: futureStart,
      toDate: futureEnd,
      description: 'Participating in state-level coding competition.',
      document: { url: 'https://example.com/symposium_ticket.pdf', name: 'ticket.pdf' },
    },
  });
  assert.equal(createRes.status, 201);
  const created = createRes.body;
  assert.equal(created.status, 'pending_faculty');

  // Step 2: Faculty reviews and forwards to HOD
  const fwdFacultyRes = await ctx.request('PATCH', `/attendance/od-leave/${created._id}/review`, {
    token: users.facultyCse.token,
    body: { action: 'forward', reason: 'Verified registration credentials.' },
  });
  assert.equal(fwdFacultyRes.status, 200);
  const fwdFaculty = fwdFacultyRes.body;
  assert.equal(fwdFaculty.status, 'pending_hod');
  assert.equal(fwdFaculty.facultyReview.action, 'forwarded');

  // Step 3: HOD reviews and forwards to Principal
  const fwdHodRes = await ctx.request('PATCH', `/attendance/od-leave/${created._id}/review`, {
    token: users.hodCse.token,
    body: { action: 'forward', reason: 'Recommended by HOD CSE.' },
  });
  assert.equal(fwdHodRes.status, 200);
  const fwdHod = fwdHodRes.body;
  assert.equal(fwdHod.status, 'pending_principal');
  assert.equal(fwdHod.hodReview.action, 'forwarded');

  // Step 4: Principal grants final approval
  const appPrincipalRes = await ctx.request('PATCH', `/attendance/od-leave/${created._id}/review`, {
    token: users.principal.token,
    body: { action: 'approve', reason: 'Approved by Principal.' },
  });
  assert.equal(appPrincipalRes.status, 200);
  const appPrincipal = appPrincipalRes.body;
  assert.equal(appPrincipal.status, 'approved');
  assert.equal(appPrincipal.principalReview.action, 'approved');
});

test('4. Period Roster: Approved OD automatically sets status="od", lockedStatus=true, badge="OD"', async () => {
  const targetDay = addDays(today(), 6);
  const targetDayKey = dayKey(targetDay);

  // Create an approved OD directly for targetDay
  const { ODLeaveRequest } = ctx.models;
  await ODLeaveRequest.create({
    student: studentCse._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    requestType: 'od',
    category: 'Sports Meet',
    fromDate: targetDay,
    toDate: targetDay,
    daysCount: 1,
    description: 'Inter-college badminton championship.',
    status: 'approved',
  });

  // Query roster for faculty
  const rosterRes = await ctx.request(
    'GET',
    `/attendance/roster?subjectId=${subjectCse._id}&section=A&date=${targetDayKey}&period=1`,
    { token: users.facultyCse.token }
  );
  assert.equal(rosterRes.status, 200);
  const roster = rosterRes.body;

  const studentRow = roster.students.find((s) => String(s._id) === String(studentCse._id));
  assert.ok(studentRow, 'Student should be in roster');
  assert.equal(studentRow.status, 'od', 'Status should be defaulted to od');
  assert.equal(studentRow.lockedStatus, true, 'Student should be locked from accidental absence');
  assert.equal(studentRow.badge, 'OD', 'Student should have OD badge');
});

test('5. Period Roster: Approved Leave sets badge="Approved Leave"', async () => {
  const leaveDay = addDays(today(), 7);
  const leaveDayKey = dayKey(leaveDay);

  const { ODLeaveRequest } = ctx.models;
  await ODLeaveRequest.create({
    student: studentCse._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    requestType: 'leave',
    category: 'Medical / Sick Leave',
    fromDate: leaveDay,
    toDate: leaveDay,
    daysCount: 1,
    description: 'Doctor consultation and rest.',
    status: 'approved',
  });

  const rosterRes = await ctx.request(
    'GET',
    `/attendance/roster?subjectId=${subjectCse._id}&section=A&date=${leaveDayKey}&period=1`,
    { token: users.facultyCse.token }
  );
  assert.equal(rosterRes.status, 200);
  const roster = rosterRes.body;

  const studentRow = roster.students.find((s) => String(s._id) === String(studentCse._id));
  assert.ok(studentRow);
  assert.equal(studentRow.status, 'absent', 'Status should default to absent for approved leave');
  assert.equal(studentRow.badge, 'Approved Leave');
});

test('6. Retroactive Reconciliation: Principal approval converts existing Absent to OD (Present credit)', async () => {
  const { AttendanceRecord, ODLeaveRequest } = ctx.models;

  // Mark student absent for today's session
  const rec = await AttendanceRecord.findOneAndUpdate(
    { student: studentCse._id, subject: subjectCse._id, date: today(), period: 1 },
    {
      $set: {
        student: studentCse._id,
        subject: subjectCse._id,
        date: today(),
        period: 1,
        status: 'absent',
        department: 'CSE',
        section: 'A',
        session: sessionToday._id,
        markedBy: users.facultyCse.u._id,
        markedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  assert.equal(rec.status, 'absent');

  // Verify dashboard stats before approval: percentage is 0%
  const summaryBefore = await ctx.request('GET', '/attendance/my', {
    token: users.studentCse.token,
  });
  assert.equal(summaryBefore.status, 200);
  const bData = summaryBefore.body;
  assert.equal(bData.overall.presentPeriods, 0);
  assert.equal(bData.overall.absentPeriods, 1);

  // Student had a pending OD request for today (e.g. forward chain reached Principal)
  const req = await ODLeaveRequest.create({
    student: studentCse._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    requestType: 'od',
    category: 'Symposium',
    fromDate: today(),
    toDate: today(),
    daysCount: 1,
    description: 'Attending symposium today.',
    status: 'pending_principal',
  });

  // Principal approves
  const approveRes = await ctx.request('PATCH', `/attendance/od-leave/${req._id}/review`, {
    token: users.principal.token,
    body: { action: 'approve', reason: 'Approved retroactively.' },
  });
  assert.equal(approveRes.status, 200);

  // Verify AttendanceRecord retroactively converted to 'od'
  const updatedRec = await AttendanceRecord.findById(rec._id);
  assert.equal(updatedRec.status, 'od');
  assert.ok(updatedRec.history.some((h) => h.from === 'absent' && h.to === 'od'));

  // Verify student dashboard now awards 100% Present attendance credit
  const summaryAfter = await ctx.request('GET', '/attendance/my', {
    token: users.studentCse.token,
  });
  assert.equal(summaryAfter.status, 200);
  const aData = summaryAfter.body;
  assert.equal(aData.overall.presentPeriods, 1, 'OD counts as present');
  assert.equal(aData.overall.absentPeriods, 0, 'No longer absent');
  assert.equal(aData.overall.odPeriods, 1, 'OD periods tracked separately');
  assert.equal(aData.overall.percentage, 100, 'Attendance percentage is 100%');
});

test('7. Student cancellation succeeds for pending request', async () => {
  const futureStart = dayKey(addDays(today(), 10));
  const futureEnd = dayKey(addDays(today(), 10));

  const createRes = await ctx.request('POST', '/attendance/od-leave', {
    token: users.studentCse.token,
    body: {
      requestType: 'leave',
      category: 'Personal / Family Reason',
      fromDate: futureStart,
      toDate: futureEnd,
      description: 'Family function.',
    },
  });
  assert.equal(createRes.status, 201);
  const created = createRes.body;

  const cancelRes = await ctx.request('PATCH', `/attendance/od-leave/${created._id}/cancel`, {
    token: users.studentCse.token,
  });
  assert.equal(cancelRes.status, 200);
  const cancelled = cancelRes.body;
  assert.equal(cancelled.request.status, 'cancelled');
});

test('8. Student cancels approved OD request at any time -> Reverts attendance to Absent and updates stats', async () => {
  const { AttendanceRecord, ODLeaveRequest } = ctx.models;

  // Student has an approved OD request for today (from test 6)
  const approvedOdReq = await ODLeaveRequest.findOne({
    student: studentCse._id,
    requestType: 'od',
    status: 'approved',
    fromDate: today(),
  });
  assert.ok(approvedOdReq, 'Should have an approved OD request from previous test');

  // Verify attendance record currently has status 'od'
  const recBefore = await AttendanceRecord.findOne({ student: studentCse._id, date: today(), period: 1 });
  assert.equal(recBefore.status, 'od');

  // Student cancels this approved OD request
  const cancelRes = await ctx.request('PATCH', `/attendance/od-leave/${approvedOdReq._id}/cancel`, {
    token: users.studentCse.token,
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.body.request.status, 'cancelled');

  // Verify attendance record retroactively reverted back to 'absent'
  const recAfter = await AttendanceRecord.findById(recBefore._id);
  assert.equal(recAfter.status, 'absent', 'Attendance status should revert from od to absent');
  assert.ok(recAfter.history.some((h) => h.from === 'od' && h.to === 'absent'));

  // Verify student dashboard now reflects 0% attendance credit
  const summaryReverted = await ctx.request('GET', '/attendance/my', {
    token: users.studentCse.token,
  });
  assert.equal(summaryReverted.status, 200);
  const revData = summaryReverted.body;
  assert.equal(revData.overall.presentPeriods, 0, 'No longer present');
  assert.equal(revData.overall.absentPeriods, 1, 'Marked absent again');
  assert.equal(revData.overall.odPeriods, 0, 'Zero OD periods');
  assert.equal(revData.overall.percentage, 0, 'Percentage drops back to 0%');

  // Verify notifications sent to Class In-Charge, HOD, and Principal
  const { Notification } = ctx.models;
  const notifs = await Notification.find({
    title: 'OD Request Cancelled by Student',
    user: { $in: [users.facultyCse.u._id, users.hodCse.u._id, users.principal.u._id] },
  });
  assert.ok(notifs.length >= 3, 'Notifications must be sent to Class In-Charge, HOD, and Principal');
});

test('9. Approved Leave request cannot be cancelled by student', async () => {
  const { ODLeaveRequest } = ctx.models;
  const leaveDay = addDays(today(), 12);

  // Create an approved leave request
  const leaveReq = await ODLeaveRequest.create({
    student: studentCse._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    requestType: 'leave',
    category: 'Medical / Sick Leave',
    fromDate: leaveDay,
    toDate: leaveDay,
    daysCount: 1,
    description: 'Fever and rest.',
    status: 'approved',
  });

  // Attempt cancellation on approved leave -> should fail with 422
  const cancelRes = await ctx.request('PATCH', `/attendance/od-leave/${leaveReq._id}/cancel`, {
    token: users.studentCse.token,
  });
  assert.equal(cancelRes.status, 422);
  assert.match(cancelRes.body.message, /Approved Leave requests cannot be cancelled/);
});

