import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, HeartPulse, LifeBuoy, Lock, ShieldOff, Siren, Wrench, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton, cn } from '../../components/ui/primitives';
import { Input, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { reportError, useReauth } from '../../components/superadmin/Reauth';
import { useEmergencyHealthCheckMutation, useEmergencyTransitionMutation, useGetEmergencyStateQuery } from '../../services/superAdmin';
import { fmtDateTime } from '../../utils/format';

/**
 * Emergency Control Center. Not linked from any navigation; reachable only by
 * URL, and the route + every API behind it are Super Admin only on the server.
 *
 * What these switches do — and do not do — is stated plainly on the page:
 * they control access to the VEXON application. They cannot take hosting or
 * the database offline, and they never delete data or backups.
 */
const MODES = {
  normal: { label: 'Normal', icon: CheckCircle2, color: 'success', text: 'Everyone can use VEXON.' },
  maintenance: { label: 'Maintenance', icon: Wrench, color: 'warning', text: 'Ordinary users see a maintenance page and cannot sign in. Existing sessions are kept but paused.' },
  lockdown: { label: 'Access lockdown', icon: Lock, color: 'danger', text: 'Every non-Super-Admin session is revoked and sign-ins are refused. Use during a security incident.' },
  recovery: { label: 'Recovery', icon: LifeBuoy, color: 'info', text: 'Access stays closed while you verify the database and services. Reopening requires a passing health check.' },
};

export default function EmergencyControl() {
  const { data: state, error, isLoading, refetch } = useGetEmergencyStateQuery();
  const [target, setTarget] = useState(null);
  const [health, { isLoading: checking, data: lastRun }] = useEmergencyHealthCheckMutation();
  const { guard, modal } = useReauth();

  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const current = MODES[state.mode];
  const hc = lastRun || state.lastHealthCheck;
  const runCheck = async () => {
    try {
      const r = await guard(() => health().unwrap());
      toast[r.ok ? 'success' : 'error'](r.ok ? 'Health check passed' : 'Health check failed — see the details');
      refetch();
    } catch (err) {
      reportError(err, 'Health check could not run');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={Siren} title="Emergency Control" subtitle="Restricted page. Every action is re-authenticated, confirmed and written to the protected audit trail." />

      <Card className="border border-amber-400/40">
        <p className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          These modes control access to the VEXON application only. They do not shut down the hosting server or the database — that needs
          separately authorised infrastructure access. Nothing here deletes data or backups, and your Super Admin access is never blocked.
        </p>
      </Card>

      <Card>
        <CardHeader title="Current state" subtitle={state.changedAt ? `Changed ${fmtDateTime(state.changedAt)}${state.reason ? ` · ${state.reason}` : ''}` : 'Never changed'} />
        <div className="flex flex-wrap items-center gap-3">
          <Badge color={current.color} icon={current.icon} className="!text-sm">{current.label}</Badge>
          <span className="text-sm muted">{current.text}</span>
        </div>
      </Card>

      <Card>
        <CardHeader title="Change mode" subtitle="Only the transitions allowed from the current state are offered. Choose Normal to lift maintenance or a lockdown — the whole site works again (users signed out by a lockdown simply sign in again)." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(MODES).map(([mode, m]) => {
            const allowed = state.allowedTransitions.includes(mode);
            const Icon = m.icon;
            return (
              <button key={mode} type="button" disabled={!allowed} onClick={() => setTarget(mode)}
                className={cn('rounded-2xl border p-4 text-left transition', allowed ? 'border-white/60 hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/5' : 'cursor-not-allowed border-transparent opacity-40')}>
                <Icon className="mb-2 h-5 w-5" />
                <p className="font-extrabold">{m.label}</p>
                <p className="mt-1 text-xs muted">{m.text}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Health check" subtitle="Database, recovery access and backup status. Required in Recovery before reopening." action={<Button icon={HeartPulse} loading={checking} onClick={runCheck}>Run health check</Button>} />
        {!hc ? <p className="text-sm muted">Not run yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {(hc.checks || []).map((c) => (
              <li key={c.name} className="flex items-center gap-2">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : c.severity === 'critical' ? <XCircle className="h-4 w-4 text-rose-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                <span className="font-semibold capitalize">{c.name.replace(/_/g, ' ')}</span>
                <span className="muted">{c.detail}</span>
              </li>
            ))}
            <li className="pt-1 text-xs muted">{hc.ok ? 'Passed' : 'Failed'} · {fmtDateTime(hc.at)}</li>
          </ul>
        )}
      </Card>

      {target && <TransitionModal state={state} to={target} guard={guard} onClose={() => setTarget(null)} onDone={refetch} />}
      {modal}
    </div>
  );
}

function TransitionModal({ state, to, guard, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState('');
  const [go, { isLoading }] = useEmergencyTransitionMutation();
  const phrase = `CONFIRM ${to.toUpperCase()}`;
  const ready = confirm === phrase && reason.trim().length >= 5;

  const submit = async () => {
    try {
      const r = await guard(() => go({ to, expectedVersion: state.version, reason, message: message || undefined, confirm }).unwrap());
      toast.success(r.changed ? `Platform is now in ${MODES[to].label}` : 'Already in that mode — nothing changed');
      onDone();
      onClose();
    } catch (err) {
      reportError(err, 'The mode was not changed');
      onDone(); // show the real current state after a conflict
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Switch to ${MODES[to].label}?`} subtitle={MODES[to].text}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={to === 'normal' ? 'primary' : 'danger'} icon={to === 'normal' ? CheckCircle2 : ShieldOff} disabled={!ready} loading={isLoading} onClick={submit}>Switch mode</Button></>}>
      <div className="space-y-3">
        <Textarea label="Reason (recorded in the audit trail)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        {to !== 'normal' && <Input label="Message shown to users (optional)" maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />}
        <Input label={`Type ${phrase} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      </div>
    </Modal>
  );
}
