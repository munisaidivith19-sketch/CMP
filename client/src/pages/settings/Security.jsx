import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, KeyRound, LaptopMinimal, LogOut, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import {
  useChangePasswordMutation,
  useGetLoginHistoryQuery,
  useGetSessionsQuery,
  useRevokeOtherSessionsMutation,
  useRevokeSessionMutation,
} from '../../services/api';
import { setCredentials } from '../../features/authSlice';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Input } from '../../components/ui/form';
import { errMsg, fmtDateTime, timeAgo } from '../../utils/format';

const REASONS = {
  invalid_password: 'Wrong password',
  account_locked: 'Account temporarily locked',
  account_suspended: 'Account suspended',
};

function ChangePasswordCard() {
  const dispatch = useDispatch();
  const [change, { isLoading }] = useChangePasswordMutation();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  const onSubmit = async ({ currentPassword, newPassword }) => {
    try {
      const session = await change({ currentPassword, newPassword }).unwrap();
      dispatch(setCredentials(session));
      reset();
      toast.success('Password changed. Your other devices were signed out.');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card>
      <CardHeader title="Change password" subtitle="Signs out every other device that uses your account." action={<KeyRound className="h-5 w-5 text-primary-400" />} />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <Input label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword} {...register('currentPassword', { required: 'Required' })} />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="8–72 characters, at least one letter and one number"
          error={errors.newPassword}
          {...register('newPassword', {
            required: 'Required',
            minLength: { value: 8, message: 'At least 8 characters' },
            maxLength: { value: 72, message: 'At most 72 characters' },
            validate: {
              letter: (v) => /[A-Za-z]/.test(v) || 'Include a letter',
              number: (v) => /\d/.test(v) || 'Include a number',
              different: (v) => v !== watch('currentPassword') || 'Choose a different password',
            },
          })}
        />
        <Input label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm} {...register('confirm', { validate: (v) => v === watch('newPassword') || 'Passwords do not match' })} />
        <Button type="submit" loading={isLoading} className="w-full sm:w-auto">
          Update password
        </Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { data, isLoading, error, refetch } = useGetSessionsQuery();
  const [revoke, { isLoading: revoking }] = useRevokeSessionMutation();
  const [revokeOthers, { isLoading: revokingAll }] = useRevokeOtherSessionsMutation();
  const [confirm, setConfirm] = useState(false);
  const others = (data || []).filter((s) => !s.current);

  return (
    <Card>
      <CardHeader
        title="Where you’re signed in"
        subtitle="Web browsers and the Android app share one account."
        action={
          others.length > 0 && (
            <Button size="sm" variant="danger" icon={LogOut} onClick={() => setConfirm(true)}>
              Sign out others
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <ul className="space-y-2">
          {data.map((s) => {
            const Icon = s.client === 'mobile' ? Smartphone : LaptopMinimal;
            return (
              <li key={s._id} className="flex items-center gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {s.device || 'Unknown device'}
                    {s.current && <Badge color="success">This device</Badge>}
                  </p>
                  <p className="truncate text-xs muted">
                    Active {timeAgo(s.lastUsedAt)} · signed in {fmtDateTime(s.createdAt)}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoking}
                    onClick={async () => {
                      try {
                        await revoke(s._id).unwrap();
                        toast.success('Device signed out');
                      } catch (e) {
                        toast.error(errMsg(e));
                      }
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Sign out all other devices?"
        text="Every other browser and phone will need to sign in again. This device stays signed in."
        confirmText="Sign out others"
        loading={revokingAll}
        onConfirm={async () => {
          try {
            const res = await revokeOthers().unwrap();
            toast.success(res.message);
          } catch (e) {
            toast.error(errMsg(e));
          }
          setConfirm(false);
        }}
      />
    </Card>
  );
}

function LoginHistoryCard() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useGetLoginHistoryQuery({ page, limit: 10 });
  return (
    <Card>
      <CardHeader title="Sign-in history" subtitle="Last 90 days, including failed attempts." />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.records.length ? (
        <EmptyState icon={ShieldCheck} title="No sign-ins recorded yet" />
      ) : (
        <>
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {data.records.map((r) => (
              <li key={r._id} className="flex items-center gap-3 py-2.5">
                {r.success ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {r.success ? 'Signed in' : REASONS[r.reason] || 'Failed sign-in'} · {r.device || 'Unknown device'}
                  </p>
                  <p className="text-xs muted">
                    {fmtDateTime(r.createdAt)}
                    {r.ip ? ` · ${r.ip}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

export default function Security() {
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Account security" subtitle="Password, signed-in devices and sign-in history." />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <ChangePasswordCard />
          <SessionsCard />
        </div>
        <LoginHistoryCard />
      </div>
    </div>
  );
}
