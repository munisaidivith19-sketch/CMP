import { AlertTriangle, KeyRound } from 'lucide-react';
import { useGetDevOtpsQuery } from '../../services/api';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { fmtTime } from '../../utils/format';

const STATUS_COLOR_KEY = { active: 'active', used: 'approved', expired: 'expired', superseded: 'cancelled', locked: 'rejected', failed: 'rejected' };

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide muted">{label}</dt>
      <dd className="break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** Development stand-in for the college SMS vendor: shows test OTPs to admins. Not linked from navigation. */
export default function DevOtpPortal() {
  const { data, isLoading, error, refetch } = useGetDevOtpsQuery(undefined, { pollingInterval: 5000 });
  const disabled = error?.status === 404;

  return (
    <div className="space-y-5">
      <div role="alert" className="flex items-start gap-3 rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-extrabold tracking-wide">DEVELOPMENT ONLY — NOT FOR PRODUCTION</p>
          <p className="text-sm">
            Simulates the college SMS vendor while its API is unavailable. Read the parent OTP here, then enter it in the faculty gate pass screen — the backend still verifies it.
          </p>
        </div>
      </div>
      <PageHeader icon={KeyRound} title="Test OTP portal" subtitle="Parent OTPs from the last 24 hours. Refreshes every 5 seconds." />

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : disabled ? (
        <Card>
          <EmptyState icon={KeyRound} title="Portal disabled" text="The development OTP portal is turned off on this server (production mode)." />
        </Card>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.otps.length ? (
        <Card>
          <EmptyState icon={KeyRound} title="No OTPs yet" text="OTPs appear here as soon as a faculty member sends one." />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.otps.map((o) => (
            <li key={o.id}>
              <Card className="h-full space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-sm font-bold">{o.passRef}</p>
                  <StatusBadge status={STATUS_COLOR_KEY[o.status] || o.status} label={o.status} />
                </div>
                <p className="rounded-2xl bg-white/60 py-3 text-center font-mono text-3xl font-extrabold tracking-[0.3em] dark:bg-white/5" aria-label="OTP">
                  {o.otp || '——'}
                </p>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="Student">{o.student?.name || '—'}</Field>
                  <Field label="Parent mobile">{o.parentMobile}</Field>
                  <Field label="Created">{fmtTime(o.createdAt)}</Field>
                  <Field label="Expires">{fmtTime(o.expiresAt)}</Field>
                  <Field label="Attempts">
                    {o.attempts} / {o.maxAttempts}
                  </Field>
                  <Field label="Faculty">{o.faculty?.name || '—'}</Field>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data?.messages?.length > 0 && (
        <Card>
          <CardHeader title="Parent messages (test SMS)" subtitle="What the parent would receive by SMS, e.g. the return-to-campus notice." />
          <ul className="space-y-3">
            {data.messages.map((m, i) => (
              <li key={`${m.sentAt}-${i}`} className="rounded-2xl bg-white/60 p-3 dark:bg-white/5">
                <p className="text-xs muted">
                  {m.to} · {fmtTime(m.sentAt)}
                </p>
                <p className="mt-1 break-words text-sm">{m.message}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
