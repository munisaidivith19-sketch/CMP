/**
 * Data input → storage → output round trips for the core content types.
 *
 * Each record is created through the API with hostile-but-legal text
 * (Unicode, emoji, HTML/script markup, quotes, a NoSQL operator written as
 * text, surrounding whitespace). The text must come back exactly as sent
 * (trimmed), be stored as plain text in MongoDB (not interpreted, not
 * double-escaped), survive an update, never expose internal fields, and be
 * gone after a delete.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const TRICKY = 'Ünïcode ✓ 日本語 🎓 <b>bold</b> <script>alert(1)</script> "quotes" & \'apos\' {"$ne":1}';
const PADDED = `   ${TRICKY}   `;
const INTERNAL = /\$2[aby]\$\d\d\$|"(?:password|tokenVersion|resetTokenHash|otpHash|jti)"\s*:/;
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

let ctx;
let admin;
let principal;
let student;
let studentUser;
const raw = (name) => ctx.models[name].collection;

before(async () => {
  ctx = await startServer();
  admin = await ctx.loginWeb(await ctx.createUser({ role: 'admin' }));
  principal = await ctx.loginWeb(await ctx.createUser({ role: 'principal' }));
  studentUser = await ctx.createUser({ role: 'student', department: 'CSE', section: 'A', year: 3, rollNo: '21CS9001' });
  student = await ctx.loginWeb(studentUser);
});
after(async () => {
  await ctx.stop();
});

/** Writes go through the web client exactly as the browser sends them (CSRF header + cookie). */
const send = (who, method, path, body) =>
  ctx.request(method, path, { token: who.token, body, cookie: [who.cookie, who.csrfCookie].filter(Boolean).join('; '), headers: { 'x-csrf-token': who.csrf } });

function assertNoInternals(res, label) {
  assert.doesNotMatch(JSON.stringify(res.body), INTERNAL, `${label}: response exposes internal fields`);
}

test('events: text round-trips verbatim; dates and numbers keep their types; update and delete persist', async () => {
  const created = await send(admin, 'POST', '/events', {
    title: PADDED.slice(0, 110),
    description: PADDED,
    venue: 'Hall <A> & "B"',
    startDate: inMinutes(60 * 24),
    endDate: inMinutes(60 * 26),
    capacity: '40',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assertNoInternals(created, 'create event');
  const id = created.body._id;

  const read = await send(admin, 'GET', `/events/${id}`);
  assert.equal(read.status, 200);
  const ev = read.body.event || read.body;
  assert.equal(ev.description, TRICKY, 'trimmed, otherwise byte-for-byte');
  assert.equal(ev.venue, 'Hall <A> & "B"', 'markup is stored as text, not escaped twice');
  assert.equal(ev.capacity, 40, 'numeric string stored as a number');

  const doc = await raw('Event').findOne({ _id: created.body._id ? new ctx.models.Event.base.Types.ObjectId(id) : null });
  assert.equal(doc.description, TRICKY);
  assert.ok(doc.startDate instanceof Date, 'stored as a BSON date, not a string');
  assert.equal(typeof doc.capacity, 'number');

  const upd = await send(admin, 'PUT', `/events/${id}`, { venue: '  Main Auditorium  ' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal((await raw('Event').findOne({ _id: doc._id })).venue, 'Main Auditorium');
  assert.equal((await raw('Event').findOne({ _id: doc._id })).description, TRICKY, 'a partial update leaves other fields alone');

  assert.ok([200, 204].includes((await send(admin, 'DELETE', `/events/${id}`)).status));
  assert.equal((await send(admin, 'GET', `/events/${id}`)).status, 404);
});

test('discussions: hostile text and tags are stored as plain text; operator-shaped text never becomes a query', async () => {
  const created = await send(student, 'POST', '/discussions', {
    title: 'Question about {"$ne":1} and <script>',
    body: PADDED,
    tags: ['  ExAm  ', 'Lab', ''],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assertNoInternals(created, 'create discussion');
  const doc = await raw('Discussion').findOne({ _id: new ctx.models.Discussion.base.Types.ObjectId(created.body._id) });
  assert.equal(doc.body, TRICKY);
  assert.equal(doc.title, 'Question about {"$ne":1} and <script>');
  assert.deepEqual(doc.tags, ['exam', 'lab'], 'tags trimmed, lower-cased, empties dropped');

  const read = await send(student, 'GET', `/discussions/${created.body._id}`);
  assert.equal(read.status, 200);
  assert.equal((read.body.discussion || read.body).body, TRICKY);
  assertNoInternals(read, 'read discussion');

  // A non-list tags value is a validation error, never a server error.
  for (const tags of ['exam', 42, null, { a: 1 }]) {
    const bad = await send(student, 'POST', '/discussions', { title: 'Another question', body: 'Enough detail here.', tags });
    assert.ok(bad.status === 422 || (tags === null && bad.status === 201), `tags=${JSON.stringify(tags)} → ${bad.status}`);
  }
});

test('lost & found: create, read, update, list search and delete keep data intact', async () => {
  const created = await send(student, 'POST', '/lost-found', {
    type: 'lost',
    itemName: 'Blue charger <usb-c> ✓',
    category: 'electronics',
    location: 'Library — 2nd floor',
    dateTime: inMinutes(-120),
    contactMethod: 'phone',
    description: PADDED,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body._id || created.body.item?._id;
  const read = await send(student, 'GET', `/lost-found/${id}`);
  assert.equal(read.status, 200);
  const item = read.body.item || read.body;
  assert.equal(item.itemName, 'Blue charger <usb-c> ✓');
  assert.equal(item.description, TRICKY);

  const upd = await send(student, 'PUT', `/lost-found/${id}`, { location: 'Canteen' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const list = await send(student, 'GET', `/lost-found?search=${encodeURIComponent('charger <usb')}`);
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list.body).includes('Canteen'), 'search with regex metacharacters finds the updated item');

  assert.ok([200, 204].includes((await send(student, 'DELETE', `/lost-found/${id}`)).status));
  assert.equal((await send(student, 'GET', `/lost-found/${id}`)).status, 404);
});

test('complaints: a student complaint is stored with its text and server-set fields only', async () => {
  const created = await send(student, 'POST', '/complaints', {
    category: 'academics',
    subCategory: 'subject',
    escalateTo: 'faculty',
    description: PADDED,
    status: 'RESOLVED', // client-chosen state must be ignored
    student: String(admin.user._id), // and so must another owner
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'SUBMITTED');
  const doc = await raw('Complaint').findOne({ _id: new ctx.models.Complaint.base.Types.ObjectId(created.body._id) });
  assert.equal(doc.description, TRICKY);
  const owner = doc.student || doc.createdBy || doc.raisedBy;
  assert.equal(String(owner), String(studentUser._id), 'owner is the signed-in student, not the body value');
});

test('achievements: create → read → update → delete, with the link and student list intact', async () => {
  const created = await send(principal, 'POST', '/achievements', {
    title: 'Hackathon <Winner> ✓',
    description: PADDED,
    category: 'technical',
    level: 'national',
    position: 'winner',
    achievedOn: '2026-05-10',
    externalLink: 'https://example.org/news?id=1&x=%3Cy%3E',
    students: [String(studentUser._id)],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body._id || created.body.achievement?._id;
  const read = await send(principal, 'GET', `/achievements/${id}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const a = read.body.achievement || read.body;
  assert.equal(a.title, 'Hackathon <Winner> ✓');
  assert.equal(a.description, TRICKY);
  assert.equal(a.externalLink, 'https://example.org/news?id=1&x=%3Cy%3E');
  assert.equal(a.students.length, 1);
  assertNoInternals(read, 'read achievement');

  const bad = await send(principal, 'PUT', `/achievements/${id}`, { externalLink: 'javascript:alert(1)' });
  assert.equal(bad.status, 422, 'a script link is rejected on update too');

  assert.ok([200, 204].includes((await send(principal, 'DELETE', `/achievements/${id}`)).status));
  assert.equal((await send(principal, 'GET', `/achievements/${id}`)).status, 404);
});

test('user records never leave the server with credentials, and passwords are stored only as bcrypt hashes', async () => {
  const me = await send(student, 'GET', '/auth/me');
  assert.equal(me.status, 200);
  assertNoInternals(me, '/auth/me');
  const users = await send(admin, 'GET', '/users?limit=50');
  assert.equal(users.status, 200);
  assertNoInternals(users, '/users');
  const all = await raw('User').find({}, { projection: { password: 1 } }).toArray();
  assert.ok(all.length >= 3);
  for (const u of all) assert.match(u.password, /^\$2[aby]\$12\$/, 'bcrypt, cost 12');
});
