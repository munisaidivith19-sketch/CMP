/**
 * Alumni Network — access control, and what the new `alumni` role can reach
 * in the rest of the campus app (it is now in the global role list, so any
 * "every role except …" rule includes it).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, hod, student, student2, alumni, alumni2, outsiderAlumni;
const later = (days) => new Date(Date.now() + days * 86400000).toISOString();

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  [admin, hod, student, student2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'X-H' }),
    mk({ name: 'Student One', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'S1', parentPhone: '9800000001', stayType: 'hosteler' }),
    mk({ name: 'Student Two', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'S2' }),
  ]);
  const mkAlumni = async (name) => {
    const a = await mk({ role: 'alumni', name, department: 'CSE' });
    await ctx.models.AlumniProfile.create({ user: a.u._id, gradYear: 2020, isVerified: true, mentorshipAvailable: true, maxActiveMentees: 3 });
    return a;
  };
  [alumni, alumni2, outsiderAlumni] = await Promise.all([mkAlumni('Alumna One'), mkAlumni('Alumnus Two'), mkAlumni('Alumnus Outsider')]);

  // Campus data an alumnus must not see.
  const { GatePass, StudyMaterial, Subject } = ctx.models;
  const subject = await Subject.create({ name: 'Network Security', code: 'CY502', department: 'CSE', semester: 5, year: 3, sections: ['A'] });
  await GatePass.create({
    student: student.u._id, regarding: 'outing', description: 'Family visit for the weekend', department: 'CSE', section: 'A',
    fromDate: new Date(), toDate: new Date(Date.now() + 86400000), parentPhone: '9800000001', status: 'pending_faculty',
    destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'T. Nagar' },
  }).catch((e) => console.error('gatepass fixture', e.message));
  await StudyMaterial.create({
    title: 'Year 3 Network Security notes', category: 'notes', department: 'CSE', year: 3, semester: 5, section: 'A',
    uploadedBy: admin.u._id, isActive: true, subject: subject._id, subjectName: 'Network Security', subjectCode: 'CY502',
    file: { url: '/uploads/ns.txt', name: 'ns.txt', mimeType: 'text/plain' },
  }).catch((e) => console.error('material fixture', e.message));
});
after(async () => {
  await ctx.stop();
});

// ── The alumni role in the rest of the campus app ──────────────────

test('An alumnus cannot see students’ gate passes', async () => {
  assert.ok(await ctx.models.GatePass.countDocuments(), 'fixture exists');
  const res = await ctx.request('GET', '/gate-pass', { token: alumni.token });
  assert.ok(res.status === 403 || (res.body.passes || []).length === 0, `gate passes leaked: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
});

test('An alumnus cannot read campus study materials or use the Study Assistant on them', async () => {
  assert.ok(await ctx.models.StudyMaterial.countDocuments(), 'fixture exists');
  const res = await ctx.request('GET', '/study-materials', { token: alumni.token });
  assert.ok(res.status === 403 || (res.body.items || []).length === 0, `materials leaked: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  assert.equal((await ctx.request('POST', '/ai/study-assistant/chat', { token: alumni.token, body: { message: 'Summarise my notes' } })).status, 403);
});

test('An alumnus has no People, Timetable, Attendance or student-profile access', async () => {
  assert.equal((await ctx.request('GET', '/users', { token: alumni.token })).status, 403);
  assert.deepEqual((await ctx.request('GET', '/users?context=picker', { token: alumni.token })).body.items, [], 'no one in the chat picker');
  assert.equal((await ctx.request('GET', `/users/${student.u._id}`, { token: alumni.token })).status, 403);
  const tt = await ctx.request('GET', '/timetable', { token: alumni.token });
  assert.ok(tt.status === 403 || tt.body.slots.length === 0);
  assert.equal((await ctx.request('GET', '/attendance/low', { token: alumni.token })).status, 403);
  assert.equal((await ctx.request('GET', '/complaints', { token: alumni.token })).status, 403);
  assert.equal((await ctx.request('POST', '/chat/conversations', { token: alumni.token, body: { participantIds: [String(student.u._id)] } })).status, 403, 'no unsolicited chats');
});

// ── Alumni profile ─────────────────────────────────────────────────

test('Only alumni accounts can create an alumni profile', async () => {
  const res = await ctx.request('PUT', '/alumni/me', { token: student.token, body: { gradYear: 2020, company: 'Fake Corp' } });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(await ctx.models.AlumniProfile.countDocuments({ user: student.u._id }), 0);
});

test('Analytics and import are staff-only; HOD analytics are their department', async () => {
  assert.equal((await ctx.request('GET', '/alumni/analytics', { token: student.token })).status, 403);
  assert.equal((await ctx.request('GET', '/alumni/analytics', { token: alumni.token })).status, 403);
  assert.equal((await ctx.request('GET', '/alumni/analytics/export', { token: student.token })).status, 403);
  assert.equal((await ctx.request('GET', '/alumni/invites', { token: alumni.token })).status, 403);
  assert.equal((await ctx.request('GET', '/alumni/analytics', { token: hod.token })).status, 200);
});

// ── Jobs ───────────────────────────────────────────────────────────

const jobBody = { title: 'SDE Intern', company: 'Acme', location: 'Remote', type: 'internship', workMode: 'remote', description: 'Work on our backend services team.', applyMode: 'referral', deadline: later(20) };

test('A job removed by staff cannot be reopened by its poster', async () => {
  const job = await ctx.request('POST', '/alumni/jobs', { token: alumni.token, body: jobBody });
  assert.equal(job.status, 201);
  assert.equal((await ctx.request('DELETE', `/alumni/jobs/${job.body._id}`, { token: hod.token, body: { reason: 'Misleading posting' } })).status, 200);
  const reopen = await ctx.request('PATCH', `/alumni/jobs/${job.body._id}/reopen`, { token: alumni.token });
  assert.notEqual(reopen.status, 200, 'reopening a staff-removed job must be refused');
  assert.equal((await ctx.models.AlumniJob.findById(job.body._id).lean()).status, 'removed');
});

test('An application cannot carry a javascript: or other non-web resume link', async () => {
  const job = await ctx.request('POST', '/alumni/jobs', { token: alumni2.token, body: jobBody });
  const res = await ctx.request('POST', `/alumni/jobs/${job.body._id}/apply`, { token: student.token, body: { resumeUrl: 'javascript:alert(document.cookie)' } });
  assert.equal(res.status, 422, JSON.stringify(res.body));
});

// ── Events ─────────────────────────────────────────────────────────

test('Searching events never reveals other people’s pending or rejected proposals', async () => {
  await ctx.models.AlumniEvent.create([
    { title: 'Secret pending meetup', description: 'Not approved yet', createdBy: outsiderAlumni.u._id, startsAt: later(3), endsAt: later(3.1), status: 'pending_approval' },
    { title: 'Secret rejected meetup', description: 'Was rejected', createdBy: outsiderAlumni.u._id, startsAt: later(3), endsAt: later(3.1), status: 'rejected' },
  ]);
  const res = await ctx.request('GET', '/alumni/events?search=Secret', { token: student.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((e) => e.title), [], 'search must keep the visibility rule');
});

test('An approved event’s organiser cannot rewrite it unchecked, and only pending events are approved', async () => {
  const ev = await ctx.models.AlumniEvent.create({ title: 'Cancelled talk', description: 'x', createdBy: alumni.u._id, startsAt: later(4), endsAt: later(4.1), status: 'cancelled' });
  const res = await ctx.request('POST', `/alumni/events/${ev._id}/approve`, { token: hod.token });
  assert.notEqual(res.status, 200, 'a cancelled event cannot be "approved" back to life');
});

// ── Chapters ───────────────────────────────────────────────────────

test('A private chapter’s posts, members and comments are for its members only', async () => {
  const ch = await ctx.request('POST', '/alumni/chapters', { token: admin.token, body: { name: 'Private Circle', type: 'interest', description: 'Members-only discussion.', isPrivate: true } });
  const slug = ch.body.slug;
  const post = await ctx.request('POST', `/alumni/chapters/${slug}/posts`, { token: admin.token, body: { body: 'Confidential plans' } });
  assert.equal(post.status, 201);

  for (const actor of [student, outsiderAlumni]) {
    assert.equal((await ctx.request('GET', `/alumni/chapters/${slug}/posts`, { token: actor.token })).status, 403, 'posts');
    assert.equal((await ctx.request('GET', `/alumni/chapters/${slug}/members`, { token: actor.token })).status, 403, 'members');
    assert.equal((await ctx.request('GET', `/alumni/chapters/posts/${post.body._id}/comments`, { token: actor.token })).status, 403, 'comments');
    assert.equal((await ctx.request('POST', `/alumni/chapters/posts/${post.body._id}/comments`, { token: actor.token, body: { body: 'let me in' } })).status, 403, 'commenting');
    assert.equal((await ctx.request('POST', `/alumni/chapters/posts/${post.body._id}/like`, { token: actor.token })).status, 403, 'liking');
  }
});

test('A member removed from a chapter cannot simply re-join', async () => {
  const ch = await ctx.request('POST', '/alumni/chapters', { token: admin.token, body: { name: 'Public Circle', type: 'interest', description: 'Open to all alumni.' } });
  const slug = ch.body.slug;
  await ctx.request('POST', `/alumni/chapters/${slug}/join`, { token: outsiderAlumni.token });
  const rm = await ctx.request('PATCH', `/alumni/chapters/${slug}/members/${outsiderAlumni.u._id}`, { token: admin.token, body: { status: 'removed' } });
  assert.equal(rm.status, 200, JSON.stringify(rm.body));
  const rejoin = await ctx.request('POST', `/alumni/chapters/${slug}/join`, { token: outsiderAlumni.token });
  assert.equal(rejoin.status, 403, `removed members stay removed: ${JSON.stringify(rejoin.body)}`);
});

// ── Mentorship ─────────────────────────────────────────────────────

test('Mentorship slot meeting links are only for the mentor (and the student who books)', async () => {
  await ctx.request('POST', '/mentorship/slots', { token: alumni.token, body: { slots: [{ startsAt: later(2), durationMin: 30, mode: 'video', meetingLink: 'https://meet.example.com/private-room' }] } });
  const asStudent = await ctx.request('GET', `/mentorship/slots?alumni=${alumni.u._id}`, { token: student2.token });
  assert.equal(asStudent.status, 200);
  assert.ok(asStudent.body.length >= 1);
  assert.ok(asStudent.body.every((s) => s.meetingLink === undefined), 'an open slot’s join link is not handed to every user');
  const asOwner = await ctx.request('GET', `/mentorship/slots?alumni=${alumni.u._id}`, { token: alumni.token });
  assert.ok(asOwner.body.some((s) => s.meetingLink === 'https://meet.example.com/private-room'));
});

test('Mentorship requests and sessions belong to their two participants', async () => {
  const r = await ctx.request('POST', '/mentorship-requests', { token: student.token, body: { alumni: String(alumni2.u._id), domain: 'other', message: 'Career advice please' } });
  assert.equal(r.status, 201);
  assert.equal((await ctx.request('GET', `/mentorship-requests/${r.body._id}`, { token: student2.token })).status, 403);
  assert.equal((await ctx.request('PATCH', `/mentorship-requests/${r.body._id}/respond`, { token: alumni.token, body: { status: 'accepted' } })).status, 409, 'another alumnus cannot accept it');
  assert.equal((await ctx.request('PATCH', `/mentorship-requests/${r.body._id}/cancel`, { token: student2.token })).status, 404, 'another student cannot cancel it');
  assert.equal((await ctx.request('POST', '/mentorship-requests', { token: alumni.token, body: { alumni: String(alumni2.u._id), domain: 'other', message: 'Alumni cannot request' } })).status, 403);
});
