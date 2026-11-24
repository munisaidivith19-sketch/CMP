import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, FlaskConical, HeartPulse, MessageSquareText, Search, Send, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Pagination, Skeleton, Tabs } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { RunResult, RunTestButton, StatusBadge } from '../../components/console/soc';
import { errorMessage, useGetSocCatalogQuery, useGetSocDiagnosticsQuery, useGetSocHealthQuery, useGetSocRunsQuery, useRunSocHealthMutation, useSmsTestMutation } from '../../services/consoleApi';
import { fmtDateTime } from '../../utils/format';

import { severityTone } from './socModel';

const words = (str) => String(str || '').replace(/_/g, ' ');

// Add a tab here (and its panel below) to extend this page.
const TABS = [
  { value: 'health', label: 'System health' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'catalog', label: 'Error catalog' },
];

/** Troubleshooting: tabs of read-only tools. Diagnostics: the registered tests and their run history. */
export default function Troubleshooting() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : TABS[0].value;
  return (
    <div>
      <PageHeader icon={Wrench} title="Troubleshooting" subtitle="System health, diagnostic tests and the error catalog." />
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-6" />
      {tab === 'health' && <Health />}
      {tab === 'diagnostics' && <Diagnostics />}
      {tab === 'catalog' && <Catalog />}
    </div>
  );
}

function Diagnostics() {
  const { data, error, refetch } = useGetSocDiagnosticsQuery({});
  const [page, setPage] = useState(1);
  const history = useGetSocRunsQuery({ page });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;
  const tests = data.items.filter((t) => !t.requiresError);
  return (
    <div className="space-y-4">
      <SmsTest />
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

/* ── SMS / OTP test ───────────────────────────────────────────────── */
const SMS_TONE = { SENT: 'success', FAILED: 'danger', SKIPPED: 'warning' };

function SmsTest() {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [send, { isLoading }] = useSmsTestMutation();
  const run = async (e) => {
    e.preventDefault();
    setResult(null);
    try {
      setResult(await send(phone.trim()).unwrap());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> SMS / OTP test</span>}
        subtitle="Sends one Gate Pass OTP SMS and one left-campus SMS (both registered templates, for “Test Student”) to the number below, through the college SMS service. Each run sends 2 real SMS; at most 5 runs per 15 minutes."
      />
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Input label="Mobile number" inputMode="tel" autoComplete="off" placeholder="10-digit mobile, e.g. 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button type="submit" icon={Send} loading={isLoading} disabled={phone.replace(/\D/g, '').length < 10}>Run</Button>
      </form>
      {result && (
        <div className="mt-4 space-y-3">
          {!result.config?.liveSms && (
            <p className="rounded-xl bg-amber-500/10 p-3 text-xs">Live OTPs are currently <b>not</b> sent by SMS (OTP_SMS_ENABLED is off). This test used the SMS service directly, so it works before you switch live sending on.</p>
          )}
          {result.config && !result.config.apiUrlHttps && <p className="rounded-xl bg-amber-500/10 p-3 text-xs">SMS_API_URL is not https://. Production refuses to send over plain http unless SMS_ALLOW_INSECURE_HTTP=true.</p>}
          <p className="text-sm">
            Sent to <b>{result.to}</b>
            {result.testOtp && <> · test OTP in the first SMS: <b className="font-mono">{result.testOtp}</b></>}
          </p>
          <ul className="divide-y divide-white/50 text-sm dark:divide-white/10">
            {result.results.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-3 py-2">
                <Badge color={SMS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                <span className="min-w-[160px] font-bold">{r.name}</span>
                <span className="flex-1 muted">{r.detail}</span>
                {r.durationMs !== undefined && <span className="text-[11px] muted">{r.durationMs} ms</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
