import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Play, Square } from 'lucide-react';
import { Badge, Button, cn } from '../ui/primitives';
import { useCancelSocRunMutation, useGetSocRunQuery, useRunSocDiagnosticMutation, errorMessage } from '../../services/superAdmin';
import { STATUS_MEANING, isFinal, statusTone } from '../../pages/superadmin/socModel';
import { fmtDateTime } from '../../utils/format';

/** Shared SOC building blocks. Everything renders text — never HTML from the server. */

export function StatusBadge({ status, className }) {
  return (
    <Badge color={statusTone(status)} className={cn('!normal-case', className)}>
      <span title={STATUS_MEANING[status]}>{String(status || 'UNKNOWN').replace(/_/g, ' ')}</span>
    </Badge>
  );
}

/** Poll one run until it is final. */
export function useRunPoller(runId) {
  const [done, setDone] = useState(false);
  const q = useGetSocRunQuery(runId, { skip: !runId, pollingInterval: runId && !done ? 1000 : 0 });
  const status = q.data?.run?.status;
  useEffect(() => setDone(false), [runId]);
  useEffect(() => {
    if (status && isFinal(status)) setDone(true);
  }, [status]);
  return q;
}

/** A finished (or running) diagnostic run: what was checked, what happened, why, when, how long, what next. */
export function RunResult({ run, compact = false }) {
  if (!run) return null;
  return (
    <div className="rounded-2xl bg-white/40 p-3 text-sm dark:bg-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="font-bold">{run.testName || run.testId}</span>
        {run.purpose === 'verification' && <Badge color="info">verification</Badge>}
        <span className="text-xs muted">
          {run.finishedAt ? `${fmtDateTime(run.finishedAt)} · ${run.durationMs ?? '—'} ms` : run.startedAt ? 'running…' : 'queued…'}
          {run.requestedBy?.name ? ` · by ${run.requestedBy.name}` : ''}
        </span>
      </div>
      <p className="mt-1 text-xs muted">{STATUS_MEANING[run.status]}</p>
      {!compact && isFinal(run.status) && (
        <dl className="mt-2 grid gap-1 sm:grid-cols-[110px_1fr]">
          <dt className="text-xs font-semibold muted">Checked</dt>
          <dd>{run.checked || '—'}</dd>
          <dt className="text-xs font-semibold muted">What happened</dt>
          <dd>{run.observed || '—'}</dd>
          <dt className="text-xs font-semibold muted">Why this result</dt>
          <dd>{run.reason || '—'}</dd>
          {run.nextSteps?.length > 0 && (
            <>
              <dt className="text-xs font-semibold muted">Next</dt>
              <dd>
                <ul className="list-disc pl-4">
                  {run.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
      {!compact && run.evidence && Object.keys(run.evidence).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold">Evidence (redacted)</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/5 p-2 text-[11px] dark:bg-white/5">{JSON.stringify(run.evidence, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/** Run button + live result for one registered test. */
export function RunTestButton({ test, errorId, onFinished }) {
  const [run, { isLoading }] = useRunSocDiagnosticMutation();
  const [cancel] = useCancelSocRunMutation();
  const [runId, setRunId] = useState(null);
  const q = useRunPoller(runId);
  const current = q.data?.run;
  useEffect(() => {
    if (current && isFinal(current.status)) onFinished?.(current);
  }, [current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    try {
      const r = await run({ testId: test.id, errorId }).unwrap();
      setRunId(r._id);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start the test'));
    }
  };
  const running = current && !isFinal(current.status);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Play} onClick={start} loading={isLoading} disabled={running}>
          Run
        </Button>
        {running && (
          <Button size="sm" variant="outline" icon={Square} onClick={() => cancel(runId)}>
            Cancel
          </Button>
        )}
        <span className="text-xs muted">Read-only · up to {Math.round(test.timeoutMs / 1000)} s</span>
      </div>
      {current && <RunResult run={current} />}
    </div>
  );
}

export function KindTag({ kind }) {
  const label = { confirmed: 'Confirmed finding', possible: 'Possible cause', recommended: 'Recommended action', unverified: 'Unverified assumption' }[kind] || kind;
  const color = { confirmed: 'danger', possible: 'warning', recommended: 'info', unverified: 'neutral' }[kind] || 'neutral';
  return (
    <Badge color={color} className="!normal-case">
      {label}
    </Badge>
  );
}
