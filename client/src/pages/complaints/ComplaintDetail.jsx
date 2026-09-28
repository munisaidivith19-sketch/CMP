import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  Clock,
  EyeOff,
  FileText,
  MessageSquareWarning,
  XCircle,
} from 'lucide-react';
import {
  useAuthorityUpdateComplaintMutation,
  useCancelComplaintMutation,
  useGetComplaintQuery,
  useMarkComplaintNotResolvedMutation,
  useMarkComplaintResolvedMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Avatar, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { errMsg, fmtClassDay, timeAgo, titleCase } from '../../utils/format';
import { COMPLAINT_CATEGORY_LABELS, ROLE_LABELS } from '../../utils/constants';

const sameId = (a, b) => Boolean(a && b) && String(a?._id || a) === String(b?._id || b);
const CANCELLABLE = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS'];

function Countdown({ target }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return (
    <p className="flex items-center gap-1.5 text-xs muted">
      <Clock className="h-3.5 w-3.5" /> Escalation available in {h}h {m}m
    </p>
  );
}

function Timeline({ history }) {
  const icon = (action) => {
    if (['resolved', 'closed'].includes(action)) return <CheckCircle2 className="h-4 w-4" />;
    if (['not_resolved', 'cancelled'].includes(action)) return <XCircle className="h-4 w-4" />;
    return <Clock className="h-4 w-4" />;
  };
  const label = (h) => {
    switch (h.action) {
      case 'submitted':
        return `Complaint submitted · assigned to ${titleCase(h.newAuthority)}`;
      case 'authority_update':
        return `${titleCase(h.actorRole)} updated status to ${titleCase(h.newStatus)}${h.comment ? ` — “${h.comment}”` : ''}`;
      case 'not_resolved':
        return 'Marked not resolved — no further escalation available';
      case 'escalated':
        return `Escalated from ${titleCase(h.previousAuthority)} to ${titleCase(h.newAuthority)}`;
      case 'resolved':
        return 'Marked resolved';
      case 'closed':
        return 'Student confirmed resolution — complaint closed';
      case 'cancelled':
        return 'Complaint cancelled by the student';
      case 'identity_accessed':
        return `Identity accessed by ${titleCase(h.actorRole)}`;
      default:
        return titleCase(h.action);
    }
  };
  if (!history?.length) return <p className="text-sm muted">No history yet.</p>;
  return (
    <ol className="space-y-3">
      {history.map((h, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500/10 text-primary-500">{icon(h.action)}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{label(h)}</p>
            <p className="text-xs muted">{timeAgo(h.timestamp)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ComplaintDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useSelector(selectUser);
  const { data: complaint, isLoading, error, refetch } = useGetComplaintQuery(id);
  const [cancel, { isLoading: cancelling }] = useCancelComplaintMutation();
  const [notResolved, { isLoading: escalating }] = useMarkComplaintNotResolvedMutation();
  const [resolved, { isLoading: closing }] = useMarkComplaintResolvedMutation();
  const [authorityUpdate, { isLoading: updating }] = useAuthorityUpdateComplaintMutation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [authorityModal, setAuthorityModal] = useState(false);
  const [status, setStatusValue] = useState('IN_REVIEW');
  const [comment, setComment] = useState('');

  const isOwner = useMemo(() => sameId(complaint?.student, me), [complaint, me]);
  const isAuthority = useMemo(() => sameId(complaint?.currentAuthorityUserId, me) || me.role === 'admin', [complaint, me]);
  const canEscalate = complaint?.notResolvedAvailableAt && Date.now() >= new Date(complaint.notResolvedAvailableAt).getTime();

  if (isLoading) return <Skeleton className="h-96" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessageSquareWarning}
        title={COMPLAINT_CATEGORY_LABELS[complaint.category] || titleCase(complaint.category)}
        subtitle={complaint.complaintCode}
        actions={<StatusBadge status={complaint.status} />}
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {complaint.subCategory && <span className="chip">{titleCase(complaint.subCategory)}</span>}
          <span className="chip">Assigned to {ROLE_LABELS[complaint.currentAuthorityRole] || titleCase(complaint.currentAuthorityRole)}</span>
          <span className="chip">Escalation level {complaint.escalationLevel}</span>
          {complaint.anonymous && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
              <EyeOff className="h-3.5 w-3.5" /> Anonymous
            </span>
          )}
        </div>

        {complaint.identityHidden === false && complaint.student && !isOwner && (
          <div className="flex items-center gap-3 rounded-2xl bg-white/50 p-3 dark:bg-white/5">
            <Avatar user={complaint.student} size="sm" />
            <div>
              <p className="text-sm font-bold">{complaint.student.name}</p>
              <p className="text-xs muted">{complaint.student.rollNo} · {complaint.student.department}</p>
            </div>
          </div>
        )}

        <p className="text-sm">{complaint.description}</p>

        {complaint.attachments?.length > 0 && (
          <div>
            <p className="label">Supporting files</p>
            <div className="flex flex-wrap gap-2">
              {complaint.attachments.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="chip">
                  <FileText className="h-3.5 w-3.5" /> {a.name || 'File'}
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs muted">Submitted {fmtClassDay(complaint.createdAt, 'dd MMM, h:mm a')} · Last updated {timeAgo(complaint.updatedAt)}</p>

        {isOwner && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/60 pt-4 dark:border-white/10">
            {CANCELLABLE.includes(complaint.status) && (
              <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel
              </Button>
            )}
            {['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED'].includes(complaint.status) && (
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" disabled={!canEscalate} loading={escalating} onClick={async () => {
                  try {
                    await notResolved(complaint._id).unwrap();
                    toast.success('Escalated to the next authority');
                  } catch (e) {
                    toast.error(errMsg(e));
                  }
                }}>
                  Not resolved
                </Button>
                {!canEscalate && <Countdown target={complaint.notResolvedAvailableAt} />}
              </div>
            )}
            {['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'].includes(complaint.status) && (
              <Button variant="success" size="sm" loading={closing} onClick={async () => {
                try {
                  await resolved(complaint._id).unwrap();
                  toast.success('Marked as resolved — thanks for confirming');
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}>
                Resolved
              </Button>
            )}
          </div>
        )}

        {isAuthority && !isOwner && !['CANCELLED', 'CLOSED'].includes(complaint.status) && (
          <div className="border-t border-white/60 pt-4 dark:border-white/10">
            <Button size="sm" onClick={() => { setStatusValue('IN_REVIEW'); setComment(''); setAuthorityModal(true); }}>
              Update status
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Timeline" />
        <Timeline history={complaint.history} />
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this complaint?"
        text="This withdraws the complaint immediately."
        confirmText="Cancel complaint"
        loading={cancelling}
        onConfirm={async () => {
          try {
            await cancel(complaint._id).unwrap();
            toast.success('Complaint cancelled');
            navigate('/complaints');
          } catch (e) {
            toast.error(errMsg(e));
          }
          setConfirmCancel(false);
        }}
      />

      <Modal
        open={authorityModal}
        onClose={() => setAuthorityModal(false)}
        title="Update complaint status"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAuthorityModal(false)}>
              Cancel
            </Button>
            <Button
              loading={updating}
              onClick={async () => {
                try {
                  await authorityUpdate({ id: complaint._id, status, comment: comment.trim() || undefined }).unwrap();
                  toast.success('Status updated — the student has been notified');
                  setAuthorityModal(false);
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="Status"
            options={[
              { value: 'IN_REVIEW', label: 'In review' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'RESOLVED', label: 'Resolved' },
            ]}
            value={status}
            onChange={(e) => setStatusValue(e.target.value)}
          />
          <Textarea label="Comment (shared with the student)" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
