/**
 * Class timetable export (GET /timetable/export?format=pdf|docx): a valid PDF
 * or Word file of exactly the class the viewer may see, with user text escaped.
 * TEST DATA ONLY — synthetic names.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { startServer } from './helpers.js';

let ctx;
let admin;
let student;
let warden;

before(async () => {
  ctx = await startServer();
  const [a, f, s, w] = await Promise.all([
    ctx.createUser({ role: 'admin', name: 'Admin' }),
    ctx.createUser({ role: 'faculty', name: 'Export Faculty', department: 'CSE', employeeId: 'E-EXP' }),
    ctx.createUser({ name: 'Export Student', department: 'CSE', year: 3, section: 'A', semester: 5, rollNo: 'EXP-1' }),
    ctx.createUser({ role: 'warden', name: 'Warden', employeeId: 'W-EXP' }),
  ]);
  admin = { u: a, ...(await ctx.loginWeb(a)) };
  student = { u: s, ...(await ctx.loginWeb(s)) };
  warden = { u: w, ...(await ctx.loginWeb(w)) };
  const subjA = await ctx.models.Subject.create({ name: 'Networks & <Security>', code: 'CS591', department: 'CSE', semester: 5, sections: ['A'] });
  const subjB = await ctx.models.Subject.create({ name: 'Only Section B Subject', code: 'CS592', department: 'CSE', semester: 5, sections: ['B'] });
  const base = { department: 'CSE', semester: 5, startTime: '09:00', endTime: '09:50' };
  for (const [section, subject, day] of [['A', subjA, 'monday'], ['A', subjA, 'tuesday'], ['B', subjB, 'wednesday']]) {
    const r = await ctx.request('POST', '/timetable', { token: admin.token, body: { ...base, section, subject: String(subject._id), faculty: String(f._id), dayOfWeek: day } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
});

after(async () => {
  await ctx.stop();
});

const get = (who, q) =>
  fetch(`${ctx.base}/api/timetable/export?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${who.token}` } });

/** One file out of a ZIP (deflate or stored), read by walking the local headers. */
function unzipEntry(buf, wanted) {
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const name = buf.toString('utf8', o + 30, o + 30 + nameLen);
    const start = o + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    if (name === wanted) return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    o = start + size;
  }
  return null;
}

test('a student downloads their own class as a PDF', async () => {
  const res = await get(student, { format: 'pdf' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="Timetable_CSE.*\.pdf"/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
});

test('Word export is a real .docx with only the viewer\'s class, and text is escaped', async () => {
  // The student asks for section B: the account decides, so it is still section A.
  const res = await get(student, { format: 'docx', section: 'B' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(res.headers.get('content-disposition'), /\.docx"/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(unzipEntry(buf, '[Content_Types].xml')?.includes('wordprocessingml.document.main+xml'));
  const doc = unzipEntry(buf, 'word/document.xml');
  assert.ok(doc, 'document part present');
  assert.match(doc, /Networks &amp; &lt;Security&gt;/, 'user text is XML-escaped');
  assert.doesNotMatch(doc, /Only Section B Subject/, 'never another section');
  assert.match(doc, /Monday/);
  assert.match(doc, /Tuesday/);
  assert.match(doc, /w:orient="landscape"/);
});

test('staff must choose a class first; other roles and bad formats are refused', async () => {
  assert.equal((await get(admin, { format: 'pdf' })).status, 422, 'no class chosen');
  const ok = await get(admin, { format: 'docx', department: 'CSE', year: 3, section: 'B', semester: 5 });
  assert.equal(ok.status, 200);
  const doc = unzipEntry(Buffer.from(await ok.arrayBuffer()), 'word/document.xml');
  assert.match(doc, /Only Section B Subject/);
  assert.doesNotMatch(doc, /Networks/);
  assert.equal((await get(warden, { format: 'pdf' })).status, 403);
  assert.equal((await get(student, { format: 'xls' })).status, 422);
});
