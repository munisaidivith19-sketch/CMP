import { useState } from 'react';
import { CheckCircle2, KeyRound, LogIn, MonitorSmartphone, RefreshCw, Search, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { useGetSecurityLogsQuery, useGetSecurityOtpsQuery, useGetSecuritySummaryQuery } from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, cn } from '../../components/ui/primitives';
import { RangeFilter } from '../../components/insights';
import { DEPARTMENTS, ROLES, ROLE_LABELS, SECTIONS, YEAR_LABELS, ACADEMIC_YEARS } from '../../utils/constants';
import { fmtDateTime, displayName } from '../../utils/format';

// Mirrors server/src/models/SecurityLog.js (the server validates the filter).
const EVENTS = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_CREATED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'FORCED_LOGOUT', 'REFRESH_FAILED',
  'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PASSWORD_RESET_FAILED',
  'USER_CREATED', 'USER_UPDATED', 'USER_ENABLED', 'USER_DISABLED', 'USER_DELETED', 'ROLE_CHANGED',
  'POLICIES_CHANGED', 'POLICY_DENIED', 'MAINTENANCE_BLOCKED',
  'ACADEMIC_SCOPE_CHANGED', 'CLASS_IN_CHARGE_CHANGED',
  'OTP_CREATED', 'OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'OTP_EXPIRED', 'OTP_RESEND', 'OTP_LOCKED', 'OTP_VIEWED', 'OTP_ALTERNATE_MOBILE',
  'GATE_PASS_APPROVED', 'GATE_PASS_REJECTED', 'GATE_PASS_CANCELLED', 'GATE_PASS_REVOKED', 'GATE_PASS_QR_VERIFIED',
  'GATE_PASS_VERIFICATION_FAILED', 'GATE_PASS_EXIT_CONFIRMED', 'GATE_PASS_RETURN_CONFIRMED',
];
const eventLabel = (e) => e.replace(/_/g, ' ').toLowerCase();

const SECURITY_RANGES = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];
const rangeQuery = ({ range, from, to }) => (range === 'custom' ? { range, ...(from ? { from } : {}), ...(to ? { to } : {}) } : range === 'all' ? {} : { range });
const customIncomplete = (r) => r.range === 'custom' && (!r.from || !r.to);

// OTP lifecycle → badge colour / label. The status always comes from the server.
const OTP_STATUS = {
  active: { color: 'success', label: 'Active' },
  used: { color: 'info', label: 'Used' },
  expired: { color: 'neutral', label: 'Expired' },
  superseded: { color: 'neutral', label: 'Replaced' },
  locked: { color: 'danger', label: 'Locked' },
  failed: { color: 'danger', label: 'Failed' },
};

function Who({ user, role, fallback }) {
  if (!user) return <span className="muted">{fallback || '—'}</span>;
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold">{displayName(user)}</p>
      <p className="truncate text-[11px] muted">
        {ROLE_LABELS[role || user.role] || role || user.role}
        {user.rollNo || user.employeeId ? ` · ${user.rollNo || user.employeeId}` : ''}
      </p>
    </div>
  );
}

function SecurityLogsTab() {
  const [q, setQ] = useState('');
  const [event, setEvent] = useState('');
  const [role, setRole] = useState('');
  const [success, setSuccess] = useState('');
  const [client, setClient] = useState('');
  const [range, setRange] = useState({ range: 'today' });
  const [page, setPage] = useState(1);
  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };

  const summary = useGetSecuritySummaryQuery(undefined, { pollingInterval: 60000 });
  const params = {
    q: q.trim() || undefined,
    event: event || undefined,
    role: role || undefined,
    success: success || undefined,
    client: client || undefined,
    ...rangeQuery(range),
    page,
  };
  const { data, isLoading, isFetching, error, refetch } = useGetSecurityLogsQuery(params, { skip: customIncomplete(range) });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={LogIn} label="Logins today" value={summary.data?.loginsToday} gradient="from-emerald-400 to-emerald-600" />
        <StatCard icon={XCircle} label="Failed logins" value={summary.data?.failedLoginsToday} hint="Today" gradient="from-rose-400 to-rose-600" delay={60} />
        <StatCard icon={KeyRound} label="Password resets" value={summary.data?.passwordResetsToday} hint="Today" gradient="from-amber-400 to-amber-600" delay={120} />
        <StatCard icon={MonitorSmartphone} label="Active sessions" value={summary.data?.activeSessions} gradient="from-sky-400 to-sky-600" delay={180} />
      </div>

      <Card className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={q} onChange={reset(setQ)} maxLength={64} placeholder="Name, email, roll no…" className="input pl-11" aria-label="Search user" />
          </div>
          <select value={event} onChange={reset(setEvent)} className="input" aria-label="Event">
            <option value="">All events</option>
            {EVENTS.map((e) => (
              <option key={e} value={e}>
                {eventLabel(e)}
              </option>
            ))}
          </select>
          <select value={role} onChange={reset(setRole)} className="input" aria-label="Role">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select value={success} onChange={reset(setSuccess)} className="input" aria-label="Result">
            <option value="">Success & failure</option>
            <option value="true">Success</option>
            <option value="false">Failure</option>
          </select>
          <select value={client} onChange={reset(setClient)} className="input" aria-label="Client">
            <option value="">Web & mobile</option>
            <option value="web">Web</option>
            <option value="mobile">Mobile</option>
            <option value="system">System</option>
          </select>
        </div>
        <RangeFilter
          ranges={SECURITY_RANGES}
          value={range}
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
        />
      </Card>

      {customIncomplete(range) ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="Choose a start and an end date" />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="No security events" text="Nothing matches these filters." />
        </Card>
      ) : (
        <Card className={cn('overflow-hidden p-0', isFetching && 'opacity-70')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-4 font-bold">Time</th>
                  <th className="px-3 py-4 font-bold">Event</th>
                  <th className="px-3 py-4 font-bold">Actor</th>
                  <th className="px-3 py-4 font-bold">Target</th>
                  <th className="px-3 py-4 font-bold">Client</th>
                  <th className="px-5 py-4 font-bold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/60 dark:divide-white/5">
                {data.items.map((l) => (
                  <tr key={l._id} className="table-row align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-xs muted">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        {l.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Success" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-500" aria-label="Failure" />}
                        <span className="font-mono text-[11px] font-bold">{l.event}</span>
                      </div>
                    </td>
                    <td className="max-w-[180px] px-3 py-3">
                      <Who user={l.actor} role={l.actorRole} fallback={l.identifier ? `Unknown · ${l.identifier}` : 'System'} />
                    </td>
                    <td className="max-w-[180px] px-3 py-3">
                      <Who user={l.targetUser} role={l.targetRole} fallback={l.targetRole ? ROLE_LABELS[l.targetRole] : '—'} />
                    </td>
                    <td className="max-w-[180px] px-3 py-3 text-xs">
                      <p className="truncate font-semibold capitalize">{l.client}</p>
                      <p className="truncate muted">{[l.device, l.ip].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="max-w-[260px] px-5 py-3 text-xs">
                      {l.reason && <p className="break-words font-semibold">{l.reason.replace(/_/g, ' ')}</p>}
                      {l.details && <p className="break-words font-mono text-[10px] muted">{JSON.stringify(l.details)}</p>}
                      {!l.reason && !l.details && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pb-5">
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10px] font-bold uppercase tracking-wide muted">{label}</dt>
      <dd className="truncate text-xs font-semibold">{children || '—'}</dd>
    </div>
  );
}

/** One generated OTP = one small card. */
function OtpCard({ o }) {
  const status = OTP_STATUS[o.status] || { color: 'neutral', label: o.status };
  const s = o.student || {};
  return (
    <Card className="h-full space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide muted">OTP · {o.passRef}</p>
        <Badge color={status.color}>{status.label}</Badge>
      </div>
      <p
        className={cn(
          'rounded-2xl bg-white/60 py-2.5 text-center font-mono text-2xl font-extrabold tracking-[0.3em] dark:bg-white/5',
          o.status !== 'active' && 'text-ink-muted line-through decoration-1'
        )}
        aria-label="OTP"
      >
        {o.otp || '——'}
      </p>
      <p className="text-[11px] muted">Expires: {fmtDateTime(o.expiresAt)}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Student" className="col-span-2">
          {s.name}
        </Field>
        <Field label="Roll no">{s.rollNo}</Field>
        <Field label="Department">{s.department}</Field>
        <Field label="Year">{YEAR_LABELS[s.year] || s.year}</Field>
        <Field label="Section">{s.section}</Field>
        <Field label="Parent mobile" className="col-span-2">
          {o.parentMobile}
        </Field>
      </dl>
      <div className="border-t border-white/60 pt-2 text-[11px] muted dark:border-white/10">
        <p>Generated: {fmtDateTime(o.createdAt)}</p>
        <p>
          Attempts {o.attempts}/{o.maxAttempts}
          {o.requestedBy ? ` · by ${o.requestedBy}` : ''} · {o.smsSent ? 'SMS sent' : 'SMS not sent'}
        </p>
      </div>
    </Card>
  );
}

function OtpTab() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState('');
  const [section, setSection] = useState('');
  const [range, setRange] = useState({ range: 'all' });
  const [page, setPage] = useState(1);
  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };
  const params = {
    q: q.trim() || undefined,
    status: status || undefined,
    department: department || undefined,
    year: year || undefined,
    section: section || undefined,
    ...rangeQuery(range),
    page,
  };
  // No background polling: every load of this list is itself recorded as OTP_VIEWED.
  const { data, isLoading, isFetching, error, refetch } = useGetSecurityOtpsQuery(params, { skip: customIncomplete(range) });

  return (
    <div className="space-y-5">
      {data && !data.smsEnabled && (
        <div role="status" className="flex items-start gap-3 rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <span className="font-bold">SMS sending is disabled.</span> OTPs are generated and verified normally but are not sent to parents — they are visible only here.
          </p>
        </div>
      )}
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input value={q} onChange={reset(setQ)} maxLength={64} placeholder="Student name or roll no…" className="input pl-11" aria-label="Search student" />
          </div>
          <select value={status} onChange={reset(setStatus)} className="input" aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(OTP_STATUS).map(([value, s]) => (
              <option key={value} value={value}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={department} onChange={reset(setDepartment)} className="input" aria-label="Department">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select value={year} onChange={reset(setYear)} className="input" aria-label="Year">
            <option value="">All years</option>
            {ACADEMIC_YEARS.map((y) => (
              <option key={y} value={y}>
                {YEAR_LABELS[y]}
              </option>
            ))}
          </select>
          <select value={section} onChange={reset(setSection)} className="input" aria-label="Section">
            <option value="">All sections</option>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                Section {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RangeFilter
            ranges={SECURITY_RANGES}
            value={range}
            onChange={(r) => {
              setRange(r);
              setPage(1);
            }}
          />
          <Button size="sm" variant="outline" icon={RefreshCw} loading={isFetching} onClick={refetch}>
            Refresh
          </Button>
        </div>
      </Card>

      {customIncomplete(range) ? (
        <Card>
          <EmptyState icon={KeyRound} title="Choose a start and an end date" />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <Card>
          <EmptyState icon={KeyRound} title="No OTPs" text="Each parent OTP appears here as its own card as soon as it is generated." />
        </Card>
      ) : (
        <>
          <p className="text-xs muted">
            {data.total} OTP{data.total === 1 ? '' : 's'} · newest first
          </p>
          <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', isFetching && 'opacity-70')}>
            {data.items.map((o) => (
              <li key={o.id}>
                <OtpCard o={o} />
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pages={data.pages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

/**
 * The parent-OTP dashboard. Shown only in the Super Admin console (the API
 * is Super Admin only); Admin → Security & Logs no longer has it.
 */
export { OtpTab };

/** Admin → Security & Logs. Admin-only on the server too. */
export default function SecurityLogs() {
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Security & Logs" subtitle="Authentication, account and gate-pass security events. Read-only." />
      <SecurityLogsTab />
    </div>
  );
}
