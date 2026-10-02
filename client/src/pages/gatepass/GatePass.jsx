import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  DoorClosed,
  DoorOpen,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  ScanLine,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  useCancelGatePassMutation,
  useCreateGatePassMutation,
  useEmergencyReviewGatePassMutation,
  useFacultyReviewGatePassMutation,
  useGetGateDashboardQuery,
  useGetGatePassesQuery,
  useGetGatePassQrQuery,
  useGetSecurityDashboardQuery,
  useHodReviewGatePassMutation,
  usePrincipalReviewGatePassMutation,
  useRecordGateOutMutation,
  useRevokeGatePassMutation,
  useVerifyGatePassMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, timeAgo, titleCase, todayKey } from '../../utils/format';
import { GATE_PASS_REGARDING, INDIAN_STATES, STUDENT_ROLES } from '../../utils/constants';
import { ParentVerification } from './ParentVerification';
import QrScannerModal from '../../components/QrScannerModal';
import { scanProblem } from '../../utils/gateQr';
import { ReturnStatus } from './ReturnStatus';
import { AUTHORITY_LABELS, EmergencyApprovedCode, EmergencyBadge, EmergencyDetails, EmergencyRequestForm, isEmergency } from './EmergencyGatePass';

const OPEN = ['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority', 'approved', 'active'];
const PENDING = ['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority'];
export const passStatusLabel = (status, pass) => {
  if (status === 'pending_authority') return `Pending — ${AUTHORITY_LABELS[pass?.emergencyAuthority] || 'authority'} approval`;
  return status === 'parent_verified' ? 'Parent verified' : status.replace('pending_', 'Waiting on ');
};
const passTitle = (p) => (isEmergency(p) ? 'Emergency gate pass' : GATE_PASS_REGARDING[p.regarding] || titleCase(p.regarding || ''));
const destinationLine = (d) => (d ? [d.area, d.district, d.state].filter(Boolean).join(', ') : '');

/* ── Shared pieces ──────────────────────────────────────────────── */
export function PassTimeline({ pass }) {
  const stageStep = (label, review, atFallback) => ({
    label,
    at: review?.at || atFallback,
    done: Boolean(review),
    bad: review?.action === 'rejected',
    note: review?.action === 'rejected' ? review.reason : null,
  });
  const approvalSteps = isEmergency(pass)
    ? [stageStep(`${AUTHORITY_LABELS[pass.emergencyAuthority]} approval`, pass.emergencyReview)]
    : [
        // Passes forwarded before parent OTP verification existed have no such step.
        ...(pass.parentVerifiedAt || ['pending_faculty', 'parent_verified'].includes(pass.status)
          ? [{ label: 'Parent verified (OTP)', at: pass.parentVerifiedAt, done: Boolean(pass.parentVerifiedAt) }]
          : []),
        stageStep('Faculty review', pass.facultyReview),
        stageStep('HOD review', pass.hodReview),
        stageStep('Principal approval', pass.principalReview),
      ];
  const steps = [
    { label: 'Requested', at: pass.createdAt, done: true },
    ...approvalSteps,
    { label: 'Left campus', at: pass.actualExit, done: Boolean(pass.actualExit) },
    ...(pass.actualExit ? [{ label: 'Return location verified', at: pass.returnLocationVerifiedAt, done: Boolean(pass.returnLocationVerifiedAt) }] : []),
    { label: 'Returned', at: pass.actualReturn, done: Boolean(pass.actualReturn) },
  ];
  if (['cancelled', 'revoked', 'expired'].includes(pass.status)) {
    steps.push({ label: titleCase(pass.status), at: pass.cancelledAt || pass.revokedAt || pass.verificationExpiry, done: true, bad: true });
  }
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.label} className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              s.done ? (s.bad ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white') : 'bg-primary-500/10 text-ink-muted'
            )}
          >
            {s.done ? s.bad ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className={cn('text-sm font-semibold', !s.done && 'muted')}>{s.label}</p>
            {s.at && s.done && <p className="text-xs muted">{timeAgo(s.at)}</p>}
            {s.note && <p className="text-xs text-rose-500">“{s.note}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Exit code before leaving; once outside, the return-to-campus status instead. */
export function PassQr({ pass }) {
  if (pass.status === 'active') return <ReturnStatus pass={pass} />;
  if (pass.status !== 'approved') return null;
  return isEmergency(pass) ? <EmergencyApprovedCode pass={pass} /> : <ExitQr pass={pass} />;
}

function ExitQr({ pass }) {
  const { data, isLoading, error } = useGetGatePassQrQuery(pass._id);
  if (isLoading) return <Skeleton className="mx-auto h-56 w-56" />;
  if (error) return <p className="text-center text-sm text-rose-600">{errMsg(error)}</p>;
  return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-3xl bg-white p-3 shadow-soft">
        <img src={data.qr} alt="Gate pass code" className="h-52 w-52" />
      </div>
      <p className="mt-3 font-mono text-4xl font-extrabold tracking-[0.3em]">{data.code}</p>
      <p className="mt-1 text-xs muted">Tell this code to security at the gate · valid until {fmtClassDay(data.expiresAt, 'dd MMM, h:mm a')}</p>
    </div>
  );
}

/* ── Student ────────────────────────────────────────────────────── */
function RequestModal({ open, onClose }) {
  const [type, setType] = useState('normal');
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [create, { isLoading }] = useCreateGatePassMutation();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm();

  useEffect(() => {
    if (!open) return;
    setType('normal');
    reset({ regarding: 'outing', description: '', fromDate: todayKey(), toDate: todayKey(), parentPhone: '', state: '', district: '', area: '' });
  }, [open, reset]);

  const onSubmit = async (v) => {
    try {
      await create({
        regarding: v.regarding,
        description: v.description,
        fromDate: v.fromDate,
        toDate: v.toDate,
        parentPhone: v.parentPhone,
        destination: { state: v.state, district: v.district, area: v.area },
      }).unwrap();
      toast.success('Gate pass requested — your class faculty has been notified');
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
      subtitle={
        type === 'emergency'
          ? 'Goes straight to the authority you choose — no faculty, HOD or parent OTP step.'
          : 'Goes to your class faculty, then HOD, then the principal for approval.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {type === 'emergency' ? (
            <Button type="submit" form="emergency-gate-pass" variant="danger" loading={emergencyBusy}>
              Send emergency request
            </Button>
          ) : (
            <Button loading={isLoading} onClick={handleSubmit(onSubmit)}>
              Submit request
            </Button>
          )}
        </>
      }
    >
      <div role="radiogroup" aria-label="Gate pass type" className="mb-4 grid grid-cols-2 gap-2">
        {[
          ['normal', 'Normal gate pass'],
          ['emergency', 'Emergency gate pass'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={type === value}
            onClick={() => setType(value)}
            className={cn('chip min-h-[44px] justify-center text-center', type === value && (value === 'emergency' ? 'bg-rose-500 text-white' : 'chip-active'))}
          >
            {label}
          </button>
        ))}
      </div>
      {type === 'emergency' ? (
        <EmergencyRequestForm formId="emergency-gate-pass" onSubmitted={onClose} onBusy={setEmergencyBusy} />
      ) : (
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
        <Select
          label="Regarding"
          options={Object.entries(GATE_PASS_REGARDING).map(([value, label]) => ({ value, label }))}
          error={errors.regarding}
          {...register('regarding', { required: true })}
        />
        <Input label="Parent's mobile number" type="tel" maxLength={20} error={errors.parentPhone} {...register('parentPhone', { required: 'Required', minLength: { value: 6, message: 'Enter a valid number' } })} />
        <Textarea
          label="Description"
          className="sm:col-span-2"
          rows={3}
          maxLength={500}
          error={errors.description}
          placeholder="Why do you need to leave campus?"
          {...register('description', { required: 'Please add details', minLength: { value: 5, message: 'At least 5 characters' } })}
        />
        <Input
          label="From date"
          type="date"
          min={todayKey()}
          error={errors.fromDate}
          {...register('fromDate', { required: 'Required' })}
        />
        <Input
          label="To date (return by)"
          type="date"
          min={watch('fromDate') || todayKey()}
          error={errors.toDate}
          {...register('toDate', {
            required: 'Required',
            validate: (v) => v >= watch('fromDate') || 'Cannot be before the departure date',
          })}
        />
        <Select label="State" placeholder="Select state" options={INDIAN_STATES} error={errors.state} {...register('state', { required: 'Required' })} />
        <Input label="District" maxLength={80} error={errors.district} {...register('district', { required: 'Required' })} />
        <Input label="Village / area" className="sm:col-span-2" maxLength={120} error={errors.area} {...register('area', { required: 'Required' })} />
      </form>
      )}
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
        subtitle="Request permission to leave campus — a normal pass (Faculty → HOD → Principal) or, in an emergency, straight to one authority."
        actions={!current && <Button icon={Plus} onClick={() => setOpen(true)}>Request gate pass</Button>}
      />
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {current ? (
            <Card className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-extrabold">{passTitle(current)}</h2>
                  {isEmergency(current) && <EmergencyBadge />}
                  <StatusBadge status={current.status} label={passStatusLabel(current.status, current)} />
                  {current.overdue && <StatusBadge status="rejected" label="overdue" />}
                </div>
                <p className="mt-1 text-sm">{current.description}</p>
                <p className="mt-1 flex items-center gap-1 text-xs muted">
                  <MapPin className="h-3.5 w-3.5" /> {destinationLine(current.destination)}
                </p>
                {isEmergency(current) ? (
                  <div className="mt-3">
                    <EmergencyDetails pass={current} compact />
                  </div>
                ) : (
                  <p className="mt-1 text-xs muted">
                    {fmtClassDay(current.fromDate)} → {fmtClassDay(current.toDate)} · Parent: {current.parentPhone}
                  </p>
                )}
                <div className="mt-5">
                  <PassTimeline pass={current} />
                </div>
                {[...PENDING, 'approved'].includes(current.status) && (
                  <Button variant="danger" size="sm" className="mt-5" onClick={() => setConfirmCancel(current)}>
                    Cancel this pass
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-center md:min-w-[280px]">
                {PENDING.includes(current.status) ? (
                  <EmptyState icon={Clock} title="Waiting for approval" text="You’ll get a notification the moment it moves to the next stage." />
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
                text="Need to leave campus? Request a pass and tell your code to security once it’s approved."
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
                            {passTitle(p)} · {p.description}
                          </p>
                          <p className="text-xs muted">
                            {fmtClassDay(p.fromDate)} → {fmtClassDay(p.toDate)}
                          </p>
                        </div>
                        <StatusBadge status={p.status} label={passStatusLabel(p.status, p)} />
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
        text="The request is withdrawn immediately."
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

/* ── Staff: shared bits ─────────────────────────────────────────── */
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

/** One stage's forward/approve + reject actions, chosen by the pass's current status. */
const STAGE_BY_STATUS = {
  pending_faculty: { hook: 'faculty', needsParentOtp: true },
  parent_verified: { hook: 'faculty', forwardLabel: 'Forward to HOD', forwardAction: 'forward', okVariant: 'primary' },
  pending_hod: { hook: 'hod', forwardLabel: 'Forward to Principal', forwardAction: 'forward', okVariant: 'primary' },
  pending_principal: { hook: 'principal', forwardLabel: 'Approve', forwardAction: 'approve', okVariant: 'success' },
  pending_authority: { hook: 'authority', forwardLabel: 'Approve', forwardAction: 'approve', okVariant: 'success' },
};

export function ReviewCard({ pass, onDone }) {
  const me = useSelector(selectUser);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [facultyReview, { isLoading: fLoading }] = useFacultyReviewGatePassMutation();
  const [hodReview, { isLoading: hLoading }] = useHodReviewGatePassMutation();
  const [principalReview, { isLoading: pLoading }] = usePrincipalReviewGatePassMutation();
  const [authorityReview, { isLoading: aLoading }] = useEmergencyReviewGatePassMutation();
  const mutations = { faculty: facultyReview, hod: hodReview, principal: principalReview, authority: authorityReview };
  const stage = STAGE_BY_STATUS[pass.status];
  const saving = fLoading || hLoading || pLoading || aLoading;
  if (!stage) return null;
  // Only the authority the student chose may decide an emergency pass (the API enforces it too).
  const canDecide = stage.hook !== 'authority' || me.role === pass.emergencyAuthority;

  const act = async (action, rejectReason) => {
    try {
      await mutations[stage.hook]({ id: pass._id, action, reason: rejectReason }).unwrap();
      toast.success(action === 'reject' ? 'Request rejected' : stage.forwardAction === 'approve' ? 'Approved — the student has their code' : 'Forwarded');
      setReject(false);
      onDone?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <StudentLine student={pass.student} extra={` · requested ${timeAgo(pass.createdAt)}`} />
          {isEmergency(pass) ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <EmergencyBadge />
                <StatusBadge status={pass.status} label={passStatusLabel(pass.status, pass)} />
              </div>
              <EmergencyDetails pass={pass} />
            </div>
          ) : (
            <>
              <p className="mt-2 break-words text-sm">
                <span className="font-bold">{GATE_PASS_REGARDING[pass.regarding] || titleCase(pass.regarding)}:</span> {pass.description}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-xs muted">
                <MapPin className="h-3.5 w-3.5 shrink-0" /> {destinationLine(pass.destination)}
              </p>
              <p className="mt-0.5 text-xs muted">
                {fmtClassDay(pass.fromDate)} → {fmtClassDay(pass.toDate)} · Parent: {pass.parentPhone}
              </p>
            </>
          )}
          {pass.status === 'parent_verified' && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-emerald-600">
              <ShieldCheck className="h-3.5 w-3.5" /> Parent verified by OTP{pass.parentVerifiedBy?.name ? ` · ${pass.parentVerifiedBy.name}` : ''}
            </p>
          )}
        </div>
        {canDecide && (
        <div className="flex flex-wrap gap-2">
          {!stage.needsParentOtp && (
            <Button size="sm" variant={stage.okVariant} icon={stage.forwardAction === 'forward' ? ArrowRight : CheckCircle2} loading={saving} onClick={() => act(stage.forwardAction)}>
              {stage.forwardLabel}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => { setReject(true); setReason(''); }}>
            Reject
          </Button>
        </div>
        )}
      </div>
      {stage.needsParentOtp && <ParentVerification pass={pass} onVerified={onDone} />}
      <Modal
        open={reject}
        onClose={() => setReject(false)}
        title="Reject gate pass"
        subtitle={pass.student?.name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReject(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={() => act('reject', reason.trim() || undefined)}>
              Reject
            </Button>
          </>
        }
      >
        <Textarea label="Reason (shared with the student)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Card>
  );
}

const STAGE_STATUS = {
  faculty: ['pending_faculty', 'parent_verified'],
  hod: ['pending_hod'],
  principal: ['pending_principal', 'pending_authority'],
  ao: ['pending_authority'],
  dean: ['pending_authority'],
  chairman: ['pending_authority'],
};
const AUTHORITY_ONLY = ['ao', 'dean', 'chairman'];

/** Whether this role has an approve/reject stage open on the pass (the API still enforces it). */
export const canReviewPass = (role, pass) => role === 'admin' ? PENDING.includes(pass.status) : Boolean(STAGE_STATUS[role]?.includes(pass.status));

/** Faculty / HOD / principal each see only their own stage; admin sees every open stage. */
function ReviewQueue({ role }) {
  const [page, setPage] = useState(1);
  const isAdmin = role === 'admin';
  const { data, isLoading, error, refetch } = useGetGatePassesQuery(isAdmin ? { status: PENDING.join(','), page } : { page });
  const mine = isAdmin ? data?.passes : data?.passes.filter((p) => STAGE_STATUS[role]?.includes(p.status));

  if (isLoading) return <Skeleton className="h-48" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!mine?.length) return <Card><EmptyState icon={CheckCircle2} title="No pending requests" text="New requests appear here instantly." /></Card>;

  return (
    <div className="space-y-3">
      {mine.map((p) => (
        <ReviewCard key={p._id} pass={p} onDone={refetch} />
      ))}
      {data.pagination.pages > 1 && <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />}
    </div>
  );
}

function OutsideNow({ dash }) {
  if (!dash.outsideStudents.length) return <Card><EmptyState icon={Users} title="Everyone is on campus" /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-white/60 dark:divide-white/5">
        {dash.outsideStudents.map((p) => (
          <li key={p._id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <StudentLine student={p.student} extra={` · left ${timeAgo(p.actualExit)}`} />
            </div>
            <span className="text-xs muted">due back {fmtClassDay(p.toDate)}</span>
            {p.overdue && <StatusBadge status="rejected" label="overdue" />}
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
            {['pending_faculty', 'parent_verified', 'pending_hod', 'pending_principal', 'pending_authority', 'approved', 'active', 'overdue', 'completed', 'rejected', 'revoked', 'cancelled', 'expired'].map((s) => (
              <option key={s} value={s}>
                {s === 'parent_verified' ? 'Parent verified' : s === 'pending_authority' ? 'Pending: emergency authority' : titleCase(s.replace('pending_', 'pending: '))}
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
                  <StudentLine student={p.student} extra={` · ${GATE_PASS_REGARDING[p.regarding] || titleCase(p.regarding)}`} />
                </Link>
                <span className="text-xs muted">{fmtClassDay(p.fromDate)}</span>
                <StatusBadge status={p.status} />
                {['approved', ...PENDING].includes(p.status) && (
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
        text="The student is notified and, if approved, their code stops working."
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
  const me = useSelector(selectUser);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'review';
  // AO / Dean / Chairman only decide emergency requests sent to them — no campus dashboard.
  const authorityOnly = AUTHORITY_ONLY.includes(me.role);
  const { data: dash, isLoading, error, refetch } = useGetGateDashboardQuery(undefined, { skip: authorityOnly });
  const tabs = [
    { value: 'review', label: 'Review' },
    ...(authorityOnly ? [] : [{ value: 'outside', label: 'Outside now', count: dash?.studentsOutside || undefined }]),
    ...(me.role === 'admin' ? [{ value: 'all', label: 'All passes' }] : []),
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        icon={DoorOpen}
        title="Gate passes"
        subtitle={
          me.role === 'faculty'
            ? 'Requests from your class wait here first.'
            : me.role === 'hod'
              ? 'Requests forwarded by faculty in your department.'
              : me.role === 'principal'
                ? 'Final approval, plus emergency requests students send to you directly.'
                : authorityOnly
                  ? 'Emergency gate pass requests students send to you directly.'
                  : 'Review requests at any stage and see who is outside.'
        }
      />
      {authorityOnly ? null : isLoading ? (
        <Skeleton className="h-28" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Clock} label="Pending" value={dash.pending} hint="Across all stages" gradient="from-amber-400 to-orange-500" />
          <StatCard icon={Users} label="Outside now" value={dash.studentsOutside} hint={dash.overdue ? `${dash.overdue} overdue` : 'None overdue'} gradient="from-sky-400 to-blue-500" delay={60} />
          <StatCard icon={LogOut} label="Exits today" value={dash.todayExits} gradient="from-violet-400 to-indigo-500" delay={120} />
          <StatCard icon={LogIn} label="Returns today" value={dash.todayReturns} gradient="from-emerald-400 to-teal-500" delay={180} />
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={(t) => setParams(t === 'review' ? {} : { tab: t }, { replace: true })} />
      {tab === 'review' && <ReviewQueue role={me.role} />}
      {tab === 'outside' && dash && <OutsideNow dash={dash} />}
      {tab === 'all' && <AllPasses />}
    </div>
  );
}

/* ── Security ───────────────────────────────────────────────────── */
function SecurityConsole() {
  const { data: dash, isLoading, error, refetch } = useGetSecurityDashboardQuery(undefined, { pollingInterval: 30000 });
  const [code, setCode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [verify, { isLoading: verifying }] = useVerifyGatePassMutation();
  const [out, { isLoading: outLoading }] = useRecordGateOutMutation();

  // Accepts the typed code or a scanned QR value — same verification either way.
  const check = async (e, scanned) => {
    e?.preventDefault?.();
    const value = (typeof scanned === 'string' ? scanned : code).trim();
    if (!value) return;
    try {
      setResult({ ...(await verify(value).unwrap()), credential: value });
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const act = async (fn, msg) => {
    try {
      // The final action re-sends the verified code; the server consumes it.
      const pass = await fn({ id: result.pass._id, code: result.credential }).unwrap();
      toast.success(msg);
      setResult({ ...result, pass: { ...result.pass, ...pass }, nextAction: null, done: true });
      setCode('');
      refetch();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldCheck} title="Security console" subtitle="Verify a student's code, then record OUT or IN." />
      {isLoading ? (
        <Skeleton className="h-28" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <StatCard icon={Users} label="Inside campus" value={dash.inside} gradient="from-emerald-400 to-teal-500" />
          <StatCard icon={LogOut} label="Outside campus" value={dash.outside} gradient="from-amber-400 to-orange-500" delay={60} />
          <StatCard icon={DoorOpen} label="Left today" value={dash.leftToday} gradient="from-sky-400 to-blue-500" delay={120} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Verify a gate pass" subtitle="Scan the student’s QR code, or enter their 4-character code." />
          <Button type="button" icon={ScanLine} className="mb-3 w-full" onClick={() => setScanOpen(true)}>
            Scan QR code
          </Button>
          <p className="mb-2 text-center text-xs muted">or enter code manually</p>
          <form onSubmit={check} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A4G5"
              aria-label="Verification code"
              autoFocus
              autoComplete="off"
              className="input flex-1 font-mono text-2xl tracking-[0.3em]"
              maxLength={4}
            />
            <Button type="submit" loading={verifying} icon={ShieldCheck}>
              Verify
            </Button>
          </form>
        </Card>
        <Card aria-live="polite">
          {!result ? (
            <EmptyState icon={ShieldCheck} title="Waiting for a code" text="Verification results appear here." />
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
                      <p className="muted">Pass type</p>
                      <p className={cn('font-bold', isEmergency(result.pass) && 'text-rose-600')}>{passTitle(result.pass)}</p>
                    </div>
                    <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                      <p className="muted">Status</p>
                      <StatusBadge status={result.pass.status} />
                    </div>
                    <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                      <p className="muted">From</p>
                      <p className="font-bold">{fmtClassDay(result.pass.fromDate)}</p>
                    </div>
                    <div className="rounded-2xl bg-white/50 p-2.5 dark:bg-white/5">
                      <p className="muted">To</p>
                      <p className="font-bold">{fmtClassDay(result.pass.toDate)}</p>
                    </div>
                  </div>
                  {result.nextAction === 'out' && (
                    <Button className="w-full" icon={LogOut} loading={outLoading} onClick={() => act(out, 'OUT recorded')}>
                      OUT — record exit
                    </Button>
                  )}
                  {result.returnRequired && (
                    <>
                      <p className="flex items-start gap-2 text-sm text-amber-600">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> This student is outside. To record their return, scan their Return QR or enter their Return Code.
                      </p>
                      <Button className="w-full" variant="success" icon={LogIn} to="/gate-pass/in">
                        Return verification
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      </div>
      <QrScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={(value) => {
          setScanOpen(false);
          const problem = scanProblem(value, 'exit');
          if (problem) setResult({ valid: false, problems: [problem] });
          else check(null, value);
        }}
      />
    </div>
  );
}

export default function GatePass() {
  const me = useSelector(selectUser);
  if (me.role === 'security') return <SecurityConsole />;
  return STUDENT_ROLES.includes(me.role) ? <StudentGatePass /> : <StaffGatePass />;
}
