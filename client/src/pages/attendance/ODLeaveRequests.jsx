import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  useGetMyODLeaveRequestsQuery,
  useCancelODLeaveRequestMutation,
} from '../../services/api';
import { Modal } from '../../components/ui/Modal';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  cn,
} from '../../components/ui/primitives';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime } from '../../utils/format';
import ODLeaveModal from './ODLeaveModal';

export default function ODLeaveRequests() {
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error, refetch } = useGetMyODLeaveRequestsQuery(
    {
      page,
      limit: 10,
      requestType: typeFilter || undefined,
      status: statusFilter || undefined,
    },
    { pollingInterval: 15000 }
  );

  const [cancelRequest, { isLoading: cancelling }] = useCancelODLeaveRequestMutation();

  const openCancelModal = (req) => {
    setCancelTarget(req);
  };

  const confirmCancellation = async () => {
    if (!cancelTarget) return;
    try {
      await cancelRequest(cancelTarget._id).unwrap();
      toast.success('Request cancelled successfully');
      setCancelTarget(null);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const requests = data?.requests || [];
  const pagination = data?.pagination;

  // Stats calculation
  const stats = useMemo(() => {
    if (!requests.length) return { odApproved: 0, leaveApproved: 0, pending: 0 };
    let odApproved = 0;
    let leaveApproved = 0;
    let pending = 0;
    requests.forEach((r) => {
      if (r.status === 'approved') {
        if (r.requestType === 'od') odApproved += r.daysCount || 1;
        else leaveApproved += r.daysCount || 1;
      } else if (r.status.startsWith('pending_')) {
        pending += 1;
      }
    });
    return { odApproved, leaveApproved, pending };
  }, [requests]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Top Banner / Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink dark:text-primary-50">
            On Duty (OD) & Leave Requests
          </h2>
          <p className="text-xs text-ink-muted dark:text-slate-400">
            Submit advance requests for approval across Class In-Charge, HOD, and Principal.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            onClick={() => setModalOpen(true)}
          >
            Apply OD / Leave
          </Button>
        </div>
      </div>

      {/* MiniStats Counters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-500/10 to-sky-500/5 p-4 shadow-sm dark:border-sky-500/20 dark:from-sky-500/15 dark:to-transparent">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              Active / Approved OD
            </span>
            <span className="rounded-xl bg-sky-500/20 p-2 text-sky-600 dark:text-sky-300">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-ink dark:text-primary-50">
            {stats.odApproved} <span className="text-xs font-normal text-ink-muted">days</span>
          </p>
          <p className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-300">
            Earns 100% Present attendance credit
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-4 shadow-sm dark:border-amber-500/20 dark:from-amber-500/15 dark:to-transparent">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Approved Leaves
            </span>
            <span className="rounded-xl bg-amber-500/20 p-2 text-amber-600 dark:text-amber-300">
              <Calendar className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-ink dark:text-primary-50">
            {stats.leaveApproved} <span className="text-xs font-normal text-ink-muted">days</span>
          </p>
          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
            Authorized leave on record
          </p>
        </div>

        <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 p-4 shadow-sm dark:border-indigo-500/20 dark:from-indigo-500/15 dark:to-transparent">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              Pending In Review
            </span>
            <span className="rounded-xl bg-indigo-500/20 p-2 text-indigo-600 dark:text-indigo-300">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-ink dark:text-primary-50">
            {stats.pending} <span className="text-xs font-normal text-ink-muted">requests</span>
          </p>
          <p className="mt-0.5 text-[11px] text-indigo-700 dark:text-indigo-300">
            In verification hierarchy
          </p>
        </div>
      </div>

      {/* Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted flex items-center gap-1.5 mr-1">
            <Filter className="h-3.5 w-3.5" /> Filters:
          </span>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Type"
            className="input w-auto rounded-xl py-1 px-3 text-xs"
          >
            <option value="">All Types (OD & Leave)</option>
            <option value="od">On Duty (OD)</option>
            <option value="leave">Leave Request</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Status"
            className="input w-auto rounded-xl py-1 px-3 text-xs"
          >
            <option value="">All Statuses</option>
            <option value="pending_faculty">Waiting for Class In-Charge</option>
            <option value="pending_hod">Waiting for HOD</option>
            <option value="pending_principal">Waiting for Principal</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {(typeFilter || statusFilter) && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setTypeFilter('');
              setStatusFilter('');
              setPage(1);
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Request Cards List */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !requests.length ? (
        <EmptyState
          icon={Calendar}
          title="No OD or Leave requests"
          text="You haven't submitted any requests matching the selected filters."
          action={
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setModalOpen(true)}>
              Apply Now
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isOD = req.requestType === 'od';
            const isPending = req.status.startsWith('pending_');
            const isApproved = req.status === 'approved';
            const isRejected = req.status === 'rejected';
            const isCancelled = req.status === 'cancelled';

            // Stage tracking: if cancelled, all stages from Class In-Charge to Principal show as cancelled
            const stageSteps = [
              {
                label: 'Class In-Charge',
                done: isCancelled ? false : Boolean(req.facultyReview?.action),
                active: isCancelled ? false : req.status === 'pending_faculty',
                rejected: isCancelled ? false : req.rejectedStage === 'faculty',
                cancelled: isCancelled,
                reviewer: req.facultyReview?.by?.name,
              },
              {
                label: 'HOD',
                done: isCancelled ? false : Boolean(req.hodReview?.action),
                active: isCancelled ? false : req.status === 'pending_hod',
                rejected: isCancelled ? false : req.rejectedStage === 'hod',
                cancelled: isCancelled,
                reviewer: req.hodReview?.by?.name,
              },
              {
                label: 'Principal',
                done: isCancelled ? false : isApproved,
                active: isCancelled ? false : req.status === 'pending_principal',
                rejected: isCancelled ? false : req.rejectedStage === 'principal',
                cancelled: isCancelled,
                reviewer: req.principalReview?.by?.name,
              },
            ];

            return (
              <div
                key={req._id}
                className={cn(
                  'group relative rounded-2xl border p-4 transition-all duration-300 shadow-sm',
                  'bg-white/80 dark:bg-[#131427]/80 backdrop-blur-xl',
                  isApproved
                    ? 'border-emerald-300/70 dark:border-emerald-500/30'
                    : isRejected
                      ? 'border-rose-300/70 dark:border-rose-500/30'
                      : isCancelled
                        ? 'border-rose-200/80 dark:border-rose-900/30'
                        : 'border-slate-200/80 dark:border-white/10 hover:border-primary-500/40'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Left: Type, Dates & Category */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-xl px-2.5 py-0.5 text-xs font-bold shadow-xs',
                          isOD
                            ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 border border-sky-500/30'
                            : 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/30'
                        )}
                      >
                        {isOD ? <Sparkles className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
                        {isOD ? 'ON DUTY (OD)' : 'LEAVE REQUEST'}
                      </span>

                      <StatusBadge status={req.status} />

                      <span className="text-xs font-bold text-ink dark:text-primary-100">
                        {fmtClassDay(req.fromDate)}
                        {req.fromDate !== req.toDate && ` → ${fmtClassDay(req.toDate)}`}
                      </span>
                      <span className="rounded-md bg-slate-100 dark:bg-white/10 px-1.5 py-0.2 text-[10px] font-mono text-ink-muted">
                        {req.daysCount} {req.daysCount === 1 ? 'day' : 'days'}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {req.category}
                    </p>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2">
                    {((isOD && (isPending || isApproved)) || (!isOD && isPending)) && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                        loading={cancelling && cancelTarget?._id === req._id}
                        onClick={() => openCancelModal(req)}
                      >
                        Cancel Request
                      </Button>
                    )}
                  </div>
                </div>

                {/* Description & Supporting Document */}
                <p className="mt-2.5 text-xs text-ink-soft dark:text-slate-300 leading-relaxed">
                  “{req.description}”
                </p>

                {req.document?.url && (
                  <div className="mt-2 flex items-center gap-2">
                    <a
                      href={req.document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100/90 dark:bg-white/10 px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      <span>{req.document.name || 'View Attachment'}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Rejection Note */}
                {isRejected && req.rejectedReason && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200/80 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:border-rose-500/20 dark:text-rose-300">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Rejected by {req.rejectedStage?.toUpperCase()}: </span>
                      {req.rejectedReason}
                    </div>
                  </div>
                )}

                {/* Cancellation Note */}
                {isCancelled && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200/80 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:border-rose-500/20 dark:text-rose-300">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Cancelled by Student: </span>
                      This request was cancelled across all verification stages (Class In-Charge, HOD, and Principal).
                    </div>
                  </div>
                )}

                {/* 3-Tier Approval Flow Visualization */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                  <div className="grid grid-cols-3 gap-2">
                    {stageSteps.map((step, idx) => (
                      <div
                        key={step.label}
                        className={cn(
                          'relative flex flex-col items-center rounded-xl p-2 text-center text-xs transition-all',
                          step.cancelled
                            ? 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border border-rose-500/20'
                            : step.done
                              ? 'bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-500/20'
                              : step.active
                                ? 'bg-primary-500/10 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300 border border-primary-500/30 ring-1 ring-primary-500/20'
                                : step.rejected
                                  ? 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border border-rose-500/20'
                                  : 'bg-slate-50 dark:bg-white/[0.02] text-ink-muted border border-slate-200/60 dark:border-white/5'
                        )}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Stage {idx + 1}
                        </span>
                        <span className="font-semibold text-[11px] truncate w-full">
                          {step.label}
                        </span>
                        <span className="mt-0.5 text-[10px]">
                          {step.cancelled ? (
                            <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400 font-bold">
                              <XCircle className="h-3 w-3" /> Cancelled
                            </span>
                          ) : step.done ? (
                            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-bold">
                              <CheckCircle2 className="h-3 w-3" /> Approved
                            </span>
                          ) : step.rejected ? (
                            <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400 font-bold">
                              <XCircle className="h-3 w-3" /> Rejected
                            </span>
                          ) : step.active ? (
                            <span className="inline-flex items-center gap-0.5 text-primary-600 dark:text-primary-400 font-bold animate-pulse">
                              <Clock className="h-3 w-3" /> Waiting
                            </span>
                          ) : (
                            'Pending'
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Created timestamp */}
                <div className="mt-2 text-right">
                  <span className="text-[10px] text-ink-muted">
                    Submitted on {fmtDateTime(req.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}

          {pagination && pagination.pages > 1 && (
            <Pagination
              page={pagination.page}
              pages={pagination.pages}
              onChange={setPage}
            />
          )}
        </div>
      )}

      {/* Red Consequences Confirmation Modal */}
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => !cancelling && setCancelTarget(null)}
        title="Cancel On Duty (OD) Request"
        size="sm"
        footer={
          <div className="flex w-full items-center justify-end gap-2.5 sm:w-auto">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCancelTarget(null)}
              disabled={cancelling}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md shadow-rose-500/20"
              loading={cancelling}
              onClick={confirmCancellation}
            >
              OK, Cancel Request
            </Button>
          </div>
        }
      >
        {cancelTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-rose-300/80 bg-rose-500/10 p-4 dark:border-rose-500/30 dark:bg-rose-500/15">
              <AlertTriangle className="h-6 w-6 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="space-y-1.5 text-xs text-rose-950 dark:text-rose-100">
                <p className="font-bold text-sm text-rose-700 dark:text-rose-300">
                  Are you sure you want to cancel this {cancelTarget.requestType.toUpperCase()} request?
                </p>
                <p className="text-[12px] leading-relaxed">
                  Cancelling will apply immediately with the following consequences:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-[11px] leading-snug">
                  <li>
                    <strong>Cancelled Across All Stages:</strong> The request will be cancelled from <strong>Class In-Charge &rarr; HOD &rarr; Principal</strong>.
                  </li>
                  {cancelTarget.status === 'approved' && cancelTarget.requestType === 'od' && (
                    <li>
                      <strong>Attendance Revocation:</strong> Your approved On Duty (OD) status will be revoked, and all periods will be reverted to <strong>Absent</strong>.
                    </li>
                  )}
                  <li>
                    <strong>Staff Notifications:</strong> An automated cancellation notice will be sent immediately to your Class In-Charge, HOD, and Principal.
                  </li>
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-xs dark:border-white/10 dark:bg-white/[0.02]">
              <div className="flex justify-between items-center text-ink-muted">
                <span>Category:</span>
                <span className="font-semibold text-ink dark:text-primary-100">{cancelTarget.category}</span>
              </div>
              <div className="mt-1 flex justify-between items-center text-ink-muted">
                <span>Dates:</span>
                <span className="font-semibold text-ink dark:text-primary-100">
                  {fmtClassDay(cancelTarget.fromDate)}
                  {cancelTarget.fromDate !== cancelTarget.toDate && ` → ${fmtClassDay(cancelTarget.toDate)}`}
                  {' '}({cancelTarget.daysCount} {cancelTarget.daysCount === 1 ? 'day' : 'days'})
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* OD / Leave Application Modal */}
      <ODLeaveModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

