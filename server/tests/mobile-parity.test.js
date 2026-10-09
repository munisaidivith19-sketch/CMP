import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The Android app's new screens (OD & Leave, Outing, Achievements, Hostel,
 * Class In-Charge students, announcements, holidays, avatar) send exactly
 * these requests. They go through the same server rules as the web.
 */
// Never upload to a real Cloudinary account from tests: dotenv does not override variables already set.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';
const { startServer } = await import('./helpers.js');
const { addDays, dayKey, today } = await import('../src/utils/dates.js');
const { UPLOAD_ROOT } = await import('../src/utils/storage.js');

let ctx;
const u = {};
const written = [];
// A real 1×1 PNG: the server checks the file type from its bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const MOBILE = { 'x-client-platform': 'mobile', 'x-device-name': 'Pixel 8', 'user-agent': 'okhttp/4.12.0' };
const call = (who, method, url, body) => ctx.request(method, url, { token: who.token, body, headers: MOBILE });

/** Multipart upload exactly like the app's FormData (field "file"). */
async function upload(who, url, name = 'photo.png') {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), name);
  const res = await fetch(`${ctx.base}/api${url}`, { method: url.startsWith('/users/me/avatar') ? 'PUT' : 'POST', headers: { authorization: `Bearer ${who.token}`, ...MOBILE }, body: form });
  const body = await res.json();
  const stored = body.url || body.avatar;
  if (stored?.startsWith('/uploads/')) written.push(path.join(UPLOAD_ROOT, path.basename(stored)));
  return { status: res.status, body };
}

const make = async (role, extra = {}) => {
  const user = await ctx.createUser({ role, name: `${role} mobile`, ...extra });
  return { u: user, ...(await ctx.loginMobile(user)) };
};

before(async () => {
  ctx = await startServer();
  u.principal = await make('principal', { employeeId: 'MP-P' });
  u.hod = await make('hod', { department: 'CSE', employeeId: 'MP-H' });
  u.faculty = await make('faculty', { department: 'CSE', section: 'A', inChargeYear: 3, inChargeSemester: 5, employeeId: 'MP-F' });
  u.warden = await make('warden', { employeeId: 'MP-W' });
  u.hosteler = await make('student', { department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'MP001', stayType: 'hosteler', gender: 'male', title: 'Mr', parentPhone: '9000000001' });
  u.dayScholar = await make('student', { department: 'CSE', section: 'A', year: 3, semester: 5, rollNo: 'MP002', stayType: 'day_scholar', gender: 'female', title: 'Ms', parentPhone: '9000000002' });
});

after(async () => {
  await Promise.all(written.map((f) => fs.rm(f, { force: true })));
  if (ctx) await ctx.stop();
});

test('OD & Leave: photo document upload, apply, and the full review chain from the app', async () => {
  const doc = await upload(u.hosteler, '/uploads?kind=document', 'invitation.png');
  assert.equal(doc.status, 201);
  const day = dayKey(addDays(today(), 3));
  const created = await call(u.hosteler, 'POST', '/attendance/od-leave', {
    requestType: 'od',
    category: 'Paper Presentation',
    fromDate: day,
    toDate: day,
    description: 'Presenting at the IEEE student conference.',
    document: { url: doc.body.url, name: doc.body.name, mimeType: doc.body.mimeType },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const mine = await call(u.hosteler, 'GET', '/attendance/od-leave/my?limit=30&requestType=od');
  assert.ok(mine.body.requests.some((r) => r._id === created.body._id));

  const queue = await call(u.faculty, 'GET', '/attendance/od-leave/reviews?limit=30&status=pending_faculty');
  assert.ok(queue.body.requests.some((r) => r._id === created.body._id));
  assert.equal((await call(u.faculty, 'PATCH', `/attendance/od-leave/${created.body._id}/review`, { action: 'forward' })).status, 200);
  assert.equal((await call(u.hod, 'PATCH', `/attendance/od-leave/${created.body._id}/review`, { action: 'forward' })).status, 200);
  const approved = await call(u.principal, 'PATCH', `/attendance/od-leave/${created.body._id}/review`, { action: 'approve' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'approved');
});

test('Day scholar Outing from the app; a hosteler is refused', async () => {
  const doc = await upload(u.dayScholar, '/uploads?kind=document');
  const body = { subject: 'Doctor appointment', description: 'Dental check-up at 3 PM.', parentPhone: '9000000002', supportingDocument: { url: doc.body.url, name: doc.body.name, mimeType: doc.body.mimeType } };
  const ok = await call(u.dayScholar, 'POST', '/gate-pass/outing', body);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.dayScholarOuting, true);
  assert.equal((await call(u.hosteler, 'POST', '/gate-pass/outing', body)).status, 403);
  // The faculty review queue the app shows (faculty: no bind filter).
  const list = await call(u.faculty, 'GET', '/gate-pass');
  assert.ok(list.body.passes.some((p) => p._id === ok.body._id));
  // HOD queue with the app's bind filter is a valid request.
  assert.equal((await call(u.hod, 'GET', '/gate-pass?bind=none')).status, 200);
});

test('Achievements: HOD posts with a photo, a student congratulates and asks to hide, the HOD resolves', async () => {
  const img = await upload(u.hod, '/uploads?kind=image');
  assert.equal(img.status, 201);
  const created = await call(u.hod, 'POST', '/achievements', {
    title: 'Hackathon winners',
    description: 'First place at the state level hackathon.',
    category: 'technical',
    level: 'state',
    position: 'first',
    achievedOn: dayKey(today()),
    students: [String(u.hosteler.u._id)],
    images: [{ url: img.body.url, mimeType: img.body.mimeType }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body._id;
  const listed = await call(u.dayScholar, 'GET', '/achievements?limit=12&category=technical');
  assert.ok(listed.body.items.some((a) => a._id === id));
  assert.equal((await call(u.dayScholar, 'POST', `/achievements/${id}/congratulate`)).body.congratulated, true);
  assert.equal((await call(u.hosteler, 'POST', `/achievements/${id}/hide-request`, {})).status, 201);
  const seen = await call(u.hod, 'GET', `/achievements/${id}`);
  assert.equal(seen.body.hideRequests.length, 1);
  assert.equal((await call(u.hod, 'PATCH', `/achievements/${id}/hide-request/${seen.body.hideRequests[0]._id}`, { action: 'reject' })).status, 200);
  // Students never see posting controls' data: no hide requests leak to them.
  assert.deepEqual((await call(u.dayScholar, 'GET', `/achievements/${id}`)).body.hideRequests, []);
  // The app's warden menu hides Achievements; the API refuses it too.
  assert.equal((await call(u.warden, 'GET', '/achievements')).status, 403);
});

test('Hostel overview: warden sees counts and lists; a student is refused', async () => {
  const summary = await call(u.warden, 'GET', '/hostel/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.total, 1);
  const list = await call(u.warden, 'GET', '/hostel/students?status=inside&limit=100');
  assert.equal(list.status, 200);
  assert.ok(list.body.students.every((s) => s.phone === undefined), 'inside list carries no phone numbers');
  assert.equal((await call(u.hosteler, 'GET', '/hostel/summary')).status, 403);
});

test('Class In-Charge: add a student, edit from the detail record, reset the password', async () => {
  const created = await call(u.faculty, 'POST', '/class-students', {
    name: 'New Student', email: 'new.student@test.edu', rollNo: 'mp003', password: 'Welcome123', title: 'Mr', gender: 'male', stayType: 'hosteler', parentPhone: '9000000003',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body._id;
  const list = await call(u.faculty, 'GET', '/class-students');
  assert.ok(list.body.items.some((s) => s._id === id));
  assert.ok(list.body.items.every((s) => s.parentPhone === undefined), 'the list carries no phone numbers');
  const detail = await call(u.faculty, 'GET', `/class-students/${id}`);
  assert.equal(detail.body.parentPhone, '9000000003');
  const edited = await call(u.faculty, 'PATCH', `/class-students/${id}`, { parentPhone: '9000000004', phone: '', stayType: 'day_scholar' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await call(u.faculty, 'GET', `/class-students/${id}`)).body.stayType, 'day_scholar');
  const reset = await call(u.faculty, 'POST', `/users/${id}/reset-password`, { newPassword: 'Changed123', confirmPassword: 'Changed123' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  // Another class's faculty cannot touch this student.
  const other = await make('faculty', { department: 'CSE', section: 'B', inChargeYear: 3, inChargeSemester: 5, employeeId: 'MP-F2' });
  assert.ok([403, 404].includes((await call(other, 'GET', `/class-students/${id}`)).status));
  assert.equal((await call(other, 'POST', `/users/${id}/reset-password`, { newPassword: 'Changed123', confirmPassword: 'Changed123' })).status, 403);
});

test('Announcements from the app: HOD posts inside their scope only; principal pins; author deletes', async () => {
  const yearPost = await call(u.hod, 'POST', '/announcements', { title: 'Lab exam', content: 'Lab exam on Monday.', priority: 'important', audience: { scope: 'year', year: 3, department: 'CSE' } });
  assert.equal(yearPost.status, 201, JSON.stringify(yearPost.body));
  assert.equal((await call(u.hod, 'POST', '/announcements', { title: 'Campus', content: 'Whole campus post.', audience: { scope: 'all' } })).status, 403);
  assert.equal((await call(u.hod, 'POST', '/announcements', { title: 'Other dept', content: 'ECE students only.', audience: { scope: 'department', department: 'ECE' } })).status, 403);
  assert.equal((await call(u.principal, 'PATCH', `/announcements/${yearPost.body._id}/pin`)).status, 200);
  assert.equal((await call(u.faculty, 'DELETE', `/announcements/${yearPost.body._id}`)).status, 403);
  assert.equal((await call(u.hod, 'DELETE', `/announcements/${yearPost.body._id}`)).status, 200);
});

test('Holidays from the app: principal adds and cancels; HOD cannot', async () => {
  const body = { reason: 'Founders day', type: 'SINGLE', startDate: dayKey(addDays(today(), 20)), department: null, year: null, section: null };
  assert.equal((await call(u.hod, 'POST', '/holidays', body)).status, 403);
  const created = await call(u.principal, 'POST', '/holidays', body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const listed = await call(u.hosteler, 'GET', `/holidays?from=${dayKey(today())}`);
  assert.ok(listed.body.holidays.some((h) => h._id === created.body._id));
  assert.equal((await call(u.principal, 'DELETE', `/holidays/${created.body._id}`)).status, 200);
});

test('Profile photo upload from the app', async () => {
  const res = await upload(u.dayScholar, '/users/me/avatar');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.avatar, /^\/uploads\//);
  assert.equal(res.body.password, undefined);
});

test('Kotlin app: SOS raise / ack / resolve, and only responders can list', async () => {
  const raised = await call(u.dayScholar, 'POST', '/sos', { type: 'medical', note: 'Fainted near the library' });
  assert.equal(raised.status, 201, JSON.stringify(raised.body));
  assert.equal((await call(u.dayScholar, 'GET', '/sos')).status, 403);
  const feed = await call(u.principal, 'GET', '/sos?status=active');
  assert.ok(feed.body.items.some((a) => a._id === raised.body._id));
  assert.equal((await call(u.principal, 'PATCH', `/sos/${raised.body._id}/ack`)).status, 200);
  assert.equal((await call(u.principal, 'PATCH', `/sos/${raised.body._id}/resolve`, { status: 'resolved', resolutionNote: 'First aid given' })).status, 200);
});

test('Kotlin app: HOD master timetable and faculty availability; others refused', async () => {
  assert.equal((await call(u.hod, 'GET', '/timetable/master?year=3')).status, 200);
  assert.equal((await call(u.hod, 'GET', '/timetable/faculty-availability?dayOfWeek=monday')).status, 200);
  assert.equal((await call(u.faculty, 'GET', '/timetable/master')).status, 403);
  // A branch HOD naming another department still gets only their own.
  const other = await call(u.hod, 'GET', '/timetable/faculty-availability?dayOfWeek=monday&department=ECE');
  assert.ok(other.body.faculties.every((f) => f.department === 'CSE'));
});

test('Kotlin app: HOD uploads a study material (PDF, no size field) and deletes it', async () => {
  const subject = await ctx.models.Subject.create({ code: 'CS601', name: 'Compilers', department: 'CSE', year: 3, semester: 5, sections: ['A'], isActive: true });
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' }), 'unit1.pdf');
  const up = await fetch(`${ctx.base}/api/uploads?kind=document`, { method: 'POST', headers: { authorization: `Bearer ${u.hod.token}`, ...MOBILE }, body: form });
  const file = await up.json();
  assert.equal(up.status, 201, JSON.stringify(file));
  written.push(path.join(UPLOAD_ROOT, path.basename(file.url)));
  const created = await call(u.hod, 'POST', '/study-materials', {
    title: 'Unit 1 notes', category: 'notes', subjectId: String(subject._id), section: '', semester: 5,
    file: { url: file.url, name: file.name, mimeType: file.mimeType },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await call(u.faculty, 'DELETE', `/study-materials/${created.body._id}`)).status, 403);
  assert.equal((await call(u.hod, 'DELETE', `/study-materials/${created.body._id}`)).status, 200);
});

test('Class In-Charge (app): student and parent mobile cannot be the same number', async () => {
  const body = { name: 'Same Phone', email: 'same.phone@test.edu', rollNo: 'MP009', password: 'Welcome123', title: 'Ms', gender: 'female', stayType: 'hosteler', parentPhone: '9000000099', phone: '+91 90000 00099' };
  const res = await call(u.faculty, 'POST', '/class-students', body);
  assert.equal(res.status, 422);
  assert.match(JSON.stringify(res.body), /cannot be the same/);
  const ok = await call(u.faculty, 'POST', '/class-students', { ...body, phone: '9000000098' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Editing into the same number is refused too.
  assert.equal((await call(u.faculty, 'PATCH', `/class-students/${ok.body._id}`, { phone: '9000000099' })).status, 422);
});
