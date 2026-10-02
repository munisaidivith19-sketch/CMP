import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft, CheckCircle2, LogIn, LogOut, ScanLine, ShieldCheck, XCircle } from 'lucide-react';
import { useRecordGateInMutation, useRecordGateOutMutation, useVerifyGatePassMutation, useVerifyReturnCredentialMutation } from '../../services/api';
import { Avatar, Button, Card, PageHeader, cn } from '../../components/ui/primitives';
import QrScannerModal from '../../components/QrScannerModal';
import { scanProblem } from '../../utils/gateQr';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, titleCase } from '../../utils/format';
import { GATE_PASS_REGARDING, YEAR_LABELS } from '../../utils/constants';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);

const COPY = {
  in: {
    title: 'Return verification',
    subtitle: "Scan the student's Return QR or enter their Return Code, then confirm they are inside.",
    placeholder: 'Return code',
    icon: LogIn,
    button: 'Student is inside',
    successMessage: 'Return recorded — the parent and class faculty have been notified.',
    mismatch: '',
  },
  out: {
    title: 'Student OUT',
    subtitle: 'Ask the student for their code, then confirm they’re leaving.',
    placeholder: 'A4G5',
    icon: LogOut,
    button: 'Confirm OUT',
    successMessage: 'OUT recorded — have a safe trip.',
    mismatch: 'This student is already outside — use Return verification when they come back.',
  },
};

/** The gate guard's OUT page (exit code) and Return verification page (return QR/code). */
export default function GateVerify({ direction }) {
  const copy = COPY[direction];
  const isReturn = direction === 'in';
  const [code, setCode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [verifyExit, { isLoading: exitChecking }] = useVerifyGatePassMutation();
  const [verifyReturn, { isLoading: returnChecking }] = useVerifyReturnCredentialMutation();
  const [recordOut, { isLoading: outLoading }] = useRecordGateOutMutation();
  const [recordIn, { isLoading: inLoading }] = useRecordGateInMutation();
  const acting = outLoading || inLoading;
  const matches = isReturn ? result?.nextAction === 'inside' : result?.nextAction === 'out';
  const student = result?.pass?.student;

  // Accepts the typed code or a scanned QR value — same verification either way.
  const check = async (e, scanned) => {
    e?.preventDefault?.();
    const value = (typeof scanned === 'string' ? scanned : code).trim();
    if (!value) return;
    try {
      setResult({ ...(await (isReturn ? verifyReturn(value) : verifyExit(value)).unwrap()), credential: value });
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const confirm = async () => {
    try {
      if (isReturn) await recordIn({ id: result.pass._id, code: result.credential }).unwrap();
      else await recordOut({ id: result.pass._id, code: result.credential }).unwrap();
      toast.success(copy.successMessage);
      setResult(null);
      setCode('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const details = isReturn && result?.pass
    ? [
        ['Department', student?.department],
        ['Year', YEAR_LABELS[student?.year] || student?.year],
        ['Section', student?.section],
        ['Gate pass', result.passRef],
        ['Status', 'Return verification ready'],
      ]
    : [];

  return (
    <div className="space-y-5">
      <Link to="/gate-pass" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Security console
      </Link>
      <PageHeader icon={copy.icon} title={copy.title} subtitle={copy.subtitle} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <Button type="button" icon={ScanLine} className="mb-3 w-full" onClick={() => setScanOpen(true)}>
            Scan QR code
          </Button>
          <p className="mb-2 text-center text-xs muted">or enter code manually</p>
          <form onSubmit={check} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={code}
              // A scanner types "CCRT:<token>" — keep that case-sensitive; codes are upper-cased.
              onChange={(e) => setCode(isReturn && /^ccrt:/i.test(e.target.value) ? e.target.value : e.target.value.toUpperCase())}
              placeholder={copy.placeholder}
              aria-label={isReturn ? 'Return code or scanned Return QR' : 'Verification code'}
              autoFocus
              autoComplete="off"
              className="input min-w-0 flex-1 font-mono text-2xl tracking-[0.3em]"
              maxLength={isReturn ? 80 : 4}
            />
            <Button type="submit" loading={exitChecking || returnChecking} icon={ShieldCheck}>
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
                {result.valid ? <CheckCircle2 className="h-6 w-6 shrink-0" /> : <XCircle className="h-6 w-6 shrink-0" />}
                <p className="font-bold">{result.valid ? (isReturn ? 'Return verification ready' : 'Valid pass') : 'Not valid'}</p>
              </div>
              {result.problems?.map((p) => (
                <p key={p} className="flex items-center gap-2 text-sm text-rose-600">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {p}
                </p>
              ))}
              {result.pass && (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar user={student} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-bold">{student?.name}</p>
                      <p className="truncate text-xs muted">{student?.rollNo || '—'}</p>
                    </div>
                    {!isReturn && <StatusBadge status={result.pass.status} />}
                  </div>
                  {isReturn ? (
                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      {details.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-xs muted">{label}</dt>
                          <dd className="break-words font-bold">{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm muted">
                      {result.pass.passType === 'emergency' ? 'Emergency gate pass' : regardingLabel(result.pass.regarding)} · {fmtClassDay(result.pass.fromDate)} → {fmtClassDay(result.pass.toDate)}
                    </p>
                  )}
                  {result.valid && !matches && copy.mismatch && (
                    <p className="flex items-center gap-2 text-sm text-amber-600">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> {copy.mismatch}
                    </p>
                  )}
                  {matches && (
                    <Button className="w-full" variant={isReturn ? 'success' : 'primary'} icon={copy.icon} loading={acting} onClick={confirm}>
                      {copy.button}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
      <QrScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title={isReturn ? 'Scan return QR' : 'Scan gate pass QR'}
        onScanned={(value) => {
          setScanOpen(false);
          const problem = scanProblem(value, isReturn ? 'return' : 'exit');
          if (problem) setResult({ valid: false, problems: [problem] });
          else check(null, value);
        }}
      />
    </div>
  );
}
