import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  GraduationCap,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  Lock,
  ArrowRight,
  Building,
  Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { setCredentials } from '../../features/authSlice';
import {
  useGetPublicClaimQuery,
  useSubmitPublicClaimMutation,
} from '../../services/api';
import { Backdrop } from '../../components/layout/AppLayout';
import {
  Button,
  Card,
  PageLoader,
} from '../../components/ui/primitives';
import { Field, Input } from '../../components/ui/form';

export default function AlumniClaim() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accept, setAccept] = useState(false);

  const { data: claimData, isLoading, error } = useGetPublicClaimQuery(token, {
    skip: !token,
  });

  const [submitClaim, { isLoading: isSubmitting }] = useSubmitPublicClaimMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.error('Missing invitation token');
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      toast.error('Password must be at least 8 characters and contain both a letter and a number');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!accept) {
      toast.error('You must accept the terms to claim your account');
      return;
    }

    try {
      const res = await submitClaim({ token, password, accept: true }).unwrap();
      dispatch(setCredentials(res));
      toast.success(`Welcome to the Alumni Network, ${claimData?.name || ''}!`);
      navigate('/alumni?tab=my_profile', { replace: true });
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to claim invitation');
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Backdrop />
        <Card className="max-w-md p-6 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold">Missing Invitation Token</h2>
          <p className="text-xs muted">
            Please use the personalized link sent to your email to claim your alumni profile.
          </p>
          <Button variant="primary" onClick={() => navigate('/login')} className="w-full">
            Return to Sign In
          </Button>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Backdrop />
        <PageLoader />
      </div>
    );
  }

  if (error || !claimData) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Backdrop />
        <Card className="max-w-md p-6 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold">Invitation Invalid or Expired</h2>
          <p className="text-xs muted">
            This invitation link is invalid, has expired, or has already been claimed. Please reach out to your department HOD or alumni coordinator for a new link.
          </p>
          <Button variant="primary" onClick={() => navigate('/login')} className="w-full">
            Return to Sign In
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Backdrop />
      <Card className="w-full max-w-lg p-6 sm:p-8 space-y-6 animate-scale-in">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white shadow-glow">
            <GraduationCap className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">Claim Your Alumni Profile</h2>
          <p className="text-xs muted max-w-sm mx-auto">
            Welcome home! Set up your password to activate your official CampusConnect Alumni account.
          </p>
        </div>

        {/* Verified Invitee Details */}
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 text-xs space-y-2 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-ink">{claimData.name}</span>
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Verified Passout
            </span>
          </div>

          <div className="flex flex-wrap gap-2 text-slate-500 pt-1">
            <span className="flex items-center gap-1">
              <Mail className="h-3 w-3" /> {claimData.email}
            </span>
            <span>•</span>
            <span>
              {claimData.department} (Class of {claimData.gradYear})
            </span>
            {claimData.company && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1 font-semibold text-primary-600 dark:text-primary-400">
                  <Building className="h-3 w-3" /> {claimData.designation} at {claimData.company}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Password Setup Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Create New Password"
            hint="At least 8 characters, containing at least 1 letter and 1 number"
            required
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>

          <Field label="Confirm Password" required>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Field>

          <label className="flex items-start gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              required
            />
            <span>
              I accept the Alumni Network Terms, Community Guidelines, and agree to support fellow campus students and peers.
            </span>
          </label>

          <Button
            variant="primary"
            type="submit"
            loading={isSubmitting}
            disabled={!password || !confirmPassword || !accept}
            className="w-full justify-center font-bold text-sm py-3"
          >
            Activate Alumni Account & Sign In <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
