import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
const users = {};
let eventByHodCse;
let eventByPrincipal;

before(async () => {
  ctx = await startServer();

  let empIdx = 800;
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
  users.admin = await make('admin');
  users.hodCse = await make('hod', { department: 'CSE' });
  users.hodEce = await make('hod', { department: 'ECE' });
  users.facCoord = await make('faculty', { department: 'ECE', designation: 'Assistant Professor' });
  users.facOther = await make('faculty', { department: 'MECH', designation: 'Associate Professor' });
  users.dean = await make('dean');

  const s = await ctx.createUser({
    role: 'student',
    name: 'Student Tester',
    rollNo: '22CS999',
    department: 'CSE',
    year: 3,
    section: 'A',
  });
  users.student = { u: s, ...(await ctx.loginWeb(s)) };
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('GET /events/faculty-coordinators returns all active faculties across departments', async () => {
  const res = await ctx.request('GET', '/events/faculty-coordinators', {
    token: users.hodCse.token,
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  const ids = res.body.map((f) => String(f._id));
  assert.ok(ids.includes(String(users.facCoord.u._id)));
  assert.ok(ids.includes(String(users.facOther.u._id)));

  // Forbidden for student
  const studentRes = await ctx.request('GET', '/events/faculty-coordinators', {
    token: users.student.token,
  });
  assert.equal(studentRes.status, 403);
});

test('POST /events allows HOD and Principal, but blocks Faculty and Student', async () => {
  const futureStart = new Date(Date.now() + 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 90000000).toISOString();

  // 1. Faculty attempt -> 403
  const facRes = await ctx.request('POST', '/events', {
    token: users.facOther.token,
    body: {
      title: 'Faculty Workshop Attempt',
      description: 'This event should be rejected for faculty.',
      venue: 'Lab 1',
      startDate: futureStart,
      endDate: futureEnd,
    },
  });
  assert.equal(facRes.status, 403);

  // 2. Student attempt -> 403
  const studRes = await ctx.request('POST', '/events', {
    token: users.student.token,
    body: {
      title: 'Student Hackathon Attempt',
      description: 'This event should be rejected for students.',
      venue: 'Auditorium',
      startDate: futureStart,
      endDate: futureEnd,
    },
  });
  assert.equal(studRes.status, 403);

  // 3. HOD CSE creates an event with assigned faculty coordinator
  const hodRes = await ctx.request('POST', '/events', {
    token: users.hodCse.token,
    body: {
      title: 'Cyber Security Symposium',
      description: 'Hands on cybersecurity tools and ethical hacking.',
      venue: 'Incubation Centre',
      startDate: futureStart,
      endDate: futureEnd,
      facultyCoordinators: [users.facCoord.u._id],
    },
  });
  assert.equal(hodRes.status, 201, JSON.stringify(hodRes.body));
  eventByHodCse = hodRes.body;
  assert.equal(eventByHodCse.title, 'Cyber Security Symposium');

  // 4. Principal creates college-wide event
  const prinRes = await ctx.request('POST', '/events', {
    token: users.principal.token,
    body: {
      title: 'Annual Tech Fest 2026',
      description: 'Flagship intra-college technical festival.',
      venue: 'Main Auditorium',
      startDate: futureStart,
      endDate: futureEnd,
      facultyCoordinators: [users.facCoord.u._id, users.facOther.u._id],
    },
  });
  assert.equal(prinRes.status, 201);
  eventByPrincipal = prinRes.body;
});

test('GET /events/:id populates faculty coordinators and permission flags', async () => {
  // Viewed by assigned Faculty Coordinator
  const coordView = await ctx.request('GET', `/events/${eventByHodCse._id}`, {
    token: users.facCoord.token,
  });
  assert.equal(coordView.status, 200);
  assert.equal(coordView.body.canEdit, false);
  assert.equal(coordView.body.canMarkAttendance, true);
  assert.equal(coordView.body.canViewParticipants, true);
  assert.equal(coordView.body.facultyCoordinators.length, 1);
  assert.equal(String(coordView.body.facultyCoordinators[0]._id), String(users.facCoord.u._id));

  // Viewed by Posting HOD
  const hodView = await ctx.request('GET', `/events/${eventByHodCse._id}`, {
    token: users.hodCse.token,
  });
  assert.equal(hodView.body.canEdit, true);
  assert.equal(hodView.body.canMarkAttendance, true);
  assert.equal(hodView.body.canViewParticipants, true);

  // Viewed by Other Department HOD (HOD ECE)
  const otherHodView = await ctx.request('GET', `/events/${eventByHodCse._id}`, {
    token: users.hodEce.token,
  });
  assert.equal(otherHodView.body.canEdit, false);
  assert.equal(otherHodView.body.canMarkAttendance, false);
  assert.equal(otherHodView.body.canViewParticipants, true);

  // Viewed by Principal
  const prinView = await ctx.request('GET', `/events/${eventByHodCse._id}`, {
    token: users.principal.token,
  });
  assert.equal(prinView.body.canEdit, true);
  assert.equal(prinView.body.canMarkAttendance, false); // Strictly restricted to posting HOD & coordinators
  assert.equal(prinView.body.canViewParticipants, true);

  // Viewed by Student
  const studView = await ctx.request('GET', `/events/${eventByHodCse._id}`, {
    token: users.student.token,
  });
  assert.equal(studView.body.canEdit, false);
  assert.equal(studView.body.canMarkAttendance, false);
  assert.equal(studView.body.canViewParticipants, false);
});

test('GET /events/:id/participants is visible to all faculty and authorities, hidden from students', async () => {
  // Student registers
  await ctx.request('POST', `/events/${eventByHodCse._id}/register`, {
    token: users.student.token,
  });

  // 1. All faculty can view participants
  const facRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants`, {
    token: users.facOther.token,
  });
  assert.equal(facRes.status, 200);
  assert.equal(facRes.body.length, 1);
  assert.equal(String(facRes.body[0].user._id), String(users.student.u._id));

  // 2. Other HOD can view participants
  const otherHodRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants`, {
    token: users.hodEce.token,
  });
  assert.equal(otherHodRes.status, 200);

  // 3. Dean / Higher authorities can view participants
  const deanRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants`, {
    token: users.dean.token,
  });
  assert.equal(deanRes.status, 200);

  // 4. Student gets 403 Forbidden
  const studRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants`, {
    token: users.student.token,
  });
  assert.equal(studRes.status, 403);
});

test('PUT /events/:id is only permitted for Principal, Admin, and the HOD who posted', async () => {
  // 1. Other department HOD (HOD ECE) attempts to edit -> 403
  const otherHodRes = await ctx.request('PUT', `/events/${eventByHodCse._id}`, {
    token: users.hodEce.token,
    body: { title: 'Hijacked Event Title' },
  });
  assert.equal(otherHodRes.status, 403);

  // 2. Assigned faculty coordinator attempts to edit -> 403
  const coordRes = await ctx.request('PUT', `/events/${eventByHodCse._id}`, {
    token: users.facCoord.token,
    body: { title: 'Coordinator Edit Title' },
  });
  assert.equal(coordRes.status, 403);

  // 3. Posting HOD updates event
  const hodRes = await ctx.request('PUT', `/events/${eventByHodCse._id}`, {
    token: users.hodCse.token,
    body: { title: 'Cyber Security Hands-on 2026' },
  });
  assert.equal(hodRes.status, 200);
  assert.equal(hodRes.body.title, 'Cyber Security Hands-on 2026');

  // 4. Principal updates event
  const prinRes = await ctx.request('PUT', `/events/${eventByHodCse._id}`, {
    token: users.principal.token,
    body: { venue: 'Main Seminar Hall B' },
  });
  assert.equal(prinRes.status, 200);
  assert.equal(prinRes.body.venue, 'Main Seminar Hall B');
});

test('PATCH /events/:id/attendance/:userId is restricted strictly to posting HOD and Faculty Coordinator', async () => {
  const studentId = users.student.u._id;

  // 1. Other faculty attempts to mark attendance -> 403
  const otherFacRes = await ctx.request('PATCH', `/events/${eventByHodCse._id}/attendance/${studentId}`, {
    token: users.facOther.token,
    body: { attended: true },
  });
  assert.equal(otherFacRes.status, 403);

  // 2. Other HOD attempts to mark attendance -> 403
  const otherHodRes = await ctx.request('PATCH', `/events/${eventByHodCse._id}/attendance/${studentId}`, {
    token: users.hodEce.token,
    body: { attended: true },
  });
  assert.equal(otherHodRes.status, 403);

  // 3. Principal attempts to mark attendance -> 403 (per user choice: strictly restricted to coordinator & posting HOD)
  const prinRes = await ctx.request('PATCH', `/events/${eventByHodCse._id}/attendance/${studentId}`, {
    token: users.principal.token,
    body: { attended: true },
  });
  assert.equal(prinRes.status, 403);

  // 4. Assigned Faculty Coordinator marks attendance -> 200 OK
  const coordRes = await ctx.request('PATCH', `/events/${eventByHodCse._id}/attendance/${studentId}`, {
    token: users.facCoord.token,
    body: { attended: true },
  });
  assert.equal(coordRes.status, 200);
  assert.equal(coordRes.body.status, 'attended');

  // 5. Posting HOD toggles attendance -> 200 OK
  const hodRes = await ctx.request('PATCH', `/events/${eventByHodCse._id}/attendance/${studentId}`, {
    token: users.hodCse.token,
    body: { attended: false },
  });
  assert.equal(hodRes.status, 200);
  assert.equal(hodRes.body.status, 'registered');
});

test('GET /events/:id/participants-pdf generates official PDF with college logo', async () => {
  // 1. Student attempt -> 403 Forbidden
  const studRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants-pdf`, {
    token: users.student.token,
  });
  assert.equal(studRes.status, 403);

  // 2. Faculty / Coordinator / HOD / Principal download PDF -> 200 OK
  const hodRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants-pdf`, {
    token: users.hodCse.token,
  });
  assert.equal(hodRes.status, 200);
  assert.equal(hodRes.headers.get('content-type'), 'application/pdf');
  assert.ok(hodRes.headers.get('content-disposition').includes('Event_Participants_'));
  assert.ok(typeof hodRes.body === 'string' && hodRes.body.startsWith('%PDF-1.4'));

  // 3. Assigned Faculty Coordinator can also download PDF
  const coordRes = await ctx.request('GET', `/events/${eventByHodCse._id}/participants-pdf`, {
    token: users.facCoord.token,
  });
  assert.equal(coordRes.status, 200);
  assert.equal(coordRes.headers.get('content-type'), 'application/pdf');
  assert.ok(typeof coordRes.body === 'string' && coordRes.body.startsWith('%PDF-1.4'));
});
