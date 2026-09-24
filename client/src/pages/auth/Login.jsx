import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input } from '../../components/ui/form';
import { useLoginMutation } from '../../services/api';
import { setCredentials } from '../../features/authSlice';
import { errMsg } from '../../utils/format';

const DEMO = [
  { label: 'Student', email: 'student@campus.edu' },
  { label: 'Club admin', email: 'clubadmin@campus.edu' },
  { label: 'Faculty', email: 'faculty@campus.edu' },
  { label: 'HOD', email: 'hod@campus.edu' },
  { label: 'Principal', email: 'principal@campus.edu' },
  { label: 'Security', email: 'security@campus.edu' },
  { label: 'Admin', email: 'admin@campus.edu' },
];

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [login, { isLoading }] = useLoginMutation();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({ defaultValues: { email: '', password: '' } });

  const onSubmit = async (values) => {
    try {
      const data = await login(values).unwrap();
      dispatch(setCredentials(data));
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      toast.error(errMsg(err, 'Sign in failed'));
    }
  };

  return (
    <AuthShell title="Welcome back 👋" subtitle="Sign in to continue to your campus dashboard.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          icon={Mail}
          autoComplete="email"
          placeholder="you@campus.edu"
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
            placeholder="••••••••"
            error={errors.password}
            {...register('password', { required: 'Password is required' })}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-[34px] rounded-lg p-1.5 text-ink-muted hover:text-ink"
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
        <Button type="submit" loading={isLoading} className="w-full" size="lg">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm muted">
        New here?{' '}
        <Link to="/register" className="font-bold text-primary-600 hover:underline dark:text-primary-300">
          Create a student account
        </Link>
      </p>

      <div className="mt-8 rounded-3xl bg-primary-500/[0.06] p-4">
        <p className="text-xs font-bold uppercase tracking-wide muted">Demo accounts · password Password@123</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              className="chip"
              onClick={() => {
                setValue('email', d.email);
                setValue('password', 'Password@123');
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
