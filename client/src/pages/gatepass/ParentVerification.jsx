import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { RotateCw, Send, ShieldCheck } from 'lucide-react';
import { useGetParentOtpQuery, useRequestParentOtpMutation, useVerifyParentOtpMutation } from '../../services/api';
import { Badge, Button, Skeleton } from '../../components/ui/primitives';
import { YEAR_LABELS } from '../../utils/constants';
import { errMsg } from '../../utils/format';

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const secondsUntil = (d, now) => (d ? Math.max(0, Math.ceil((new Date(d).getTime() - now) / 1000)) : 0);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const NOT_LIVE_TEXT = {
  expired: 'The OTP expired. Send a new one to the parent.',
  locked: 'Too many incorrect attempts. Send a new OTP to the parent.',
  failed: 'The last OTP could not be sent. Try again.',
};

/** Faculty step: confirm the parent with a backend-issued OTP before forwarding to the HOD. */
export function ParentVerification({ pass, onVerified }) {
  const inputId = useId();
  const { data, isLoading, error, refetch } = useGetParentOtpQuery(pass._id);
  const [send, { isLoading: sending }] = useRequestParentOtpMutation();
  const [verify, { isLoading: verifying }] = useVerifyParentOtpMutation();
  const [sent, setSent] = useState(null);
  const [otp, setOtp] = useState('');
  const [problem, setProblem] = useState('');

  const state = sent || data;
  const now = useNow(Boolean(state?.resendAvailableAt || state?.status === 'active'));
  const expiresIn = state?.status === 'active' ? secondsUntil(state.expiresAt, now) : 0;
  const live = expiresIn > 0;
  const resendIn = secondsUntil(state?.resendAvailableAt, now);
  const length = state?.otpLength ?? 0;
  const status = state?.status === 'active' && !live ? 'expired' : state?.status;

  const sendOtp = async () => {
    try {
      setSent(await send(pass._id).unwrap());
      setOtp('');
      setProblem('');
      toast.success('OTP sent to the registered parent mobile number');
    } catch (e) {
      toast.error(errMsg(e));
      refetch();
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (otp.length !== length) {
      setProblem(`Enter the ${length}-digit OTP`);
      return;
    }
    try {
      await verify({ id: pass._id, otp }).unwrap();
      toast.success('Parent verified — you can now forward to the HOD');
      onVerified?.();
    } catch (err) {
      setProblem(errMsg(err, 'Could not verify the OTP'));
      setOtp('');
      setSent(null);
      refetch();
    }
  };

  const student = pass.student || {};
  const details = [
    ['Student', student.name],
    ['Department', student.department || pass.department],
    ['Year', YEAR_LABELS[student.year] || (student.year ? `Year ${student.year}` : '—')],
    ['Section', student.section || pass.section],
    ['Parent mobile', state?.parentMobile || pass.parentPhone],
  ];

  return (
    <section aria-label="Parent verification" className="min-w-0 rounded-3xl border border-primary-500/15 bg-primary-500/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary-500" aria-hidden />
        <h3 className="text-sm font-extrabold uppercase tracking-wide">Parent verification</h3>
        {state?.devMode && (
          <Badge color="warning" className="normal-case">
            Development OTP service
          </Badge>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="muted">{label}</dt>
            <dd className="break-words font-bold">{value || '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-12" />
        ) : error ? (
          <p className="text-sm text-rose-600" role="alert">
            {errMsg(error)}
          </p>
        ) : live ? (
          <form onSubmit={submit} noValidate>
            <p className="text-sm">
              OTP sent to the registered parent mobile number.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 sm:w-64">
                <label htmlFor={inputId} className="mb-1 block text-xs font-bold muted">
                  Enter {length}-digit OTP
                </label>
                <input
                  id={inputId}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, length));
                    setProblem('');
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={length}
                  placeholder={'•'.repeat(length)}
                  aria-invalid={Boolean(problem)}
                  aria-describedby={problem ? `${inputId}-error` : undefined}
                  className="input w-full text-center font-mono text-2xl tracking-[0.4em]"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" icon={ShieldCheck} loading={verifying} className="w-full sm:w-auto">
                  Verify OTP
                </Button>
                <Button type="button" variant="ghost" icon={RotateCw} disabled={resendIn > 0 || sending} loading={sending} onClick={sendOtp} className="w-full sm:w-auto">
                  {resendIn > 0 ? `Resend OTP in ${resendIn}s` : 'Resend OTP'}
                </Button>
              </div>
            </div>
            {problem && (
              <p id={`${inputId}-error`} className="mt-2 text-sm text-rose-600" role="alert">
                {problem}
              </p>
            )}
            <p className="mt-2 text-xs muted">
              <span className="font-bold tabular-nums">{mmss(expiresIn)}</span> remaining · {state.attemptsLeft} attempt{state.attemptsLeft === 1 ? '' : 's'} left
            </p>
          </form>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm">
              {problem && (
                <span className="block text-rose-600" role="alert">
                  {problem}
                </span>
              )}
              {NOT_LIVE_TEXT[status] || 'Send an OTP to the parent’s registered mobile number, then enter the code they read out.'}
            </p>
            <Button icon={Send} loading={sending} disabled={resendIn > 0} onClick={sendOtp} className="w-full sm:w-auto">
              {resendIn > 0 ? `Send new OTP in ${resendIn}s` : status && status !== 'none' ? 'Send new OTP' : 'Send OTP'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
