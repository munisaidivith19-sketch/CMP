/**
 * Additional Attendance policies for staff accounts (policies.js →
 * STAFF_GRANTABLE.attendance): `view` widens what the account reads,
 * `create` lets it mark and edit (re-mark) attendance, each campus-wide or
 * for one department, on top of the role's own scope. Nothing implies
 * anything else, nothing changes without a grant, and the grant never opens
 * admin-wide attendance screens.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { writeLimiter } from '../src/middleware/rateLimit.js';

beforeEach(async () => {
  for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) await writeLimiter.resetKey(ip);
});

const { clock } = await import('../src/utils/clock.js');

// Campus time is Asia/Kolkata (UTC+05:30); 2026-10-05 is a Monday.
const at = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 0, h * 60 + m - 330));
};
const realNow = clock.now;
const CSE = 'CSE (Cyber Security)';
const ECE = 'ECE';
const DAY = '2026-10-05';

let ctx;
let sa, admin, facNs, facOther, facEce, principal, office, hodCse;
let stuCse, stuEce;
let subjNs, subjEce, subjCseOther;

const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const setGrant = (who, policies) => ctx.models.User.updateOne({ _id: who.u._id }, { $set: { policies } });
const VIEW = (extra = {}) => [{ module: 'attendance', actions: ['view'], ...extra }];
const VIEW_CREATE = (extra = {}) => [{ module: 'attendance', actions: ['create', 'view'], ...extra }];
const eceRoster = (who) => req('GET', `/attendance/roster?subjectId=${subjEce._id}&date=${DAY}&period=2&section=A`, who);
const markEce = (who, status = 'present') =>
  req('POST', '/attendance/mark', who, { subjectId: String(subjEce._id), date: DAY, period: 2, section: 'A', records: [{ student: String(stuEce.u._id), status }] });

before(async () => {
  ctx = await startServer();
  const mk = async (o) => {
    const u = await ctx.createUser(o);
    return { u, ...(await ctx.loginWeb(u)) };
  };
  [sa, admin, facNs, facOther, facEce, principal, office, hodCse, stuCse, stuEce] = await Promise.all([
    mk({ role: 'super_admin', name: 'Platform Owner' }),
    mk({ role: 'admin', name: 'The Admin' }),
    mk({ role: 'faculty', name: 'Fac NS', department: CSE, employeeId: 'E-NS' }),
    mk({ role: 'faculty', name: 'Fac Other', department: CSE, employeeId: 'E-OT' }),
    mk({ role: 'faculty', name: 'Fac ECE', department: ECE, employeeId: 'E-EC' }),
    mk({ role: 'principal', name: 'The Principal', employeeId: 'E-PR' }),
    mk({ role: 'office', name: 'The Office', employeeId: 'E-OF' }),
    mk({ role: 'hod', name: 'HOD CSE', department: CSE, employeeId: 'E-HOD' }),
    mk({ name: 'Stu Cse', department: CSE, section: 'A', year: 3, semester: 6, rollNo: '101' }),
    mk({ name: 'Stu Ece', department: ECE, section: 'A', year: 3, semester: 6, rollNo: '201' }),
  ]);
  const { Subject, TimetableSlot } = ctx.models;
  subjNs = await Subject.create({ name: 'Network Security', code: 'CS601', department: CSE, semester: 6, year: 3, faculty: [facNs.u._id], sections: ['A'] });
  subjCseOther = await Subject.create({ name: 'Cryptography', code: 'CS602', department: CSE, semester: 6, year: 3, faculty: [facOther.u._id], sections: ['A'] });
  subjEce = await Subject.create({ name: 'VLSI', code: 'EC601', department: ECE, semester: 6, year: 3, faculty: [facEce.u._id], sections: ['A'] });
  const base = { dayOfWeek: 'monday', semester: 6, year: 3, isActive: true, section: 'A' };
  await TimetableSlot.create([
    { ...base, subject: subjNs._id, faculty: facNs.u._id, department: CSE, period: 1, startTime: '08:30', endTime: '09:15' },
    { ...base, subject: subjEce._id, faculty: facEce.u._id, department: ECE, period: 2, startTime: '09:15', endTime: '10:00' },
    { ...base, subject: subjCseOther._id, faculty: facOther.u._id, department: CSE, period: 3, startTime: '10:00', endTime: '10:45' },
  ]);
  clock.now = () => at(DAY, '11:00');
  // Existing ECE attendance, recorded by the Admin.
  assert.equal((await markEce(admin)).status, 200);
  await req('POST', '/super-admin/reauth', sa, { password: PASSWORD });
});
after(async () => {
  clock.now = realNow;
  await ctx.stop();
});

test('the staff catalogue offers Attendance view and create, campus-wide or one department', async () => {
  const mine = await req('GET', '/admin/my-policies', sa);
  const att = mine.body.staffCatalogue.attendance;
  assert.deepEqual(Object.keys(att.actions), ['view', 'create']);
  assert.deepEqual(att.scopes, ['campus', 'department']);

  const put = (policies) => req('PUT', `/admin/users/${facNs.u._id}/policies`, sa, { policies });
  assert.equal((await put(VIEW_CREATE({ scope: 'department', department: ECE }))).status, 200);
  assert.equal((await put([{ module: 'attendance', actions: ['create'] }])).status, 422, 'create needs view');
  assert.equal((await put([{ module: 'attendance', actions: ['view', 'correct'] }])).status, 422, 'correct stays with Admins');
  assert.equal((await put([{ module: 'attendance', actions: ['view', 'export'] }])).status, 422, 'export stays with Admins');
  assert.equal((await put(VIEW({ scope: 'department', department: 'NOPE' }))).status, 422);
  // Admin attendance policies stay campus-wide only.
  const policyAdmin = await ctx.createUser({ role: 'admin', employeeId: 'E-PA', policyManaged: true, policies: [] });
  assert.equal((await req('PUT', `/super-admin/admins/${policyAdmin._id}/policies`, sa, { policies: VIEW({ scope: 'department', department: ECE }) })).status, 422);
  await setGrant(facNs, []);
});

test('without a grant, faculty stay within their own classes (unchanged behaviour)', async () => {
  assert.equal((await req('GET', `/attendance/subject/${subjEce._id}`, facNs)).status, 403);
  assert.equal((await req('GET', `/attendance/student/${stuEce.u._id}`, facNs)).status, 403);
  assert.equal((await eceRoster(facNs)).status, 403);
  assert.equal((await markEce(facNs)).status, 403);
  assert.equal((await req('GET', `/attendance/subject/${subjNs._id}`, facNs)).status, 200, 'own subject still fine');
});

test('Attendance → view (one department) opens that department to read, not to write', async () => {
  await setGrant(facNs, VIEW({ scope: 'department', department: ECE }));
  assert.equal((await req('GET', `/attendance/subject/${subjEce._id}`, facNs)).status, 200);
  assert.equal((await req('GET', `/attendance/student/${stuEce.u._id}`, facNs)).status, 200);
  const sessions = await req('GET', `/attendance/sessions?mine=false&from=${DAY}&to=${DAY}`, facNs);
  assert.equal(sessions.status, 200);
  const ece = sessions.body.filter((s) => s.department === ECE);
  assert.ok(ece.length > 0, 'ECE sessions visible');
  assert.ok(ece.every((s) => s.editable === false), 'view never makes a session editable');
  const roster = await eceRoster(facNs);
  assert.equal(roster.status, 200);
  assert.equal(roster.body.editable, false);
  assert.equal((await markEce(facNs, 'absent')).status, 403, 'view is not write');
  // Not another CSE faculty member's class: the grant is ECE only.
  assert.equal((await req('GET', `/attendance/subject/${subjCseOther._id}`, facNs)).status, 403);
  // Never admin-wide screens.
  assert.equal((await req('GET', '/attendance/summary', facNs)).status, 403);
  assert.equal((await req('GET', '/attendance/low-monitor', facNs)).status, 403);
  // Another faculty member gained nothing.
  assert.equal((await req('GET', `/attendance/subject/${subjEce._id}`, facOther)).status, 403);
});

test('Attendance → create marks and edits classes in scope, on earlier dates too; nothing outside it', async () => {
  await setGrant(facNs, VIEW_CREATE({ scope: 'department', department: ECE }));
  const roster = await eceRoster(facNs);
  assert.equal(roster.body.editable, true, roster.body.lockedReason);
  const edit = await markEce(facNs, 'absent');
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const rec = await ctx.models.AttendanceRecord.findOne({ student: stuEce.u._id, subject: subjEce._id }).lean();
  assert.equal(rec.status, 'absent');
  assert.equal(String(rec.markedBy), String(facNs.u._id));
  // An earlier date (the previous Monday) is open to the grant, as for an Admin.
  const earlier = await req('POST', '/attendance/mark', facNs, { subjectId: String(subjEce._id), date: '2026-09-28', period: 2, section: 'A', records: [{ student: String(stuEce.u._id), status: 'present' }] });
  assert.equal(earlier.status, 200, JSON.stringify(earlier.body));
  // Another CSE class is outside an ECE grant.
  const other = await req('POST', '/attendance/mark', facNs, { subjectId: String(subjCseOther._id), date: DAY, period: 3, section: 'A', records: [{ student: String(stuCse.u._id), status: 'present' }] });
  assert.equal(other.status, 403);
  // Future dates stay closed for everyone.
  const future = await req('POST', '/attendance/mark', facNs, { subjectId: String(subjEce._id), date: '2026-10-12', period: 2, section: 'A', records: [{ student: String(stuEce.u._id), status: 'present' }] });
  assert.equal(future.status, 422);
});

test('read-only roles: a campus-wide create grant lets Principal and Office mark; without it they stay read-only', async () => {
  for (const who of [principal, office]) {
    assert.equal((await markEce(who)).status, 403, 'read-only without a grant');
    await setGrant(who, VIEW_CREATE());
    assert.equal((await eceRoster(who)).status, 200);
    const res = await markEce(who);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  // An HOD's campus-wide grant lifts the today-only rule and opens other departments.
  await setGrant(hodCse, VIEW_CREATE());
  assert.equal((await markEce(hodCse)).status, 200);
});

test('revoking the grant removes the access on the very next request', async () => {
  await setGrant(facNs, VIEW_CREATE());
  assert.equal((await markEce(facNs)).status, 200);
  const res = await req('PUT', `/admin/users/${facNs.u._id}/policies`, sa, { policies: [] });
  assert.equal(res.status, 200);
  assert.equal((await markEce(facNs)).status, 403);
  assert.equal((await req('GET', `/attendance/subject/${subjEce._id}`, facNs)).status, 403);
  assert.equal((await req('GET', `/attendance/subject/${subjNs._id}`, facNs)).status, 200, 'role access intact');
});
