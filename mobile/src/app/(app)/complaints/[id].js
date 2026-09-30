import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, Clock, EyeOff, FileText, XCircle } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, ErrorState, Header, Input, Loading, Screen, SectionTitle, StatusBadge, T } from '../../../components/ui';
import {
  errMsg,
  useAuthorityUpdateComplaintMutation,
  useCancelComplaintMutation,
  useGetComplaintQuery,
  useMarkComplaintNotResolvedMutation,
  useMarkComplaintResolvedMutation,
} from '../../../services/api';
import { assetUrl } from '../../../config';
import { selectUser } from '../../../store/authSlice';
import { COMPLAINT_CATEGORY_LABELS, ROLE_LABELS, colors } from '../../../theme';
import { fmtDateTime, sameId, timeAgo, titleCase } from '../../../utils/format';

const CANCELLABLE = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS'];
const ESCALATABLE = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED'];
const CONFIRMABLE = ['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'];
const AUTHORITY_STATUSES = [
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
];

function Countdown({ target }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(target).getTime() - Date.now();
  if (!target || ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Clock size={13} color={colors.soft} />
      <T v="small">
        Escalation available in {h}h {m}m
      </T>
    </View>
  );
}

function historyLabel(h) {
  switch (h.action) {
    case 'submitted':
      return `Complaint submitted · assigned to ${titleCase(h.newAuthority)}`;
    case 'authority_update':
      return `${titleCase(h.actorRole)} updated status to ${titleCase(String(h.newStatus || '').toLowerCase())}${h.comment ? ` — “${h.comment}”` : ''}`;
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
}

function Timeline({ history }) {
  if (!history?.length) return <T v="small">No history yet.</T>;
  return (
    <View style={{ gap: 12 }}>
      {history.map((h, i) => {
        const done = ['resolved', 'closed'].includes(h.action);
        const bad = ['not_resolved', 'cancelled'].includes(h.action);
        const Icon = done ? CheckCircle2 : bad ? XCircle : Clock;
        const tint = done ? colors.success : bad ? colors.danger : colors.primary;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={15} color={tint} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="strong" style={{ fontSize: 13 }}>
                {historyLabel(h)}
              </T>
              <T v="small">{timeAgo(h.timestamp)}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function ComplaintDetail() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: c, isLoading, error, refetch, isFetching } = useGetComplaintQuery(id);
  const [cancel, { isLoading: cancelling }] = useCancelComplaintMutation();
  const [notResolved, { isLoading: escalating }] = useMarkComplaintNotResolvedMutation();
  const [resolved, { isLoading: closing }] = useMarkComplaintResolvedMutation();
  const [authorityUpdate, { isLoading: updating }] = useAuthorityUpdateComplaintMutation();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('IN_REVIEW');
  const [comment, setComment] = useState('');

  const run = async (fn, success) => {
    try {
      await fn();
      if (success) Alert.alert(success);
      return true;
    } catch (e) {
      Alert.alert('Something went wrong', errMsg(e));
      return false;
    }
  };

  if (isLoading || error || !c) {
    return (
      <Screen>
        <Header back title="Complaint" />
        {isLoading ? <Loading /> : <ErrorState error={error} onRetry={refetch} />}
      </Screen>
    );
  }

  const isOwner = sameId(c.student, me);
  const isAuthority = sameId(c.currentAuthorityUserId, me) || me.role === 'admin';
  const canEscalate = c.notResolvedAvailableAt && Date.now() >= new Date(c.notResolvedAvailableAt).getTime();

  const confirmCancel = () =>
    Alert.alert('Cancel this complaint?', 'This withdraws the complaint immediately.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel complaint',
        style: 'destructive',
        onPress: async () => {
          if (await run(() => cancel(c._id).unwrap(), 'Complaint cancelled')) router.back();
        },
      },
    ]);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title={COMPLAINT_CATEGORY_LABELS[c.category] || titleCase(c.category)} subtitle={c.complaintCode} right={<StatusBadge status={c.status} />} />

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {c.subCategory ? <Badge label={titleCase(c.subCategory)} color="neutral" /> : null}
          <Badge label={`Assigned to ${ROLE_LABELS[c.currentAuthorityRole] || titleCase(c.currentAuthorityRole)}`} color="primary" />
          <Badge label={`Escalation level ${c.escalationLevel}`} color="info" />
          {c.anonymous ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.neutralSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <EyeOff size={12} color="#475569" />
              <T v="small" style={{ color: '#475569', fontSize: 11 }}>
                Anonymous
              </T>
            </View>
          ) : null}
        </View>

        {c.identityHidden === false && c.student && !isOwner ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 16, padding: 10 }}>
            <Avatar user={c.student} size={36} />
            <View>
              <T v="strong">{c.student.name}</T>
              <T v="small">
                {c.student.rollNo} · {c.student.department}
              </T>
            </View>
          </View>
        ) : null}

        <T v="body">{c.description}</T>

        {c.attachments?.length ? (
          <View style={{ gap: 6 }}>
            <T v="label">Supporting files</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.attachments.map((a) => (
                <Pressable
                  key={a.url}
                  onPress={() => Linking.openURL(assetUrl(a.url)).catch(() => Alert.alert('Cannot open this file'))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}
                  accessibilityRole="link"
                >
                  <FileText size={13} color={colors.primary600} />
                  <T v="small" numberOfLines={1} style={{ color: colors.primary600, maxWidth: 180 }}>
                    {a.name || 'File'}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <T v="small" style={{ color: colors.muted }}>
          Submitted {fmtDateTime(c.createdAt)} · Last updated {timeAgo(c.updatedAt)}
        </T>

        {isOwner ? (
          <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CANCELLABLE.includes(c.status) ? <Button small variant="danger" title="Cancel" loading={cancelling} onPress={confirmCancel} /> : null}
              {ESCALATABLE.includes(c.status) ? (
                <Button
                  small
                  variant="outline"
                  title="Not resolved"
                  disabled={!canEscalate}
                  loading={escalating}
                  onPress={() => run(() => notResolved(c._id).unwrap(), 'Escalated to the next authority')}
                />
              ) : null}
              {CONFIRMABLE.includes(c.status) ? (
                <Button small variant="success" title="Resolved" loading={closing} onPress={() => run(() => resolved(c._id).unwrap(), 'Marked as resolved — thanks for confirming')} />
              ) : null}
            </View>
            {ESCALATABLE.includes(c.status) && !canEscalate ? <Countdown target={c.notResolvedAvailableAt} /> : null}
          </View>
        ) : null}

        {isAuthority && !isOwner && !['CANCELLED', 'CLOSED'].includes(c.status) ? (
          <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingTop: 12 }}>
            {editing ? (
              <>
                <T v="h3">Update complaint status</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {AUTHORITY_STATUSES.map((s) => (
                    <Chip key={s.value} label={s.label} active={status === s.value} onPress={() => setStatus(s.value)} />
                  ))}
                </View>
                <Input label="Comment (shared with the student)" value={comment} onChangeText={setComment} multiline maxLength={500} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button small variant="ghost" title="Cancel" onPress={() => setEditing(false)} />
                  <Button
                    small
                    title="Save"
                    loading={updating}
                    onPress={async () => {
                      const ok = await run(
                        () => authorityUpdate({ id: c._id, status, comment: comment.trim() || undefined }).unwrap(),
                        'Status updated — the student has been notified'
                      );
                      if (ok) setEditing(false);
                    }}
                  />
                </View>
              </>
            ) : (
              <Button
                small
                title="Update status"
                style={{ alignSelf: 'flex-start' }}
                onPress={() => {
                  setStatus('IN_REVIEW');
                  setComment('');
                  setEditing(true);
                }}
              />
            )}
          </View>
        ) : null}
      </Card>

      <SectionTitle title="Timeline" />
      <Card>
        <Timeline history={c.history} />
      </Card>
    </Screen>
  );
}
