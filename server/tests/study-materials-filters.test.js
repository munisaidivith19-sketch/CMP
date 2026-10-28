import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let ctx;
let student, faculty;

before(async () => {
  ctx = await startServer();
  const s = await ctx.createUser({ name: 'Sem Five', department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'SF1' });
  const f = await ctx.createUser({ role: 'faculty', name: 'Dr. Filter', department: 'CSE', employeeId: 'E-FILT' });
  student = { u: s, ...(await ctx.loginWeb(s)) };
  faculty = { u: f, ...(await ctx.loginWeb(f)) };

  const subj = (code, semester, department = 'CSE') => ctx.models.Subject.create({ name: `Subject ${code}`, code, department, semester, sections: ['A'] });
  const [s2, s5, s6, ece5] = await Promise.all([subj('CS201', 2), subj('CS501', 5), subj('CS601', 6), subj('EC501', 5, 'ECE')]);
  const mat = (subject, category, department = 'CSE') => ({
    title: `${subject.code} ${category}`, category, department, section: 'A', semester: subject.semester,
    subject: subject._id, subjectName: subject.name, subjectCode: subject.code, file: { url: '/uploads/x.pdf' }, uploadedBy: f._id,
  });
  await ctx.models.StudyMaterial.create([mat(s2, 'notes'), mat(s5, 'question_bank'), mat(s5, 'notes'), mat(s6, 'notes'), mat(ece5, 'syllabus', 'ECE')]);
});
after(async () => {
  await ctx.stop();
});

const titles = (res) => res.body.items.map((m) => m.title).sort();

test('a student sees every semester up to their current one, never a later one or another department', async () => {
  const res = await ctx.request('GET', '/study-materials', { token: student.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(titles(res), ['CS201 notes', 'CS501 notes', 'CS501 question_bank']);
});

test('a student can narrow by semester, subject and category, but not past their own semester', async () => {
  assert.deepEqual(titles(await ctx.request('GET', '/study-materials?semester=2', { token: student.token })), ['CS201 notes']);
  assert.deepEqual(titles(await ctx.request('GET', '/study-materials?semester=5&category=notes', { token: student.token })), ['CS501 notes']);
  assert.deepEqual(titles(await ctx.request('GET', '/study-materials?semester=6', { token: student.token })), []);
});

test('the filters endpoint offers only what the user can read', async () => {
  const res = await ctx.request('GET', '/study-materials/filters', { token: student.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.currentSemester, 5);
  assert.deepEqual(res.body.semesters, [2, 5]);
  assert.deepEqual(res.body.categories, ['notes', 'question_bank']);
  assert.deepEqual(res.body.subjects.map((s) => s.code), ['CS201', 'CS501']);

  const staff = await ctx.request('GET', '/study-materials/filters', { token: faculty.token });
  assert.equal(staff.status, 200);
  assert.deepEqual(staff.body.semesters, [2, 5, 6]);
  assert.equal(staff.body.currentSemester, null);
});
