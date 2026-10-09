import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { ChevronDown, ChevronUp, Link2, Plus, Send, Trash2, Unlink, Users } from 'lucide-react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, SectionTitle, StatusBadge, T } from './ui';
import ReasonSheet from './ReasonSheet';
import {
  errMsg,
  useBindGatePassMutation,
  useCreateBindGroupMutation,
  useDeleteBindGroupMutation,
  useGetBindGroupsQuery,
  useHodReviewBindGroupMutation,
  usePrincipalReviewBindGroupMutation,
  useRejectBindMemberMutation,
  useSubmitBindGroupMutation,
  useUnbindGatePassMutation,
} from '../services/api';
import { selectUser } from '../store/authSlice';
import { colors } from '../theme';
import { displayName, fmtDateTime, sameId, timeAgo } from '../utils/format';

/**
 * Bulk gate-pass approval ("Bind"), same workflow as the web: the class
 * in-charge groups parent-verified requests and sends them to the HOD, who
 * forwards (or rejects) them to the principal. Every rule is enforced by the
 * API — this only hides actions a role cannot take.
 */
const GROUP_LABEL = { open: 'Draft', pending_hod: 'Waiting on HOD', pending_principal: 'Waiting on principal', approved: 'Approved', rejected: 'Rejected' };
const GROUP_COLOR = { open: 'neutral', pending_hod: 'warning', pending_principal: 'warning', approved: 'success', rejected: 'danger' };
const MEMBER_LABEL = { parent_verified: 'parent verified', pending_hod: 'waiting: HOD', pending_principal: 'waiting: principal' };
const classLine = (g) => (g.department ? `${g.department} · Year ${g.year} · Sec ${g.section}` : 'Class is set by the first student you bind');

const confirmThen = (title, message, okText, fn, destructive) =>
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: okText, style: destructive ? 'destructive' : 'default', onPress: fn },
  ]);

function CreateGroupForm() {
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [create, { isLoading }] = useCreateBindGroupMutation();
  const valid = title.trim().length >= 2 && name.trim().length >= 2 && reason.trim().length >= 5;
  const submit = async () => {
    try {
      await create({ title: title.trim(), name: name.trim(), reason: reason.trim() }).unwrap();
      setTitle('');
      setName('');
      setReason('');
      Alert.alert('Bind group created', 'Bind parent-verified requests to it from the Review tab.');
    } catch (e) {
      Alert.alert('Could not create', errMsg(e));
    }
  };
  return (
    <Card style={{ gap: 10 }}>
      <T v="h3">Create a bind group</T>
      <T v="small">Group students from your class leaving for the same reason and send them to the HOD together.</T>
      <Input label="Title" value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Pongal holidays" />
      <Input label="Group name" value={name} onChangeText={setName} maxLength={80} placeholder="e.g. III CSE-A · Pongal batch" />
      <Input label="Reason" value={reason} onChangeText={setReason} maxLength={500} multiline placeholder="Why these students are leaving (5+ characters)" />
      <Button title="Create bind group" icon={Plus} loading={isLoading} disabled={!valid} onPress={submit} />
    </Card>
  );
}

function GroupCard({ group, me, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rejecting, setRejecting] = useState(null); // { kind: 'group' } | { kind: 'member', member }
  const [unbind, { isLoading: unbinding }] = useUnbindGatePassMutation();
  const [submit, { isLoading: submitting }] = useSubmitBindGroupMutation();
  const [remove, { isLoading: deleting }] = useDeleteBindGroupMutation();
  const [hodReview, { isLoading: hodBusy }] = useHodReviewBindGroupMutation();
  const [principalReview, { isLoading: prinBusy }] = usePrincipalReviewBindGroupMutation();
  const [rejectMember, { isLoading: memberBusy }] = useRejectBindMemberMutation();

  const isAdmin = me.role === 'admin';
  const canBuild = group.status === 'open' && (sameId(group.createdBy, me) || isAdmin);
  const canHod = group.status === 'pending_hod' && ['hod', 'admin'].includes(me.role);
  const canPrincipal = group.status === 'pending_principal' && ['principal', 'admin'].includes(me.role);
  const ready = group.members.filter((m) => m.status === 'parent_verified').length;
  const waiting = group.members.filter((m) => m.status === group.status).length;
  const busy = submitting || deleting || hodBusy || prinBusy || memberBusy;

  const run = async (fn, ok) => {
    try {
      await fn();
      if (ok) Alert.alert(ok);
      return true;
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
      return false;
    }
  };

  const doReject = async (reason) => {
    const r = reason || undefined;
    const ok =
      rejecting.kind === 'member'
        ? await run(() => rejectMember({ id: group._id, passId: rejecting.member._id, reason: r }).unwrap(), 'Student rejected')
        : await run(() => (group.status === 'pending_hod' ? hodReview({ id: group._id, action: 'reject', reason: r }) : principalReview({ id: group._id, action: 'reject', reason: r })).unwrap(), 'Group rejected');
    if (ok) setRejecting(null);
  };

  return (
    <Card style={{ gap: 10 }}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', gap: 10 }}>
        <Users size={20} color={colors.primary} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="strong">{group.name}</T>
          <Badge label={GROUP_LABEL[group.status]} color={GROUP_COLOR[group.status]} />
          <T v="small">
            <T v="strong">{group.title}</T> · {group.reason}
          </T>
          <T v="small" style={{ color: colors.muted }}>
            {classLine(group)} · {group.counts.total} student{group.counts.total === 1 ? '' : 's'}
            {group.createdBy?.name ? ` · by ${displayName(group.createdBy)}` : ''} · {timeAgo(group.updatedAt)}
          </T>
        </View>
        {open ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
      </Pressable>

      {group.status === 'approved' ? (
        <T v="small" style={{ color: '#059669' }}>
          QR codes ready: {group.counts.codesIssued} / {group.counts.approved}
          {group.counts.codesWaiting > 0 ? ` · ${group.counts.codesWaiting} being generated` : ''}
        </T>
      ) : null}
      {group.status === 'rejected' && group.rejectedReason ? <T v="small" style={{ color: colors.danger }}>Rejected: “{group.rejectedReason}”</T> : null}

      {open
        ? group.members.length
          ? group.members.map((m) => {
              const s = m.student || {};
              const queued = m.status === 'approved' && ['queued', 'processing'].includes(m.codeIssue?.state);
              return (
                <View key={m._id} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="strong" numberOfLines={1}>{displayName(s)}</T>
                      <T v="small" numberOfLines={1}>
                        {s.rollNo || '—'} · {s.department || '—'} · Y{s.year ?? '—'} · Sec {s.section || '—'}
                      </T>
                    </View>
                    {m.status === 'approved' && m.codeIssue?.state === 'issued' ? (
                      <Badge label="QR ready" color="success" />
                    ) : queued ? (
                      <Badge label={`QR at ${fmtDateTime(m.codeIssue.scheduledAt)}`} color="info" />
                    ) : (
                      <StatusBadge status={m.status} label={MEMBER_LABEL[m.status]} />
                    )}
                  </View>
                  {m.status === 'rejected' && m.rejectedReason ? <T v="small" style={{ color: colors.danger }}>“{m.rejectedReason}”</T> : null}
                  {canBuild ? <Button title="Unbind" icon={Unlink} variant="ghost" small loading={unbinding} onPress={() => run(() => unbind(m._id).unwrap())} style={{ alignSelf: 'flex-start' }} /> : null}
                  {(canHod || canPrincipal) && m.status === group.status ? (
                    <Button title="Reject student" variant="danger" small onPress={() => setRejecting({ kind: 'member', member: m })} style={{ alignSelf: 'flex-start' }} />
                  ) : null}
                </View>
              );
            })
          : <T v="small">No students yet. In the Review tab, verify a student’s parent OTP, then tap Bind.</T>
        : null}

      {canBuild ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            title={`Send to HOD${ready ? ` (${ready})` : ''}`}
            icon={Send}
            small
            style={{ flex: 1 }}
            disabled={!ready}
            loading={submitting}
            onPress={() => confirmThen('Send this group to the HOD?', `${ready} parent-verified student(s) move to the HOD together. You cannot add students afterwards.`, 'Send', () => run(() => submit(group._id).unwrap(), 'Sent to the HOD'))}
          />
          <Button
            title="Delete"
            icon={Trash2}
            variant="danger"
            small
            loading={deleting}
            onPress={() => confirmThen('Delete this bind group?', 'Its requests go back to your Review queue.', 'Delete', () => run(() => remove(group._id).unwrap(), 'Bind group deleted'), true)}
          />
        </View>
      ) : null}
      {canHod || canPrincipal ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canHod ? (
            <Button title="Forward to Principal" small style={{ flex: 1 }} disabled={!waiting || busy} loading={hodBusy} onPress={() => confirmThen('Forward this group?', `${waiting} student(s) go to the principal.`, 'Forward', () => run(() => hodReview({ id: group._id, action: 'forward' }).unwrap(), 'Forwarded to the principal'))} />
          ) : (
            <Button title="Approve all" variant="success" small style={{ flex: 1 }} disabled={!waiting || busy} loading={prinBusy} onPress={() => confirmThen('Approve every student in this group?', `${waiting} student(s) are approved. QR codes are generated a few at a time.`, 'Approve', () => run(() => principalReview({ id: group._id, action: 'approve' }).unwrap(), 'Approved'))} />
          )}
          <Button title="Reject group" variant="danger" small style={{ flex: 1 }} disabled={busy} onPress={() => setRejecting({ kind: 'group' })} />
        </View>
      ) : null}

      <ReasonSheet
        open={Boolean(rejecting)}
        title={rejecting?.kind === 'member' ? 'Reject this student' : 'Reject the entire group'}
        subtitle={rejecting?.kind === 'member' ? displayName(rejecting.member.student) : `${group.name} · ${waiting} student(s)`}
        label="Reason (shared with the student)"
        confirmText="Reject"
        loading={busy}
        onClose={() => setRejecting(null)}
        onConfirm={doReject}
      />
    </Card>
  );
}

/** The Bind tab for faculty, HOD, principal and admin. */
export function BindPanel() {
  const me = useSelector(selectUser);
  const { data: groups, isLoading, error, refetch } = useGetBindGroupsQuery();
  const actionable = (g) =>
    (g.status === 'open' && (sameId(g.createdBy, me) || me.role === 'admin')) ||
    (g.status === 'pending_hod' && ['hod', 'admin'].includes(me.role)) ||
    (g.status === 'pending_principal' && ['principal', 'admin'].includes(me.role));
  const list = groups || [];
  const pending = list.filter(actionable);
  const rest = list.filter((g) => !actionable(g));

  return (
    <View style={{ gap: 12 }}>
      {me.role === 'faculty' ? <CreateGroupForm /> : null}
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !list.length ? (
        <Card>
          <EmptyState icon={Link2} title="No bind groups" text={me.role === 'faculty' ? 'Create a group, then bind parent-verified requests to it from the Review tab.' : 'Groups sent to you appear here.'} />
        </Card>
      ) : (
        <>
          {pending.map((g) => (
            <GroupCard key={g._id} group={g} me={me} defaultOpen={me.role !== 'principal'} />
          ))}
          {rest.length ? <SectionTitle title="Earlier groups" /> : null}
          {rest.map((g) => (
            <GroupCard key={g._id} group={g} me={me} defaultOpen={false} />
          ))}
        </>
      )}
    </View>
  );
}

/** Review card: put a parent-verified request into one of my open groups. */
export function BindButton({ pass, onDone }) {
  const [open, setOpen] = useState(false);
  const { data: groups, isLoading: loadingGroups } = useGetBindGroupsQuery({ status: 'open' }, { skip: !open });
  const [bind, { isLoading }] = useBindGatePassMutation();
  const [unbind, { isLoading: unbinding }] = useUnbindGatePassMutation();

  if (pass.bindGroup) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge label={`In group: ${pass.bindGroup.name || 'bind group'}`} color="info" />
        <Button
          title="Unbind"
          icon={Unlink}
          variant="ghost"
          small
          loading={unbinding}
          onPress={async () => {
            try {
              await unbind(pass._id).unwrap();
              onDone?.();
            } catch (e) {
              Alert.alert('Could not unbind', errMsg(e));
            }
          }}
        />
      </View>
    );
  }

  const choose = async (groupId) => {
    try {
      await bind({ id: pass._id, groupId }).unwrap();
      setOpen(false);
      onDone?.();
    } catch (e) {
      Alert.alert('Could not bind', errMsg(e));
    }
  };

  return (
    <>
      <Button title="Bind" icon={Link2} variant="soft" small onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.35)' }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 10 }}>
          <T v="h2">Bind to a group</T>
          <T v="small">{displayName(pass.student)}</T>
          {loadingGroups ? (
            <Loading />
          ) : !groups?.length ? (
            <T v="small">You have no open bind groups. Create one in the Bind tab first.</T>
          ) : (
            groups.map((g) => (
              <Button key={g._id} title={`${g.name} — ${g.title} (${g.counts.total})`} variant="outline" loading={isLoading} onPress={() => choose(g._id)} />
            ))
          )}
          <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}
