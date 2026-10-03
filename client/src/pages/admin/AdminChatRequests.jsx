import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { Check, Eye, UsersRound, X } from 'lucide-react';
import { useGetGroupRequestsQuery, useReviewGroupRequestMutation } from '../../services/api';
import { Avatar, AvatarStack, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/form';
import { ROLE_LABELS, STUDENT_ROLES, YEAR_LABELS } from '../../utils/constants';
import { errMsg, timeAgo } from '../../utils/format';
import { selectUser } from '../../features/authSlice';

const CATEGORY_LABEL = { custom: 'Custom', academic: 'Academics', faculty: 'Faculty' };

/**
 * Group requests waiting for approval. An admin reviews faculty class groups
 * (and may review any request); the principal reviews the groups HODs ask to
 * create. The server returns each reviewer only the requests they decide.
 */
export default function AdminChatRequests() {
  const me = useSelector(selectUser);
  const isPrincipal = me.role === 'principal';
  const [viewing, setViewing] = useState(null);
  const [status, setStatus] = useState('pending');
  const { data = [], isLoading, error, refetch } = useGetGroupRequestsQuery(status === 'all' ? { status: 'all' } : undefined);
  const [review, { isLoading: saving, originalArgs }] = useReviewGroupRequestMutation();
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const act = async (id, action, why) => {
    try {
      await review({ id, action, ...(why ? { reason: why } : {}) }).unwrap();
      toast.success(action === 'approve' ? 'Group approved — members have been notified' : 'Request rejected');
      setRejecting(null);
      setViewing(null);
      setReason('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UsersRound}
        title="Group chat requests"
        subtitle={
          isPrincipal
            ? 'HODs ask to create these groups. Open one to see who is in it and why, then approve or reject.'
            : 'Faculty class groups go live only after an admin approves them.'
        }
      />
      <Tabs
        tabs={[
          { value: 'pending', label: 'Pending', count: status === 'pending' ? data.length || undefined : undefined },
          { value: 'all', label: 'Pending & rejected' },
        ]}
        value={status}
        onChange={setStatus}
      />

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="No requests"
            text={`New ${isPrincipal ? 'HOD' : 'faculty'} group requests will show up here and in your notifications.`}
          />
        </Card>
      ) : (
        // min-w-0 on the cards: a long group or member name truncates instead
        // of widening the page past a phone screen.
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {data.map((r) => {
            const members = r.participants.filter((p) => String(p._id) !== String(r.createdBy?._id));
            const students = members.filter((m) => STUDENT_ROLES.includes(m.role));
            const sections = [...new Set(students.map((m) => m.section).filter(Boolean))];
            const busy = saving && originalArgs?.id === r._id;
            return (
              <Card key={r._id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <Avatar user={r.createdBy} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{r.name}</p>
                    <p className="truncate text-xs muted">
                      by {r.createdBy?.name} · {ROLE_LABELS[r.createdBy?.role]}
                      {r.createdBy?.department ? ` · ${r.createdBy.department}` : ''} · {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <Badge color={r.status === 'pending' ? 'warning' : 'danger'}>{r.status}</Badge>
                </div>
                {r.category && (
                  <p className="text-xs font-semibold text-primary-600">
                    {CATEGORY_LABEL[r.category]} group
                    {r.linkedYear ? ` · ${YEAR_LABELS[r.linkedYear]} Section ${r.linkedSection}` : ''}
                  </p>
                )}
                {r.reason && (
                  <p className="text-sm">
                    <span className="font-semibold">Reason: </span>
                    {r.reason}
                  </p>
                )}
                {r.description && <p className="text-sm">{r.description}</p>}
                <div className="flex items-center gap-3">
                  <AvatarStack users={members} max={6} />
                  <p className="text-xs muted">
                    {members.length} member{members.length === 1 ? '' : 's'}
                    {students.length ? ` · ${students.length} students` : ''}
                    {sections.length ? ` · Sec ${sections.join(', ')}` : ''}
                  </p>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-primary-600">Member list</summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {members.map((m) => (
                      <li key={m._id} className="flex justify-between gap-2">
                        <span className="truncate">{m.name}</span>
                        <span className="shrink-0 muted">{[ROLE_LABELS[m.role], m.rollNo, m.section && `Sec ${m.section}`].filter(Boolean).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                {r.status === 'pending' ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" icon={Eye} onClick={() => setViewing(r)}>
                      View request
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => setRejecting(r)}>
                      <X className="h-4 w-4" /> Reject
                    </Button>
                    <Button size="sm" variant="success" loading={busy} onClick={() => act(r._id, 'approve')}>
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                  </div>
                ) : (
                  r.rejectReason && <p className="text-xs text-rose-500">Reason: {r.rejectReason}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Request detail: who is in the group and why it is needed. */}
      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.name}
        subtitle={
          viewing
            ? `Requested by ${viewing.createdBy?.name} (${ROLE_LABELS[viewing.createdBy?.role]}${viewing.createdBy?.department ? `, ${viewing.createdBy.department}` : ''}) · ${timeAgo(viewing.createdAt)}`
            : ''
        }
        footer={
          viewing?.status === 'pending' && (
            <>
              <Button variant="danger" onClick={() => setRejecting(viewing)}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button variant="success" loading={saving} onClick={() => act(viewing._id, 'approve')}>
                <Check className="h-4 w-4" /> Approve
              </Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="space-y-4">
            {viewing.category && (
              <p className="text-sm">
                <span className="font-semibold">Group type: </span>
                {CATEGORY_LABEL[viewing.category]}
                {viewing.linkedYear ? ` · ${YEAR_LABELS[viewing.linkedYear]} Section ${viewing.linkedSection}` : ''}
              </p>
            )}
            <div>
              <p className="label">Reason</p>
              <p className="whitespace-pre-wrap rounded-2xl bg-white/50 p-3 text-sm dark:bg-white/5">{viewing.reason || viewing.description || '—'}</p>
            </div>
            <div>
              <p className="label">Members ({viewing.participants.length - 1})</p>
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {viewing.participants
                  .filter((p) => String(p._id) !== String(viewing.createdBy?._id))
                  .map((m) => (
                    <li key={m._id} className="flex items-center gap-3 rounded-xl p-1.5">
                      <Avatar user={m} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{m.name}</span>
                        <span className="block truncate text-xs muted">
                          {[ROLE_LABELS[m.role], m.department, m.rollNo, m.section && `Sec ${m.section}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={`Reject "${rejecting?.name}"?`}
        subtitle={`The ${rejecting?.createdBy?.role === 'hod' ? 'HOD' : 'faculty member'} is told the group was not approved.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={saving} onClick={() => act(rejecting._id, 'reject', reason.trim())}>
              Reject request
            </Button>
          </>
        }
      >
        <Textarea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Modal>
    </div>
  );
}
