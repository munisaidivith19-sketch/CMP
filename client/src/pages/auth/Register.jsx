import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import toast from 'react-hot-toast';
import { Hash, Lock, Mail, User } from 'lucide-react';
import AuthShell from './AuthShell';
import { Button } from '../../components/ui/primitives';
import { Input, Select } from '../../components/ui/form';
import { useRegisterMutation } from '../../services/api';
import { setCredentials } from '../../features/authSlice';
import { DEPARTMENTS } from '../../utils/constants';
import { errMsg } from '../../utils/format';

export default function Register() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [registerUser, { isLoading }] = useRegisterMutation();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { name: '', email: '', department: '', year: '', rollNo: '', password: '', confirm: '' } });

  const onSubmit = async ({ confirm, ...values }) => {
    try {
      const data = await registerUser({ ...values, year: values.year ? Number(values.year) : undefined }).unwrap();
      dispatch(setCredentials(data));
      toast.success('Account created — welcome to CampusConnect! 🎉');
      navigate('/profile?edit=1', { replace: true });
    } catch (err) {
      toast.error(errMsg(err, 'Registration failed'));
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Join your campus community in less than a minute.">
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input
          className="sm:col-span-2"
          label="Full name"
          icon={User}
          placeholder="Your name"
          error={errors.name}
          {...register('name', { required: 'Name is required', minLength: { value: 2, message: 'Too short' } })}
        />
        <Input
          className="sm:col-span-2"
          label="College email"
          type="email"
          icon={Mail}
          placeholder="you@campus.edu"
          error={errors.email}
          {...register('email', {
            required: 'Email is required',
            pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
          })}
        />
        <Select
          label="Department"
          placeholder="Select department"
          options={DEPARTMENTS}
          error={errors.department}
          {...register('department', { required: 'Choose your department' })}
        />
        <Select label="Year" placeholder="Select year" options={[1, 2, 3, 4].map((y) => ({ value: y, label: `Year ${y}` }))} {...register('year')} />
        <Input className="sm:col-span-2" label="Roll number (optional)" icon={Hash} placeholder="e.g. 22CS101" {...register('rollNo')} />
        <Input
          label="Password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          error={errors.password}
          hint="8+ characters, a letter and a number"
          {...register('password', {
            required: 'Password is required',
            minLength: { value: 8, message: 'At least 8 characters' },
            validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || 'Include a letter and a number',
          })}
        />
        <Input
          label="Confirm password"
          type="password"
          icon={Lock}
          autoComplete="new-password"
          error={errors.confirm}
          {...register('confirm', { validate: (v) => v === watch('password') || 'Passwords do not match' })}
        />
        <Button type="submit" loading={isLoading} className="sm:col-span-2" size="lg">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm muted">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-primary-600 hover:underline dark:text-primary-300">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
