/**
 * Alumni Network — end-to-end feature flows over the HTTP API:
 * import → invite → claim, profile + privacy + verification, directory,
 * jobs + applications, events + RSVP + waitlist, chapters, mentorship
 * (requests, slots, sessions, notes, rating, messaging).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, hodCse, hodEce, faculty, student, student2, alumni, alumniUnverified;
const later = (days) => new Date(Date.now() + days * 86400000).toISOString();

async function makeAlumni(ctxRef, over = {}, profile = {}) {
  const u = await ctxRef.createUser({ role: 'alumni', department: 'CSE', ...over });
  await ctxRef.models.AlumniProfile.create({ user: u._id, gradYear: 2020, company: 'Acme', designation: 'Engineer', location: 'Chennai', isVerified: true, mentorshipAvailable: true, maxActiveMentees: 2, domains: ['software_engineering'], ...profile });
  return { u, ...(await ctxRef.loginWeb(u)) };
}

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  [admin, hodCse, hodEce, faculty, student, student2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'A-HC' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'A-HE' }),
    mk({ role: 'faculty', name: 'Faculty', department: 'CSE', employeeId: 'A-F' }),
    mk({ name: 'Student One', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'S1' }),
    mk({ name: 'Student Two', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'S2' }),
  ]);
  alumni = await makeAlumni(ctx, { name: 'Alumna Verified', email: 'alumna@alumni.test', phone: '9000000001' });
  alumniUnverified = await makeAlumni(ctx, { name: 'Alumnus Pending' }, { isVerified: false });
});
after(async () => {
  await ctx.stop();
});

// ── Import → invite → claim ────────────────────────────────────────

test('Import: an HOD previews a CSV, invalid / other-department / existing rows are flagged, commit creates invites', async () => {
  const csv = [
    'name,email,department,gradYear,company',
    'Ravi Kumar,ravi.kumar@alumni.test,CSE,2019,Zoho',
    'Bad Row,not-an-email,CSE,2019,X',
    'Other Dept,other@alumni.test,ECE,2018,Y',
    `Existing,${student.u.email},CSE,2020,Z`,
  ].join('\n');
  const preview = await ctx.request('POST', '/alumni/import/preview', { token: hodCse.token, body: { csv } });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  const states = Object.fromEntries(preview.body.rows.map((r) => [r.name, r.state]));
  assert.deepEqual(states, { 'Ravi Kumar': 'valid', 'Bad Row': 'invalid', 'Other Dept': 'invalid', Existing: 'exists' });

  assert.equal((await ctx.request('POST', '/alumni/import/preview', { token: student.token, body: { csv } })).status, 403);

  const commit = await ctx.request('POST', `/alumni/import/${preview.body._id}/commit`, { token: hodCse.token, body: { sendEmails: false } });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.invitesCreated, 1);
  assert.equal((await ctx.request('POST', `/alumni/import/${preview.body._id}/commit`, { token: hodCse.token, body: {} })).status, 409, 'no double commit');

  const token = /token=([a-f0-9]+)/.exec(commit.body.downloadLinksCsv)[1];
  const info = await ctx.request('GET', `/auth/alumni-claim/${token}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.email, 'ravi.kumar@alumni.test');

  const claim = await ctx.request('POST', `/auth/alumni-claim/${token}`, { body: { password: 'Alumni123', accept: true } });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.user.role, 'alumni');
  assert.ok(claim.body.accessToken);
  assert.equal(claim.body.user.password, undefined, 'no password hash in the response');

  assert.equal((await ctx.request('GET', `/auth/alumni-claim/${token}`)).status, 404, 'a claimed link is spent');
  assert.equal((await ctx.request('GET', '/auth/alumni-claim/deadbeef')).status, 404);

  const login = await ctx.request('POST', '/auth/login', { body: { email: 'ravi.kumar@alumni.test', password: 'Alumni123' } });
  assert.equal(login.status, 200, 'the claimed account can sign in');
});

// ── Profile, privacy, verification, directory ──────────────────────

test('Profile: an alumnus edits their profile; privacy hides fields from students', async () => {
  const put = await ctx.request('PUT', '/alumni/me', {
    token: alumni.token,
    body: { headline: 'Backend engineer', privacy: { email: 'hidden', company: 'staff' } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const asStudent = await ctx.request('GET', `/alumni/${alumni.u._id}`, { token: student.token });
  assert.equal(asStudent.status, 200);
  assert.equal(asStudent.body.user.email, undefined, 'email hidden');
  assert.equal(asStudent.body.user.phone, undefined, 'phone hidden by default');
  assert.equal(asStudent.body.company, undefined, 'company is staff-only now');
  assert.equal(asStudent.body.privacy, undefined, 'privacy settings not exposed');

  const asHod = await ctx.request('GET', `/alumni/${alumni.u._id}`, { token: hodCse.token });
  assert.equal(asHod.body.company, 'Acme', 'staff of the same department see staff-level fields');
  await ctx.request('PUT', '/alumni/me', { token: alumni.token, body: { privacy: { email: 'mentees', company: 'public' } } });
});

test('Verification: unverified profiles are hidden; an HOD verifies their own department only', async () => {
  assert.equal((await ctx.request('GET', `/alumni/${alumniUnverified.u._id}`, { token: student.token })).status, 404);
  const dir = await ctx.request('GET', '/alumni', { token: student.token });
  assert.ok(!dir.body.items.some((p) => p.user.name === 'Alumnus Pending'), 'not in the directory');

  const queue = await ctx.request('GET', '/alumni?unverified=true', { token: hodCse.token });
  assert.ok(queue.body.items.some((p) => p.user.name === 'Alumnus Pending'));
  const profile = await ctx.models.AlumniProfile.findOne({ user: alumniUnverified.u._id }).lean();

  assert.equal((await ctx.request('PATCH', `/alumni/${profile._id}/verify`, { token: hodEce.token })).status, 403, 'another department’s HOD');
  assert.equal((await ctx.request('PATCH', `/alumni/${profile._id}/verify`, { token: student.token })).status, 403);
  assert.equal((await ctx.request('PATCH', `/alumni/${profile._id}/verify`, { token: hodCse.token })).status, 200);
  assert.equal((await ctx.request('GET', `/alumni/${alumniUnverified.u._id}`, { token: student.token })).status, 200, 'visible once verified');
});

// ── Jobs ───────────────────────────────────────────────────────────

const jobBody = (over = {}) => ({
  title: 'Backend Intern', company: 'Acme', location: 'Chennai', type: 'internship', workMode: 'hybrid',
  description: 'Build APIs with Node.js and MongoDB for our platform team.', applyMode: 'referral', deadline: later(20), ...over,
});

test('Jobs: a verified alumnus posts, a student applies once, the poster manages applications', async () => {
  const unverified = await makeAlumni(ctx, { name: 'Never Verified' }, { isVerified: false });
  assert.equal((await ctx.request('POST', '/alumni/jobs', { token: unverified.token, body: jobBody() })).status, 403, 'unverified alumni cannot post');
  assert.equal((await ctx.request('POST', '/alumni/jobs', { token: student.token, body: jobBody() })).status, 403, 'students cannot post');

  const job = await ctx.request('POST', '/alumni/jobs', { token: alumni.token, body: jobBody() });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  const id = job.body._id;
  assert.ok((await ctx.request('GET', '/alumni/jobs', { token: student.token })).body.items.some((j) => j._id === id));

  const apply = await ctx.request('POST', `/alumni/jobs/${id}/apply`, { token: student.token, body: { note: 'Interested', referralRequested: true } });
  assert.equal(apply.status, 201, JSON.stringify(apply.body));
  assert.equal((await ctx.request('POST', `/alumni/jobs/${id}/apply`, { token: student.token, body: {} })).status, 409, 'no duplicate application');

  assert.equal((await ctx.request('GET', `/alumni/jobs/${id}/applications`, { token: student2.token })).status, 403, 'only the poster / staff');
  const apps = await ctx.request('GET', `/alumni/jobs/${id}/applications`, { token: alumni.token });
  assert.equal(apps.body.items.length, 1);

  const upd = await ctx.request('PATCH', `/alumni/job-applications/${apply.body._id}`, { token: alumni.token, body: { status: 'shortlisted' } });
  assert.equal(upd.status, 200);
  assert.equal((await ctx.request('PATCH', `/alumni/job-applications/${apply.body._id}`, { token: student2.token, body: { status: 'rejected' } })).status, 403);

  assert.equal((await ctx.request('PATCH', `/alumni/jobs/${id}`, { token: student2.token, body: { title: 'Hijack' } })).status, 403);
  assert.equal((await ctx.request('PATCH', `/alumni/job-applications/${apply.body._id}/withdraw`, { token: student.token })).status, 200);
});

// ── Events ─────────────────────────────────────────────────────────

const eventBody = (over = {}) => ({
  title: 'Alumni Tech Talk', type: 'guest_talk', mode: 'online', startsAt: later(5), endsAt: later(5.1),
  description: 'A talk about building a career in backend engineering.', meetingLink: 'https://meet.example.com/talk', capacity: 1, ...over,
});

test('Events: an alumnus proposes an event, an HOD approves it, RSVP fills then waitlists', async () => {
  const proposed = await ctx.request('POST', '/alumni/events', { token: alumni.token, body: eventBody() });
  assert.equal(proposed.status, 201, `proposing an event must not crash: ${JSON.stringify(proposed.body)}`);
  const id = proposed.body._id;
  assert.equal(proposed.body.status, 'pending_approval');

  assert.equal((await ctx.request('POST', `/alumni/events/${id}/rsvp`, { token: student.token })).status, 400, 'no RSVP before approval');
  assert.equal((await ctx.request('POST', `/alumni/events/${id}/approve`, { token: student.token })).status, 403);
  assert.equal((await ctx.request('POST', `/alumni/events/${id}/approve`, { token: hodCse.token })).status, 200);

  const first = await ctx.request('POST', `/alumni/events/${id}/rsvp`, { token: student.token });
  assert.equal(first.body.status, 'going');
  const second = await ctx.request('POST', `/alumni/events/${id}/rsvp`, { token: student2.token });
  assert.equal(second.body.status, 'waitlisted', 'capacity 1');

  const seen = await ctx.request('GET', `/alumni/events/${id}`, { token: student2.token });
  assert.equal(seen.body.meetingLink, undefined, 'meeting link only for those going');
  assert.equal((await ctx.request('GET', `/alumni/events/${id}`, { token: student.token })).body.meetingLink, 'https://meet.example.com/talk');

  assert.equal((await ctx.request('DELETE', `/alumni/events/${id}/rsvp`, { token: student.token })).status, 200);
  const promoted = await ctx.models.AlumniEventRsvp.findOne({ event: id, user: student2.u._id }).lean();
  assert.equal(promoted.status, 'going', 'the waitlist moves up');

  assert.equal((await ctx.request('GET', `/alumni/events/${id}/attendees`, { token: student.token })).status, 403);
  assert.equal((await ctx.request('GET', `/alumni/events/${id}/attendees`, { token: alumni.token })).status, 200);
});

// ── Chapters ───────────────────────────────────────────────────────

test('Chapters: staff create, alumni join and post, students read only, moderators remove members', async () => {
  const ch = await ctx.request('POST', '/alumni/chapters', { token: admin.token, body: { name: 'Chennai Alumni', type: 'city', city: 'Chennai', description: 'Alumni living in Chennai.' } });
  assert.equal(ch.status, 201, JSON.stringify(ch.body));
  const slug = ch.body.slug;
  assert.equal((await ctx.request('POST', '/alumni/chapters', { token: alumni.token, body: { name: 'Nope', type: 'city', description: 'Not allowed here.' } })).status, 403);

  assert.equal((await ctx.request('POST', `/alumni/chapters/${slug}/join`, { token: alumni.token })).status, 201);
  assert.equal((await ctx.request('POST', `/alumni/chapters/${slug}/join`, { token: student.token })).status, 403, 'students are read-only');
  const post = await ctx.request('POST', `/alumni/chapters/${slug}/posts`, { token: alumni.token, body: { body: 'Meetup this Saturday!' } });
  assert.equal(post.status, 201);
  assert.equal((await ctx.request('POST', `/alumni/chapters/${slug}/posts`, { token: student.token, body: { body: 'hi' } })).status, 403);
  assert.ok((await ctx.request('GET', `/alumni/chapters/${slug}/posts`, { token: student.token })).body.items.length >= 1);

  // The admin (creator) is the moderator and removes the alumnus.
  const removed = await ctx.request('PATCH', `/alumni/chapters/${slug}/members/${alumni.u._id}`, { token: admin.token, body: { status: 'removed' } });
  assert.equal(removed.status, 200, `a moderator can remove a member: ${JSON.stringify(removed.body)}`);
  assert.equal((await ctx.request('POST', `/alumni/chapters/${slug}/posts`, { token: alumni.token, body: { body: 'still here?' } })).status, 403, 'removed members cannot post');
});

// ── Mentorship ─────────────────────────────────────────────────────

test('Mentorship: request → accept → slot → booked session → notes → complete → rate', async () => {
  const reqRes = await ctx.request('POST', '/mentorship-requests', { token: student.token, body: { alumni: String(alumni.u._id), domain: 'software_engineering', message: 'Guidance on backend careers' } });
  assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
  const id = reqRes.body._id;
  assert.equal((await ctx.request('POST', '/mentorship-requests', { token: student.token, body: { alumni: String(alumni.u._id), domain: 'software_engineering', message: 'Again please' } })).status, 409);

  assert.equal((await ctx.request('PATCH', `/mentorship-requests/${id}/respond`, { token: alumniUnverified.token, body: { status: 'accepted' } })).status, 409, 'not their request');
  const acc = await ctx.request('PATCH', `/mentorship-requests/${id}/respond`, { token: alumni.token, body: { status: 'accepted' } });
  assert.equal(acc.body.status, 'accepted');
  assert.equal((await ctx.models.AlumniProfile.findOne({ user: alumni.u._id }).lean()).activeMenteeCount, 1);

  const slots = await ctx.request('POST', '/mentorship/slots', { token: alumni.token, body: { slots: [{ startsAt: later(3), durationMin: 30, mode: 'video', meetingLink: 'https://meet.example.com/mentor' }] } });
  assert.equal(slots.status, 201);
  const booked = await ctx.request('POST', '/mentorship/sessions', { token: student.token, body: { request: id, slot: slots.body[0]._id, agenda: 'Resume review' } });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));

  await ctx.request('PATCH', `/mentorship/sessions/${booked.body._id}/notes`, { token: alumni.token, body: { sharedNotes: 'Work on DSA', alumniPrivateNotes: 'Needs confidence' } });
  const asStudent = await ctx.request('GET', `/mentorship-requests/${id}`, { token: student.token });
  assert.equal(asStudent.status, 200);
  assert.equal(asStudent.body.sessions[0].sharedNotes, 'Work on DSA');
  assert.equal(asStudent.body.sessions[0].alumniPrivateNotes, undefined, 'the alumnus’s private notes never reach the student');
  const listed = await ctx.request('GET', '/mentorship/sessions', { token: student.token });
  assert.ok(listed.body.every((s) => s.alumniPrivateNotes === undefined));

  assert.equal((await ctx.request('GET', `/mentorship-requests/${id}`, { token: student2.token })).status, 403, 'not a participant');

  assert.equal((await ctx.request('PATCH', `/mentorship-requests/${id}/complete`, { token: alumni.token })).status, 200);
  const rated = await ctx.request('PATCH', `/mentorship-requests/${id}/rate`, { token: student.token, body: { rating: 5, review: 'Very helpful' } });
  assert.equal(rated.status, 200);
  assert.equal((await ctx.models.AlumniProfile.findOne({ user: alumni.u._id }).lean()).ratingAvg, 5);
});

test('Mentorship: "Message mentor" opens one working chat between mentor and mentee', async () => {
  const reqRes = await ctx.request('POST', '/mentorship-requests', { token: student2.token, body: { alumni: String(alumni.u._id), domain: 'software_engineering', message: 'Please mentor me' } });
  await ctx.request('PATCH', `/mentorship-requests/${reqRes.body._id}/respond`, { token: alumni.token, body: { status: 'accepted' } });

  const first = await ctx.request('POST', `/mentorship/requests/${reqRes.body._id}/message`, { token: student2.token });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await ctx.request('POST', `/mentorship/requests/${reqRes.body._id}/message`, { token: alumni.token });
  assert.equal(String(again.body.conversationId), String(first.body.conversationId), 'the same conversation, not a new one each time');

  const id = first.body.conversationId;
  const send = await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: student2.token, body: { body: 'Hello mentor' } });
  assert.equal(send.status, 201, `the mentee can write: ${JSON.stringify(send.body)}`);
  const reply = await ctx.request('POST', `/chat/conversations/${id}/messages`, { token: alumni.token, body: { body: 'Hi!' } });
  assert.equal(reply.status, 201, `the mentor can reply: ${JSON.stringify(reply.body)}`);

  // Without an accepted mentorship there is no chat.
  assert.equal((await ctx.request('POST', '/chat/conversations', { token: student.token, body: { participantIds: [String(alumniUnverified.u._id)] } })).status, 403);
});
