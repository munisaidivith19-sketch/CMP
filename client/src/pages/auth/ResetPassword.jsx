import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { KeyRound, Lock, ShieldAlert } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { useResetPasswordMutation } from '../../services/api';
import { errMsg } from '../../utils/format';

/** The token arrives in the URL fragment (#token=…), which browsers never send to servers. */
function readToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('token') || '';
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [reset, { isLoading }] = useResetPasswordMutation();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { password: '', confirm: '' } });

  // Drop the token from the address bar / history as soon as we have it.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const onSubmit = async ({ password }) => {
    try {
      const res = await reset({ token, password }).unwrap();
      toast.success(res.message || 'Password updated');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(errMsg(err, 'Could not reset the password'));
    }
  };

  if (!token) {
    return (
      <AuthShell title="Link not valid" subtitle="This password reset link is incomplete or has already been used.">
        <div className="flex items-start gap-3 rounded-3xl bg-rose-500/10 p-4 text-sm text-rose-700">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          Reset links expire after 15 minutes and work only once. Request a new one to continue.
        </div>
        <Button to="/forgot-password" className="mt-6 w-full">
          Request a new link
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Your other devices will be signed out once it’s changed.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input
          label="New password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          autoFocus
          hint="8+ characters with at least one letter and one number"
          error={errors.password}
          {...register('password', {
            required: 'Password is required',
            minLength: { value: 8, message: 'At least 8 characters' },
            maxLength: { value: 72, message: 'At most 72 characters' },
            validate: {
              letter: (v) => /[A-Za-z]/.test(v) || 'Include a letter',
              number: (v) => /\d/.test(v) || 'Include a number',
            },
          })}
        />
        <Input
          label="Confirm password"
          type="password"
          icon={KeyRound}
          autoComplete="new-password"
          error={errors.confirm}
          {...register('confirm', { validate: (v) => v === watch('password') || 'Passwords do not match' })}
        />
        <Button type="submit" loading={isLoading} className="w-full" size="lg">
          Update password
        </Button>
      </form>
      <p className="mt-6 text-center text-sm muted">
        <Link to="/login" className="font-bold text-primary-600 hover:underline dark:text-primary-300">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
