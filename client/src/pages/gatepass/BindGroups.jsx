import { useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { ArrowRight, CheckCircle2, ChevronDown, Clock, Link2, Plus, QrCode, Send, Trash2, Unlink, Users, XCircle } from 'lucide-react';
import {
  useBindGatePassMutation,
  useCreateBindGroupMutation,
  useDeleteBindGroupMutation,
  useGetBindGroupsQuery,
  useHodReviewBindGroupMutation,
  usePrincipalReviewBindGroupMutation,
  useRejectBindMemberMutation,
  useSubmitBindGroupMutation,
  useUnbindGatePassMutation,
} from '../../services/api';
import { selectUser } from '../../features/authSlice';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '../../components/ui/primitives';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Input, Select, Textarea } from '../../components/ui/form';
import { StatusBadge } from '../../components/insights';
import { displayName, errMsg, fmtStamp, timeAgo } from '../../utils/format';

/**
 * Bulk gate-pass approval ("Bind"). The class in-charge groups parent-verified
 * requests and sends the group to the HOD; the HOD forwards or rejects it (or
 * single students); the principal approves or rejects it (or single students).
 * Every rule is enforced by the API — this screen only hides actions a role
 * cannot take.
 */

const GROUP_STATUS_LABEL = {
  open: 'Draft · with class in-charge',
  pending_hod: 'Waiting on HOD',
  pending_principal: 'Waiting on Principal',
  approved: 'Approved',
  rejected: 'Rejected',
};
const GROUP_BADGE = { open: 'neutral', pending_hod: 'warning', pending_principal: 'warning', approved: 'success', rejected: 'danger' };
const MEMBER_LABEL = {
  parent_verified: 'Parent verified',
  pending_hod: 'Waiting on HOD',
  pending_principal: 'Waiting on Principal',
};
const sameId = (a, b) => String(a?._id || a || '') === String(b?._id || b || '');
const classLine = (g) => (g.department ? `${g.department} · Year ${g.year} · Sec ${g.section}` : 'Class is set by the first student you bind');

/* ── Create a group (class in-charge) ─────────────────────────── */
function CreateGroupForm() {
  const [form, setForm] = useState({ title: '', reason: '', name: '' });
  const [create, { isLoading }] = useCreateBindGroupMutation();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.title.trim().length >= 2 && form.reason.trim().length >= 5 && form.name.trim().length >= 2;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || isLoading) return;
    try {
      await create({ title: form.title.trim(), reason: form.reason.trim(), name: form.name.trim() }).unwrap();
      toast.success('Bind group created — bind parent-verified requests from the Review tab');
      setForm({ title: '', reason: '', name: '' });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <Card>
      <CardHeader title="Create a bind group" subtitle="Group several students from your class who are leaving for the same reason, then send them to the HOD together." />
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input label="Title" placeholder="e.g. Pongal holidays" maxLength={120} value={form.title} onChange={set('title')} required />
        <Input label="Group name" placeholder="e.g. III CSE-A · Pongal batch" maxLength={80} value={form.name} onChange={set('name')} required />
        <Textarea className="md:col-span-2" label="Reason" rows={2} maxLength={500} placeholder="Why these students are leaving (5+ characters)" value={form.reason} onChange={set('reason')} required />
        <div className="md:col-span-2">
          <Button type="submit" icon={Plus} loading={isLoading} disabled={!valid}>
            Create bind group
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ── One student in a group ───────────────────────────────────── */
function MemberRow({ m, canUnbind, canReject, onUnbind, onReject, busy }) {
  const s = m.student || {};
  const waiting = m.status === 'approved' && ['queued', 'processing'].includes(m.codeIssue?.state);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-bold">{displayName(s)}</p>
        <p className="truncate text-xs muted">{s.rollNo || '—'}</p>
      </div>
      <div className="min-w-0 basis-40 text-xs">
        <p className="truncate font-semibold">{s.department || '—'}</p>
        <p className="muted">
          Year {s.year ?? '—'} · Sec {s.section || '—'}
        </p>
      </div>
      <div className="min-w-0 basis-32 text-xs">
        <p className="muted">Mobile</p>
        <p className="truncate font-semibold">{s.phone || '—'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {m.status === 'approved' && m.codeIssue?.state === 'issued' ? (
          <Badge color="success" icon={QrCode}>QR ready</Badge>
        ) : waiting ? (
          <Badge color="info" icon={Clock}>QR at {fmtStamp(m.codeIssue.scheduledAt, 'h:mm:ss a')}</Badge>
        ) : (
          <StatusBadge status={m.status} label={MEMBER_LABEL[m.status]} />
        )}
        {canUnbind && (
          <Button size="sm" variant="ghost" icon={Unlink} loading={busy} onClick={() => onUnbind(m)}>
            Unbind
          </Button>
        )}
        {canReject && (
          <Button size="sm" variant="danger" icon={XCircle} onClick={() => onReject(m)}>
            Reject
          </Button>
        )}
      </div>
      {m.status === 'rejected' && m.rejectedReason && <p className="w-full text-xs text-rose-500">“{m.rejectedReason}”</p>}
    </li>
  );
}

/* ── A group, with the actions this viewer may take ────────────── */
function BindGroupCard({ group, me, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rejecting, setRejecting] = useState(null); // { kind: 'group' } | { kind: 'member', member }
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(null); // 'submit' | 'delete' | 'forward' | 'approve'
  const [unbind, { isLoading: unbinding }] = useUnbindGatePassMutation();
  const [submit, { isLoading: submitting }] = useSubmitBindGroupMutation();
  const [remove, { isLoading: deleting }] = useDeleteBindGroupMutation();
  const [hodReview, { isLoading: hodBusy }] = useHodReviewBindGroupMutation();
  const [principalReview, { isLoading: prinBusy }] = usePrincipalReviewBindGroupMutation();
  const [rejectMember, { isLoading: memberBusy }] = useRejectBindMemberMutation();

  const isAdmin = me.role === 'admin';
  const owner = sameId(group.createdBy, me);
  const canBuild = group.status === 'open' && (owner || isAdmin);
  const canHod = group.status === 'pending_hod' && ['hod', 'admin'].includes(me.role);
  const canPrincipal = group.status === 'pending_principal' && ['principal', 'admin'].includes(me.role);
  const stageStatus = group.status; // members waiting at the group's stage share its status
  const ready = group.members.filter((m) => m.status === 'parent_verified').length;
  const waiting = group.members.filter((m) => m.status === stageStatus).length;
  const busy = submitting || deleting || hodBusy || prinBusy;

  const run = async (fn, ok) => {
    try {
      await fn();
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    }
  };

  const decide = async () => {
    const kind = confirm;
    setConfirm(null);
    if (kind === 'submit') await run(() => submit(group._id).unwrap(), 'Sent to the HOD');
    if (kind === 'delete') await run(() => remove(group._id).unwrap(), 'Bind group deleted');
    if (kind === 'forward') await run(() => hodReview({ id: group._id, action: 'forward' }).unwrap(), 'Forwarded to the Principal');
    if (kind === 'approve') await run(() => principalReview({ id: group._id, action: 'approve' }).unwrap(), 'Approved — QR codes are being generated a few at a time');
  };

  const doReject = async () => {
    const r = reason.trim() || undefined;
    const ok =
      rejecting.kind === 'member'
        ? await run(() => rejectMember({ id: group._id, passId: rejecting.member._id, reason: r }).unwrap(), 'Student rejected')
        : await run(
            () => (group.status === 'pending_hod' ? hodReview({ id: group._id, action: 'reject', reason: r }) : principalReview({ id: group._id, action: 'reject', reason: r })).unwrap(),
            'Group rejected'
          );
    if (ok) setRejecting(null);
  };

  const topActions = (canHod || canPrincipal) && (
    <div className="flex flex-wrap gap-2">
      {canHod ? (
        <Button size="sm" icon={ArrowRight} loading={hodBusy} disabled={!waiting} onClick={() => setConfirm('forward')}>
          Forward to Principal
        </Button>
      ) : (
        <Button size="sm" variant="success" icon={CheckCircle2} loading={prinBusy} disabled={!waiting} onClick={() => setConfirm('approve')}>
          Approve
        </Button>
      )}
      <Button size="sm" variant="danger" icon={XCircle} disabled={busy} onClick={() => { setReason(''); setRejecting({ kind: 'group' }); }}>
        Reject
      </Button>
    </div>
  );

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-expanded={open}>
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-600">
            <Users className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-extrabold">{group.name}</span>
              <Badge color={GROUP_BADGE[group.status]}>{GROUP_STATUS_LABEL[group.status]}</Badge>
            </span>
            <span className="mt-0.5 block text-sm">
              <span className="font-semibold">{group.title}</span> · {group.reason}
            </span>
            <span className="mt-0.5 block text-xs muted">
              {classLine(group)} · {group.counts.total} student{group.counts.total === 1 ? '' : 's'}
              {group.createdBy?.name ? ` · by ${displayName(group.createdBy)}` : ''} · {timeAgo(group.updatedAt)}
            </span>
          </span>
          <ChevronDown className={cn('ml-auto mt-1 h-4 w-4 shrink-0 transition', open && 'rotate-180')} />
        </button>
        {topActions}
      </div>

      {group.status === 'approved' && (
        <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <QrCode className="h-4 w-4" /> QR codes ready: {group.counts.codesIssued} / {group.counts.approved}
          {group.counts.codesWaiting > 0 && <span className="muted">· {group.counts.codesWaiting} being generated, a few at a time</span>}
        </p>
      )}
      {group.status === 'rejected' && group.rejectedReason && <p className="text-xs text-rose-500">Rejected: “{group.rejectedReason}”</p>}

      {open && (
        group.members.length ? (
          <ul className="divide-y divide-white/60 dark:divide-white/5">
            {group.members.map((m) => (
              <MemberRow
                key={m._id}
                m={m}
                busy={unbinding}
                canUnbind={canBuild}
                canReject={(canHod || canPrincipal) && m.status === stageStatus}
                onUnbind={(x) => run(() => unbind(x._id).unwrap(), 'Removed from the group')}
                onReject={(x) => { setReason(''); setRejecting({ kind: 'member', member: x }); }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm muted">
            No students yet. In the <span className="font-semibold">Review</span> tab, verify a student’s parent OTP, then press <span className="font-semibold">Bind</span>.
          </p>
        )
      )}

      {canBuild && (
        <div className="flex flex-wrap gap-2 border-t border-white/60 pt-3 dark:border-white/5">
          <Button icon={Send} loading={submitting} disabled={!ready} onClick={() => setConfirm('submit')}>
            Confirm &amp; send to HOD{ready ? ` (${ready})` : ''}
          </Button>
          <Button variant="ghost" icon={Trash2} loading={deleting} onClick={() => setConfirm('delete')}>
            Delete group
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={
          { submit: 'Send this group to the HOD?', delete: 'Delete this bind group?', forward: 'Forward this group to the Principal?', approve: 'Approve every student in this group?' }[confirm] || ''
        }
        text={
          {
            submit: `${ready} parent-verified student(s) move to the HOD together. You cannot add students afterwards.`,
            delete: 'The group is removed and its requests go back to your Review queue.',
            forward: `${waiting} student(s) go to the Principal.`,
            approve: `${waiting} student(s) are approved. Their QR codes are generated a few at a time; each student sees when theirs will be ready.`,
          }[confirm] || ''
        }
        confirmText={{ submit: 'Send to HOD', delete: 'Delete', forward: 'Forward', approve: 'Approve' }[confirm] || 'OK'}
        danger={confirm === 'delete'}
        loading={busy}
        onConfirm={decide}
      />
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={rejecting?.kind === 'member' ? 'Reject this student' : 'Reject the entire group'}
        subtitle={rejecting?.kind === 'member' ? displayName(rejecting.member.student) : `${group.name} · ${waiting} student(s)`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={memberBusy || hodBusy || prinBusy} onClick={doReject}>
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

/* ── The Bind tab ─────────────────────────────────────────────── */
export function BindPanel() {
  const me = useSelector(selectUser);
  const { data: groups, isLoading, error, refetch } = useGetBindGroupsQuery();
  const isFaculty = me.role === 'faculty' || me.role === 'admin';
  const actionable = (g) =>
    (g.status === 'open' && (sameId(g.createdBy, me) || me.role === 'admin')) ||
    (g.status === 'pending_hod' && ['hod', 'admin'].includes(me.role)) ||
    (g.status === 'pending_principal' && ['principal', 'admin'].includes(me.role));

  const list = groups || [];
  const pending = list.filter(actionable);
  const rest = list.filter((g) => !actionable(g));

  return (
    <div className="space-y-4">
      {me.role === 'faculty' && <CreateGroupForm />}
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={Link2}
            title="No bind groups"
            text={isFaculty ? 'Create a group above, then bind parent-verified requests to it from the Review tab.' : 'Groups sent to you appear here.'}
          />
        </Card>
      ) : (
        <>
          {pending.map((g) => (
            // The principal sees name / class / count first and opens a group to see its students.
            <BindGroupCard key={g._id} group={g} me={me} defaultOpen={me.role !== 'principal'} />
          ))}
          {rest.length > 0 && (
            <>
              <h3 className="pt-2 text-xs font-bold uppercase tracking-wider text-ink-muted">Earlier groups</h3>
              {rest.map((g) => (
                <BindGroupCard key={g._id} group={g} me={me} defaultOpen={false} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Review card: put a parent-verified request into a group ─────── */
export function BindButton({ pass, onDone }) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const { data: groups } = useGetBindGroupsQuery({ status: 'open' }, { skip: !open });
  const [bind, { isLoading }] = useBindGatePassMutation();
  const [unbind, { isLoading: unbinding }] = useUnbindGatePassMutation();

  if (pass.bindGroup) {
    return (
      <>
        <Badge color="info" icon={Link2}>In group: {pass.bindGroup.name || 'bind group'}</Badge>
        <Button
          size="sm"
          variant="ghost"
          icon={Unlink}
          loading={unbinding}
          onClick={async () => {
            try {
              await unbind(pass._id).unwrap();
              toast.success('Removed from the group');
              onDone?.();
            } catch (err) {
              toast.error(errMsg(err));
            }
          }}
        >
          Unbind
        </Button>
      </>
    );
  }

  const options = (groups || []).map((g) => ({ value: g._id, label: `${g.name} — ${g.title} (${g.counts.total})` }));
  return (
    <>
      <Button size="sm" variant="soft" icon={Link2} onClick={() => { setGroupId(''); setOpen(true); }}>
        Bind
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Bind to a group"
        subtitle={displayName(pass.student)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              icon={Link2}
              loading={isLoading}
              disabled={!groupId}
              onClick={async () => {
                try {
                  await bind({ id: pass._id, groupId }).unwrap();
                  toast.success('Added to the group');
                  setOpen(false);
                  onDone?.();
                } catch (err) {
                  toast.error(errMsg(err));
                }
              }}
            >
              Bind
            </Button>
          </>
        }
      >
        {groups && !options.length ? (
          <p className="text-sm muted">
            You have no open bind groups. Create one in the <span className="font-semibold">Bind</span> tab first.
          </p>
        ) : (
          <Select keepCase label="Group" placeholder="Choose a group" options={options} value={groupId} onChange={(e) => setGroupId(e.target.value)} />
        )}
      </Modal>
    </>
  );
}
