import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { explainProblem } from '../lib/explain.js';
import { Badge, Button, Card, Initials, Spinner, fmtDateTime, fmtTime, studentLine } from '../ui.jsx';

// What each dashboard card opens. `load` returns the same { ok, data } shape as every other API call.
const KINDS = {
  outside: {
    title: 'Outside on a gate pass',
    load: () => window.gate.api.outside(),
    rows: (d) => d.items,
    summary: (d) => `${d.total} student${d.total === 1 ? '' : 's'} outside · ${d.overdue} overdue`,
    empty: 'No student is outside on a gate pass right now.',
  },
  out: {
    title: 'OUT events today',
    load: () => window.gate.api.history({ range: 'today', type: 'out', limit: 100 }),
    rows: (d) => d.items,
    summary: (d) => `${d.total} exit${d.total === 1 ? '' : 's'} recorded today${d.total > d.items.length ? ` · showing the latest ${d.items.length}` : ''}`,
    empty: 'No exit has been recorded today.',
  },
  in: {
    title: 'IN events today',
    load: () => window.gate.api.history({ range: 'today', type: 'in', limit: 100 }),
    rows: (d) => d.items,
    summary: (d) => `${d.total} return${d.total === 1 ? '' : 's'} recorded today${d.total > d.items.length ? ` · showing the latest ${d.items.length}` : ''}`,
    empty: 'No return has been recorded today.',
  },
};

/** A popup with the list behind a dashboard number. `kind` is outside | out | in | notOnPass. */
export default function StatDetail({ kind, population, onClose }) {
  const spec = KINDS[kind];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(spec));
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    if (!spec) return;
    setLoading(true);
    const r = await spec.load();
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(explainProblem(r.kind, r.message));
  }, [spec]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = spec ? spec.title : 'Not on an active gate pass';
  const rows = data && spec ? spec.rows(data) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Card className="glass-strong flex max-h-[85vh] w-full max-w-2xl flex-col" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold">{title}</h2>
            {data && spec && <p className="text-sm muted">{spec.summary(data)}</p>}
          </div>
          {spec && (
            <Button variant="ghost" icon={RefreshCw} loading={loading} onClick={load} aria-label="Refresh" className="!px-2" />
          )}
          <button ref={closeRef} type="button" className="btn-ghost rounded-lg p-2" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {!spec ? (
            <div className="space-y-2 text-sm">
              <p className="text-3xl font-extrabold tabular-nums">{population?.notOnActivePass ?? '—'}</p>
              <p>
                Active students minus those currently outside on a gate pass ({population?.totalStudents ?? '—'} − {population?.outsideOnPass ?? '—'}).
              </p>
              <p className="muted">
                This is not a head count of who is on campus: day scholars and anyone who left without a gate pass are not tracked by these records, so there is no list to show for it.
              </p>
            </div>
          ) : error ? (
            <div role="alert" className="rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
              <b>{error.title}.</b> {error.action}
            </div>
          ) : !data ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <p className="text-sm muted">{spec.empty}</p>
          ) : (
            <ul className="divide-y divide-white/60 dark:divide-white/10">
              {rows.map((r) => (
                <li key={r.id || `${r.passRef}-${r.student?._id}`} className="flex items-center gap-3 py-2.5">
                  <Initials name={r.student?.name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{r.student?.name || '—'}</p>
                    <p className="truncate text-xs muted">{studentLine(r.student)}</p>
                    <p className="truncate text-xs muted">
                      {r.passRef && `Gate pass ${r.passRef}`}
                      {kind === 'outside' && ` · Left ${fmtDateTime(r.exitedAt)}`}
                      {kind === 'outside' && r.dueBack && ` · Due back ${fmtDateTime(r.dueBack)}`}
                      {kind !== 'outside' && r.guard?.name && ` · ${r.guard.name}`}
                    </p>
                  </div>
                  {kind === 'outside' ? (
                    r.overdue && <Badge tone="error">Overdue</Badge>
                  ) : (
                    <span className="shrink-0 text-sm tabular-nums muted">{fmtTime(r.at)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
