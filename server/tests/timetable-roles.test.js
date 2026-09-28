import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, nextEvent, noEvent } from './helpers.js';

let ctx;
let admin, hodCse, hodEce, faculty, warden, security, student;
let subjectCse, subjectEce;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, hc, he, f, w, sec, s] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD-CSE' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HOD-ECE' }),
    mk({ role: 'faculty', name: 'Faculty', department: 'CSE', employeeId: 'E-FAC' }),
    mk({ role: 'warden', name: 'Warden', employeeId: 'E-WD' }),
    mk({ role: 'security', name: 'Security', employeeId: 'E-SEC' }),
    mk({ name: 'Student', department: 'CSE', section: 'A', semester: 5, rollNo: '01' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  hodCse = { u: hc, ...(await ctx.loginWeb(hc)) };
  hodEce = { u: he, ...(await ctx.loginWeb(he)) };
  faculty = { u: f, ...(await ctx.loginWeb(f)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  security = { u: sec, ...(await ctx.loginWeb(sec)) };
  student = { u: s, ...(await ctx.loginWeb(s)) };

  subjectCse = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS600', department: 'CSE', semester: 5, faculty: [f._id], sections: ['A'] });
  subjectEce = await ctx.models.Subject.create({ name: 'Signals', code: 'EC600', department: 'ECE', semester: 5, faculty: [], sections: ['A'] });
});
after(async () => {
  await ctx.stop();
});

const slot = (over = {}) => ({
  subject: String(subjectCse._id),
  faculty: String(faculty.u._id),
  section: 'A',
  department: 'CSE',
  dayOfWeek: 'monday',
  period: 1,
  startTime: '09:00',
  endTime: '09:50',
  semester: 5,
  ...over,
});

// ── Warden / Security: zero timetable access ────────────────────────

test('warden and security get 403 on every timetable/subject endpoint', async () => {
  for (const actor of [warden, security]) {
    assert.equal((await ctx.request('GET', '/timetable', { token: actor.token })).status, 403);
    assert.equal((await ctx.request('GET', '/timetable/current', { token: actor.token })).status, 403);
    assert.equal((await ctx.request('GET', '/timetable/section/A', { token: actor.token })).status, 403);
    assert.equal((await ctx.request('GET', `/timetable/faculty/${faculty.u._id}`, { token: actor.token })).status, 403);
    assert.equal((await ctx.request('GET', '/subjects', { token: actor.token })).status, 403);
    assert.equal((await ctx.request('POST', '/timetable', { token: actor.token, body: slot() })).status, 403);
    assert.equal((await ctx.request('POST', '/subjects', { token: actor.token, body: {} })).status, 403);
  }
});

test('warden and security never receive timetable:updated socket events', async () => {
  const wSock = await ctx.connect(warden.token);
  const secSock = await ctx.connect(security.token);
  const staffSock = await ctx.connect(admin.token);

  const staffGotIt = nextEvent(staffSock, 'timetable:updated');
  const created = await ctx.request('POST', '/timetable', { token: admin.token, body: slot() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await staffGotIt;

  assert.ok(await noEvent(wSock, 'timetable:updated'), 'warden must not receive timetable events');
  assert.ok(await noEvent(secSock, 'timetable:updated'), 'security must not receive timetable events');
});

// ── HOD: department-scoped write access ─────────────────────────────

test('HOD can create/edit/delete timetable slots and subjects in their own department only', async () => {
  const ownSubject = await ctx.request('POST', '/subjects', {
    token: hodCse.token,
    body: { name: 'OS', code: 'CS700', department: 'ECE', semester: 5, faculty: [String(faculty.u._id)] },
  });
  assert.equal(ownSubject.status, 201, JSON.stringify(ownSubject.body));
  // The department is always forced to the HOD's own, whatever the client sent.
  assert.equal(ownSubject.body.department, 'CSE');

  // Asking to create a slot "in ECE" (department spoofed) is forced back to
  // CSE server-side — the CSE subject/faculty pairing then still has to check
  // out, so this succeeds as a perfectly ordinary CSE slot, not an ECE one.
  const spoofed = await ctx.request('POST', '/timetable', {
    token: hodCse.token,
    body: slot({ department: 'ECE', period: 2, startTime: '10:00', endTime: '10:50' }),
  });
  assert.equal(spoofed.status, 201, JSON.stringify(spoofed.body));
  assert.equal(spoofed.body.department, 'CSE');

  const createdSlot = await ctx.request('POST', '/timetable', { token: hodCse.token, body: slot({ period: 3, startTime: '11:00', endTime: '11:50' }) });
  assert.equal(createdSlot.status, 201, JSON.stringify(createdSlot.body));
  assert.equal(createdSlot.body.department, 'CSE');

  const updated = await ctx.request('PUT', `/timetable/${createdSlot.body._id}`, { token: hodCse.token, body: { room: 'LH-5' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.room, 'LH-5');

  // A different department's HOD is rejected outright — on a still-active slot.
  const foreignEdit = await ctx.request('PUT', `/timetable/${createdSlot.body._id}`, { token: hodEce.token, body: { room: 'LH-9' } });
  assert.equal(foreignEdit.status, 403);
  const foreignDeleteSlot = await ctx.request('DELETE', `/timetable/${createdSlot.body._id}`, { token: hodEce.token });
  assert.equal(foreignDeleteSlot.status, 403);

  const deleted = await ctx.request('DELETE', `/timetable/${createdSlot.body._id}`, { token: hodCse.token });
  assert.equal(deleted.status, 200);
  const foreignSubjectEdit = await ctx.request('PUT', `/subjects/${ownSubject.body._id}`, { token: hodEce.token, body: { name: 'Renamed' } });
  assert.equal(foreignSubjectEdit.status, 403);
  const foreignDelete = await ctx.request('DELETE', `/subjects/${ownSubject.body._id}`, { token: hodEce.token });
  assert.equal(foreignDelete.status, 403);

  // Faculty and students still have no write access at all.
  assert.equal((await ctx.request('POST', '/timetable', { token: faculty.token, body: slot({ period: 4 }) })).status, 403);
  assert.equal((await ctx.request('POST', '/timetable', { token: student.token, body: slot({ period: 4 }) })).status, 403);
});

// ── Add period: subject catalogue + college-wide faculty ────────────

test('subject catalogue syncs into real Subject records, idempotently, without overwriting edits', async () => {
  const { syncSubjects } = await import('../src/utils/syncSubjects.js');
  const added = await syncSubjects();
  assert.ok(added > 0);
  const sem1 = await ctx.request('GET', '/subjects?department=CSE&semester=1', { token: hodCse.token });
  assert.ok(sem1.body.some((s) => s.code === 'MA101'), 'first-year subjects exist for CSE semester 1');

  await ctx.models.Subject.updateOne({ code: 'MA101', department: 'CSE', semester: 1 }, { name: 'Renamed by admin' });
  assert.equal(await syncSubjects(), 0, 'second run adds nothing');
  const kept = await ctx.models.Subject.findOne({ code: 'MA101', department: 'CSE', semester: 1 }).lean();
  assert.equal(kept.name, 'Renamed by admin', 'sync never overwrites existing subjects');
});

test('faculty picker lists every active faculty college-wide with only name + department', async () => {
  const res = await ctx.request('GET', '/timetable/faculty-options', { token: hodCse.token });
  assert.equal(res.status, 200);
  const eceFac = await ctx.createUser({ role: 'faculty', name: 'Priya ECE', department: 'ECE', employeeId: 'E-PRIYA' });
  const again = await ctx.request('GET', '/timetable/faculty-options', { token: hodCse.token });
  const priya = again.body.find((f) => f.name === 'Priya ECE');
  assert.ok(priya, 'another department’s faculty is listed for a CSE HOD');
  assert.deepEqual(Object.keys(priya).sort(), ['_id', 'department', 'name']);
  assert.equal((await ctx.request('GET', '/timetable/faculty-options', { token: faculty.token })).status, 403);
  assert.equal((await ctx.request('GET', '/timetable/faculty-options', { token: warden.token })).status, 403);

  // CSE HOD schedules the ECE faculty member; it shows on that faculty's own timetable.
  const created = await ctx.request('POST', '/timetable', {
    token: hodCse.token,
    body: slot({ faculty: String(eceFac._id), dayOfWeek: 'friday', period: 6, startTime: '14:00', endTime: '14:50' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const priyaLogin = await ctx.loginWeb(eceFac);
  const mine = await ctx.request('GET', '/timetable', { token: priyaLogin.token });
  assert.ok(mine.body.slots.some((s) => String(s._id) === String(created.body._id) && s.department === 'CSE' && s.section === 'A'));
  const cseStudent = await ctx.request('GET', '/timetable', { token: student.token });
  assert.ok(cseStudent.body.slots.some((s) => String(s._id) === String(created.body._id)), 'the class’s students see it too');
});

test('admin retains full college-wide write access', async () => {
  const ok = await ctx.request('POST', '/subjects', {
    token: admin.token,
    body: { name: 'Signals II', code: 'EC700', department: 'ECE', semester: 5, faculty: [] },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
