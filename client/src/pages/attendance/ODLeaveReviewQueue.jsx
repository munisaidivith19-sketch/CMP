import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Paperclip,
  RefreshCw,
  Search,
  Sparkles,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { selectUser } from '../../features/authSlice';
import {
  useGetPendingODLeaveReviewsQuery,
  useReviewODLeaveRequestMutation,
} from '../../services/api';
import {
  Avatar,
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
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, fmtDateTime } from '../../utils/format';

export default function ODLeaveReviewQueue() {
  const me = useSelector(selectUser);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [rejectModalTarget, setRejectModalTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, isFetching, error, refetch } = useGetPendingODLeaveReviewsQuery({
    page,
    limit: 15,
    status: statusFilter || undefined,
    requestType: typeFilter || undefined,
  });

  const [reviewRequest, { isLoading: reviewing }] = useReviewODLeaveRequestMutation();

  const requests = data?.requests || [];
  const pagination = data?.pagination;

  const isFaculty = me.role === 'faculty';
  const isHod = me.role === 'hod';
  const isPrincipal = me.role === 'principal' || me.role === 'admin';

  const handleAction = async (request, action, reason = '') => {
    try {
      await reviewRequest({
        id: request._id,
        action,
        reason: reason || undefined,
      }).unwrap();

      if (action === 'approve') {
        toast.success(`Request approved! Attendance automatically updated for ${request.student?.name}.`);
      } else if (action === 'forward') {
        toast.success(`Request forwarded to ${isFaculty ? 'Department HOD' : 'the Principal'}.`);
      } else if (action === 'reject') {
        toast.success('Request has been rejected.');
      }
      setRejectModalTarget(null);
      setRejectReason('');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink dark:text-primary-50">
            OD & Leave Review Console
          </h2>
          <p className="text-xs text-ink-muted dark:text-slate-400">
            {isFaculty && 'Review advance student requests from your class and forward to HOD.'}
            {isHod && 'Review department student requests and forward to the Principal.'}
            {isPrincipal && 'Grant final approval to apply OD attendance credit (100% Present) or Leave on student records.'}
          </p>
        </div>

        <Button
          size="sm"
          variant="ghost"
          icon={RefreshCw}
          loading={isFetching}
          onClick={() => refetch()}
        >
          Refresh Queue
        </Button>
      </div>

      {/* Filter Bar */}
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
            {isFaculty && <option value="pending_faculty">Waiting My Review (Faculty)</option>}
            {isHod && <option value="pending_hod">Waiting My Review (HOD)</option>}
            {isPrincipal && <option value="pending_principal">Waiting My Review (Principal)</option>}
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
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

      {/* Queue List */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !requests.length ? (
        <EmptyState
          icon={UserCheck}
          title="No pending requests in your queue"
          text="All OD and Leave requests have been reviewed or none have been submitted yet."
        />
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isOD = req.requestType === 'od';
            const student = req.student || {};

            const canActFaculty = isFaculty && req.status === 'pending_faculty';
            const canActHod = isHod && req.status === 'pending_hod';
            const canActPrincipal = isPrincipal && req.status === 'pending_principal';
            const canReview = canActFaculty || canActHod || canActPrincipal;

            return (
              <div
                key={req._id}
                className={cn(
                  'group relative rounded-2xl border p-4 transition-all duration-300 shadow-sm',
                  'bg-white/80 dark:bg-[#131427]/80 backdrop-blur-xl',
                  canReview
                    ? 'border-primary-500/40 ring-1 ring-primary-500/20 shadow-md'
                    : 'border-slate-200/80 dark:border-white/10'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Student Info & Request Meta */}
                  <div className="flex items-start gap-3">
                    <Avatar user={student} size="md" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-ink dark:text-primary-50">
                          {student.name}
                        </span>
                        <span className="text-xs font-mono text-ink-muted">
                          {student.rollNo || 'No Roll'}
                        </span>
                        <span className="rounded-md bg-slate-100 dark:bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                          {student.department} · Sec {student.section} · Yr {student.year}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-xl px-2.5 py-0.5 text-xs font-bold shadow-xs',
                            isOD
                              ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 border border-sky-500/30'
                              : 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/30'
                          )}
                        >
                          {isOD ? <Sparkles className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
                          {isOD ? 'ON DUTY (OD)' : 'LEAVE'}
                        </span>

                        <StatusBadge status={req.status} />

                        <span className="text-xs font-bold text-ink dark:text-primary-100">
                          {fmtClassDay(req.fromDate)}
                          {req.fromDate !== req.toDate && ` → ${fmtClassDay(req.toDate)}`}
                        </span>
                        <span className="text-xs text-ink-muted">
                          ({req.daysCount} {req.daysCount === 1 ? 'day' : 'days'})
                        </span>
                      </div>

                      <p className="mt-1 text-xs font-semibold text-primary-600 dark:text-primary-400">
                        {req.category}
                      </p>
                    </div>
                  </div>

                  {/* Review Actions */}
                  {canReview && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        icon={X}
                        loading={reviewing}
                        onClick={() => {
                          setRejectModalTarget(req);
                          setRejectReason('');
                        }}
                      >
                        Reject
                      </Button>

                      {canActPrincipal ? (
                        <Button
                          size="sm"
                          variant="success"
                          icon={Check}
                          loading={reviewing}
                          onClick={() => handleAction(req, 'approve')}
                        >
                          Approve Request
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={ArrowRight}
                          loading={reviewing}
                          onClick={() => handleAction(req, 'forward')}
                        >
                          {canActFaculty ? 'Forward to HOD' : 'Forward to Principal'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Reason / Explanation */}
                <p className="mt-3 text-xs text-ink-soft dark:text-slate-300 leading-relaxed bg-slate-50/80 dark:bg-white/[0.02] p-2.5 rounded-xl border border-slate-100 dark:border-white/5">
                  <span className="font-semibold text-ink dark:text-primary-100">Student Explanation: </span>
                  “{req.description}”
                </p>

                {/* Document attachment if available */}
                {req.document?.url && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <a
                      href={req.document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100/90 dark:bg-white/10 px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      <span>{req.document.name || 'View Attachment Document'}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Prior Review Notes */}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-muted">
                  {req.facultyReview?.at && (
                    <span>
                      Class In-Charge: <strong className="text-ink dark:text-primary-100">{req.facultyReview.action}</strong> by {req.facultyReview.by?.name}
                    </span>
                  )}
                  {req.hodReview?.at && (
                    <span>
                      HOD: <strong className="text-ink dark:text-primary-100">{req.hodReview.action}</strong> by {req.hodReview.by?.name}
                    </span>
                  )}
                  {req.principalReview?.at && (
                    <span>
                      Principal: <strong className="text-ink dark:text-primary-100">{req.principalReview.action}</strong> by {req.principalReview.by?.name}
                    </span>
                  )}
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

      {/* Rejection Modal */}
      {rejectModalTarget && (
        <Modal
          open
          onClose={() => setRejectModalTarget(null)}
          title="Reject Request"
          subtitle={`Rejecting ${rejectModalTarget.requestType.toUpperCase()} request for ${rejectModalTarget.student?.name}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRejectModalTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={reviewing}
                disabled={rejectReason.trim().length < 3}
                onClick={() => handleAction(rejectModalTarget, 'reject', rejectReason.trim())}
              >
                Confirm Rejection
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Please provide a clear reason for the rejection. This explanation will be sent directly to the student.
            </p>
            <textarea
              rows={3}
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Inadequate advance notice, internal exams scheduled on these dates, or missing approval letter..."
              className="input w-full"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

