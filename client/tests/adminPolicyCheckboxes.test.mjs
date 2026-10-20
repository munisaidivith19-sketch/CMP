// Admin dashboard modules as checkboxes (ADMIN_POLICY_CHECKBOXES.md): what a
// policy-managed Admin's sidebar and routes show for a given module list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarSections, MAIN, CAMPUS, ADMIN } from '../src/components/layout/navItems.js';
import { checkedModules, groupBySection, moduleForPath, routeAllowed, toggleModule } from '../src/utils/adminModules.js';
// The single source of truth, exactly as GET /api/account/modules serves it.
import { ADMIN_MODULES, ADMIN_MODULE_KEYS, ADMIN_MODULE_SECTIONS } from '../../server/src/constants/adminModules.js';
import { POLICY_CATALOGUE, modulesToPolicies } from '../../server/src/policies.js';

const catalogue = ADMIN_MODULES.map(({ key, label, section, nav }) => ({ key, label, section, nav }));
/** A mocked GET /api/account/modules response. */
const account = (modules, policyManaged = true) => ({ role: 'admin', policyManaged, modules, catalogue, sections: ADMIN_MODULE_SECTIONS });
const admin = { role: 'admin', name: 'Ops Admin' };
const labels = (items) => items.map((i) => i.label);
const render = (user, opts) => {
  const s = sidebarSections(user, opts);
  return { main: labels(s.main), campus: labels(s.campus), admin: labels(s.admin) };
};

test('the sidebar of an Admin with only Gate Pass and Hostel ticked shows exactly those two (plus the Dashboard)', () => {
  assert.deepEqual(render(admin, { account: account(['gatePass', 'hostel']) }), { main: ['Dashboard'], campus: ['Gate pass', 'Hostel'], admin: [] });
});

test('ticked modules show every sidebar item they cover, in the sidebar\'s own sections', () => {
  const r = render(admin, { account: account(['people', 'grievances', 'analytics', 'securityLogs', 'chat']) });
  assert.deepEqual(r.main, ['Dashboard', 'People']);
  assert.deepEqual(r.campus, ['Chat', 'Grievances']);
  assert.deepEqual(r.admin, ['Analytics', 'Grievances', 'Users', 'Group requests', 'Security & Logs']);
});

test('nothing ticked: Dashboard only; module list not loaded yet: Dashboard only (no flash of hidden items)', () => {
  assert.deepEqual(render(admin, { account: account([]) }), { main: ['Dashboard'], campus: [], admin: [] });
  assert.deepEqual(render(admin, {}), { main: ['Dashboard'], campus: [], admin: [] });
});

test('a legacy Admin and every other role keep their full role-based sidebar', () => {
  const full = render(admin, { account: account(ADMIN_MODULE_KEYS, false) });
  const everything = render(admin, { account: account(ADMIN_MODULE_KEYS) });
  assert.deepEqual(full, everything);
  assert.ok(full.main.includes('Notifications') && full.campus.includes('Gate pass') && full.admin.includes('Users'));
  const student = render({ role: 'student', stayType: 'day_scholar' }, {});
  assert.ok(student.main.includes('Notifications') && student.campus.includes('Bus Tracking'));
  const hod = render({ role: 'hod', department: 'CSE' }, {});
  assert.ok(hod.admin.includes('Academics'));
});

test('every Admin sidebar item belongs to a module, and every module has an Admin sidebar item', () => {
  const adminItems = [...MAIN, ...CAMPUS, ...ADMIN].filter((i) => !i.excludeRoles?.includes('admin') && (!i.roles || i.roles.includes('admin')) && i.to !== '/');
  for (const i of adminItems) assert.ok(moduleForPath(i.to, catalogue), `${i.label} (${i.to}) has a module`);
  for (const m of ADMIN_MODULES) assert.ok(adminItems.some((i) => moduleForPath(i.to, catalogue)?.key === m.key), `${m.key} has a sidebar item`);
});

test('route guard: module pages need their module; pages of no module stay open', () => {
  const a = account(['gatePass']);
  assert.equal(routeAllowed('/gate-pass', a), true);
  assert.equal(routeAllowed('/gate-pass/64f1a2b3c4d5e6f708192a3b', a), true);
  assert.equal(routeAllowed('/hostel', a), false);
  assert.equal(routeAllowed('/admin/users', a), false);
  assert.equal(moduleForPath('/admin/users', catalogue).key, 'people');
  assert.equal(moduleForPath('/admin', catalogue).key, 'analytics');
  assert.equal(moduleForPath('/skill-wallet/gallery/abc', catalogue).key, 'innovationGallery');
  for (const open of ['/', '/profile', '/settings/security', '/search']) assert.equal(routeAllowed(open, a), true, open);
  // Not restricted: everything open.
  assert.equal(routeAllowed('/hostel', account(ADMIN_MODULE_KEYS, false)), true);
  assert.equal(routeAllowed('/hostel', undefined), true);
});

test('the checkbox editor writes the same policies as the server for the same ticks', () => {
  let draft = [];
  for (const key of ['gatePass', 'attendance', 'people']) draft = toggleModule(draft, ADMIN_MODULES.find((m) => m.key === key), true, POLICY_CATALOGUE);
  assert.deepEqual(checkedModules(draft, ADMIN_MODULES), ['people', 'attendance', 'gatePass']);
  const sort = (list) => [...list].map((p) => ({ ...p, actions: [...p.actions].sort() })).sort((x, y) => x.module.localeCompare(y.module));
  assert.deepEqual(sort(draft), sort(modulesToPolicies(['gatePass', 'attendance', 'people'])));
  // Unticking removes exactly that module.
  draft = toggleModule(draft, ADMIN_MODULES.find((m) => m.key === 'attendance'), false, POLICY_CATALOGUE);
  assert.deepEqual(checkedModules(draft, ADMIN_MODULES), ['people', 'gatePass']);
  assert.deepEqual(groupBySection(ADMIN_MODULES, ADMIN_MODULE_SECTIONS).map((g) => g.label), ['Menu', 'Campus', 'Administration']);
});
