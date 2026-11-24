import { memo } from 'react';
import { cn } from '../ui/primitives';
import { DEPARTMENTS } from '../../utils/constants';

/**
 * Checkbox policy editor. `value` is the server's list
 * [{ module, actions, scope, department }]; the catalogue comes from the
 * server, so labels, descriptions and allowed scopes always match what the
 * backend enforces. Read never implies write: every action is its own box.
 */
function PolicyEditor({ catalogue, value, onChange, disabled }) {
  const byModule = Object.fromEntries((value || []).map((p) => [p.module, p]));

  // A narrowed catalogue (delegated assignment) may allow only a department
  // scope, fixed to one department (`def.department`).
  const fresh = (module) => {
    const def = catalogue?.[module] || {};
    const scope = def.scopes?.includes('campus') ? 'campus' : def.scopes?.[0] || 'campus';
    return { module, actions: [], scope, ...(scope === 'department' ? { department: def.department || DEPARTMENTS[0] } : {}) };
  };

  const update = (module, patch) => {
    const current = byModule[module] || fresh(module);
    const next = { ...current, ...patch };
    if (next.scope !== 'department') delete next.department;
    const rest = (value || []).filter((p) => p.module !== module);
    onChange(next.actions.length ? [...rest, next] : rest);
  };

  const toggle = (module, action) => {
    const actions = new Set(byModule[module]?.actions || []);
    if (actions.has(action)) actions.delete(action);
    else actions.add(action);
    update(module, { actions: [...actions] });
  };

  return (
    <div className="space-y-3">
      {Object.entries(catalogue || {}).map(([module, def]) => {
        const grant = byModule[module];
        return (
          <fieldset key={module} className="rounded-2xl border border-white/60 p-4 dark:border-white/10" disabled={disabled}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-sm font-extrabold">{def.label}</legend>
              {def.scopes.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="font-semibold muted" htmlFor={`scope-${module}`}>Data scope</label>
                  <select
                    id={`scope-${module}`}
                    className="input !w-auto !py-1.5 text-xs"
                    value={grant?.scope || 'campus'}
                    disabled={disabled || !grant}
                    onChange={(e) => update(module, { scope: e.target.value, department: e.target.value === 'department' ? grant?.department || def.department || DEPARTMENTS[0] : undefined })}
                  >
                    {def.scopes.map((s) => (
                      <option key={s} value={s}>{s === 'campus' ? 'Campus-wide' : 'One department'}</option>
                    ))}
                  </select>
                  {grant?.scope === 'department' && (
                    <select className="input !w-auto !py-1.5 text-xs" value={grant.department || ''} disabled={disabled} onChange={(e) => update(module, { department: e.target.value })} aria-label="Department">
                      {(def.department ? [def.department] : DEPARTMENTS).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <span className="text-[11px] font-semibold muted">{def.scopes[0] === 'department' ? `Department: ${def.department || grant?.department || '—'}` : 'Campus-wide'}</span>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(def.actions).map(([action, meaning]) => {
                const checked = Boolean(grant?.actions.includes(action));
                return (
                  <label key={action} className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl p-2 text-sm transition', checked ? 'bg-primary-500/10' : 'hover:bg-white/40 dark:hover:bg-white/5')}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary-600" checked={checked} onChange={() => toggle(module, action)} />
                    <span>
                      <span className="font-bold capitalize">{action}</span>
                      <span className="block text-xs muted">{meaning}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export default memo(PolicyEditor);
