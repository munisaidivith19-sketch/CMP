import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity, AlertTriangle, CheckCircle2, Crown, Database, HardDriveDownload, KeyRound, LogOut, Plus, Power, Search, ShieldAlert, ShieldCheck, UserCog, Users, XCircle,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, cn } from '../../components/ui/primitives';
import { Input, Select } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import PolicyEditor from '../../components/superadmin/PolicyEditor';
import DelegationEditor from '../../components/superadmin/DelegationEditor';
import { reportError, useReauth } from '../../components/superadmin/Reauth';
import {
  useCreateSuperAdminAdminMutation,
  useGetAdminEventsQuery,
  useGetAuditTrailQuery,
  useGetMonitoringQuery,
  useGetPolicyCatalogueQuery,
  useGetSuperChatMessagesQuery,
  useGetSuperChatsQuery,
  useGetRecoveryQuery,
  useGetSuperAdminsQuery,
  useGetSuperOverviewQuery,
  useGetSuperSecurityEventsQuery,
  useGetSuspiciousLoginsQuery,
  useResetAdminPasswordMutation,
  useRevokeAdminSessionsMutation,
  useSetAdminDelegationMutation,
  useSetAdminPoliciesMutation,
  useSetAdminStatusMutation,
  useUpdateSuperAdminAdminMutation,
} from '../../services/superAdmin';
import { ROLE_LABELS } from '../../utils/constants';
import { rolesSummary } from '../../utils/delegation';
import { OtpTab } from '../admin/SecurityLogs';
import { fmtDateTime } from '../../utils/format';

/**
 * Super Admin console. Deliberately has no link to the Emergency Control
 * page. Every action is authorized on the server; sensitive ones prompt for
 * the password (useReauth) when the server asks for it.
 */
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'admins', label: 'Admin accounts' },
  { value: 'security', label: 'Security center' },
  { value: 'chats', label: 'Chats (read-only)' },
  { value: 'otps', label: 'Gate-pass OTPs' },
  { value: 'monitoring', label: 'Campus monitoring' },
  { value: 'recovery', label: 'Backup & recovery' },
];

export default function SuperAdmin() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'overview';
  return (
    <div>
      <PageHeader icon={Crown} title="Super Admin" subtitle="Platform administration: admin accounts, policies, security and recovery." />
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-6" />
      {tab === 'overview' && <Overview />}
      {tab === 'admins' && <Admins />}
      {tab === 'security' && <SecurityCenter />}
      {tab === 'chats' && <Chats />}
      {tab === 'otps' && <OtpTab />}
      {tab === 'monitoring' && <Monitoring />}
      {tab === 'recovery' && <Recovery />}
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────── */
function Overview() {
  const { data, isLoading, error, refetch } = useGetSuperOverviewQuery();
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const roles = Object.entries(data.users.byRole).filter(([, v]) => v.total > 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Database} label="Database" value={data.health.database === 'connected' ? 'Healthy' : 'Down'} hint={`Uptime ${Math.round(data.health.uptimeSec / 60)} min`} />
        <StatCard icon={Power} label="Platform" value={data.health.platformMode === 'normal' ? 'Normal' : 'Restricted'} gradient={data.health.platformMode === 'normal' ? undefined : 'from-rose-400 to-rose-600'} />
        <StatCard icon={Activity} label="Active sessions" value={data.security.activeSessions} />
        <StatCard icon={ShieldAlert} label="Failed sign-ins (24 h)" value={data.security.failedLogins24h} hint={`${data.security.policyDenials24h} policy denials`} gradient="from-amber-400 to-amber-600" />
      </div>
      <Card>
        <CardHeader title="Accounts by role" subtitle={`Generated ${fmtDateTime(data.generatedAt)} · refreshed at most every 30 s`} />
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {roles.map(([role, v]) => (
            <div key={role} className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
              <p className="text-xs font-semibold muted">{ROLE_LABELS[role] || 'Super Admin'}</p>
              <p className="text-xl font-extrabold">{v.total}</p>
              <p className="text-[11px] muted">{v.active} active</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── Admin accounts ───────────────────────────────────────────────── */
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Admins() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const { data, isFetching, error, refetch } = useGetSuperAdminsQuery({ page, q: search || undefined, status: status || undefined });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const { guard, modal } = useReauth();

  useEffect(() => setPage(1), [search, status]);

  return (
    <Card>
      <CardHeader
        title="Admin accounts"
        subtitle="Only ordinary Admins are managed here. Super Admin accounts are provisioned from the server."
        action={<Button icon={Plus} onClick={() => setCreating(true)}>New admin</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input icon={Search} placeholder="Search name, email, employee ID" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-[220px] flex-1" />
        <Select keepCase value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Deactivated' }]} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <Skeleton className="h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={UserCog} title="No admin accounts" text="Create the first one with “New admin”." />
      ) : (
        <div className={cn('divide-y divide-white/50 dark:divide-white/10', isFetching && 'opacity-60')}>
          {data.items.map((a) => (
            <button key={a._id} type="button" onClick={() => setSelected(a)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-white/30 dark:hover:bg-white/5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{a.name}</p>
                <p className="truncate text-xs muted">{a.email} · {a.employeeId || '—'}</p>
              </div>
              <Badge color={a.isActive ? 'success' : 'neutral'}>{a.isActive ? 'Active' : 'Deactivated'}</Badge>
              <Badge color={a.policyManaged ? 'info' : 'warning'}>{a.policyManaged ? `${a.policies.length} module policies` : 'Legacy · unrestricted'}</Badge>
              {a.policyManaged && (
                <span className="text-[11px] muted" title="Roles this Admin may create / assign (delegation limits)">
                  Creates: {rolesSummary(a.delegation?.createRoles, ROLE_LABELS, 'per policies')} · Assigns: {rolesSummary(a.delegation?.assignRoles, ROLE_LABELS, 'per policies')}
                </span>
              )}
              {a.mustChangePassword && <Badge color="warning">Password change pending</Badge>}
            </button>
          ))}
        </div>
      )}
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
      {creating && <CreateAdminModal guard={guard} onClose={() => setCreating(false)} />}
      {selected && <AdminDetail guard={guard} adminId={selected._id} initial={selected} onClose={() => setSelected(null)} />}
      {modal}
    </Card>
  );
}

const EMPTY = { name: '', email: '', employeeId: '', phone: '', password: '' };

function CreateAdminModal({ guard, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [policies, setPolicies] = useState([]);
  const { data: cat } = useGetPolicyCatalogueQuery();
  const [create, { isLoading }] = useCreateSuperAdminAdminMutation();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    try {
      await guard(() => create({ ...form, phone: form.phone || undefined, policies }).unwrap());
      toast.success('Admin created. Share the temporary password securely — it must be changed at first sign-in.');
      onClose();
    } catch (err) {
      reportError(err, 'Could not create the admin');
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="New admin account" subtitle="The role is always ordinary Admin. Grant only the module policies this person needs."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={isLoading} onClick={submit}>Create admin</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Full name" value={form.name} onChange={set('name')} />
        <Input label="Email (sign-in)" type="email" value={form.email} onChange={set('email')} />
        <Input label="Employee ID" value={form.employeeId} onChange={set('employeeId')} />
        <Input label="Phone (optional)" value={form.phone} onChange={set('phone')} />
        <Input label="Temporary password" type="password" autoComplete="new-password" hint="10+ characters with a letter, number and symbol. Never stored or shown again." value={form.password} onChange={set('password')} className="sm:col-span-2" />
      </div>
      <p className="mb-2 mt-5 text-sm font-extrabold">Module policies</p>
      <PolicyEditor catalogue={cat?.modules} value={policies} onChange={setPolicies} />
    </Modal>
  );
}

function AdminDetail({ guard, adminId, initial, onClose }) {
  const { data: list } = useGetSuperAdminsQuery({ q: initial.email });
  const admin = list?.items?.find((a) => a._id === adminId) || initial;
  const { data: cat } = useGetPolicyCatalogueQuery();
  const { data: events } = useGetAdminEventsQuery({ id: adminId, limit: 10 });
  const [policies, setPolicies] = useState(admin.policies || []);
  const [profile, setProfile] = useState({ name: admin.name, employeeId: admin.employeeId || '', phone: admin.phone || '' });
  const [reset, setReset] = useState({ newPassword: '', confirmPassword: '', reason: '' });
  const [reason, setReason] = useState('');
  const [savePolicies, savingPolicies] = useSetAdminPoliciesMutation();
  const [saveDelegation, savingDelegation] = useSetAdminDelegationMutation();
  const [update, updating] = useUpdateSuperAdminAdminMutation();
  const [setStatus, settingStatus] = useSetAdminStatusMutation();
  const [resetPw, resetting] = useResetAdminPasswordMutation();
  const [revoke, revoking] = useRevokeAdminSessionsMutation();

  const run = async (fn, ok, fail) => {
    try {
      await guard(fn);
      toast.success(ok);
    } catch (err) {
      reportError(err, fail);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={admin.name} subtitle={`${admin.email} · last sign-in ${admin.lastLogin ? fmtDateTime(admin.lastLogin) : 'never'}`}>
      <div className="space-y-6">
        <section>
          <h4 className="mb-2 text-sm font-extrabold">Profile</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Name" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
            <Input label="Employee ID" value={profile.employeeId} onChange={(e) => setProfile((p) => ({ ...p, employeeId: e.target.value }))} />
            <Input label="Phone" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <Button size="sm" variant="soft" className="mt-2" loading={updating.isLoading}
            onClick={() => run(() => update({ id: adminId, name: profile.name, employeeId: profile.employeeId, phone: profile.phone || undefined }).unwrap(), 'Profile saved', 'Could not save the profile')}>
            Save profile
          </Button>
        </section>

        <section>
          <h4 className="mb-1 text-sm font-extrabold">Module policies</h4>
          <p className="mb-3 text-xs muted">
            {admin.policyManaged ? 'This admin can use only what is ticked below.' : 'Legacy admin: currently unrestricted. Saving policies switches this account to deny-by-default.'}
          </p>
          <PolicyEditor catalogue={cat?.modules} value={policies} onChange={setPolicies} />
          <Button size="sm" className="mt-3" icon={ShieldCheck} loading={savingPolicies.isLoading}
            onClick={() => run(() => savePolicies({ id: adminId, policies }).unwrap(), 'Policies saved — effective on the admin’s next request', 'Could not save policies')}>
            Save policies
          </Button>
        </section>

        <section>
          <h4 className="mb-1 text-sm font-extrabold">User creation &amp; delegation</h4>
          <p className="mb-3 text-xs muted">
            Which roles this Admin may create or assign, and the most it may delegate to other Admins. Limits only narrow the module policies above; they never add access.
          </p>
          <DelegationEditor
            key={`${adminId}-${admin.delegation?.updatedAt || 'none'}`}
            admin={admin}
            catalogue={cat?.modules}
            saving={savingDelegation.isLoading}
            onSave={(delegation) => run(() => saveDelegation({ id: adminId, delegation }).unwrap(), 'Delegation saved — effective on the admin’s next request', 'Could not save the delegation')}
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Card className="!p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><KeyRound className="h-4 w-4" /> Reset password</h4>
            <div className="space-y-2">
              <Input type="password" autoComplete="new-password" placeholder="Temporary password" value={reset.newPassword} onChange={(e) => setReset((r) => ({ ...r, newPassword: e.target.value }))} />
              <Input type="password" autoComplete="new-password" placeholder="Confirm temporary password" value={reset.confirmPassword} onChange={(e) => setReset((r) => ({ ...r, confirmPassword: e.target.value }))} />
              <Input placeholder="Reason" value={reset.reason} onChange={(e) => setReset((r) => ({ ...r, reason: e.target.value }))} />
              <Button size="sm" variant="danger" loading={resetting.isLoading}
                onClick={() => run(async () => { await resetPw({ id: adminId, ...reset }).unwrap(); setReset({ newPassword: '', confirmPassword: '', reason: '' }); }, 'Password reset; the admin was signed out everywhere', 'Could not reset the password')}>
                Reset & sign out
              </Button>
            </div>
          </Card>
          <Card className="!p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><Power className="h-4 w-4" /> Access</h4>
            <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant={admin.isActive ? 'danger' : 'primary'} loading={settingStatus.isLoading}
                onClick={() => run(() => setStatus({ id: adminId, isActive: !admin.isActive, reason }).unwrap(), admin.isActive ? 'Admin deactivated and signed out' : 'Admin reactivated', 'Could not change the status')}>
                {admin.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
              <Button size="sm" variant="outline" icon={LogOut} loading={revoking.isLoading}
                onClick={() => run(() => revoke(adminId).unwrap(), 'All sessions revoked', 'Could not revoke sessions')}>
                Revoke sessions
              </Button>
            </div>
            <p className="mt-2 text-xs muted">{events?.activeSessions?.length ?? '—'} active session(s)</p>
          </Card>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-extrabold">Recent authentication events</h4>
          {!events ? <Skeleton className="h-16" /> : events.items.length === 0 ? <p className="text-sm muted">No events yet.</p> : (
            <ul className="space-y-1 text-xs">
              {events.items.map((e) => (
                <li key={e._id} className="flex flex-wrap gap-2">
                  {e.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                  <span className="font-semibold">{e.event.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="muted">{fmtDateTime(e.createdAt)} · {e.device || e.client}{e.reason ? ` · ${e.reason}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

/* ── Security center ──────────────────────────────────────────────── */
function SecurityCenter() {
  const [view, setView] = useState('events');
  return (
    <div className="space-y-4">
      <Tabs tabs={[{ value: 'events', label: 'Security events' }, { value: 'suspicious', label: 'Suspicious sign-ins' }, { value: 'audit', label: 'Protected audit trail' }]} value={view} onChange={setView} />
      {view === 'events' && <SecurityEvents />}
      {view === 'suspicious' && <Suspicious />}
      {view === 'audit' && <AuditTrail />}
    </div>
  );
}

function SecurityEvents() {
  const [page, setPage] = useState(1);
  const [failedOnly, setFailedOnly] = useState(false);
  const { data, error, refetch } = useGetSuperSecurityEventsQuery({ page, success: failedOnly ? 'false' : undefined });
  return (
    <Card>
      <CardHeader title="All security events" subtitle="Includes privileged accounts. Read-only." action={
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={failedOnly} onChange={(e) => { setFailedOnly(e.target.checked); setPage(1); }} /> Failures only</label>
      } />
      <EventTable data={data} error={error} refetch={refetch} render={(e) => [e.event.replace(/_/g, ' ').toLowerCase(), e.actor?.email || e.identifier || '—', e.targetUser?.email || '—', e.ip || '—', fmtDateTime(e.createdAt)]} ok={(e) => e.success} />
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
    </Card>
  );
}

function Suspicious() {
  const { data, error, refetch } = useGetSuspiciousLoginsQuery();
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-32" />;
  return (
    <Card>
      <CardHeader title="Repeated failed sign-ins (last 24 h)" subtitle="Networks with three or more failures." />
      {data.items.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing suspicious" /> : (
        <ul className="divide-y divide-white/50 text-sm dark:divide-white/10">
          {data.items.map((r) => (
            <li key={r.ip} className="flex flex-wrap items-center gap-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="font-bold">{r.ip || 'unknown'}</span>
              <Badge color="danger">{r.failures} failures</Badge>
              <span className="text-xs muted">{(r.accounts || []).filter(Boolean).join(', ')} · last {fmtDateTime(r.last)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AuditTrail() {
  const [page, setPage] = useState(1);
  const { data, error, refetch } = useGetAuditTrailQuery({ page });
  return (
    <Card>
      <CardHeader title="Protected audit trail" subtitle="Privileged operations. Append-only: these records cannot be edited or deleted from the application." />
      <EventTable data={data} error={error} refetch={refetch} render={(a) => [a.action.replace(/_/g, ' ').toLowerCase(), a.actor?.email || a.actorRole || '—', a.target?.email || '—', a.reason || '—', fmtDateTime(a.createdAt)]} ok={(a) => a.outcome === 'success' || a.outcome === 'unchanged'} />
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
    </Card>
  );
}

function EventTable({ data, error, refetch, render, ok }) {
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-40" />;
  if (!data.items.length) return <EmptyState icon={ShieldCheck} title="No records" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <tbody className="divide-y divide-white/50 dark:divide-white/10">
          {data.items.map((row) => (
            <tr key={row._id}>
              <td className="py-2 pr-2">{ok(row) ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}</td>
              {render(row).map((cell, i) => (
                <td key={i} className={cn('py-2 pr-3', i === 0 && 'font-bold capitalize')}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Chats (read-only) ────────────────────────────────────────────── */
const convTitle = (c) => c.name || (c.participants || []).map((p) => p.name).join(', ') || 'Conversation';

function Chats() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const search = useDebounced(q);
  const { data, error, refetch, isFetching } = useGetSuperChatsQuery({ page, q: search || undefined });
  useEffect(() => setPage(1), [search]);
  return (
    <Card>
      <CardHeader title="All chats" subtitle="Read-only. You cannot send messages. Every conversation you open is recorded in the protected audit trail." />
      <Input icon={Search} placeholder="Search by person or group name" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4" />
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-40" /> : data.items.length === 0 ? (
        <EmptyState icon={Users} title="No conversations" />
      ) : (
        <ul className={cn('divide-y divide-white/50 dark:divide-white/10', isFetching && 'opacity-60')}>
          {data.items.map((c) => (
            <li key={c._id}>
              <button type="button" onClick={() => setOpenId(c._id)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-white/30 dark:hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{convTitle(c)}</p>
                  <p className="truncate text-xs muted">{c.lastMessage?.body ? `${c.lastMessage.sender?.name || ''}: ${c.lastMessage.body}` : 'No messages yet'}</p>
                </div>
                <Badge color="neutral">{c.type}</Badge>
                <span className="text-xs muted">{c.participantCount} people · {fmtDateTime(c.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
      {openId && <ChatViewer id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function ChatViewer({ id, onClose }) {
  const [page, setPage] = useState(1);
  const { data, error, refetch } = useGetSuperChatMessagesQuery({ id, page });
  return (
    <Modal open onClose={onClose} size="lg" title={data ? convTitle(data.conversation) : 'Conversation'} subtitle="Read-only view — sending is not available.">
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-40" /> : (
        <>
          {data.pages > 1 && <Pagination page={page} pages={data.pages} onChange={setPage} />}
          <p className="mb-2 text-xs muted">Page 1 is the newest messages.</p>
          <ul className="space-y-2">
            {data.items.map((m) => (
              <li key={m._id} className="rounded-2xl bg-white/40 p-3 text-sm dark:bg-white/5">
                <p className="text-xs font-bold">{m.sender?.name || 'Unknown'} <span className="font-normal muted">· {ROLE_LABELS[m.sender?.role] || ''} · {fmtDateTime(m.createdAt)}{m.editedAt ? ' · edited' : ''}</span></p>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.deleted ? <span className="muted italic">Message deleted</span> : m.body}</p>
                {m.attachment?.url && <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-primary-600 underline">{m.attachment.name || 'Attachment'}</a>}
              </li>
            ))}
          </ul>
          {!data.items.length && <p className="text-sm muted">No messages.</p>}
        </>
      )}
    </Modal>
  );
}

/* ── Monitoring & recovery ────────────────────────────────────────── */
function Monitoring() {
  const { data, error, refetch } = useGetMonitoringQuery();
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-32" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={CheckCircle2} label="Attendance sessions today" value={data.attendanceSessionsToday} />
        <StatCard icon={Activity} label="Active timetable periods" value={data.activePeriods} />
        <StatCard icon={Users} label="Upcoming events" value={data.upcomingEvents} />
        <StatCard icon={Users} label="Approved clubs" value={data.approvedClubs} />
        <StatCard icon={ShieldAlert} label="Pending gate passes" value={data.pendingGatePasses} />
      </div>
      <p className="text-sm muted">{data.note}</p>
    </div>
  );
}

function Recovery() {
  const { data, error, refetch } = useGetRecoveryQuery();
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-32" />;
  const { backup, lastHealthCheck } = data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Backups" subtitle="Reported by the server's backup job (BACKUP_STATUS_FILE)." />
        {!backup.configured ? (
          <EmptyState icon={HardDriveDownload} title="Backup status not configured" text="Have your backup job write its status file and set BACKUP_STATUS_FILE on the server. See docs/SUPER_ADMIN.md." />
        ) : !backup.readable ? (
          <p className="text-sm font-semibold text-rose-600">The backup status file could not be read. Check the backup job on the server.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="muted">Last backup</dt><dd className="font-bold">{backup.lastBackupAt ? fmtDateTime(backup.lastBackupAt) : 'None recorded'}</dd>
            <dt className="muted">Last verified restore</dt><dd className="font-bold">{backup.lastVerifiedAt ? fmtDateTime(backup.lastVerifiedAt) : 'Never'}</dd>
            <dt className="muted">Last result</dt><dd className="font-bold">{backup.lastResult || '—'}</dd>
          </dl>
        )}
      </Card>
      <Card>
        <CardHeader title="Recovery readiness" subtitle="Last health check run from Emergency Control." />
        {!lastHealthCheck ? <p className="text-sm muted">No health check has been run yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {(lastHealthCheck.checks || []).map((c) => (
              <li key={c.name} className="flex items-center gap-2">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : c.severity === 'critical' ? <XCircle className="h-4 w-4 text-rose-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                <span className="font-semibold capitalize">{c.name.replace(/_/g, ' ')}</span>
                <span className="muted">{c.detail}</span>
              </li>
            ))}
            <li className="pt-1 text-xs muted">Checked {fmtDateTime(lastHealthCheck.at)}</li>
          </ul>
        )}
      </Card>
    </div>
  );
}
