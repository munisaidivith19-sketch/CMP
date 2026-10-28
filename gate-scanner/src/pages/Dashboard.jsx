import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, CheckCircle2, DoorOpen, LogIn, LogOut, RefreshCw, Users, XCircle } from 'lucide-react';
import { useScanner } from '../hooks/useScanner.jsx';
import { explainProblem, SCAN_CODES } from '../lib/explain.js';
import { Badge, Button, Card, Spinner, Stat, StatusDot, fmtTime } from '../ui.jsx';

const REFRESH_MS = 20000;
const OUTCOME_TONE = { success: 'success', rejected: 'error', duplicate: 'warning' };

/** Live counts from the server's gate-pass records; nothing here is sample data. */
export default function Dashboard({ connection, guard, settings }) {
  const scanner = useScanner();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { reportFailure } = connection;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await window.gate.api.dashboard();
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(explainProblem(r.kind, r.message));
      if (['offline', 'timeout'].includes(r.kind)) reportFailure();
    }
  }, [reportFailure]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const p = data?.population;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">Gate dashboard</h1>
        {data && <span className="text-sm muted">Updated {fmtTime(data.generatedAt)} · {data.date} ({data.timezone})</span>}
        <Button variant="outline" icon={RefreshCw} loading={loading} className="ml-auto" onClick={load}>
          Refresh
        </Button>
      </div>
      {error && (
        <div role="alert" className="rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
          <b>{error.title}.</b> {error.action} {data ? 'Showing the last figures received.' : ''}
        </div>
      )}
      {!data && !error ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <Stat icon={DoorOpen} tone="primary" label="Outside on a gate pass" value={p.outsideOnPass} hint={`Each student counted once · ${p.overdue} overdue`} />
            <Stat icon={Users} tone="neutral" label="Not on an active gate pass" value={p.notOnActivePass} hint={`of ${p.totalStudents} active students`} />
            <Stat icon={LogOut} tone="warning" label="OUT events today" value={data.today.outEvents} hint="Every recorded exit" />
            <Stat icon={LogIn} tone="success" label="IN events today" value={data.today.inEvents} hint="Every recorded return" />
          </div>
          <p className="text-xs muted">
            Counts come from approved gate passes only: “outside” means an exit was recorded and the return has not been. Students who leave without a gate pass (for example day scholars going home) are not tracked by these records, so “not on an active gate pass” is not a head count of who is physically on campus.
          </p>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <p className="section-title mb-3">My recent scans</p>
              {data.recent.length === 0 ? (
                <p className="text-sm muted">No scans recorded from your account yet.</p>
              ) : (
                <ul className="divide-y divide-white/60 dark:divide-white/10">
                  {data.recent.map((s) => (
                    <li key={s.scanId} className="flex items-center gap-3 py-2">
                      <span className="w-24 shrink-0 whitespace-nowrap text-sm tabular-nums muted">{fmtTime(s.receivedAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.student?.name || '—'}</span>
                      {s.direction && <span className="text-xs font-extrabold">{s.direction === 'out' ? 'OUT' : 'IN'}</span>}
                      <Badge tone={OUTCOME_TONE[s.outcome] || 'neutral'}>{SCAN_CODES[s.code]?.title || s.code}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="space-y-3">
              <p className="section-title">This station</p>
              <dl className="space-y-2 text-sm">
                <Row label="Guard">{guard?.name}</Row>
                <Row label="Gate">{settings.gateName || 'Not named (set in Diagnostics)'}</Row>
                <Row label="Server"><StatusDot tone={connection.online ? 'success' : 'error'} label={connection.online ? 'Connected' : 'Offline'} /></Row>
                <Row label="Scanner"><StatusDot tone={scanner.status.tone} label={scanner.status.label} /></Row>
              </dl>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge tone="success" icon={CheckCircle2}>{data.myScansToday.success} recorded</Badge>
                <Badge tone="error" icon={XCircle}>{data.myScansToday.rejected} rejected</Badge>
                <Badge tone="warning" icon={AlarmClock}>{data.myScansToday.duplicate} repeats</Badge>
              </div>
              <p className="text-xs muted">Your scans today, as recorded by the server.</p>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{children}</dd>
    </div>
  );
}
