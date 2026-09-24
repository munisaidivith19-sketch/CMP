import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DoorClosed,
  DoorOpen,
  LogIn,
  LogOut,
  Plus,
  QrCode,
  ScanLine,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  useCancelGatePassMutation,
  useCreateGatePassMutation,
  useGetGateDashboardQuery,
  useGetGatePassesQuery,
  useGetGatePassQrQuery,
  useRecordGateExitMutation,
  useRecordGateReturnMutation,
  useReviewGatePassMutation,
  useRevokeGatePassMutation,
  useVerifyGatePassMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtDateTime, timeAgo, titleCase, toLocalInput } from '../../utils/format';
import { STAFF_VIEW } from '../../utils/constants';

export const GATE_REASONS = ['medical', 'family_emergency', 'personal', 'official', 'outing', 'other'];
const OPEN = ['pending', 'approved', 'active'];

/* ── Shared pieces ──────────────────────────────────────────────── */
export function PassTimeline({ pass }) {
  const steps = [
    { label: 'Requested', at: pass.createdAt, done: true },
    { label: pass.status === 'rejected' ? 'Rejected' : 'Approved', at: pass.reviewedAt || pass.approvedAt, done: Boolean(pass.reviewedAt || pass.approvedAt), bad: pass.status === 'rejected' },
    { label: 'Left campus', at: pass.actualExit, done: Boolean(pass.actualExit) },
    { label: 'Returned', at: pass.actualReturn, done: Boolean(pass.actualReturn) },
  ];
  if (['cancelled', 'revoked', 'expired'].includes(pass.status)) {
    steps.push({ label: titleCase(pass.status), at: pass.cancelledAt || pass.revokedAt || pass.verificationExpiry, done: true, bad: true });
  }
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              s.done ? (s.bad ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white') : 'bg-primary-500/10 text-ink-muted'
            )}
          >
            {s.done ? s.bad ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className={cn('text-sm font-semibold', !s.done && 'muted')}>{s.label}</p>
            {s.at && s.done && <p className="text-xs muted">{fmtDateTime(s.at)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PassQr({ pass }) {
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id, { skip: !['approved', 'active'].includes(pass.status) });
  if (!['approved', 'active'].includes(pass.status)) return null;
  if (isLoading) return <Skeleton className="mx-auto h-56 w-56" />;
  if (error) return <p className="text-center text-sm text-rose-600">{errMsg(error)}</p>;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-3xl bg-white p-3 shadow-soft">
        <img src={data.qr} alt="Gate pass QR code" className="h-52 w-52" />
      </div>
      <p className="mt-3 font-mono text-lg font-extrabold tracking-[0.25em]">{data.code.replace(/(.{4})/g, '$1 ').trim()}</p>
      <p className="mt-1 text-xs muted">Show this at the gate · valid until {fmtDateTime(data.expiresAt)}</p>
    </div>
  );
}

/* ── Student ────────────────────────────────────────────────────── */
function RequestModal({ open, onClose }) {
  const [create, { isLoading }] = useCreateGatePassMutation();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm();

  // Default times are relative to when the dialog is opened.
  useEffect(() => {
    if (!open) return;
    const start = new Date(Date.now() + 15 * 60000);
    reset({ reason: 'personal', description: '', destination: '', expectedExit: toLocalInput(start), expectedReturn: toLocalInput(new Date(start.getTime() + 3 * 3600000)) });
  }, [open, reset]);

  const onSubmit = async (v) => {
    try {
      await create({ ...v, expectedExit: new Date(v.expectedExit).toISOString(), expectedReturn: new Date(v.expectedReturn).toISOString() }).unwrap();
      toast.success('Gate pass requested — you’ll be notified when it’s reviewed');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a gate pass"
      subtitle="Faculty or an administrator reviews every request."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
            Submit request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Select label="Reason" options={GATE_REASONS.map((r) => ({ value: r, label: titleCase(r) }))} error={errors.reason} {...register('reason', { required: true })} />
        <Input label="Destination" placeholder="e.g. City hospital" maxLength={160} {...register('destination')} />
        <Textarea
          label="Details"
          className="sm:col-span-2"
          rows={3}
          maxLength={500}
          error={errors.description}
          placeholder="Why do you need to leave campus?"
          {...register('description', { required: 'Please add details', minLength: { value: 5, message: 'At least 5 characters' } })}
        />
        <Input
          label="Leaving at"
          type="datetime-local"
          error={errors.expectedExit}
          {...register('expectedExit', { required: 'Required', validate: (v) => new Date(v) > new Date(Date.now() - 15 * 60000) || 'Cannot be in the past' })}
        />
        <Input
          label="Returning by"
          type="datetime-local"
          error={errors.expectedReturn}
          {...register('expectedReturn', {
            required: 'Required',
            validate: {
              after: (v) => new Date(v) > new Date(watch('expectedExit')) || 'Must be after the exit time',
              max: (v) => new Date(v) - new Date(watch('expectedExit')) <= 7 * 86400000 || 'At most 7 days',
            },
          })}
        />
      </form>
    </Modal>
  );
}

function StudentGatePass() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const { data, isLoading, error, refetch } = useGetGatePassesQuery({ page, limit: 10 });
  const [cancel, { isLoading: cancelling }] = useCancelGatePassMutation();
  const current = data?.passes.find((p) => OPEN.includes(p.status));

  return (
    <div className="space-y-5">
      <PageHeader
        icon={DoorOpen}
        title="Gate pass"
        subtitle="Request permission to leave campus and show your pass at the gate."
        actions={!current && <Button icon={Plus} onClick={() => setOpen(true)}>Request gate pass</Button>}
      />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {current ? (
            <Card className="grid gap-6 md:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-extrabold">{titleCase(current.reason)}</h2>
                  <StatusBadge status={current.status} />
                  {current.overdue && <StatusBadge status="rejected" label="overdue" />}
                </div>
                <p className="mt-1 text-sm">{current.description}</p>
                <p className="mt-1 text-xs muted">
                  {current.destination ? `${current.destination} · ` : ''}
                  {fmtDateTime(current.expectedExit)} → {fmtDateTime(current.expectedReturn)}
                </p>
                <div className="mt-5">
                  <PassTimeline pass={current} />
                </div>
                {['pending', 'approved'].includes(current.status) && (
                  <Button variant="danger" size="sm" className="mt-5" onClick={() => setConfirmCancel(current)}>
                    Cancel this pass
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-center md:min-w-[280px]">
                {current.status === 'pending' ? (
                  <EmptyState icon={Clock} title="Waiting for approval" text="You’ll get a notification the moment it’s reviewed." />
                ) : (
                  <PassQr pass={current} />
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={DoorOpen}
                title="No active gate pass"
                text="Need to leave campus? Request a pass and show its QR code at the gate once it’s approved."
                action={<Button icon={Plus} onClick={() => setOpen(true)}>Request gate pass</Button>}
              />
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            {!data.passes.length ? (
              <p className="text-sm muted">No gate passes yet.</p>
            ) : (
              <>
                <ul className="divide-y divide-white/60 dark:divide-white/5">
                  {data.passes.map((p) => (
                    <li key={p._id}>
                      <Link to={`/gate-pass/${p._id}`} className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-white/60 dark:hover:bg-white/5">
                        <DoorClosed className="h-5 w-5 shrink-0 text-primary-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {titleCase(p.reason)} · {p.description}
                          </p>
                          <p className="text-xs muted">
                            {fmtDateTime(p.expectedExit)} → {fmtDateTime(p.expectedReturn)}
                          </p>
                        </div>
                        <StatusBadge status={p.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
                <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
              </>
            )}
          </Card>
        </>
      )}
      <RequestModal open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog
        open={Boolean(confirmCancel)}
        onClose={() => setConfirmCancel(null)}
        title="Cancel this gate pass?"
        text="The QR code stops working immediately."
        confirmText="Cancel pass"
        loading={cancelling}
        onConfirm={async () => {
          try {
            await cancel(confirmCancel._id).unwrap();
            toast.success('Gate pass cancelled');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setConfirmCancel(null);
        }}
      />
    </div>
  );
}

/* ── Staff ──────────────────────────────────────────────────────── */
function StudentLine({ student, extra }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar user={student} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{student?.name}</p>
        <p className="truncate text-xs muted">
          {student?.rollNo || '—'} · {student?.department}
          {student?.section ? ` · Sec ${student.section}` : ''}
          {extra}
        </p>
      </div>
    </div>
  );
}

function ReviewQueue() {
  const [page, setPage] = useState(1);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  const { data, isLoading, error, refetch } = useGetGatePassesQuery({ status: 'pending', page });
  const [review, { isLoading: saving }] = useReviewGatePassMutation();

  const act = async (id, action, rejectedReason) => {
    try {
      await review({ id, action, rejectedReason }).unwrap();
      toast.success(action === 'approved' ? 'Approved — the student can now use their QR code' : 'Request rejected');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (isLoading) return <Skeleton className="h-48" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data.passes.length) return <Card><EmptyState icon={CheckCircle2} title="No pending requests" text="New requests appear here instantly." /></Card>;

  return (
    <div className="space-y-3">
      {data.passes.map((p) => (
        <Card key={p._id} className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <StudentLine student={p.student} extra={` · requested ${timeAgo(p.createdAt)}`} />
            <p className="mt-2 text-sm">
              <span className="font-bold">{titleCase(p.reason)}:</span> {p.description}
            </p>
            <p className="mt-0.5 text-xs muted">
              {p.destination ? `${p.destination} · ` : ''}
              {fmtDateTime(p.expectedExit)} → {fmtDateTime(p.expectedReturn)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="success" loading={saving} onClick={() => act(p._id, 'approved')}>
              Approve
            </Button>
            <Button size="sm" variant="danger" onClick={() => { setReject(p); setReason(''); }}>
              Reject
            </Button>
          </div>
        </Card>
      ))}
      <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
      <Modal
        open={Boolean(reject)}
        onClose={() => setReject(null)}
        title="Reject gate pass"
        subtitle={reject?.student?.name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReject(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={async () => { await act(reject._id, 'rejected', reason.trim() || undefined); setReject(null); }}>
              Reject
            </Button>
          </>
        }
      >
        <Textarea label="Reason (shared with the student)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

function GateConsole() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [verify, { isLoading }] = useVerifyGatePassMutation();
  const [exit, { isLoading: exiting }] = useRecordGateExitMutation();
  const [ret, { isLoading: returning }] = useRecordGateReturnMutation();

  const check = async (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    try {
      setResult(await verify(code.trim()).unwrap());
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const act = async (fn, msg) => {
    try {
      const pass = await fn(result.pass._id).unwrap();
      toast.success(msg);
      setResult({ ...result, pass: { ...result.pass, ...pass }, nextAction: pass.status === 'active' ? 'return' : null, done: true });
      setCode('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Verify a pass" subtitle="Type the code shown under the student’s QR, or scan it with a USB/Bluetooth scanner." action={<ScanLine className="h-5 w-5 text-primary-400" />} />
        <form onSubmit={check} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX XXXX XXXX"
            aria-label="Verification code"
            autoFocus
            autoComplete="off"
            className="input flex-1 font-mono text-lg tracking-[0.2em]"
            maxLength={40}
          />
          <Button type="submit" loading={isLoading} icon={ShieldCheck}>
            Verify
          </Button>
        </form>
      </Card>
      <Card aria-live="polite">
        {!result ? (
          <EmptyState icon={QrCode} title="Waiting for a code" text="Verification results appear here." />
        ) : (
          <div className="space-y-4">
            <div className={cn('flex items-center gap-3 rounded-2xl p-3', result.valid ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700')}>
              {result.valid ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
              <p className="font-bold">{result.done ? 'Recorded' : result.valid ? 'Valid pass' : 'Not valid'}</p>
            </div>
            {result.problems?.map((p) => (
              <p key={p} className="flex items-center gap-2 text-sm text-rose-600">
                <AlertTriangle className="h-4 w-4" /> {p}
              </p>
            ))}
            {result.pass && (
              <>
                <StudentLine student={result.pass.student} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                    <p className="muted">Reason</p>
                    <p className="font-bold">{titleCase(result.pass.reason)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                    <p className="muted">Status</p>
                    <StatusBadge status={result.pass.status} />
                  </div>
                  <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                    <p className="muted">Expected exit</p>
                    <p className="font-bold">{fmtDateTime(result.pass.expectedExit)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                    <p className="muted">Expected return</p>
                    <p className="font-bold">{fmtDateTime(result.pass.expectedReturn)}</p>
                  </div>
                </div>
                {result.nextAction === 'exit' && (
                  <Button className="w-full" icon={LogOut} loading={exiting} onClick={() => act(exit, 'Exit recorded')}>
                    Record exit
                  </Button>
                )}
                {result.nextAction === 'return' && (
                  <Button className="w-full" variant="success" icon={LogIn} loading={returning} onClick={() => act(ret, 'Return recorded — pass closed')}>
                    Record return
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function OutsideNow({ dash }) {
  const [ret, { isLoading }] = useRecordGateReturnMutation();
  if (!dash.outsideStudents.length) return <Card><EmptyState icon={Users} title="Everyone is on campus" /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-white/60 dark:divide-white/5">
        {dash.outsideStudents.map((p) => (
          <li key={p._id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <StudentLine student={p.student} extra={` · left ${timeAgo(p.actualExit)}`} />
            </div>
            <span className="text-xs muted">due {fmtDateTime(p.expectedReturn)}</span>
            {p.overdue && <StatusBadge status="rejected" label="overdue" />}
            <Button size="sm" variant="success" loading={isLoading} onClick={async () => { try { await ret(p._id).unwrap(); toast.success('Return recorded'); } catch (e) { toast.error(errMsg(e)); } }}>
              Mark returned
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AllPasses() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revoke, setRevoke] = useState(null);
  const { data, isLoading, error, refetch } = useGetGatePassesQuery({ status: status || undefined, page });
  const [doRevoke, { isLoading: revoking }] = useRevokeGatePassMutation();
  return (
    <Card>
      <CardHeader
        title="All passes"
        action={
          <select aria-label="Status" className="input w-auto rounded-xl py-1.5 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            {['pending', 'approved', 'active', 'overdue', 'completed', 'rejected', 'revoked', 'cancelled', 'expired'].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.passes.length ? (
        <EmptyState icon={DoorOpen} title="No passes found" />
      ) : (
        <>
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {data.passes.map((p) => (
              <li key={p._id} className="flex flex-wrap items-center gap-3 py-3">
                <Link to={`/gate-pass/${p._id}`} className="min-w-0 flex-1">
                  <StudentLine student={p.student} extra={` · ${titleCase(p.reason)}`} />
                </Link>
                <span className="text-xs muted">{fmtDateTime(p.expectedExit)}</span>
                <StatusBadge status={p.status} />
                {['pending', 'approved'].includes(p.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setRevoke(p)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />
        </>
      )}
      <ConfirmDialog
        open={Boolean(revoke)}
        onClose={() => setRevoke(null)}
        title="Revoke this gate pass?"
        text="Its QR code stops working and the student is notified."
        confirmText="Revoke"
        loading={revoking}
        onConfirm={async () => {
          try {
            await doRevoke({ id: revoke._id }).unwrap();
            toast.success('Gate pass revoked');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setRevoke(null);
        }}
      />
    </Card>
  );
}

function StaffGatePass() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'review';
  const { data: dash, isLoading, error, refetch } = useGetGateDashboardQuery();
  return (
    <div className="space-y-5">
      <PageHeader icon={DoorOpen} title="Gate passes" subtitle="Review requests, verify passes at the gate and see who is outside." />
      {isLoading ? (
        <Skeleton className="h-28" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Clock} label="Pending" value={dash.pending} hint="Awaiting review" gradient="from-amber-400 to-orange-500" />
          <StatCard icon={Users} label="Outside now" value={dash.studentsOutside} hint={dash.overdue ? `${dash.overdue} overdue` : 'None overdue'} gradient="from-sky-400 to-blue-500" delay={60} />
          <StatCard icon={LogOut} label="Exits today" value={dash.todayExits} gradient="from-violet-400 to-indigo-500" delay={120} />
          <StatCard icon={LogIn} label="Returns today" value={dash.todayReturns} gradient="from-emerald-400 to-teal-500" delay={180} />
        </div>
      )}
      <Tabs
        tabs={[
          { value: 'review', label: 'Review', count: dash?.pending || undefined },
          { value: 'gate', label: 'Gate console' },
          { value: 'outside', label: 'Outside now', count: dash?.studentsOutside || undefined },
          { value: 'all', label: 'All passes' },
        ]}
        value={tab}
        onChange={(t) => setParams(t === 'review' ? {} : { tab: t }, { replace: true })}
      />
      {tab === 'review' && <ReviewQueue />}
      {tab === 'gate' && <GateConsole />}
      {tab === 'outside' && dash && <OutsideNow dash={dash} />}
      {tab === 'all' && <AllPasses />}
    </div>
  );
}

export default function GatePass() {
  const me = useSelector(selectUser);
  return STAFF_VIEW.includes(me.role) ? <StaffGatePass /> : <StudentGatePass />;
}
