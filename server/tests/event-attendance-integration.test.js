import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { campusParts, dayKey } from '../src/utils/dates.js';
import { clock } from '../src/utils/clock.js';

let ctx;
const users = {};
let studentCse;
let subjectCse;
let timetableSlot;
let testEvent;

// Class attendance can only be marked during its period, so the tests run at a
// fixed time inside today's 09:00–10:00 slot instead of whenever the suite runs.
const realNow = clock.now;

before(async () => {
  const todayKey = campusParts(realNow()).dateKey;
  const pinned = new Date(`${todayKey}T09:30:00+05:30`);
  clock.now = () => pinned;
  ctx = await startServer();

  let empIdx = 900;
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

  users.admin = await make('admin');
  users.principal = await make('principal');
  users.hodCse = await make('hod', { department: 'CSE' });
  users.facCoord = await make('faculty', { department: 'ECE', designation: 'Coordinator' });
  // Class In-Charge for CSE Year 3 Section A
  users.classInCharge = await make('faculty', {
    department: 'CSE',
    section: 'A',
    inChargeYear: 3,
    inChargeSemester: 5,
  });

  studentCse = await ctx.createUser({
    role: 'student',
    name: 'Muni Student',
    rollNo: '22CS100',
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
  });
  users.studentCse = { u: studentCse, ...(await ctx.loginWeb(studentCse)) };

  const { Subject, TimetableSlot } = ctx.models;
  subjectCse = await Subject.create({
    code: 'CS301',
    name: 'Cloud Architecture',
    department: 'CSE',
    year: 3,
    semester: 5,
    sections: ['A'],
    faculty: [users.classInCharge.u._id],
    isActive: true,
  });

  const now = clock.now();
  const todayWeekday = campusParts(now).weekday;

  timetableSlot = await TimetableSlot.create({
    subject: subjectCse._id,
    faculty: users.classInCharge.u._id,
    department: 'CSE',
    section: 'A',
    year: 3,
    semester: 5,
    dayOfWeek: todayWeekday,
    period: 1,
    startTime: '09:00',
    endTime: '10:00',
    room: 'CS-Lab-1',
    isActive: true,
  });
});

after(async () => {
  clock.now = realNow;
  if (ctx) await ctx.stop();
});

test('1. Create Workshop Event with assigned Faculty Coordinator', async () => {
  const now = clock.now();
  const startDate = new Date(now);
  startDate.setHours(9, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 1); // 2-day event!
  endDate.setHours(17, 0, 0, 0);

  const res = await ctx.request('POST', '/events', {
    token: users.hodCse.token,
    body: {
      title: 'Full Stack AI Workshop',
      description: 'Hands-on 2-day workshop on modern agentic web development.',
      category: 'workshop',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      venue: 'Main Auditorium',
      facultyCoordinators: [users.facCoord.u._id],
    },
  });

  assert.equal(res.status, 201);
  testEvent = res.body;
  assert.equal(testEvent.category, 'workshop');
  assert.equal(testEvent.facultyCoordinators.length, 1);
});

test('2. Student registers for the workshop event', async () => {
  const res = await ctx.request('POST', `/events/${testEvent._id}/register`, {
    token: users.studentCse.token,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'registered');
});

test('3. Class Attendance getRoster detects event registration and sets "On Workshop" with locked OD status', async () => {
  const now = clock.now();
  const todayStr = dayKey(now);

  const res = await ctx.request('GET', `/attendance/roster?slotId=${timetableSlot._id}&date=${todayStr}`, {
    token: users.classInCharge.token,
  });

  assert.equal(res.status, 200);
  const studentRow = res.body.students.find((s) => String(s._id) === String(studentCse._id));
  assert.ok(studentRow, 'Student should be in class roster');
  assert.equal(studentRow.badge, 'On Workshop', 'Badge must be dynamically "On Workshop"');
  assert.equal(studentRow.status, 'od', 'Status must be defaulted to "od"');
  assert.equal(studentRow.lockedStatus, true, 'Status must be locked to prevent accidental absent mark');
  assert.ok(studentRow.eventInfo, 'Event metadata must be attached');
  assert.equal(studentRow.eventInfo.title, 'Full Stack AI Workshop');
});

test('4. Submitting class attendance preserves OD status for the event participant', async () => {
  const now = clock.now();
  const todayStr = dayKey(now);

  // Even if client attempted to send absent for this student
  const res = await ctx.request('POST', '/attendance/mark', {
    token: users.admin.token,
    body: {
      slotId: timetableSlot._id,
      date: todayStr,
      period: 1,
      records: [
        { student: studentCse._id, status: 'absent' }, // sent absent by mistake
      ],
    },
  });

  assert.equal(res.status, 200);

  const { AttendanceRecord } = ctx.models;
  const record = await AttendanceRecord.findOne({
    student: studentCse._id,
    subject: subjectCse._id,
    period: 1,
  });

  assert.ok(record, 'Attendance record must exist');
  assert.equal(record.status, 'od', 'Event participant must be protected with OD status');
});

test('5. Event Faculty Coordinator marks student as Attended -> records OD and notifies student', async () => {
  const now = clock.now();
  const todayStr = dayKey(now);

  const res = await ctx.request('PATCH', `/events/${testEvent._id}/attendance/${studentCse._id}`, {
    token: users.facCoord.token,
    body: {
      attended: true,
      date: todayStr,
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'attended');
  assert.equal(res.body.attended, true);

  // Verify notification was sent to student
  const { Notification } = ctx.models;
  const notif = await Notification.findOne({
    user: studentCse._id,
    title: 'Event Attendance Marked: Present',
  });
  assert.ok(notif, 'Student should receive attendance marked notification');
  assert.ok(notif.message.includes('Full Stack AI Workshop'));
});

test('6. Multi-day Event: Coordinator marks student Absent on Day 2 -> marks Absent & alerts Class In-Charge', async () => {
  const now = clock.now();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = dayKey(tomorrow);

  const res = await ctx.request('PATCH', `/events/${testEvent._id}/attendance/${studentCse._id}`, {
    token: users.facCoord.token,
    body: {
      attended: false,
      date: tomorrowStr,
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.attended, false);

  // Verify Class In-Charge received absence alert notification
  const { Notification } = ctx.models;
  const cicNotif = await Notification.findOne({
    user: users.classInCharge.u._id,
    title: `Event Absence Alert: ${studentCse.name}`,
  });
  assert.ok(cicNotif, 'Class In-Charge must receive event absence alert notification');
  assert.ok(cicNotif.message.includes('Full Stack AI Workshop'));

  // Verify student received absence notification
  const studentNotif = await Notification.findOne({
    user: studentCse._id,
    title: 'Event Absence: Full Stack AI Workshop',
  });
  assert.ok(studentNotif, 'Student must receive absence notification');
});

test('7. Out-of-schedule date gracefully clamps to event date and marks absent', async () => {
  // Pass a date well beyond the event end date (e.g. +30 days)
  const farFutureDate = new Date();
  farFutureDate.setDate(farFutureDate.getDate() + 30);
  const outOfRangeStr = dayKey(farFutureDate);

  const res = await ctx.request('PATCH', `/events/${testEvent._id}/attendance/${studentCse._id}`, {
    token: users.facCoord.token,
    body: {
      attended: false,
      date: outOfRangeStr,
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.attended, false);
});
