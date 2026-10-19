import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button, cn } from '../ui/primitives';
import PolicyEditor from './PolicyEditor';
import { ROLE_LABELS } from '../../utils/constants';
import { DELEGATABLE_ROLES, previewDelegation, rolesSummary } from '../../utils/delegation';

/**
 * Super Admin: which roles a policy-managed Admin may create and assign, and
 * the most it may delegate to other Admins. Each limit can be left "not
 * limited" (the module policies decide, as before) or set to an explicit list.
 * The effective result is previewed from the draft before saving; the server
 * validates and enforces everything.
 */
function RoleLimit({ id, title, help, value, onChange, disabled }) {
  const limited = Array.isArray(value);
  const toggle = (role) => {
    const set = new Set(value || []);
    if (set.has(role)) set.delete(role);
    else set.add(role);
    onChange([...set]);
  };
  return (
    <fieldset className="rounded-2xl border border-white/60 p-4 dark:border-white/10" disabled={disabled}>
      <legend className="text-sm font-extrabold">{title}</legend>
      <p className="mb-2 text-xs muted">{help}</p>
      <label className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={limited} onChange={(e) => onChange(e.target.checked ? [] : null)} aria-describedby={`${id}-help`} />
        Limit to the roles ticked below
      </label>
      <p id={`${id}-help`} className="sr-only">When unticked, the Admin's module policies decide.</p>
      {limited && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {DELEGATABLE_ROLES.map((r) => (
            <label key={r} className={cn('flex cursor-pointer items-center gap-2 rounded-xl p-1.5 text-sm', value.includes(r) ? 'bg-primary-500/10' : 'hover:bg-white/40 dark:hover:bg-white/5')}>
              <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={value.includes(r)} onChange={() => toggle(r)} />
              {ROLE_LABELS[r] || r}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export default function DelegationEditor({ admin, catalogue, onSave, saving }) {
  const initial = admin.delegation || {};
  const [draft, setDraft] = useState({
    createRoles: Array.isArray(initial.createRoles) ? initial.createRoles : null,
    assignRoles: Array.isArray(initial.assignRoles) ? initial.assignRoles : null,
    grantablePolicies: Array.isArray(initial.grantablePolicies) ? initial.grantablePolicies : null,
  });
  const preview = useMemo(() => previewDelegation(admin.policies || [], draft), [admin.policies, draft]);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  if (!admin.policyManaged) {
    return <p className="text-xs muted">Delegation limits apply to policy-managed Admins only. Save module policies for this legacy Admin first.</p>;
  }

  return (
    <div className="space-y-3">
      <RoleLimit id="create-roles" title="Roles this Admin may create" value={draft.createRoles} onChange={set('createRoles')}
        help="Also needs User Management → create (students, club admins, alumni) or Staff Management → create (staff roles)." />
      <RoleLimit id="assign-roles" title="Roles this Admin may assign to existing accounts" value={draft.assignRoles} onChange={set('assignRoles')}
        help="Also needs User Management → roles, plus edit rights over both the current and the new role. Appointing an HOD needs Faculty and HOD." />
      <fieldset className="rounded-2xl border border-white/60 p-4 dark:border-white/10">
        <legend className="text-sm font-extrabold">Most this Admin may delegate to other Admins</legend>
        <p className="mb-2 text-xs muted">Only used when the Admin holds User Management → policies. Always also capped by the Admin's own policies.</p>
        <label className="mb-3 flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={Array.isArray(draft.grantablePolicies)} onChange={(e) => set('grantablePolicies')(e.target.checked ? [] : null)} />
          Limit to the permissions ticked below
        </label>
        {Array.isArray(draft.grantablePolicies) && <PolicyEditor catalogue={catalogue} value={draft.grantablePolicies} onChange={set('grantablePolicies')} />}
      </fieldset>

      <div className="rounded-2xl bg-primary-500/5 p-4 text-sm" aria-live="polite">
        <p className="mb-2 font-extrabold">Effective after saving</p>
        <dl className="grid gap-1 text-xs sm:grid-cols-[180px_1fr]">
          <dt className="font-semibold muted">Can create</dt>
          <dd>{rolesSummary(preview.createRoles, ROLE_LABELS)}</dd>
          <dt className="font-semibold muted">Can assign</dt>
          <dd>{rolesSummary(preview.assignRoles, ROLE_LABELS)}</dd>
          <dt className="font-semibold muted">Can delegate to Admins</dt>
          <dd>
            {!preview.canAssignPolicies ? 'Nothing (no User Management → policies)' : preview.grantablePolicies.length === 0 ? 'Nothing' : preview.grantablePolicies.map((p) => `${catalogue?.[p.module]?.label || p.module}: ${p.actions.join(', ')}${p.scope === 'department' ? ` (${p.department})` : ''}`).join(' · ')}
          </dd>
        </dl>
        {(preview.unused.createRoles.length > 0 || preview.unused.assignRoles.length > 0) && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Ticked but not usable with the current module policies: {rolesSummary([...new Set([...preview.unused.createRoles, ...preview.unused.assignRoles])], ROLE_LABELS)}.
          </p>
        )}
      </div>
      <Button size="sm" icon={ShieldCheck} loading={saving} onClick={() => onSave(draft)}>
        Save delegation
      </Button>
    </div>
  );
}
