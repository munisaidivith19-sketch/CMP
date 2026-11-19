import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, Clock, Eye, EyeOff, KeyRound, Lock, Mail, ShieldAlert } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { useLoginMutation } from '../../services/api';
import { setCredentials } from '../../features/authSlice';
import { IDLE_LOGOUT_MESSAGE, clearLogoutReason, peekLogoutReason } from '../../services/sessionSync';
import { errMsg } from '../../utils/format';
import { encryptPassword } from '../../services/loginCrypto';
import TurnstileWidget from '../../components/TurnstileWidget';

// Passwords are reset by the Class In-Charge or an Admin — there is no email reset.
const PASSWORD_HELP = 'Forgot your password? Contact your Class In-Charge or Admin to reset your password.';

function formatCountdown(totalSecs) {
  if (totalSecs <= 0) return '00:00';
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [login, { isLoading }] = useLoginMutation();

  // Progressive Lockout & Attempt Warning State
  const [lockout, setLockout] = useState(() => {
    try {
      const saved = sessionStorage.getItem('campus_lockout');
      if (saved) {
        const { lockUntil } = JSON.parse(saved);
        const diffSecs = Math.ceil((new Date(lockUntil).getTime() - Date.now()) / 1000);
        if (diffSecs > 0) return { isLocked: true, secondsLeft: diffSecs, lockUntil };
      }
    } catch {
      /* ignore storage parse error */
    }
    return { isLocked: false, secondsLeft: 0, lockUntil: null };
  });

  const [remainingAttempts, setRemainingAttempts] = useState(null);
  const [nextLockMinutes, setNextLockMinutes] = useState(5);
  // Security check (CAPTCHA): shown only when the server asks for it.
  const [captcha, setCaptcha] = useState(null); // { siteKey } | null
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const timerRef = useRef(null);
  // Shown once when the previous session ended for inactivity.
  const [idleNotice] = useState(() => peekLogoutReason() === 'idle');
  useEffect(() => clearLogoutReason(), []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { email: '', password: '' } });

  // Ticking countdown timer
  useEffect(() => {
    if (!lockout.isLocked) return;

    timerRef.current = setInterval(() => {
      setLockout((prev) => {
        if (!prev.isLocked) return prev;
        const diffSecs = Math.ceil((new Date(prev.lockUntil).getTime() - Date.now()) / 1000);
        if (diffSecs <= 0) {
          clearInterval(timerRef.current);
          sessionStorage.removeItem('campus_lockout');
          toast.success('Lockout expired. You can now try signing in.');
          return { isLocked: false, secondsLeft: 0, lockUntil: null };
        }
        return { ...prev, secondsLeft: diffSecs };
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [lockout.isLocked, lockout.lockUntil]);

  const onSubmit = async (values) => {
    if (lockout.isLocked) return;
    if (captcha && !captchaToken) {
      toast.error('Complete the security check first.');
      return;
    }
    // A Turnstile token is single-use: whatever happens, the widget needs a new one next time.
    const sentToken = captcha ? captchaToken : null;

    try {
      // The password leaves the browser as encrypted text, not readable in the request.
      const send = async (refreshKey) => {
        const envelope = await encryptPassword(values.password, { refreshKey });
        const body = envelope ? { email: values.email, ...envelope } : { ...values };
        if (sentToken) body.captchaToken = sentToken;
        return login(body).unwrap();
      };
      let data;
      try {
        data = await send(false);
      } catch (err) {
        // The server's key changed (restart / new key): fetch the new one and retry once.
        if (err?.data?.code !== 'LOGIN_KEY_STALE') throw err;
        data = await send(true);
      }
      sessionStorage.removeItem('campus_lockout');
      setRemainingAttempts(null);
      dispatch(setCredentials(data));
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      const data = err?.data;

      // The server says whether the next attempt needs the security check.
      if (data?.captchaRequired !== undefined) setCaptcha(data.captchaRequired && data.siteKey ? { siteKey: data.siteKey } : null);
      if (sentToken) setCaptchaReset((n) => n + 1);

      // Handle HTTP 423 (Locked) or payload indicating lockout
      if (err?.status === 423 || data?.locked) {
        const lockUntil = data?.lockUntil || new Date(Date.now() + (data?.retryAfterSeconds || 300) * 1000).toISOString();
        const secondsLeft = data?.retryAfterSeconds || Math.ceil((new Date(lockUntil).getTime() - Date.now()) / 1000);

        const newLockout = { isLocked: true, secondsLeft, lockUntil };
        setLockout(newLockout);
        setRemainingAttempts(null);
        try {
          sessionStorage.setItem('campus_lockout', JSON.stringify({ lockUntil }));
        } catch {
          /* ignore */
        }
        toast.error(data?.message || 'Account temporarily locked due to failed attempts.');
      } else {
        // Handle failed attempts before lockout (remaining attempts)
        if (data?.remainingAttempts !== undefined) {
          setRemainingAttempts(data.remainingAttempts);
          if (data.nextLockMinutes) setNextLockMinutes(data.nextLockMinutes);
        }
        toast.error(errMsg(err, 'Sign in failed'));
      }
    }
  };

  return (
    <AuthShell title="Welcome back 👋" subtitle="Sign in to continue to your campus dashboard.">
      {idleNotice && (
        <div role="status" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{IDLE_LOGOUT_MESSAGE}</span>
        </div>
      )}
      <form
        onSubmit={(e) => {
          // Never leave the password readable once Sign in is pressed: back to the masked dots.
          setShow(false);
          return handleSubmit(onSubmit)(e);
        }}
        className="space-y-4" noValidate>
        {/* Active Lockout Banner with Live Monospace Countdown */}
        {lockout.isLocked && (
          <div className="rounded-2xl border border-white/45 bg-white/10 p-4 text-center backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2">
              <ShieldAlert className="auth-red h-6 w-6" />
              <p className="auth-red text-lg font-extrabold">Account Temporarily Locked</p>
            </div>
            <p className="mt-1 text-sm font-semibold text-white">
              Too many consecutive failed sign-in attempts. For your security, please wait:
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 font-mono text-3xl font-extrabold tracking-wider text-white">
              <Clock className="h-6 w-6 animate-pulse" />
              <span>{formatCountdown(lockout.secondsLeft)}</span>
            </div>
            <p className="mt-3 border-t border-white/30 pt-2.5 text-sm font-bold text-white">{PASSWORD_HELP}</p>
          </div>
        )}

        {/* Remaining Attempts Warning Pill */}
        {!lockout.isLocked && remainingAttempts !== null && remainingAttempts > 0 && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span>
              Invalid credentials. <strong>{remainingAttempts} attempt{remainingAttempts > 1 ? 's' : ''} remaining</strong> before a temporary {nextLockMinutes}-minute lock.
            </span>
          </div>
        )}

        {!lockout.isLocked && (
          <>
        <Input
          label="Email"
          type="email"
          icon={Mail}
          autoComplete="email"
          disabled={lockout.isLocked}
          placeholder="you@jnn.edu.in"
          error={errors.email}
          {...register('email', {
            required: 'Email is required',
            pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
          })}
        />

        <div className="relative">
          <Input
            label="Password"
            type={show ? 'text' : 'password'}
            icon={Lock}
            autoComplete="current-password"
            disabled={lockout.isLocked}
            placeholder="••••••••"
            error={errors.password}
            {...register('password', { required: 'Password is required' })}
          />
          <button
            type="button"
            disabled={lockout.isLocked}
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-[34px] rounded-lg p-1.5 text-ink-muted hover:text-ink disabled:opacity-40"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <p className="-mt-1 flex items-start gap-1.5 text-xs font-medium text-ink-soft dark:text-ink-muted">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-500" aria-hidden />
          <span>{PASSWORD_HELP}</span>
        </p>

        {captcha && (
          <div className="space-y-1.5">
            <p className="text-center text-xs font-semibold text-ink-soft dark:text-ink-muted">
              There were failed sign-ins from this network. Please complete this quick security check.
            </p>
            <TurnstileWidget
              siteKey={captcha.siteKey}
              action="login"
              onToken={setCaptchaToken}
              resetKey={captchaReset}
              onLoadError={() => toast.error('The security check could not load. Check your connection and reload the page.')}
            />
          </div>
        )}

        <Button
          type="submit"
          loading={isLoading}
          disabled={lockout.isLocked || (Boolean(captcha) && !captchaToken)}
          className="w-full"
          size="lg"
        >
          {lockout.isLocked ? `Locked (${formatCountdown(lockout.secondsLeft)})` : 'Sign in'}
        </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}

