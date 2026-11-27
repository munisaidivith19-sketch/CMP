import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertOctagon, Bot, CheckCircle2, Coins, Gauge, PowerOff, RefreshCw, Search, ShieldBan, Terminal, Unlock } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/form';
import { reportError, useReauth } from '../../components/console/Reauth';
import {
  useEmergencyStopAiDoubtsMutation,
  useGetAiDoubtsBlockedQuery,
  useGetAiDoubtsStatusQuery,
  useGrantAiDoubtsCreditsMutation,
  useLazyGetAiDoubtsCreditsQuery,
  useUnblockAiDoubtsUserMutation,
} from '../../services/aiDoubtsAdminApi';
import { errorMessage } from '../../services/consoleApi';
import { fmtDateTime } from '../../utils/format';

/**
 * Troubleshooting → AI Doubts: status of the self-hosted model and the
 * emergency stop. Stopping is one-way from here — AI is turned back on only
 * from the server terminal.
 */
export default function AiDoubtsControl() {
  const { data, error, refetch, isFetching } = useGetAiDoubtsStatusQuery(undefined, { pollingInterval: 10000 });
  const [open, setOpen] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <Skeleton className="h-60" />;

  const state = data.stopped ? 'stopped' : data.enabledInEnv ? 'running' : 'off';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="AI Doubts (self-hosted model)"
          subtitle="The AI Doubts tab in Study Materials. The JNN Study Assistant is a separate feature and is not affected here."
          action={
            <Button variant="ghost" size="sm" icon={RefreshCw} loading={isFetching} onClick={refetch}>
              Refresh
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          {state === 'running' && <Badge color="success" icon={CheckCircle2}>Running</Badge>}
          {state === 'off' && <Badge color="warning" icon={PowerOff}>Off in server .env</Badge>}
          {state === 'stopped' && <Badge color="danger" icon={AlertOctagon}>Emergency stopped</Badge>}
          <span className="text-sm muted">
            Model <code className="font-mono text-xs">{data.model}</code>
            {data.fallbackModel && (
              <>
                {' '}
                · busy-time model <code className="font-mono text-xs">{data.fallbackModel}</code>
              </>
            )}
          </span>
        </div>
        {state === 'off' && (
          <p className="mt-3 text-sm muted">
            Switched off with <code className="font-mono text-xs">LOCAL_AI_ENABLED=false</code> in <code className="font-mono text-xs">server/.env</code>. Set it to <code className="font-mono text-xs">true</code> and restart the API to turn it on.
          </p>
        )}
      </Card>

      <LoadPanel data={data} />

      {data.stopped ? <StoppedPanel stop={data.stop} command={data.resumeCommand} /> : <StopPanel onStop={() => setOpen(true)} />}

      <BlockedPanel count={data.blockedStudents} />

      {data.creditsEnabled ? <CreditsPanel credits={data.credits} /> : null}

      <StopModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function StopPanel({ onStop }) {
  return (
    <Card className="border border-rose-300/60 dark:border-rose-500/30">
      <CardHeader title="Emergency stop" subtitle="Use only if the AI must be shut off immediately — for example, unsafe answers or the server is overloaded." />
      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm muted">
        <li>All AI Doubts requests are refused straight away, for every student.</li>
        <li>Answers being written right now are cancelled (nothing half-written is saved).</li>
        <li>The model is unloaded from the server's memory.</li>
        <li>
          <strong className="text-ink dark:text-white">It cannot be turned back on from the web.</strong> Someone with terminal access on the server must run{' '}
          <code className="font-mono text-xs">npm run ai:resume</code>.
        </li>
      </ul>
      <Button variant="danger" icon={AlertOctagon} onClick={onStop}>
        Emergency stop AI
      </Button>
    </Card>
  );
}

function StoppedPanel({ stop, command }) {
  const by = stop?.by ? [stop.by.name, stop.by.email || stop.by.user].filter(Boolean).join(' · ') || stop.by.role : 'unknown';
  return (
    <Card className="border border-rose-300/60 bg-rose-500/5 dark:border-rose-500/30">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
          <AlertOctagon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="font-extrabold">AI Doubts is emergency stopped</h3>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="muted">When</dt>
              <dd>{stop?.stoppedAt ? fmtDateTime(stop.stoppedAt) : 'unknown'}</dd>
              <dt className="muted">By</dt>
              <dd>
                {by} {stop?.source === 'terminal' && <Badge color="neutral">server terminal</Badge>}
                {stop?.source === 'tripwire' && <Badge color="danger">automatic tripwire</Badge>}
              </dd>
              <dt className="muted">Reason</dt>
              <dd className="break-words">{stop?.reason || '—'}</dd>
            </dl>
          </div>
          <div className="rounded-2xl bg-slate-900 p-3 text-slate-100">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-300">
              <Terminal className="h-3.5 w-3.5" /> To turn AI back on, run this on the server:
            </p>
            <code className="block font-mono text-sm">{command}</code>
          </div>
          <p className="text-xs muted">There is no button for this on purpose: restarting AI needs a person with access to the server.</p>
        </div>
      </div>
    </Card>
  );
}

function StopModal({ open, onClose }) {
  const [reason, setReason] = useState('');
  const [stopAi, { isLoading }] = useEmergencyStopAiDoubtsMutation();
  const { guard, modal } = useReauth();
  const valid = reason.trim().length >= 5;

  const confirm = async () => {
    try {
      const res = await guard(() => stopAi(reason.trim()).unwrap());
      toast.success(`AI stopped${res.aborted ? ` — ${res.aborted} answer${res.aborted === 1 ? '' : 's'} cancelled` : ''}.`);
      setReason('');
      onClose();
    } catch (err) {
      reportError(err, errorMessage(err, 'Could not stop AI'));
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="Emergency stop AI Doubts?"
        subtitle="Students lose AI Doubts immediately. Only someone on the server terminal can turn it back on."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" icon={AlertOctagon} loading={isLoading} disabled={!valid} onClick={confirm}>
              Stop AI now
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-2xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
            <Bot className="h-4 w-4 shrink-0" /> You'll be asked for your password. The stop is recorded in the audit trail.
          </div>
          <Textarea
            label="Reason (required)"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Model giving unsafe answers; server overloaded during exams"
            hint="At least 5 characters. Shown to whoever turns AI back on."
          />
        </div>
      </Modal>
      {modal}
    </>
  );
}

function LoadPanel({ data }) {
  const pct = data.capacity ? Math.min(100, Math.round((data.active / data.capacity) * 100)) : 0;
  const busy = data.queued >= (data.busyAt ?? Infinity);
  return (
    <Card>
      <CardHeader title="Load right now" subtitle="Students take turns in a fair queue. When the queue is long, answers get shorter (and use the busy-time model if one is set)." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Answering" value={`${data.active} / ${data.capacity}`} />
        <Stat label="Waiting" value={`${data.queued}${data.maxQueue ? ` / ${data.maxQueue}` : ''}`} tone={busy ? 'warning' : undefined} />
        <Stat label="Students waiting" value={data.waitingStudents ?? 0} />
        <Stat label="Model servers" value={data.instances?.length ?? 1} />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10" aria-label={`${pct}% of answer slots in use`}>
        <div className={busy ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs muted">
        <Gauge className="h-3.5 w-3.5" />
        {busy ? 'Busy — short answers are being used to keep the queue moving.' : 'Normal.'} Limits: {data.limits?.maxQuestionsPerConversation} questions per chat, memory {data.limits?.memoryMinutes} min.
      </p>
    </Card>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={tone === 'warning' ? 'rounded-2xl bg-amber-500/10 px-3 py-2' : 'rounded-2xl bg-white/50 px-3 py-2 dark:bg-white/5'}>
      <p className="text-[0.65rem] font-bold uppercase tracking-wider muted">{label}</p>
      <p className="text-lg font-extrabold">{value}</p>
    </div>
  );
}

const CATEGORY_LABEL = { prompt_attack: 'trying to break the rules', system_probe: 'asking about servers / database', sexual: 'sexual content', tripwire: 'answer tripped the safety wire' };

function BlockedPanel({ count }) {
  const { data, isFetching, refetch } = useGetAiDoubtsBlockedQuery(undefined, { pollingInterval: 30000 });
  const [unblock, { isLoading }] = useUnblockAiDoubtsUserMutation();
  const { guard, modal } = useReauth();
  const items = data?.items || [];

  const lift = async (row) => {
    try {
      await guard(() => unblock({ userId: row.userId, reason: 'Unblocked from Troubleshooting' }).unwrap());
      toast.success(`${row.name || 'Student'} can use AI Doubts again.`);
    } catch (err) {
      reportError(err, errorMessage(err, 'Could not unblock'));
    }
  };

  return (
    <Card>
      <CardHeader
        title={`Blocked students${count ? ` (${count})` : ''}`}
        subtitle="Students are paused automatically after repeated rule-breaking requests (prompt attacks, questions about the servers or database, sexual content). Only that student is affected."
        action={
          <Button variant="ghost" size="sm" icon={RefreshCw} loading={isFetching} onClick={refetch}>
            Refresh
          </Button>
        }
      />
      {!items.length ? (
        <p className="text-sm muted">No students are blocked right now.</p>
      ) : (
        <ul className="divide-y divide-white/60 dark:divide-white/10">
          {items.map((row) => (
            <li key={row.userId} className="flex flex-wrap items-start gap-3 py-3">
              <ShieldBan className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold">
                  {row.name || 'Unknown'} <span className="font-normal muted">{[row.rollNo, row.email, row.department].filter(Boolean).join(' · ')}</span>
                </p>
                <p className="text-xs muted">Until {fmtDateTime(row.blockedUntil)}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {[...new Set((row.strikes || []).map((x) => x.category))].map((c) => (
                    <Badge key={c} color="warning">
                      {CATEGORY_LABEL[c] || c}
                    </Badge>
                  ))}
                </p>
              </div>
              <Button size="sm" variant="ghost" icon={Unlock} loading={isLoading} onClick={() => lift(row)}>
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
      {modal}
    </Card>
  );
}

function CreditsPanel({ credits }) {
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [lookup, { data, isFetching, error }] = useLazyGetAiDoubtsCreditsQuery();
  const [grant, { isLoading }] = useGrantAiDoubtsCreditsMutation();
  const { guard, modal } = useReauth();
  const n = Number(amount);
  const valid = account.trim().length >= 3 && Number.isInteger(n) && n >= 1 && n <= 10000 && reason.trim().length >= 5;

  const find = (e) => {
    e?.preventDefault();
    if (account.trim().length >= 3) lookup(account.trim());
  };
  const give = async () => {
    try {
      const res = await guard(() => grant({ account: account.trim(), amount: n, reason: reason.trim() }).unwrap());
      toast.success(`Added ${n} credits — ${res.credits.remaining} left this month.`);
      setAmount('');
      setReason('');
      lookup(account.trim());
    } catch (err) {
      reportError(err, errorMessage(err, 'Could not add credits'));
    }
  };

  const c = data?.credits;
  return (
    <Card>
      <CardHeader
        title="Student credits"
        subtitle={`Each student gets ${credits?.monthly ?? '—'} credits a month (max ${credits?.daily ?? '—'} a day, no rollover). Staff are unlimited. Bonus credits last until the end of this month and are recorded in the audit trail.`}
      />
      <form onSubmit={find} className="flex flex-wrap items-end gap-2">
        <Input label="Student email or roll number" value={account} onChange={(e) => setAccount(e.target.value)} className="min-w-[16rem] flex-1" icon={Search} />
        <Button type="submit" variant="ghost" loading={isFetching} disabled={account.trim().length < 3}>
          Look up
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-500">{errorMessage(error, 'Not found')}</p>}
      {data?.account && c && (
        <div className="mt-3 rounded-2xl bg-white/50 p-3 text-sm dark:bg-white/5">
          <p className="font-bold">
            {data.account.name} <span className="font-normal muted">{[data.account.rollNo, data.account.email, data.account.role].filter(Boolean).join(' · ')}</span>
          </p>
          {c.unlimited ? (
            <p className="mt-1 muted">Unlimited (staff account).</p>
          ) : (
            <p className="mt-1 flex items-center gap-1.5">
              <Coins className="h-4 w-4 text-emerald-600" /> {c.remaining} left this month ({c.used} used{c.bonus ? `, ${c.bonus} bonus` : ''}) · today {c.dayRemaining} of {c.daily}
            </p>
          )}
        </div>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Input label="Bonus credits" type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Final-year project review week" />
        <Button icon={Coins} loading={isLoading} disabled={!valid} onClick={give}>
          Add credits
        </Button>
      </div>
      <p className="mt-2 text-xs muted">You'll be asked for your password.</p>
      {modal}
    </Card>
  );
}
