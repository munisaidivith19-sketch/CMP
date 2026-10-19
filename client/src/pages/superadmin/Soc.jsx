import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Activity, AlertTriangle, BookOpen, ClipboardList, FlaskConical, Gauge, HeartPulse, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, cn } from '../../components/ui/primitives';
import { Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { KindTag, RunResult, RunTestButton, StatusBadge } from '../../components/superadmin/soc';
import {
  errorMessage,
  useAddSocIncidentNoteMutation,
  useCreateSocIncidentMutation,
  useGetSocAlertsQuery,
  useGetSocAssigneesQuery,
  useGetSocCatalogQuery,
  useGetSocCoverageQuery,
  useGetSocDiagnosticsQuery,
  useGetSocErrorsQuery,
  useGetSocHealthQuery,
  useGetSocIncidentQuery,
  useGetSocIncidentsQuery,
  useGetSocOverviewQuery,
  useGetSocRunsQuery,
  useGetSuperSecurityEventsQuery,
  useRunSocHealthMutation,
  useUpdateSocIncidentMutation,
} from '../../services/superAdmin';
import { countLabel, percentLabel, severityTone, telemetryNotice, ERROR_STATUS_LABEL } from './socModel';
import { fmtDateTime } from '../../utils/format';

/**
 * Super Admin → Security Operations. Every number comes from the server for
 * an explicit time range; "No data" is shown where the server has none.
 * The server authorizes every request (super_admin only).
 */
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'errors', label: 'Error explorer' },
  { value: 'security', label: 'Security log' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'health', label: 'System health' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'catalog', label: 'Error catalog' },
  { value: 'coverage', label: 'Coverage' },
];
const RANGE_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];
const words = (s) => String(s || '').replace(/_/g, ' ');

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Soc() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'overview';
  const [newIncident, setNewIncident] = useState(null);
  return (
    <div>
      <PageHeader icon={ShieldAlert} title="Security Operations" subtitle="Security monitoring, errors, diagnostics and guided repairs — Super Admin only." />
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-6" />
      {tab === 'overview' && <Overview onOpenIncident={setNewIncident} go={(t) => setParams({ tab: t })} />}
      {tab === 'errors' && <ErrorExplorer />}
      {tab === 'security' && <SecurityLog />}
      {tab === 'incidents' && <Incidents onNew={() => setNewIncident({})} />}
      {tab === 'health' && <Health />}
      {tab === 'diagnostics' && <Diagnostics />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'coverage' && <Coverage />}
      {newIncident && <NewIncidentModal seed={newIncident} onClose={() => setNewIncident(null)} />}
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────── */
function Overview({ onOpenIncident, go }) {
  const [range, setRange] = useState('24h');
  const { data, error, refetch, isFetching } = useGetSocOverviewQuery(range);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;
  const sev = data.alerts.bySeverity;
  const st = data.errors.byStatus;
  return (
    <div className={cn('space-y-6', isFetching && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-3">
        <Select keepCase value={range} onChange={(e) => setRange(e.target.value)} options={RANGE_OPTIONS} />
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={refetch}>Refresh</Button>
        <span className="text-xs muted">Generated {fmtDateTime(data.generatedAt)} · from {fmtDateTime(data.since)}</span>
      </div>
      <p className={cn('rounded-2xl px-4 py-2 text-xs font-semibold', data.telemetry.complete && !data.telemetry.lastFlushError ? 'bg-emerald-500/10' : 'bg-amber-500/15')}>{telemetryNotice(data.telemetry)}</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={AlertTriangle} label="Security alerts (suspected)" value={data.alerts.total} hint={`${sev.high || 0} high · ${sev.medium || 0} medium`} gradient="from-rose-400 to-rose-600" />
        <StatCard icon={ShieldAlert} label="Failed sign-ins" value={data.security.failedLogins} hint={`${data.security.policyDenials} policy refusals`} gradient="from-amber-400 to-amber-600" />
        <StatCard icon={Activity} label="Server error rate" value={percentLabel(data.traffic.serverErrorRate)} hint={`${countLabel(data.traffic.serverErrors)} 5xx of ${countLabel(data.traffic.requests)} requests`} />
        <StatCard icon={ClipboardList} label="Unclassified errors" value={data.errors.unclassified} hint="Need a catalog definition" onClick={() => go('errors')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Errors by status" subtitle="Distinct errors seen in this range" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.keys(ERROR_STATUS_LABEL).map((s) => (
              <div key={s} className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
                <p className="text-[11px] font-semibold muted">{ERROR_STATUS_LABEL[s].split(' —')[0]}</p>
                <p className="text-xl font-extrabold">{st[s] || 0}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs muted">Last error recorded: {data.errors.lastErrorAt ? fmtDateTime(data.errors.lastErrorAt) : 'none recorded'}</p>
        </Card>
        <Card>
          <CardHeader title="Captured errors by source" subtitle="Occurrences counted in this range" />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(data.traffic.capturedBySource).map(([k, v]) => (
              <li key={k} className="flex justify-between"><span className="capitalize muted">{words(k)}</span><span className="font-bold">{v}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs muted">
            Rate-limited requests: {countLabel(data.traffic.rateLimited)} · Pipeline: {data.pipeline.enabled ? `${data.pipeline.written} written, ${data.pipeline.dropped} dropped, ${data.pipeline.failed} failed since ${fmtDateTime(data.pipeline.startedAt)}` : 'capture disabled'}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Admin, role and policy changes" subtitle="From the protected audit trail" />
        {Object.keys(data.security.adminChanges).length === 0 ? <p className="text-sm muted">No privileged changes in this range.</p> : (
          <div className="flex flex-wrap gap-2">{Object.entries(data.security.adminChanges).map(([k, v]) => <Badge key={k} color={k === 'PRIVILEGE_ESCALATION_BLOCKED' ? 'danger' : 'neutral'}>{words(k).toLowerCase()} · {v}</Badge>)}</div>
        )}
      </Card>

      <Alerts range={range} onOpenIncident={onOpenIncident} />
    </div>
  );
}

function Alerts({ range, onOpenIncident }) {
  const { data, error, refetch } = useGetSocAlertsQuery(range);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-32" />;
  return (
    <Card>
      <CardHeader title="Suspicious activity" subtitle="Computed from stored security records. These are suspicions, not confirmed attacks." />
      {data.items.length === 0 ? <EmptyState icon={ShieldCheck} title="No suspicious patterns in this range" text="Thresholds: 10+ failed sign-ins from one network, 5+ for one account, 10+ policy refusals for one admin, blocked privilege changes, rate-limit surges." /> : (
        <ul className="divide-y divide-white/50 dark:divide-white/10">
          {data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
              <Badge color={severityTone(a.severity)}>{a.severity}</Badge>
              <div className="min-w-[200px] flex-1">
                <p className="font-bold">{a.title} <span className="text-xs font-semibold muted">(suspected)</span></p>
                <p className="text-sm">{a.detail}</p>
                <p className="text-xs muted">{a.explanation}</p>
              </div>
              <Button size="sm" variant="outline" icon={Plus} onClick={() => onOpenIncident({ title: a.title, category: 'security', severity: a.severity === 'high' ? 'high' : 'medium', summary: `${a.detail}\n\n${a.explanation}`, alert: { type: a.type, key: a.key, severity: a.severity, evidence: a.evidence, range: a.range } })}>Open incident</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── Error explorer ───────────────────────────────────────────────── */
const SOURCES = ['express', 'authorization', 'rate_limit', 'database', 'job', 'socket', 'process', 'client_web', 'client_mobile'];
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function ErrorExplorer() {
  const [f, setF] = useState({ q: '', source: '', severity: '', status: '', classification: '', module: '', environment: '', range: '7d', correlationId: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q);
  const corr = useDebounced(f.correlationId);
  const params = Object.fromEntries(Object.entries({ ...f, q, correlationId: corr.length >= 8 ? corr : '', page }).filter(([, v]) => v));
  const { data, error, refetch, isFetching } = useGetSocErrorsQuery(params);
  const set = (k) => (e) => {
    setF((s) => ({ ...s, [k]: e.target.value }));
    setPage(1);
  };
  return (
    <Card>
      <CardHeader title="Error explorer" subtitle="One row per distinct error; repeats are counted. Server-side search and pagination." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input icon={Search} placeholder="Search title, message, route, code" value={f.q} onChange={set('q')} />
        <Input placeholder="Correlation ID" value={f.correlationId} onChange={set('correlationId')} />
        <Select keepCase value={f.range} onChange={set('range')} options={RANGE_OPTIONS} placeholder="Any time" />
        <Select keepCase value={f.source} onChange={set('source')} options={SOURCES.map((s) => ({ value: s, label: words(s) }))} placeholder="All sources" />
        <Select keepCase value={f.severity} onChange={set('severity')} options={SEVERITIES} placeholder="All severities" />
        <Select keepCase value={f.status} onChange={set('status')} options={Object.entries(ERROR_STATUS_LABEL).map(([value, label]) => ({ value, label }))} placeholder="All statuses" />
        <Select keepCase value={f.classification} onChange={set('classification')} options={[{ value: 'classified', label: 'Classified' }, { value: 'unclassified', label: 'Unclassified' }]} placeholder="Classified or not" />
        <Input placeholder="Module (e.g. attendance)" value={f.module} onChange={(e) => set('module')({ target: { value: e.target.value.toLowerCase().replace(/[^a-z_]/g, '') } })} />
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-40" /> : data.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No errors match" text="Nothing recorded for these filters. Errors appear here when the API, background jobs, the database, real-time server or the web app report them." />
      ) : (
        <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs muted"><tr><th className="py-2">Severity</th><th>Error</th><th>Module</th><th>Source</th><th>Count</th><th>Last seen</th><th>Status</th></tr></thead>
            <tbody className="divide-y divide-white/50 dark:divide-white/10">
              {data.items.map((e) => (
                <tr key={e._id} className="hover:bg-white/30 dark:hover:bg-white/5">
                  <td className="py-2 pr-2"><Badge color={severityTone(e.severity)}>{e.severity}</Badge></td>
                  <td className="max-w-[360px] pr-3">
                    <Link to={`/super-admin/soc/errors/${e._id}`} className="font-bold hover:underline">{e.title}</Link>
                    <p className="truncate text-xs muted">{e.code}{!e.classified && ' · unclassified'} · {e.method ? `${e.method} ` : ''}{e.route}</p>
                  </td>
                  <td className="pr-3 capitalize">{words(e.module)}</td>
                  <td className="pr-3 capitalize">{words(e.source)}</td>
                  <td className="pr-3 font-bold">{e.count}</td>
                  <td className="pr-3 text-xs">{fmtDateTime(e.lastSeenAt)}</td>
                  <td className="text-xs">{ERROR_STATUS_LABEL[e.status]}{e.regressions ? ` · regressed ×${e.regressions}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
    </Card>
  );
}

/* ── Security log explorer ────────────────────────────────────────── */
function SecurityLog() {
  const [q, setQ] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const [range, setRange] = useState('24h');
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const ms = { '1h': 3600e3, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 }[range];
  const [from] = useState(() => new Map());
  if (!from.has(range)) from.set(range, new Date(Date.now() - ms).toISOString());
  const { data, error, refetch } = useGetSuperSecurityEventsQuery({ page, q: search || undefined, success: failedOnly ? 'false' : undefined, from: from.get(range) });
  return (
    <Card>
      <CardHeader title="Security log" subtitle="Sign-ins, sessions, policy refusals, OTP and gate-pass events. Read-only; personal details are limited to what the log stores." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input icon={Search} placeholder="Search sign-in name, IP or reason" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="min-w-[220px] flex-1" />
        <Select keepCase value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }} options={RANGE_OPTIONS} />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={failedOnly} onChange={(e) => { setFailedOnly(e.target.checked); setPage(1); }} /> Failures only</label>
      </div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-40" /> : data.items.length === 0 ? <EmptyState icon={ShieldCheck} title="No security events match" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <tbody className="divide-y divide-white/50 dark:divide-white/10">
              {data.items.map((e) => (
                <tr key={e._id}>
                  <td className="py-2 pr-2"><StatusBadge status={e.success ? 'PASS' : 'FAIL'} /></td>
                  <td className="pr-3 font-bold capitalize">{words(e.event).toLowerCase()}</td>
                  <td className="pr-3">{e.actor?.email || e.identifier || '—'}</td>
                  <td className="pr-3">{e.ip || '—'}</td>
                  <td className="pr-3">{e.reason || '—'}</td>
                  <td>{fmtDateTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
    </Card>
  );
}

/* ── Incidents ────────────────────────────────────────────────────── */
const INCIDENT_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved'];
const ASSESSMENTS = { undetermined: 'Undetermined', suspected: 'Suspected', confirmed: 'Confirmed', false_positive: 'False positive' };

function Incidents({ onNew }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, error, refetch } = useGetSocIncidentsQuery({ page, status: status || undefined });
  return (
    <Card>
      <CardHeader title="Incidents" subtitle="Grouped investigations with an append-only timeline. Every change is in the protected audit trail." action={<Button icon={Plus} onClick={onNew}>New incident</Button>} />
      <div className="mb-4"><Select keepCase value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={INCIDENT_STATUSES} placeholder="All statuses" /></div>
      {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <Skeleton className="h-32" /> : data.items.length === 0 ? <EmptyState icon={ClipboardList} title="No incidents" text="Open one from a suspicious-activity alert or an error page." /> : (
        <ul className="divide-y divide-white/50 dark:divide-white/10">
          {data.items.map((i) => (
            <li key={i._id}>
              <button type="button" onClick={() => setOpen(i._id)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-white/30 dark:hover:bg-white/5">
                <span className="font-mono text-xs muted">#{i.number}</span>
                <Badge color={severityTone(i.severity)}>{i.severity}</Badge>
                <span className="min-w-[200px] flex-1 font-bold">{i.title}</span>
                <Badge color="neutral">{ASSESSMENTS[i.assessment]}</Badge>
                <span className="text-xs capitalize">{i.status}</span>
                <span className="text-xs muted">{i.assignee?.name || 'Unassigned'} · {fmtDateTime(i.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={data?.pages} onChange={setPage} />
      {open && <IncidentModal id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

export function NewIncidentModal({ seed = {}, onClose }) {
  const [form, setForm] = useState({ title: seed.title || '', summary: seed.summary || '', category: seed.category || 'reliability', severity: seed.severity || 'medium' });
  const [create, { isLoading }] = useCreateSocIncidentMutation();
  const submit = async () => {
    try {
      const r = await create({ ...form, assessment: seed.alert ? 'suspected' : 'undetermined', errorIds: seed.errorIds, runIds: seed.runIds, alert: seed.alert }).unwrap();
      toast.success(`Incident #${r.number} opened`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open the incident'));
    }
  };
  return (
    <Modal open onClose={onClose} title="Open an incident" subtitle={seed.alert ? 'Opened from a suspicious-activity alert — assessment starts as "suspected".' : 'Assessment starts as "undetermined".'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={isLoading} onClick={submit} disabled={form.title.trim().length < 3}>Open incident</Button></>}>
      <div className="space-y-3">
        <Input label="Title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Summary" value={form.summary} maxLength={2000} rows={4} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Category" keepCase value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={[{ value: 'reliability', label: 'Reliability' }, { value: 'security', label: 'Security' }, { value: 'other', label: 'Other' }]} />
          <Select label="Severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} options={['low', 'medium', 'high', 'critical']} />
        </div>
      </div>
    </Modal>
  );
}

function IncidentModal({ id, onClose }) {
  const { data: inc, error, refetch } = useGetSocIncidentQuery(id);
  const { data: people } = useGetSocAssigneesQuery();
  const [update, { isLoading }] = useUpdateSocIncidentMutation();
  const [addNote] = useAddSocIncidentNoteMutation();
  const [note, setNote] = useState('');
  const [assessNote, setAssessNote] = useState('');
  const [resolution, setResolution] = useState('');
  const apply = async (body, ok = 'Updated') => {
    try {
      await update({ id, ...body }).unwrap();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update'));
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={inc ? `#${inc.number} · ${inc.title}` : 'Incident'} subtitle={inc ? `${inc.category} · opened ${fmtDateTime(inc.createdAt)} by ${inc.createdBy?.name || '—'}` : undefined}>
      {error ? <ErrorState error={error} onRetry={refetch} /> : !inc ? <Skeleton className="h-40" /> : (
        <div className="space-y-4 text-sm">
          {inc.summary && <p className="whitespace-pre-wrap">{inc.summary}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Status" keepCase value={inc.status} disabled={isLoading} onChange={(e) => (e.target.value === 'resolved' ? toast('Write resolution notes below and press "Resolve".') : apply({ status: e.target.value }))} options={INCIDENT_STATUSES} />
            <Select label="Severity" value={inc.severity} disabled={isLoading} onChange={(e) => apply({ severity: e.target.value })} options={['low', 'medium', 'high', 'critical']} />
            <Select label="Assignee" keepCase value={inc.assignee?._id || ''} disabled={isLoading} onChange={(e) => apply({ assignee: e.target.value || null })} placeholder="Unassigned" options={(people?.items || []).map((p) => ({ value: p._id, label: p.name }))} />
          </div>
          <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
            <p className="font-bold">Assessment: {ASSESSMENTS[inc.assessment]}</p>
            <p className="text-xs muted">Mark "confirmed" or "false positive" only with evidence, and write it down.</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input className="min-w-[240px] flex-1" placeholder="Evidence / reasoning" value={assessNote} onChange={(e) => setAssessNote(e.target.value)} />
              {Object.entries(ASSESSMENTS).filter(([k]) => k !== inc.assessment).map(([k, label]) => (
                <Button key={k} size="sm" variant="outline" onClick={() => apply({ assessment: k, assessmentNote: assessNote }, `Assessment: ${label}`)}>{label}</Button>
              ))}
            </div>
          </div>
          {inc.errorEvents?.length > 0 && (
            <div>
              <p className="mb-1 font-bold">Related errors</p>
              <ul className="space-y-1">{inc.errorEvents.map((e) => <li key={e._id}><Link className="hover:underline" to={`/super-admin/soc/errors/${e._id}`}>{e.title}</Link> <span className="text-xs muted">{e.code} · {ERROR_STATUS_LABEL[e.status]} · ×{e.count}</span></li>)}</ul>
            </div>
          )}
          {inc.diagnosticRuns?.length > 0 && <p className="text-xs">Linked diagnostic runs: {inc.diagnosticRuns.map((r) => `${r.testName || r.testId} (${r.status})`).join(', ')}</p>}
          {inc.securityEventDetails?.length > 0 && <p className="text-xs">Linked security events: {inc.securityEventDetails.length}</p>}
          {inc.alert && (
            <details><summary className="cursor-pointer text-xs font-semibold">Alert snapshot (redacted)</summary><pre className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-black/5 p-2 text-[11px] dark:bg-white/5">{JSON.stringify(inc.alert, null, 2)}</pre></details>
          )}
          <div>
            <p className="mb-1 font-bold">Timeline</p>
            <ol className="space-y-1 border-l border-white/60 pl-3 dark:border-white/10">
              {inc.timeline.map((t) => (
                <li key={t._id} className="text-xs">
                  <span className="muted">{fmtDateTime(t.at)} · {t.by?.name || 'System'} · </span>
                  <span className="font-semibold">{t.type}</span>
                  {t.from || t.to ? ` ${t.from || '—'} → ${t.to || '—'}` : ''}
                  {t.text && <span className="block whitespace-pre-wrap">{t.text}</span>}
                </li>
              ))}
            </ol>
            <div className="mt-2 flex gap-2">
              <Input className="flex-1" placeholder="Add an investigation note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" disabled={note.trim().length < 2} onClick={async () => { try { await addNote({ id, text: note }).unwrap(); setNote(''); } catch (err) { toast.error(errorMessage(err)); } }}>Add</Button>
            </div>
          </div>
          {inc.status !== 'resolved' ? (
            <div className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
              <Textarea label="Resolution notes" rows={3} value={resolution} maxLength={2000} onChange={(e) => setResolution(e.target.value)} hint="Required to resolve. Say what was found and what was done." />
              <Button className="mt-2" size="sm" disabled={resolution.trim().length < 5} loading={isLoading} onClick={() => apply({ status: 'resolved', resolution }, 'Incident resolved')}>Resolve</Button>
            </div>
          ) : (
            <p className="rounded-2xl bg-emerald-500/10 p-3"><span className="font-bold">Resolved {fmtDateTime(inc.resolvedAt)}.</span> {inc.resolution}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── System health ────────────────────────────────────────────────── */
function Health() {
  const { data, error, refetch } = useGetSocHealthQuery();
  const [run, { isLoading }] = useRunSocHealthMutation();
  const [fresh, setFresh] = useState(null);
  const h = fresh || data;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!h) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2">System health <StatusBadge status={h.status} /></span>}
          subtitle={`${h.scope} · checked ${fmtDateTime(h.checkedAt)}${h.cached ? ` (cached up to ${h.cacheSeconds} s)` : ''}. UNKNOWN means no data — it is never counted as healthy.`}
          action={<Button size="sm" icon={HeartPulse} loading={isLoading} onClick={async () => { try { setFresh(await run().unwrap()); } catch (err) { toast.error(errorMessage(err)); } }}>Run checks now</Button>}
        />
        <ul className="divide-y divide-white/50 text-sm dark:divide-white/10">
          {h.checks.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-3 py-2">
              <StatusBadge status={c.status} />
              <span className="min-w-[180px] font-bold">{c.label}</span>
              <span className="flex-1 muted">{c.detail}</span>
              <span className="text-[11px] muted">{c.testId}{c.durationMs !== undefined ? ` · ${c.durationMs} ms` : ''}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Background jobs" subtitle="Heartbeats in this API process. UNKNOWN right after a restart is normal." />
        {h.jobs.length === 0 ? <p className="text-sm muted">No background jobs are registered in this process.</p> : (
          <ul className="divide-y divide-white/50 text-sm dark:divide-white/10">
            {h.jobs.map((j) => (
              <li key={j.name} className="flex flex-wrap items-center gap-3 py-2">
                <StatusBadge status={j.status} />
                <span className="min-w-[200px] font-mono text-xs font-bold">{j.name}</span>
                <span className="flex-1 text-xs muted">{j.reason} {j.description ? `· ${j.description}` : ''}</span>
                <span className="text-[11px] muted">last run {j.lastRunAt ? fmtDateTime(j.lastRunAt) : 'never'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ── Diagnostics ──────────────────────────────────────────────────── */
function Diagnostics() {
  const { data, error, refetch } = useGetSocDiagnosticsQuery({});
  const [page, setPage] = useState(1);
  const history = useGetSocRunsQuery({ page });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;
  const tests = data.items.filter((t) => !t.requiresError);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Diagnostic test library" subtitle="Registered, read-only tests. Only these can run; nothing typed here is executed. Error-specific tests run from an error's page." />
        <ul className="space-y-3">
          {tests.map((t) => (
            <li key={t.id} className="rounded-2xl border border-white/50 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2"><FlaskConical className="h-4 w-4" /><span className="font-bold">{t.name}</span><span className="font-mono text-[11px] muted">{t.id}</span></div>
              <p className="mt-1 text-sm">{t.purpose}</p>
              <p className="text-xs muted">Result rules: {t.output}</p>
              <div className="mt-2"><RunTestButton test={t} onFinished={() => history.refetch()} /></div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Run history" subtitle="Every run is stored with its evidence and recorded in the audit trail." />
        {!history.data ? <Skeleton className="h-32" /> : history.data.items.length === 0 ? <p className="text-sm muted">No diagnostics have been run yet.</p> : (
          <div className="space-y-2">{history.data.items.map((r) => <RunResult key={r._id} run={r} compact />)}</div>
        )}
        <Pagination page={page} pages={history.data?.pages} onChange={setPage} />
      </Card>
    </div>
  );
}

/* ── Catalog ──────────────────────────────────────────────────────── */
function Catalog() {
  const { data, error, refetch } = useGetSocCatalogQuery();
  const [q, setQ] = useState('');
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;
  const rx = q.trim().toLowerCase();
  const items = data.items.filter((d) => !rx || `${d.code} ${d.title} ${d.module}`.toLowerCase().includes(rx));
  return (
    <Card>
      <CardHeader title="Error catalog" subtitle={`${data.items.length} definitions. Errors are classified only by structured signals, never by message similarity.`} />
      <Input icon={Search} placeholder="Search code, title or module" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4" />
      <div className="space-y-2">
        {items.map((d) => (
          <details key={d.code} className="rounded-2xl border border-white/50 p-3 dark:border-white/10">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <BookOpen className="h-4 w-4" />
              <span className="font-mono text-xs font-bold">{d.code}</span>
              <span className="font-bold">{d.title}</span>
              {d.severity && <Badge color={severityTone(d.severity)}>{d.severity}</Badge>}
              <span className="text-xs capitalize muted">{words(d.module)}</span>
              {!d.repair && <span className="text-xs muted">· no repair guide</span>}
            </summary>
            <div className="mt-2 space-y-2 text-sm">
              <p>{d.summary}</p>
              <p className="muted">{d.meaning}</p>
              {d.causes?.length > 0 && <div><p className="font-semibold">Possible causes</p><ul className="list-disc pl-5">{d.causes.map((c) => <li key={c.id}>{c.text}</li>)}</ul></div>}
              <p className="text-xs"><span className="font-semibold">Tests:</span> {d.diagnostics?.join(', ') || d.verification?.tests?.join(', ') || 'none'}</p>
              <p className="text-xs muted">v{d.version} · updated {d.updatedAt} · {d.classification}</p>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

/* ── Coverage ─────────────────────────────────────────────────────── */
function Coverage() {
  const { data, error, refetch } = useGetSocCoverageQuery();
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Gauge} label="Average tooling coverage" value={`${data.overallScore} %`} hint="Measured from the running code" />
        <StatCard icon={BookOpen} label="Error definitions" value={t.errorDefinitions} hint={`${t.repairGuides} with repair guides`} />
        <StatCard icon={FlaskConical} label="Diagnostic tests" value={t.diagnostics} />
        <StatCard icon={AlertTriangle} label="Modules without definitions" value={t.modulesWithoutDefinitions} hint={`of ${t.modules} modules · ${t.mountedRoutes} routes`} gradient="from-amber-400 to-amber-600" />
      </div>
      <Card>
        <CardHeader title="Error sources" subtitle="Which parts of VEXON report errors to the SOC" />
        <ul className="space-y-1 text-sm">
          {data.sources.map((s) => (
            <li key={s.source} className="flex flex-wrap items-center gap-2"><StatusBadge status={s.connected ? 'PASS' : 'FAIL'} /><span className="font-semibold">{s.label}</span>{s.detail && <span className="text-xs muted">{s.detail}</span>}</li>
          ))}
        </ul>
      </Card>
      {data.brokenReferences.length > 0 && <Card><CardHeader title="Broken catalog references" /><ul className="text-sm">{data.brokenReferences.map((b) => <li key={`${b.code}${b.testId}`}>{b.code} → {b.testId} (not registered)</li>)}</ul></Card>}
      <Card>
        <CardHeader title="Coverage by module" subtitle="Lowest first. Gaps are listed for every module." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="muted"><tr><th className="py-2">Module</th><th>Score</th><th>Routes</th><th>Capture</th><th>Definitions</th><th>Diagnostics</th><th>Repair guides</th><th>Test files</th><th>Gaps</th></tr></thead>
            <tbody className="divide-y divide-white/50 dark:divide-white/10">
              {data.modules.map((m) => (
                <tr key={m.module} className="align-top">
                  <td className="py-2 pr-2 font-bold capitalize">{words(m.module)}</td>
                  <td className="pr-2"><Badge color={m.score >= 67 ? 'success' : m.score >= 34 ? 'warning' : 'danger'}>{m.score} %</Badge></td>
                  <td className="pr-2">{m.routes}</td>
                  <td className="pr-2">{m.errorCapture}</td>
                  <td className="pr-2">{m.errorDefinitions.length}</td>
                  <td className="pr-2">{m.diagnostics.length}</td>
                  <td className="pr-2">{m.repairGuides}</td>
                  <td className="pr-2">{m.automatedTestFiles === null ? 'unknown' : m.automatedTestFiles.length}</td>
                  <td className="max-w-[320px]"><ul className="list-disc pl-4">{[...m.gaps, ...m.limitations].map((g) => <li key={g}>{g}</li>)}</ul></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Unclassified errors" subtitle={`${t.unclassifiedErrors} recorded. Facts, what is missing, and the next step for each.`} />
        {data.unclassified.length === 0 ? <p className="text-sm muted">None recorded.</p> : (
          <ul className="space-y-2 text-sm">
            {data.unclassified.map((u) => (
              <li key={u.id} className="rounded-2xl bg-white/40 p-3 dark:bg-white/5">
                <Link to={`/super-admin/soc/errors/${u.id}`} className="font-bold hover:underline">{u.facts.errorName || 'Error'}: {u.facts.message}</Link>
                <p className="text-xs muted">{u.facts.source} · {u.facts.module} · {u.facts.method ? `${u.facts.method} ` : ''}{u.facts.route} · ×{u.facts.count} · last {fmtDateTime(u.facts.lastSeenAt)} · stack {u.facts.hasStack ? 'captured' : 'not captured'}</p>
                <p className="text-xs"><KindTag kind="unverified" /> Missing: {u.missing.join(', ')}</p>
                <p className="text-xs"><KindTag kind="recommended" /> {u.nextStep}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.notes.map((n) => <p key={n} className="text-xs muted">{n}</p>)}
    </div>
  );
}
