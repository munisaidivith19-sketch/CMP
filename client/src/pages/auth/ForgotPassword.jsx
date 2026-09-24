import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { ArrowLeft, MailCheck, Mail } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { useForgotPasswordMutation } from '../../services/api';
import { errMsg } from '../../utils/format';

export default function ForgotPassword() {
  const [sent, setSent] = useState(null);
  const [send, { isLoading }] = useForgotPasswordMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { email: '' } });

  const onSubmit = async ({ email }) => {
    try {
      const res = await send({ email }).unwrap();
      setSent({ email, message: res.message });
    } catch (err) {
      toast.error(errMsg(err, 'Could not send the reset link'));
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox 📬" subtitle={sent.message}>
        <div className="flex flex-col items-center rounded-3xl bg-primary-500/[0.06] p-6 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
            <MailCheck className="h-7 w-7" />
          </div>
          <p className="text-sm">
            If <span className="font-bold">{sent.email}</span> belongs to an account, a link to reset the password is on its way. It
            expires in 15 minutes and can be used once.
          </p>
          <p className="mt-2 text-xs muted">Didn’t get it? Check spam, or try again in a minute.</p>
        </div>
        <Button to="/login" variant="soft" icon={ArrowLeft} className="mt-6 w-full">
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your college email and we’ll send you a secure reset link.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input
          label="College email"
          type="email"
          icon={Mail}
          autoComplete="email"
          autoFocus
          placeholder="you@campus.edu"
          error={errors.email}
          {...register('email', {
            required: 'Email is required',
            pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
          })}
        />
        <Button type="submit" loading={isLoading} className="w-full" size="lg">
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm muted">
        Remembered it?{' '}
        <Link to="/login" className="font-bold text-primary-600 hover:underline dark:text-primary-300">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
