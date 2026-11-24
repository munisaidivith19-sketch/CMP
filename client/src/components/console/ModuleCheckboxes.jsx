import { memo, useState } from 'react';
import { cn } from '../ui/primitives';
import PolicyEditor from './PolicyEditor';
import { groupBySection, moduleChecked, modulePartial, toggleModule } from '../../utils/adminModules';

/**
 * One checkbox per Admin dashboard module, grouped like the Admin's sidebar
 * (Menu / Campus / Administration). Ticked = the Admin sees the module in its
 * sidebar and can use it; unticked = hidden, its pages redirect away and its
 * API answers 403. The list comes from the server (policies catalogue →
 * adminModules), never from a client constant.
 *
 * `value` is the policy draft [{ module, actions, scope, department }];
 * "Fine-tune" opens the per-action editor on the same draft for narrower
 * grants (read-only access, one department). `onFineTune` is told when that
 * editor changed something.
 */
function ModuleCheckboxes({ adminModules, sections, catalogue, value, onChange, onFineTune, disabled }) {
  const [fine, setFine] = useState(false);
  const groups = groupBySection(adminModules, sections);
  if (!adminModules?.length) return <p className="text-sm muted">Loading modules…</p>;

  const allOn = adminModules.every((m) => moduleChecked(value, m));
  const setAll = (on) => onChange(adminModules.reduce((acc, m) => (moduleChecked(acc, m) === on ? acc : toggleModule(acc, m, on, catalogue)), value || []));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" disabled={disabled || allOn} onClick={() => setAll(true)}>Tick all</button>
        <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" disabled={disabled || !(value || []).length} onClick={() => setAll(false)}>Clear all</button>
        <span className="muted">Nothing ticked = no modules (Dashboard and own account only).</span>
      </div>
      {groups.map((g) => (
        <fieldset key={g.key} className="rounded-2xl border border-white/60 p-4 dark:border-white/10" disabled={disabled}>
          <legend className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft dark:text-ink-muted">{g.label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.modules.map((m) => {
              const checked = moduleChecked(value, m);
              const partial = modulePartial(value, m, catalogue);
              return (
                <label key={m.key} className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl p-2 text-sm transition', checked ? 'bg-primary-500/10' : 'hover:bg-white/40 dark:hover:bg-white/5')}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary-600"
                    checked={checked}
                    onChange={() => onChange(toggleModule(value, m, !checked, catalogue))}
                    aria-describedby={partial ? `partial-${m.key}` : undefined}
                  />
                  <span className="flex-1 font-bold">{m.label}</span>
                  {partial && <span id={`partial-${m.key}`} className="text-[11px] font-semibold muted">custom</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div>
        <button type="button" className="text-xs font-bold text-primary-600 hover:underline" onClick={() => setFine((f) => !f)} aria-expanded={fine}>
          {fine ? 'Hide fine-tuning' : 'Fine-tune actions and data scopes (optional)'}
        </button>
        {fine && (
          <div className="mt-3">
            <p className="mb-2 text-xs muted">Narrow a ticked module, for example view-only access or one department. A module stays ticked while any of its actions is granted.</p>
            <PolicyEditor
              catalogue={catalogue}
              value={value}
              disabled={disabled}
              onChange={(next) => {
                onFineTune?.();
                onChange(next);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ModuleCheckboxes);
