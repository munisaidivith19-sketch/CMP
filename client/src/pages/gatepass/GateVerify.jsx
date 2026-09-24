import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft, CheckCircle2, LogIn, LogOut, ShieldCheck, XCircle } from 'lucide-react';
import { useRecordGateInMutation, useRecordGateOutMutation, useVerifyGatePassMutation } from '../../services/api';
import { Avatar, Button, Card, PageHeader, cn } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, titleCase } from '../../utils/format';
import { GATE_PASS_REGARDING } from '../../utils/constants';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);

const COPY = {
  in: {
    title: 'Student IN',
    subtitle: "Ask the student for their code, then confirm they're entering.",
    icon: LogIn,
    button: 'Confirm IN',
    successMessage: 'IN recorded — class faculty has been notified.',
    mismatch: 'This student has not left campus yet — use the OUT page first.',
  },
  out: {
    title: 'Student OUT',
    subtitle: 'Ask the student for their code, then confirm they’re leaving.',
    icon: LogOut,
    button: 'Confirm OUT',
    successMessage: 'OUT recorded — have a safe trip.',
    mismatch: 'This code is already outside — use the IN page instead.',
  },
};

/** The gate guard's dedicated IN / OUT confirmation screen (a focused half of the fuller /gate-pass console). */
export default function GateVerify({ direction }) {
  const copy = COPY[direction];
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [verify, { isLoading: verifying }] = useVerifyGatePassMutation();
  const [recordOut, { isLoading: outLoading }] = useRecordGateOutMutation();
  const [recordIn, { isLoading: inLoading }] = useRecordGateInMutation();
  const acting = outLoading || inLoading;
  const matches = result?.nextAction === direction;

  const check = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    try {
      setResult(await verify(code.trim()).unwrap());
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const confirm = async () => {
    const fn = direction === 'in' ? recordIn : recordOut;
    try {
      await fn(result.pass._id).unwrap();
      toast.success(copy.successMessage);
      setResult(null);
      setCode('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-5">
      <Link to="/gate-pass" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Security console
      </Link>
      <PageHeader icon={copy.icon} title={copy.title} subtitle={copy.subtitle} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <form onSubmit={check} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="DF45"
              aria-label="Verification code"
              autoFocus
              autoComplete="off"
              className="input flex-1 font-mono text-2xl tracking-[0.3em]"
              maxLength={4}
            />
            <Button type="submit" loading={verifying} icon={ShieldCheck}>
              Verify
            </Button>
          </form>
        </Card>
        <Card aria-live="polite">
          {!result ? (
            <p className="text-sm muted">Verification results appear here.</p>
          ) : (
            <div className="space-y-4">
              <div className={cn('flex items-center gap-3 rounded-2xl p-3', result.valid ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700')}>
                {result.valid ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
                <p className="font-bold">{result.valid ? 'Valid pass' : 'Not valid'}</p>
              </div>
              {result.problems?.map((p) => (
                <p key={p} className="flex items-center gap-2 text-sm text-rose-600">
                  <AlertTriangle className="h-4 w-4" /> {p}
                </p>
              ))}
              {result.pass && (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar user={result.pass.student} />
                    <div className="min-w-0">
                      <p className="truncate font-bold">{result.pass.student?.name}</p>
                      <p className="truncate text-xs muted">
                        {result.pass.student?.rollNo || '—'} · Year {result.pass.student?.year || '—'} · {result.pass.student?.department || '—'}
                      </p>
                    </div>
                    <StatusBadge status={result.pass.status} />
                  </div>
                  <p className="text-sm muted">
                    {regardingLabel(result.pass.regarding)} · {fmtClassDay(result.pass.fromDate)} → {fmtClassDay(result.pass.toDate)}
                  </p>
                  {result.valid && !matches && (
                    <p className="flex items-center gap-2 text-sm text-amber-600">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> {copy.mismatch}
                    </p>
                  )}
                  {matches && (
                    <Button className="w-full" variant={direction === 'in' ? 'success' : 'primary'} icon={copy.icon} loading={acting} onClick={confirm}>
                      {copy.button}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
