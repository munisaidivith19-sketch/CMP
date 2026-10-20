/**
 * Admin dashboard modules as checkboxes (ADMIN_POLICY_CHECKBOXES.md): a
 * policy-managed Admin sees and uses exactly the ticked modules; every other
 * module's API answers 403; legacy Admins and other roles are unchanged.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

const { ADMIN_MODULES, ADMIN_MODULE_KEYS } = await import('../src/constants/adminModules.js');
const { modulesToPolicies } = await import('../src/policies.js');

// One read route per module (relative to /api).
const PROBE = {
  announcements: '/announcements',
  events: '/events',
  clubs: '/clubs',
  discussions: '/discussions',
  people: '/users',
  notifications: '/notifications',
  chat: '/chat/conversations',
  timetable: '/timetable/master',
  transport: '/transport/buses',
  studyMaterials: '/study-materials',
  achievements: '/achievements',
  innovationGallery: '/skill-wallet/gallery',
  attendance: '/attendance/summary/students',
  gatePass: '/gate-pass',
  hostel: '/hostel/summary',
  lostFound: '/lost-found',
  grievances: '/complaints',
  alumni: '/alumni/jobs',
  sos: '/sos',
  insights: '/analytics/college',
  analytics: '/admin/analytics',
  moderation: '/reports',
  activityLog: '/admin/activity',
  securityLogs: '/admin/security/events',
};

let ctx;
let sa;
const uniq = () => Math.random().toString(36).slice(2, 8);
const req = (method, path, who, body) => ctx.request(method, path, { token: who?.token, body });
const denied = (res) => res.status === 403 && res.body?.code === 'POLICY_DENIED';
async function login(overrides) {
  const u = await ctx.createUser({ name: `U ${uniq()}`, ...overrides });
  return { u, ...(await ctx.loginWeb(u)) };
}
const restrictedAdmin = () => login({ role: 'admin', employeeId: `PA-${uniq()}`, policyManaged: true, policies: [] });
async function setModules(target, modules) {
  assert.equal((await req('POST', '/super-admin/reauth', sa, { password: PASSWORD })).status, 200);
  return req('PUT', `/super-admin/admins/${target.u._id}/modules`, sa, { modules });
}

before(async () => {
  ctx = await startServer();
  sa = await login({ role: 'super_admin', name: 'Checkbox Owner' });
});
after(async () => ctx?.stop());

test('every dashboard module has a probe route (the list and the test stay in step)', () => {
  assert.deepEqual(Object.keys(PROBE).sort(), [...ADMIN_MODULE_KEYS].sort());
  for (const m of ADMIN_MODULES) {
    assert.ok(m.label && ['menu', 'campus', 'administration'].includes(m.section), m.key);
    assert.ok(m.nav.length && m.api.length && m.policies.length, m.key);
  }
});

test('only Gate Pass and Hostel ticked: those two APIs work, every other module answers 403', async () => {
  const admin = await restrictedAdmin();
  const saved = await setModules(admin, ['gatePass', 'hostel']);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.policyManaged, true);
  assert.deepEqual(saved.body.modules, ['gatePass', 'hostel']);

  assert.equal((await req('GET', PROBE.gatePass, admin)).status, 200);
  assert.equal((await req('GET', PROBE.hostel, admin)).status, 200);
  for (const [key, path] of Object.entries(PROBE)) {
    if (key === 'gatePass' || key === 'hostel') continue;
    const res = await req('GET', path, admin);
    assert.ok(denied(res), `${key} ${path} → ${res.status} ${res.body?.code}`);
  }
  // Writes to an unticked module are refused as well.
  assert.ok(denied(await req('POST', '/lost-found', admin, { type: 'lost', itemName: 'x' })));
  // Raising an SOS is never blocked by module policies (this body is invalid, so 422 — not 403).
  assert.equal((await req('POST', '/sos', admin, {})).status === 403, false);
});

test('GET /account/modules returns exactly the ticked modules, and changes show on the next request', async () => {
  const admin = await restrictedAdmin();
  assert.deepEqual((await req('GET', '/account/modules', admin)).body.modules, []);
  await setModules(admin, ['hostel', 'gatePass']);
  const mine = await req('GET', '/account/modules', admin);
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('cache-control') || '', /no-store/);
  assert.equal(mine.body.policyManaged, true);
  assert.deepEqual(mine.body.modules, ['gatePass', 'hostel']);
  assert.ok(mine.body.catalogue.some((m) => m.key === 'gatePass' && m.nav.includes('/gate-pass')));
  assert.deepEqual(mine.body.sections.map((s) => s.label), ['Menu', 'Campus', 'Administration']);
  // /admin/my-policies (the sidebar's existing source) carries the same list.
  assert.deepEqual((await req('GET', '/admin/my-policies', admin)).body.modules, ['gatePass', 'hostel']);

  // Untick Hostel: the very next requests reflect it (no cache).
  assert.equal((await setModules(admin, ['gatePass'])).status, 200);
  assert.deepEqual((await req('GET', '/account/modules', admin)).body.modules, ['gatePass']);
  assert.ok(denied(await req('GET', PROBE.hostel, admin)));
  assert.equal((await req('GET', PROBE.gatePass, admin)).status, 200);
  // Re-tick it.
  await setModules(admin, ['gatePass', 'hostel']);
  assert.equal((await req('GET', PROBE.hostel, admin)).status, 200);
});

test('each module, ticked on its own, opens its API and nothing else', async () => {
  const admin = await restrictedAdmin();
  for (const key of ADMIN_MODULE_KEYS) {
    await ctx.models.User.updateOne({ _id: admin.u._id }, { $set: { policies: modulesToPolicies([key]) } });
    const own = await req('GET', PROBE[key], admin);
    assert.ok(!denied(own), `${key}: its own route ${PROBE[key]} is open (got ${own.status})`);
    const other = ADMIN_MODULE_KEYS.find((k) => k !== key && !ADMIN_MODULES.find((m) => m.key === k).api.some((a) => PROBE[key].startsWith(a)));
    assert.ok(denied(await req('GET', PROBE[other], admin)), `${key}: ${other} stays closed`);
  }
});

test('a legacy (not policy-managed) Admin keeps every module', async () => {
  const legacy = await login({ role: 'admin', employeeId: `LA-${uniq()}` });
  const mine = await req('GET', '/account/modules', legacy);
  assert.equal(mine.body.policyManaged, false);
  assert.deepEqual(mine.body.modules, ADMIN_MODULE_KEYS);
  for (const [key, path] of Object.entries(PROBE)) {
    const res = await req('GET', path, legacy);
    assert.ok(!denied(res), `${key} ${path} → ${res.status}`);
  }
});

test('other roles are not module-restricted: their modules are null and their access is unchanged', async () => {
  const student = await login({ name: 'Module Student' });
  const mine = await req('GET', '/account/modules', student);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.modules, null);
  assert.equal((await req('GET', '/notifications', student)).status, 200);
  assert.equal((await req('GET', '/announcements', student)).status, 200);
  const faculty = await login({ role: 'faculty', department: 'CSE', employeeId: `F-${uniq()}` });
  assert.equal((await req('GET', '/account/modules', faculty)).body.modules, null);
  assert.equal((await req('GET', '/notifications', faculty)).status, 200);
});

test('the modules endpoint is Super-Admin-only, re-authenticated and validated', async () => {
  const admin = await restrictedAdmin();
  assert.equal((await setModules(admin, ['gatePass', 'nuclearLaunch'])).status, 422);
  assert.equal((await req('GET', '/account/modules', admin)).body.modules.length, 0, 'nothing half-saved');
  // An Admin cannot use it, not even on another Admin.
  const legacy = await login({ role: 'admin', employeeId: `LA-${uniq()}` });
  assert.equal((await req('PUT', `/super-admin/admins/${admin.u._id}/modules`, legacy, { modules: ['gatePass'] })).status, 403);
  // A checkbox save keeps fine-tuned grants of modules that stay ticked.
  await ctx.models.User.updateOne({ _id: admin.u._id }, { $set: { policies: [{ module: 'user_management', actions: ['view'], scope: 'department', department: 'CSE' }] } });
  const kept = await setModules(admin, ['people', 'gatePass']);
  assert.equal(kept.status, 200);
  const um = kept.body.policies.find((p) => p.module === 'user_management');
  assert.deepEqual(um.actions, ['view']);
  assert.equal(um.department, 'CSE');
  assert.ok(kept.body.policies.some((p) => p.module === 'gate_pass'));
  assert.ok(await ctx.models.AuditLog.exists({ action: 'POLICIES_CHANGED', target: admin.u._id }));
});
