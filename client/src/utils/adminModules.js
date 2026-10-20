/**
 * Admin dashboard modules (one checkbox each). The list itself lives on the
 * server (server/src/constants/adminModules.js) and reaches the client
 * through the API:
 *   GET /api/account/modules            → { policyManaged, modules, catalogue, sections }
 *   GET /api/super-admin/policies/catalogue → { adminModules, adminModuleSections, modules }
 * These helpers only decide what to show; the server refuses every API call
 * of an unticked module whatever the UI does.
 */

/** The module whose client route prefix best (longest) matches `pathname`, or null. */
export function moduleForPath(pathname, catalogue) {
  let best = null;
  let bestLen = -1;
  for (const m of catalogue || []) {
    for (const p of m.nav || []) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && p.length > bestLen) {
        best = m;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** Restricted by module checkboxes? (a policy-managed Admin with a loaded module list) */
export const isModuleRestricted = (account) => Boolean(account?.policyManaged && Array.isArray(account.modules));

/**
 * May this account open `pathname`? Pages that belong to no module (profile,
 * account security, search) stay open; a module page needs its module.
 */
export function routeAllowed(pathname, account) {
  if (!isModuleRestricted(account)) return true;
  const m = moduleForPath(pathname, account.catalogue);
  return !m || account.modules.includes(m.key);
}

/**
 * Should a sidebar item show? For a policy-managed Admin: the Dashboard, and
 * items whose page belongs to a ticked module (items of no module are hidden).
 */
export function navItemAllowed(to, account) {
  if (!isModuleRestricted(account)) return true;
  if (to === '/') return true;
  const m = moduleForPath(to, account.catalogue);
  return Boolean(m && account.modules.includes(m.key));
}

/** Modules grouped by sidebar section, in the sidebar's order. */
export function groupBySection(adminModules, sections) {
  return (sections || []).map((s) => ({ ...s, modules: (adminModules || []).filter((m) => m.section === s.key) })).filter((s) => s.modules.length);
}

const grantOf = (policies, module) => (policies || []).find((p) => p.module === module && p.actions?.length);

/** Is the module ticked in this policy draft? (any of its policies granted) */
export const moduleChecked = (policies, mod) => mod.policies.some((p) => grantOf(policies, p));

/** Ticked, but narrower than everything (fewer actions, or one department). */
export function modulePartial(policies, mod, catalogue) {
  if (!moduleChecked(policies, mod)) return false;
  return mod.policies.some((p) => {
    const g = grantOf(policies, p);
    const all = Object.keys(catalogue?.[p]?.actions || {});
    return !g || g.scope === 'department' || all.some((a) => !g.actions.includes(a));
  });
}

/** The ticked module keys of a policy draft. */
export const checkedModules = (policies, adminModules) => (adminModules || []).filter((m) => moduleChecked(policies, m)).map((m) => m.key);

/**
 * Tick or untick one module in a policy draft: ticking grants every action of
 * its policies campus-wide (keeping grants it already has), unticking removes
 * them. Mirrors the server's modulesToPolicies.
 */
export function toggleModule(policies, mod, on, catalogue) {
  const rest = (policies || []).filter((p) => !mod.policies.includes(p.module));
  if (!on) return rest;
  const mine = mod.policies.map((p) => grantOf(policies, p) || { module: p, actions: Object.keys(catalogue?.[p]?.actions || {}), scope: 'campus' });
  return [...rest, ...mine.filter((g) => g.actions.length)];
}
