import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Keyboard, LogIn, LogOut, RefreshCw, ScanLine, XCircle } from 'lucide-react';
import { useScanner } from '../hooks/useScanner.jsx';
import { explainJob } from '../lib/explain.js';
import { Badge, Button, Card, Initials, StatusDot, cn, fmtTime, studentLine, toneClass } from '../ui.jsx';

const STATE_BADGE = {
  queued: ['pending', 'Queued'],
  sending: ['pending', 'Recording…'],
  uncertain: ['pending', 'Checking…'],
  success: ['success', 'Recorded'],
  duplicate: ['warning', 'Already recorded'],
  rejected: ['error', 'Rejected'],
  failed: ['error', 'Not recorded'],
};
const TONE_ICON = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, pending: Clock };

/** The gate screen: scans are recorded only while this page is open. */
export default function ScannerPage({ connection }) {
  const scanner = useScanner();
  const { setArmed } = scanner;
  useEffect(() => {
    setArmed(true);
    return () => setArmed(false);
  }, [setArmed]);

  const latest = scanner.jobs[0];
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        {!connection.online && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl bg-rose-500/15 p-4 text-rose-800 dark:text-rose-200">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-extrabold">Server offline — scans are NOT being recorded</p>
              <p className="text-sm">Use the manual gate register (student name, roll number, time, OUT / IN, gate pass reference) until the connection is back. Do not scan again later from memory.</p>
            </div>
          </div>
        )}
        <ResultPanel job={latest} scanner={scanner} />
        <ManualEntry disabled={!connection.online} onSubmit={scanner.enqueueManual} />
      </div>
      <div className="space-y-5">
        <Card>
          <p className="section-title mb-3">Scanner</p>
          <StatusDot tone={scanner.status.tone} label={scanner.status.label} />
          <p className="mt-2 text-xs muted">{scanner.status.detail}</p>
          {scanner.inputProblem && Date.now() - scanner.inputProblem.at < 60000 && (
            <div className="mt-3 rounded-2xl bg-amber-500/15 p-3 text-sm text-amber-800 dark:text-amber-200">
              <p className="font-bold">{scanner.inputProblem.title} <span className="font-normal">(input capture, nothing was sent)</span></p>
              <p>{scanner.inputProblem.action}</p>
            </div>
          )}
          {scanner.ignoredRepeats > 0 && <p className="mt-3 text-xs muted">Repeated reads of the same QR ignored this session: {scanner.ignoredRepeats}</p>}
        </Card>
        <Card>
          <p className="section-title mb-3">Recent scans</p>
          {scanner.jobs.length === 0 ? (
            <p className="text-sm muted">Scans appear here as students are scanned.</p>
          ) : (
            <ul className="space-y-2" aria-live="polite">
              {scanner.jobs.slice(0, 15).map((j) => (
                <RecentRow key={j.scanId} job={j} onRecheck={() => scanner.recheck(j.scanId)} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function ResultPanel({ job, scanner }) {
  if (!job) {
    return (
      <Card className="flex min-h-[340px] flex-col items-center justify-center text-center">
        <ScanLine className="h-16 w-16 text-primary-500" aria-hidden />
        <p className="mt-4 text-2xl font-extrabold">Ready to scan</p>
        <p className="mt-1 max-w-md muted">Scan the student's gate pass QR. Exit QRs record OUT, Return QRs record IN — the QR decides, according to the gate-pass rules.</p>
        {scanner.status.tone !== 'success' && <p className="mt-3 text-sm font-semibold text-amber-700">{scanner.status.label}: {scanner.status.detail}</p>}
      </Card>
    );
  }
  const view = explainJob(job);
  const Icon = TONE_ICON[view.tone] || AlertTriangle;
  const student = job.result?.student;
  const direction = job.result?.direction || job.direction;
  return (
    <Card className={cn('min-h-[340px] border-4', { success: 'border-emerald-400/70', warning: 'border-amber-400/70', error: 'border-rose-400/70', pending: 'border-sky-400/70' }[view.tone])} aria-live="assertive">
      <div className={cn('flex items-center gap-3 rounded-2xl p-4', toneClass(view.tone))}>
        <Icon className="h-10 w-10 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-extrabold leading-tight">{view.title}</p>
          {view.action && <p className="text-base font-semibold">{view.action}</p>}
        </div>
        {direction && (
          <Badge tone={direction === 'out' ? 'primary' : 'success'} icon={direction === 'out' ? LogOut : LogIn} className="!text-base">
            {direction === 'out' ? 'OUT' : 'IN'}
          </Badge>
        )}
      </div>
      {student ? (
        <div className="mt-5 flex items-center gap-5">
          <Initials name={student.name} className="h-20 w-20 text-2xl" />
          <div className="min-w-0">
            <p className="break-words text-3xl font-extrabold leading-tight">{student.name}</p>
            <p className="mt-1 text-lg muted">{studentLine(student)}</p>
            {job.result?.passRef && <p className="mt-1 text-sm muted">Gate pass {job.result.passRef}</p>}
          </div>
        </div>
      ) : (
        <p className="mt-5 text-lg muted">{job.label}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm muted">
        <span>Scanned {fmtTime(job.receivedAt)}</span>
        {job.result?.recordedAt && <span>Recorded {fmtTime(job.result.recordedAt)}</span>}
        <span>Source: {job.source === 'manual' ? 'typed code' : job.source === 'serial' ? 'USB serial scanner' : 'keyboard-mode scanner'}</span>
      </div>
      {view.detail && view.detail !== view.action && <p className="mt-3 text-sm">{view.detail}</p>}
      {job.state === 'uncertain' && !job.settling && (
        <Button className="mt-4" variant="outline" icon={RefreshCw} onClick={() => scanner.recheck(job.scanId)}>
          Check again
        </Button>
      )}
    </Card>
  );
}

function RecentRow({ job, onRecheck }) {
  const [tone, label] = STATE_BADGE[job.state] || ['neutral', job.state];
  const student = job.result?.student;
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{student?.name || job.label}</p>
        <p className="truncate text-xs muted">
          {fmtTime(job.receivedAt)}
          {job.result?.code ? ` · ${job.result.code.replace(/_/g, ' ').toLowerCase()}` : job.error?.kind ? ` · ${job.error.kind.replace(/_/g, ' ')}` : ''}
        </p>
      </div>
      {(job.result?.direction || job.direction) && <span className="text-xs font-extrabold">{(job.result?.direction || job.direction) === 'out' ? 'OUT' : 'IN'}</span>}
      <Badge tone={tone}>{label}</Badge>
      {job.state === 'uncertain' && !job.settling && (
        <button type="button" className="btn-ghost rounded-lg p-1" onClick={onRecheck} aria-label="Check again">
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/** For a QR that will not scan: the student reads out their code. The guard must say which kind it is. */
function ManualEntry({ disabled, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(null);
  const [code, setCode] = useState('');
  const valid = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4}$/.test(code);
  const submit = (e) => {
    e.preventDefault();
    if (!valid || !kind) return;
    onSubmit(code, kind);
    setCode('');
  };
  return (
    <Card>
      <button type="button" className="flex w-full items-center gap-2 text-left font-bold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Keyboard className="h-5 w-5" aria-hidden /> Enter a code by hand
        <span className="ml-auto text-xs font-normal muted">{open ? 'Hide' : 'QR will not scan?'}</span>
      </button>
      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <fieldset>
            <legend className="label">The student is…</legend>
            <div className="flex gap-2">
              {[
                ['out', 'Leaving (exit code)', LogOut],
                ['in', 'Returning (return code)', LogIn],
              ].map(([k, label, Icon]) => (
                <button key={k} type="button" className={cn('chip !py-2 !text-sm', kind === k && 'chip-active')} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="manual-code">4-character code</label>
            <input
              id="manual-code"
              className="input max-w-[200px] font-mono text-2xl tracking-[0.3em]"
              value={code}
              maxLength={4}
              autoComplete="off"
              placeholder="A4G5"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <Button type="submit" disabled={disabled || !valid || !kind}>
              Record
            </Button>
          </div>
          <p className="text-xs muted">Exit and return codes look alike, so choose the right one. The server still checks the pass, its approval and expiry.</p>
        </form>
      )}
    </Card>
  );
}
