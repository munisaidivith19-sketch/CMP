import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { explainProblem, SCAN_CODES } from '../lib/explain.js';
import { Badge, Button, Card, Spinner, cn, fmtDateTime, studentLine } from '../ui.jsx';

const RANGES = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['custom', 'Custom'],
];
const OUTCOME_TONE = { success: 'success', rejected: 'error', duplicate: 'warning' };

/** Gate events (from the gate passes) and Gate Scanner attempts, filtered and paged on the server. */
export default function History() {
  const [tab, setTab] = useState('events');
  const [filters, setFilters] = useState({ range: 'today', from: '', to: '', type: '', outcome: '', q: '', page: 1 });
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => set({ q: search.trim() }), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (filters.range === 'custom' && (!filters.from || !filters.to)) return;
    setLoading(true);
    const params = { ...filters, limit: 25 };
    const r = await (tab === 'events' ? window.gate.api.history(params) : window.gate.api.attempts(params));
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(explainProblem(r.kind, r.message));
  }, [filters, tab]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Gate history</h1>
      <div className="flex flex-wrap gap-2" role="tablist">
        {[
          ['events', 'Gate events (OUT / IN)'],
          ['attempts', 'Scanner attempts'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn('chip !text-sm', tab === id && 'chip-active')} onClick={() => { setTab(id); setData(null); set({}); }}>
            {label}
          </button>
        ))}
      </div>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map(([id, label]) => (
            <button key={id} type="button" className={cn('chip', filters.range === id && 'chip-active')} aria-pressed={filters.range === id} onClick={() => set({ range: id })}>
              {label}
            </button>
          ))}
          {filters.range === 'custom' && (
            <span className="flex items-center gap-2">
              <label className="sr-only" htmlFor="from">From</label>
              <input id="from" type="date" className="input !w-auto !py-1.5" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
              <span className="muted">to</span>
              <label className="sr-only" htmlFor="to">To</label>
              <input id="to" type="date" className="input !w-auto !py-1.5" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" aria-hidden />
            <label className="sr-only" htmlFor="hsearch">Search student</label>
            <input id="hsearch" className="input !pl-9" placeholder="Student name or roll number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="sr-only" htmlFor="htype">Event type</label>
          <select id="htype" className="input !w-auto" value={filters.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="">OUT and IN</option>
            <option value="out">OUT only</option>
            <option value="in">IN only</option>
          </select>
          {tab === 'attempts' && (
            <>
              <label className="sr-only" htmlFor="houtcome">Outcome</label>
              <select id="houtcome" className="input !w-auto" value={filters.outcome} onChange={(e) => set({ outcome: e.target.value })}>
                <option value="">All outcomes</option>
                <option value="success">Recorded</option>
                <option value="rejected">Rejected</option>
                <option value="duplicate">Repeated scans</option>
              </select>
            </>
          )}
        </div>
      </Card>

      {error && <div role="alert" className="rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300"><b>{error.title}.</b> {error.action}</div>}
      {filters.range === 'custom' && (!filters.from || !filters.to) ? (
        <p className="text-sm muted">Choose a start and an end date.</p>
      ) : !data ? (
        loading ? <Spinner /> : null
      ) : (
        <Card className="overflow-x-auto !p-0">
          <div className="flex items-center gap-3 px-5 py-3 text-sm muted">
            <span>{data.total} {tab === 'events' ? 'event(s)' : 'attempt(s)'} · {data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`} ({data.range.timezone})</span>
            {loading && <Spinner className="h-4 w-4" />}
          </div>
          {data.items.length === 0 ? (
            <p className="px-5 pb-5 text-sm muted">Nothing found for these filters.</p>
          ) : tab === 'events' ? (
            <EventsTable items={data.items} />
          ) : (
            <AttemptsTable items={data.items} />
          )}
          <Pager page={data.page} pages={data.pages} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
        </Card>
      )}
    </div>
  );
}

const Th = ({ children }) => <th className="whitespace-nowrap px-5 py-2 text-left text-xs font-bold uppercase tracking-wide muted">{children}</th>;
const Td = ({ children, className }) => <td className={cn('px-5 py-2.5 align-top text-sm', className)}>{children}</td>;

function EventsTable({ items }) {
  return (
    <table className="w-full">
      <thead>
        <tr><Th>Time</Th><Th>Event</Th><Th>Student</Th><Th>Gate pass</Th><Th>Guard</Th><Th>Gate</Th></tr>
      </thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.id} className="table-row border-t border-white/60 dark:border-white/10">
            <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(e.at)}</Td>
            <Td><Badge tone={e.type === 'out' ? 'primary' : 'success'}>{e.type === 'out' ? 'OUT' : 'IN'}</Badge></Td>
            <Td>
              <p className="font-semibold">{e.student?.name || '—'}</p>
              <p className="text-xs muted">{studentLine(e.student)}</p>
            </Td>
            <Td className="whitespace-nowrap">{e.passRef}<p className="text-xs muted">{e.passType === 'outing' ? 'Day scholar outing' : e.passType}</p></Td>
            <Td>{e.guard?.name || '—'}</Td>
            <Td>{e.gate || (e.via === 'web_or_mobile' ? <span className="muted">Portal / app</span> : '—')}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttemptsTable({ items }) {
  return (
    <table className="w-full">
      <thead>
        <tr><Th>Time</Th><Th>Outcome</Th><Th>Student</Th><Th>Event</Th><Th>Guard</Th><Th>Gate</Th></tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <tr key={a.scanId} className="table-row border-t border-white/60 dark:border-white/10">
            <Td className="whitespace-nowrap tabular-nums">{fmtDateTime(a.receivedAt)}</Td>
            <Td>
              <Badge tone={OUTCOME_TONE[a.outcome] || 'neutral'}>{SCAN_CODES[a.code]?.title || a.code}</Badge>
              {a.message && <p className="mt-1 max-w-xs text-xs muted">{a.message}</p>}
            </Td>
            <Td>
              <p className="font-semibold">{a.student?.name || '—'}</p>
              <p className="text-xs muted">{studentLine(a.student)}</p>
            </Td>
            <Td>{a.direction ? (a.direction === 'out' ? 'OUT' : 'IN') : '—'}{a.passRef && <p className="text-xs muted">{a.passRef}</p>}</Td>
            <Td>{a.guard?.name || '—'}</Td>
            <Td>{a.gate || '—'}<p className="text-xs muted">{a.source === 'manual' ? 'typed' : a.source}</p></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3">
      <Button variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
      <span className="text-sm muted">Page {page} of {pages}</span>
      <Button variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
