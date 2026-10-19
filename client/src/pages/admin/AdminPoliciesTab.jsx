import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, UserCog } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../components/ui/primitives';
import PolicyEditor from '../../components/superadmin/PolicyEditor';
import { useGetPolicyTargetsQuery, useSetDelegatedPoliciesMutation } from '../../services/superAdmin';
import { ROLE_LABELS } from '../../utils/constants';
import { restrictCatalogue, rolesSummary } from '../../utils/delegation';
import { errMsg } from '../../utils/format';

/**
 * Delegated policy assignment for an Admin holding User Management → policies.
 * Shows only the modules, actions and scopes this Admin may delegate (its
 * delegation cap from /admin/my-policies); permissions outside it are never
 * listed and are kept unchanged by the server (merge mode). The server
 * re-validates every save.
 */
/**
 * Role policies tab for every Admin: its own effective permissions, then the
 * delegated assignment tool when authorized, or what a Super Admin must grant.
 */
export function RolePoliciesTab({ myPolicies, isLoading }) {
  if (isLoading || !myPolicies) return <Skeleton className="h-40" />;
  const managed = myPolicies.policyManaged;
  const d = myPolicies.delegation;
  const canDelegate = Boolean(managed && d?.canAssignPolicies);
  const label = (m) => myPolicies.catalogue?.[m]?.label || m;
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 text-base font-extrabold">Your permissions</h3>
        {!managed ? (
          <p className="text-sm muted">
            You are a legacy Admin: user management is unrestricted for you, but you cannot assign policies to other Admins.
            To do that, a Super Admin must switch your account to module policies and grant <b>User Management → policies</b>.
          </p>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-[200px_1fr]">
            <dt className="font-semibold muted">Module policies</dt>
            <dd className="flex flex-wrap gap-1.5">
              {(myPolicies.policies || []).length === 0 ? 'None' : myPolicies.policies.map((p) => (
                <Badge key={p.module} color="info">{label(p.module)}: {p.actions.join(', ')}{p.scope === 'department' ? ` (${p.department})` : ''}</Badge>
              ))}
            </dd>
            <dt className="font-semibold muted">Accounts you can create</dt>
            <dd>{rolesSummary(d?.createRoles, ROLE_LABELS)}</dd>
            <dt className="font-semibold muted">Roles you can assign</dt>
            <dd>{rolesSummary(d?.assignRoles, ROLE_LABELS)}</dd>
            <dt className="font-semibold muted">You can delegate</dt>
            <dd>{!d?.canAssignPolicies ? 'Nothing (needs User Management → policies)' : d.grantablePolicies.length ? d.grantablePolicies.map((p) => `${label(p.module)}: ${p.actions.join(', ')}`).join(' · ') : 'Nothing'}</dd>
          </dl>
        )}
        <p className="mt-3 text-xs muted">Any other role or permission requires Super Admin authorization. Super Admin and protected platform policies are never shown here.</p>
      </Card>
      {canDelegate ? (
        <AdminPoliciesTab myPolicies={myPolicies} />
      ) : (
        <Card>
          <h3 className="mb-1 text-base font-extrabold">Assign policies to other Admins</h3>
          <p className="text-sm muted">
            Read-only for your account. To assign these to other Admins, ask a Super Admin to grant you <b>User Management → policies</b>
            {managed ? ' and, if needed, set the permissions you may delegate.' : ' after switching your account to module policies (Super Admin → Admin accounts → your account → Module policies).'}
          </p>
        </Card>
      )}
      <PolicyCatalogue myPolicies={myPolicies} />
    </div>
  );
}

/** Every module policy that exists, read-only, marking what this Admin holds. */
function PolicyCatalogue({ myPolicies }) {
  const managed = myPolicies.policyManaged;
  const held = (module, action) => (myPolicies.policies || []).some((p) => p.module === module && p.actions.includes(action));
  return (
    <Card>
      <h3 className="mb-1 text-base font-extrabold">Available policies</h3>
      <p className="mb-3 text-xs muted">
        {managed ? 'Ticked items are the policies you hold.' : 'As a legacy Admin you are not limited by these policies; they apply to policy-managed Admins.'} There is no delete permission anywhere.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(myPolicies.catalogue || {}).map(([module, def]) => (
          <section key={module} className="rounded-2xl border border-white/60 p-3 dark:border-white/10" aria-label={def.label}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-extrabold">{def.label}</h4>
              <span className="text-[11px] muted">{def.scopes.includes('department') ? 'Campus or one department' : 'Campus-wide'}</span>
            </div>
            <ul className="space-y-1.5">
              {Object.entries(def.actions).map(([action, meaning]) => (
                <li key={action} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary-600" checked={managed && held(module, action)} readOnly disabled aria-label={`${def.label} ${action}`} />
                  <span>
                    <span className="font-bold capitalize">{action}</span>
                    <span className="block text-xs muted">{meaning}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

export default function AdminPoliciesTab({ myPolicies }) {
  const { data, isLoading, isError, refetch } = useGetPolicyTargetsQuery();
  const [selectedId, setSelectedId] = useState(null);
  const cap = myPolicies?.delegation?.grantablePolicies || [];
  const catalogue = useMemo(() => restrictCatalogue(myPolicies?.catalogue, cap), [myPolicies?.catalogue, cap]);
  const selected = data?.items?.find((a) => a._id === selectedId);

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError) return <Card><p className="text-sm">Could not load Admin accounts. <Button size="sm" variant="ghost" onClick={refetch}>Try again</Button></p></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="!p-3">
        <p className="mb-2 px-2 text-xs muted">Admins you may assign policies to. Super Admin and legacy Admin accounts are managed by a Super Admin only.</p>
        {!data?.items?.length ? (
          <EmptyState icon={UserCog} title="No Admin accounts" text="There are no policy-managed Admins to manage." />
        ) : (
          <ul className="space-y-1" aria-label="Admin accounts">
            {data.items.map((a) => (
              <li key={a._id}>
                <button type="button" onClick={() => setSelectedId(a._id)} aria-pressed={a._id === selectedId}
                  className={`w-full rounded-xl p-2 text-left text-sm ${a._id === selectedId ? 'bg-primary-500/10' : 'hover:bg-white/40 dark:hover:bg-white/5'}`}>
                  <span className="block font-bold">{a.name}</span>
                  <span className="block truncate text-xs muted">{a.email}{a.isActive ? '' : ' · deactivated'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        {!selected ? (
          <p className="text-sm muted">Choose an Admin to view or change the permissions you can delegate.</p>
        ) : (
          <TargetEditor key={selected._id} target={selected} catalogue={catalogue} />
        )}
      </Card>
    </div>
  );
}

function TargetEditor({ target, catalogue }) {
  const [policies, setPolicies] = useState(target.policies);
  const [save, { isLoading }] = useSetDelegatedPoliciesMutation();
  const submit = async () => {
    try {
      await save({ id: target._id, policies }).unwrap();
      toast.success('Policies saved — effective on the Admin’s next request');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-extrabold">{target.name}</h3>
        {target.hiddenActions > 0 && <Badge color="neutral">{target.hiddenActions} other permission(s) managed by a Super Admin</Badge>}
      </div>
      <p className="mb-3 text-xs muted">
        Can create: {rolesSummary(target.limits.createRoles, ROLE_LABELS, 'no limit set')} · Can assign: {rolesSummary(target.limits.assignRoles, ROLE_LABELS, 'no limit set')}.
        Granting account creation, role changes or policy assignment needs a Super Admin to set this Admin’s limits first, inside yours.
      </p>
      {Object.keys(catalogue).length === 0 ? (
        <p className="text-sm">You have no permissions you may delegate.</p>
      ) : (
        <>
          <PolicyEditor catalogue={catalogue} value={policies} onChange={setPolicies} />
          <Button size="sm" className="mt-3" icon={ShieldCheck} loading={isLoading} onClick={submit}>Save policies</Button>
        </>
      )}
    </div>
  );
}
