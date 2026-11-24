import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

/**
 * Strict RBAC for IT support: every API route the server registers is
 * walked, and anything outside the fixed allowlist below must be refused by
 * the confined-role guard. A new route is therefore denied by default; widening
 * the IT support's access means changing this list on purpose.
 *
 * Attendance, gate passes and hostel are read-only (GET), and are hidden from
 * the IT support's sidebar (reachable by typing the address only).
 */
const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const READ = ['GET'];
const SUPER_ADMIN_MAY = [
  [/^\/auth\//, ANY],
  [/^\/users\/me(\/avatar)?$/, ['PUT']],
  [/^\/notifications(\/|$)/, ANY],
  [/^\/client-errors$/, ['POST']],
  [/^\/console(\/|$)/, ANY],
  [/^\/admin\/users(\/[^/]+)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
  [/^\/admin\/users\/[^/]+\/policies$/, ['GET', 'PUT']],
  [/^\/admin\/my-policies$/, READ],
  [/^\/users\/[^/]+\/reset-password$/, ['POST']],
  [/^\/admin\/role-assignments\//, ANY],
  [/^\/attendance(\/|$)/, READ],
  [/^\/staff\/early-exits$/, READ],
  [/^\/gate-pass(\/|$)/, READ],
  [/^\/hostel(\/|$)/, READ],
];
const allowed = (method, path) => SUPER_ADMIN_MAY.some(([re, m]) => re.test(path) && m.includes(method));

let ctx;
let sa;
let routes;

/** Every [METHOD, path] registered after the confined-role guard (sub-routers included). */
function collect(stack, prefix = '') {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      const paths = [].concat(layer.route.path);
      for (const p of paths) for (const m of Object.keys(layer.route.methods)) if (m !== '_all' && m !== 'head' && m !== 'options') out.push([m.toUpperCase(), prefix + p]);
    } else if (layer.handle?.stack && typeof layer.rawPath === 'string') {
      out.push(...collect(layer.handle.stack, prefix + layer.rawPath));
    }
  }
  return out;
}
// Fill path parameters with a well-formed id (the guard runs before any validator).
const concrete = (p) => p.replace(/:[A-Za-z_]+/g, '6650a1b2c3d4e5f601234567').replace(/\{?\*[A-Za-z_]+\}?/g, 'x');

before(async () => {
  ctx = await startServer();
  const u = await ctx.createUser({ role: 'super_admin', name: 'Platform Owner' });
  sa = { u, ...(await ctx.loginWeb(u)) };
  const { default: router } = await import('../src/routes/index.js');
  const guard = router.stack.findIndex((l) => l.name === 'confinedRoleGuard');
  assert.ok(guard > 0, 'confinedRoleGuard is mounted on the API router');
  routes = collect(router.stack.slice(guard + 1));
});
after(() => ctx.stop());

test('every route outside IT support allowlist is refused by the guard (deny by default)', async () => {
  const denied = routes.filter(([m, p]) => !allowed(m, concrete(p)));
  assert.ok(denied.length > 200, `walked ${routes.length} routes`);
  const leaks = [];
  for (const [m, p] of denied) {
    const r = await ctx.request(m, concrete(p), { token: sa.token, body: m === 'GET' ? undefined : {} });
    if (r.status !== 403 || !/console/.test(r.body?.message || '')) leaks.push(`${m} ${p} → ${r.status}`);
  }
  assert.deepEqual(leaks, []);
});

test('attendance, gate passes, hostel and early exits: every write is refused', async () => {
  const writes = routes.filter(([m, p]) => m !== 'GET' && /^\/(attendance|gate-pass|hostel|staff\/early-exits)(\/|$)/.test(p));
  assert.ok(writes.length > 20, `found ${writes.length} write routes`);
  for (const [m, p] of writes) {
    const r = await ctx.request(m, concrete(p), { token: sa.token, body: {} });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test('IT support cannot subscribe to live Discussions over the socket either', async () => {
  const student = await ctx.createUser({});
  const d = await ctx.models.Discussion.create({ title: 'Lab timings', body: 'Open thread', author: student._id });
  const join = async (token) => {
    const socket = await ctx.connect(token);
    const res = await new Promise((resolve) => socket.emit('discussion:join', String(d._id), resolve));
    socket.disconnect();
    return res;
  };
  // Control: an ordinary user may join the same thread.
  assert.deepEqual(await join((await ctx.loginWeb(student)).token), { ok: true });
  assert.deepEqual(await join(sa.token), { ok: false, error: 'forbidden' });
});
