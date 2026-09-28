import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let admin, principal, hodCse, hodEce, facC, facMulti, otherFacCse, facEce;
let stuC1, stuA1, stuB1, stuEce, stuC2OtherYear;

before(async () => {
  ctx = await startServer();
  const mk = (o) => ctx.createUser(o);
  const [a, p, hc, he, fc, fm, fo, fe, sc, sa, sb, se, sc2] = await Promise.all([
    mk({ role: 'admin', name: 'Admin' }),
    mk({ role: 'principal', name: 'Principal', employeeId: 'E-PR' }),
    mk({ role: 'hod', name: 'HOD CSE', department: 'CSE', employeeId: 'E-HOD-CSE' }),
    mk({ role: 'hod', name: 'HOD ECE', department: 'ECE', employeeId: 'E-HOD-ECE' }),
    mk({ role: 'faculty', name: 'Fac C', department: 'CSE', section: 'C', employeeId: 'E-C' }),
    mk({ role: 'faculty', name: 'Fac Multi', department: 'CSE', section: 'D', employeeId: 'E-MULTI' }),
    mk({ role: 'faculty', name: 'Fac Other CSE', department: 'CSE', section: 'A', employeeId: 'E-A' }),
    mk({ role: 'faculty', name: 'Fac ECE', department: 'ECE', section: 'A', employeeId: 'E-ECE' }),
    mk({ name: 'Stu C1', department: 'CSE', section: 'C', year: 3, rollNo: 'C1' }),
    mk({ name: 'Stu A1', department: 'CSE', section: 'A', rollNo: 'A1' }),
    mk({ name: 'Stu B1', department: 'CSE', section: 'B', rollNo: 'B1' }),
    mk({ name: 'Stu ECE1', department: 'ECE', section: 'A', rollNo: 'E1' }),
    // Same department + section letter, but a different year — the classic
    // ambiguity ("CSE-C" exists in more than one year) the scope must resolve.
    mk({ name: 'Stu C Other Year', department: 'CSE', section: 'C', year: 2, rollNo: 'C2' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  principal = { u: p, ...(await ctx.loginWeb(p)) };
  hodCse = { u: hc, ...(await ctx.loginWeb(hc)) };
  hodEce = { u: he, ...(await ctx.loginWeb(he)) };
  facC = { u: fc, ...(await ctx.loginWeb(fc)) };
  facMulti = { u: fm, ...(await ctx.loginWeb(fm)) };
  otherFacCse = { u: fo, ...(await ctx.loginWeb(fo)) };
  facEce = { u: fe, ...(await ctx.loginWeb(fe)) };
  stuC1 = { u: sc, ...(await ctx.loginWeb(sc)) };
  stuA1 = { u: sa, ...(await ctx.loginWeb(sa)) };
  stuB1 = { u: sb, ...(await ctx.loginWeb(sb)) };
  stuEce = { u: se, ...(await ctx.loginWeb(se)) };
  stuC2OtherYear = { u: sc2, ...(await ctx.loginWeb(sc2)) };

  // Fac Multi is class in-charge of section D but also teaches section A per
  // the timetable — the scope must be the union, not just User.section.
  const subject = await ctx.models.Subject.create({ name: 'DBMS', code: 'CS900', department: 'CSE', semester: 5, faculty: [fm._id], sections: ['A', 'D'] });
  await ctx.models.TimetableSlot.create({
    subject: subject._id, faculty: fm._id, section: 'A', department: 'CSE',
    dayOfWeek: 'monday', period: 1, startTime: '09:00', endTime: '10:00', semester: 5,
  });

  // Establishes that CSE-C maps to year 3 college-wide (taught by someone
  // else) — Fac C has no timetable row of their own for section C, so their
  // class-in-charge fallback must resolve the year from this instead.
  const subjectC = await ctx.models.Subject.create({ name: 'OS', code: 'CS901', department: 'CSE', semester: 5, year: 3, faculty: [fo._id], sections: ['C'] });
  await ctx.models.TimetableSlot.create({
    subject: subjectC._id, faculty: fo._id, section: 'C', department: 'CSE', year: 3,
    dayOfWeek: 'tuesday', period: 1, startTime: '09:00', endTime: '10:00', semester: 5,
  });
});
after(async () => {
  await ctx.stop();
});

// ── Student: no directory access ───────────────────────────────────

test('student cannot access the People directory API or search, but can still open an individual profile', async () => {
  const list = await ctx.request('GET', '/users', { token: stuC1.token });
  assert.equal(list.status, 403);

  const search = await ctx.request('GET', '/search?q=Stu&type=users', { token: stuC1.token });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.users, []);

  // Decision: single-profile lookups (used by chat/discussions/clubs links)
  // stay open to students — only directory browsing/search is blocked.
  const profile = await ctx.request('GET', `/users/${stuA1.u._id}`, { token: stuC1.token });
  assert.equal(profile.status, 200);

  // The chat "start a new conversation" picker uses the same endpoint with
  // context=picker and must keep working for students.
  const picker = await ctx.request('GET', '/users?context=picker&limit=5', { token: stuC1.token });
  assert.equal(picker.status, 200);
});

// ── Faculty: assigned section(s) only ──────────────────────────────

test('faculty sees only their assigned section(s), never other sections/departments, and cannot bypass via query params', async () => {
  const mine = await ctx.request('GET', '/users?role=student', { token: facC.token });
  assert.equal(mine.status, 200);
  const names = mine.body.items.map((u) => u.name);
  assert.ok(names.includes('Stu C1'));
  assert.ok(!names.includes('Stu A1') && !names.includes('Stu B1') && !names.includes('Stu ECE1'));

  // Query-parameter manipulation must not escape the authorized scope —
  // asking for another department just intersects with the scope to nothing,
  // it never widens it.
  const bypass = await ctx.request('GET', '/users?role=student&department=ECE', { token: facC.token });
  assert.equal(bypass.status, 200);
  assert.equal(bypass.body.items.length, 0, 'faculty must not see ECE students by requesting that department');

  // The People list is a class roster for faculty: no other faculty appear
  // at all, even from the same department.
  const facultyView = await ctx.request('GET', '/users?role=faculty', { token: facC.token });
  assert.equal(facultyView.body.items.length, 0);
  const unfiltered = await ctx.request('GET', '/users', { token: facC.token });
  assert.ok(unfiltered.body.items.every((u) => u.role === 'student' || u.role === 'club_admin'));

  // Opening another faculty member's profile directly is still allowed
  // (existing allowed scope — contextual links elsewhere in the app).
  const facProfile = await ctx.request('GET', `/users/${otherFacCse.u._id}`, { token: facC.token });
  assert.equal(facProfile.status, 200);
});

test('faculty class-in-charge fallback resolves the section’s year and excludes a same-letter section from a different year', async () => {
  const res = await ctx.request('GET', '/users?role=student', { token: facC.token });
  const names = res.body.items.map((u) => u.name);
  assert.ok(names.includes('Stu C1'), 'CSE-C, year 3 — the resolved year');
  assert.ok(!names.includes('Stu C Other Year'), 'CSE-C, year 2 — must not leak across years');
});

test('faculty teaching multiple sections (timetable, not just class in-charge) sees the union', async () => {
  const res = await ctx.request('GET', '/users?role=student', { token: facMulti.token });
  const names = res.body.items.map((u) => u.name);
  assert.ok(names.includes('Stu A1'), 'taught via timetable');
  assert.ok(!names.includes('Stu C1') && !names.includes('Stu B1') && !names.includes('Stu ECE1'));
});

test('faculty cannot search or open a profile outside their assigned section', async () => {
  const search = await ctx.request('GET', '/search?q=Stu+A1&type=users', { token: facC.token });
  assert.ok(!search.body.users.some((u) => u.name === 'Stu A1'), 'out-of-scope student must never appear in search results');

  const forbidden = await ctx.request('GET', `/users/${stuA1.u._id}`, { token: facC.token });
  assert.equal(forbidden.status, 403);

  const allowed = await ctx.request('GET', `/users/${stuC1.u._id}`, { token: facC.token });
  assert.equal(allowed.status, 200);
});

// ── HOD: own department only ────────────────────────────────────────

test('HOD sees only their own department (students and faculty), cannot bypass via query params, cannot open other departments’ profiles', async () => {
  const mine = await ctx.request('GET', '/users', { token: hodCse.token });
  const names = mine.body.items.map((u) => u.name);
  assert.ok(names.includes('Stu C1') && names.includes('Fac Other CSE'));
  assert.ok(!names.includes('Stu ECE1') && !names.includes('Fac ECE'));

  const bypass = await ctx.request('GET', '/users?department=ECE', { token: hodCse.token });
  assert.equal(bypass.body.items.length, 0);

  const forbiddenStudent = await ctx.request('GET', `/users/${stuEce.u._id}`, { token: hodCse.token });
  assert.equal(forbiddenStudent.status, 403);
  const forbiddenFaculty = await ctx.request('GET', `/users/${facEce.u._id}`, { token: hodCse.token });
  assert.equal(forbiddenFaculty.status, 403);

  const ok = await ctx.request('GET', `/users/${stuC1.u._id}`, { token: hodCse.token });
  assert.equal(ok.status, 200);

  const otherHod = await ctx.request('GET', '/users', { token: hodEce.token });
  const eceNames = otherHod.body.items.map((u) => u.name);
  assert.ok(eceNames.includes('Fac ECE') && eceNames.includes('Stu ECE1'));
  assert.ok(!eceNames.includes('Fac Other CSE') && !eceNames.includes('Stu C1'));
});

// ── Principal: campus-wide ──────────────────────────────────────────

test('principal has unrestricted, campus-wide visibility and search', async () => {
  const list = await ctx.request('GET', '/users', { token: principal.token });
  const names = list.body.items.map((u) => u.name);
  assert.ok(['Stu C1', 'Stu A1', 'Stu B1', 'Stu ECE1'].every((n) => names.includes(n)));

  const profile = await ctx.request('GET', `/users/${stuEce.u._id}`, { token: principal.token });
  assert.equal(profile.status, 200);

  const search = await ctx.request('GET', '/search?q=Stu&type=users', { token: principal.token });
  assert.ok(search.body.users.length > 0);
});

// ── Admin: existing access preserved ────────────────────────────────

test('admin retains full existing People access', async () => {
  const list = await ctx.request('GET', '/users', { token: admin.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 8);

  const profile = await ctx.request('GET', `/users/${stuEce.u._id}`, { token: admin.token });
  assert.equal(profile.status, 200);
});

// ── Pagination / count leakage ──────────────────────────────────────

test('pagination totals reflect only the authorized scope, applied before pagination', async () => {
  const res = await ctx.request('GET', '/users?role=student&limit=1', { token: facC.token });
  assert.equal(res.status, 200);
  // Only Stu C1 is in facC's authorized scope, however small the page size.
  assert.equal(res.body.total, 1);
});
