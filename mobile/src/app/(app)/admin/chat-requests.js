import { useState } from 'react';
import { Alert, Modal, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { Check, UsersRound, X } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useGetGroupRequestsQuery, useReviewGroupRequestMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { ROLE_LABELS, STUDENT_ROLES, colors } from '../../../theme';
import { sameId, timeAgo } from '../../../utils/format';

const CATEGORY_LABEL = { custom: 'Custom', academic: 'Academics', faculty: 'Faculty' };
const REVIEWERS = ['admin', 'principal'];

/**
 * Approve or reject group requests: the admin reviews faculty class groups,
 * the principal reviews the groups HODs ask to create (with their reason).
 */
export default function ChatRequests() {
  const me = useSelector(selectUser);
  const isPrincipal = me.role === 'principal';
  const { data = [], isLoading, isFetching, error, refetch } = useGetGroupRequestsQuery(undefined, { skip: !REVIEWERS.includes(me.role) });
  const [review, { isLoading: saving }] = useReviewGroupRequestMutation();
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  if (!REVIEWERS.includes(me.role)) {
    return (
      <Screen>
        <Header back title="Group requests" />
        <Card>
          <EmptyState icon={UsersRound} title="For the admin and principal" text="Your group requests are listed on the Messages tab." />
        </Card>
      </Screen>
    );
  }

  const act = async (id, action, why) => {
    try {
      await review({ id, action, ...(why ? { reason: why } : {}) }).unwrap();
      setRejecting(null);
      setReason('');
      Alert.alert(action === 'approve' ? 'Group approved' : 'Request rejected', action === 'approve' ? 'Members have been notified.' : 'The requester has been told.');
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
    }
  };

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Group requests" subtitle={isPrincipal ? 'Groups HODs want to create — check who is in them and why.' : 'Faculty class groups go live after you approve them.'} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data.length ? (
        <Card>
          <EmptyState icon={UsersRound} title="No pending requests" text="New requests appear here and in your notifications." />
        </Card>
      ) : (
        data.map((r) => {
          const members = r.participants.filter((p) => !sameId(p, r.createdBy));
          const students = members.filter((m) => STUDENT_ROLES.includes(m.role));
          const sections = [...new Set(students.map((m) => m.section).filter(Boolean))];
          return (
            <Card key={r._id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={r.createdBy} size={40} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>
                    {r.name}
                  </T>
                  <T v="small" numberOfLines={1}>
                    {r.createdBy?.name} · {ROLE_LABELS[r.createdBy?.role]} · {timeAgo(r.createdAt)}
                  </T>
                </View>
                <Badge label="pending" color="warning" />
              </View>
              {r.category ? (
                <T v="small" style={{ color: colors.primary }}>
                  {CATEGORY_LABEL[r.category]} group{r.linkedYear ? ` · Year ${r.linkedYear} Sec ${r.linkedSection}` : ''}
                </T>
              ) : null}
              {r.reason ? <T>Reason: {r.reason}</T> : null}
              <T v="small">
                {members.length} member{members.length === 1 ? '' : 's'}
                {students.length ? ` · ${students.length} students` : ''}
                {sections.length ? ` · Sec ${sections.join(', ')}` : ''}
              </T>
              <T v="small">
                {members.map((m) => [m.name, ROLE_LABELS[m.role], m.rollNo, m.section && `Sec ${m.section}`].filter(Boolean).join(' · ')).join('\n')}
              </T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Reject" icon={X} variant="danger" small style={{ flex: 1 }} disabled={saving} onPress={() => setRejecting(r)} />
                <Button title="Approve" icon={Check} variant="success" small style={{ flex: 1 }} loading={saving && !rejecting} onPress={() => act(r._id, 'approve')} />
              </View>
            </Card>
          );
        })
      )}

      <Modal visible={Boolean(rejecting)} transparent animationType="slide" onRequestClose={() => setRejecting(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(27,29,58,0.35)' }} onPress={() => setRejecting(null)} />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 }}>
          <T v="h2">Reject “{rejecting?.name}”?</T>
          <Input label="Reason (optional)" value={reason} onChangeText={setReason} multiline maxLength={300} />
          <Button title="Reject request" variant="danger" loading={saving} onPress={() => act(rejecting._id, 'reject', reason.trim())} />
          <Button title="Cancel" variant="ghost" onPress={() => setRejecting(null)} />
        </View>
      </Modal>
    </Screen>
  );
}
