import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { AlertTriangle, Clock, Eye, EyeOff, Lock, Mail, ShieldAlert } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { useLoginMutation } from '../../services/api';
import { setCredentials } from '../../features/authSlice';
import { errMsg } from '../../utils/format';

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
  const timerRef = useRef(null);

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

    try {
      const data = await login(values).unwrap();
      sessionStorage.removeItem('campus_lockout');
      setRemainingAttempts(null);
      dispatch(setCredentials(data));
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      const data = err?.data;

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
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Active Lockout Banner with Live Monospace Countdown */}
        {lockout.isLocked && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.08] p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
              <ShieldAlert className="h-5 w-5" />
              <p className="font-bold text-sm">Account Temporarily Locked</p>
            </div>
            <p className="mt-1 text-xs muted">
              Too many consecutive failed sign-in attempts. For your security, please wait:
            </p>
            <div className="mt-3 flex items-center justify-center gap-2 font-mono text-3xl font-extrabold tracking-wider text-rose-600 dark:text-rose-400">
              <Clock className="h-6 w-6 animate-pulse" />
              <span>{formatCountdown(lockout.secondsLeft)}</span>
            </div>
            <div className="mt-3 border-t border-rose-500/20 pt-2.5">
              <Link to="/forgot-password" className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-300">
                Need immediate access? Reset password →
              </Link>
            </div>
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

        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-300">
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          loading={isLoading}
          disabled={lockout.isLocked}
          className="w-full"
          size="lg"
        >
          {lockout.isLocked ? `Locked (${formatCountdown(lockout.secondsLeft)})` : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

