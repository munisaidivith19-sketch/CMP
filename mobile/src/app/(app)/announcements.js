import { useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { useSelector } from 'react-redux';
import { Megaphone, Pin, PinOff, Plus, Trash2 } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, IconButton, Loading, Screen, T } from '../../components/ui';
import { errMsg, useDeleteAnnouncementMutation, useGetAnnouncementsQuery, useTogglePinAnnouncementMutation } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { colors } from '../../theme';
import { fmtDateTime, sameId, timeAgo, displayName } from '../../utils/format';
import FullImage from '../../components/FullImage';
import AnnouncementForm, { canPostAnnouncements } from '../../components/AnnouncementForm';

export default function Announcements() {
  const me = useSelector(selectUser);
  const [composing, setComposing] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useGetAnnouncementsQuery({ limit: 40 });
  const [togglePin] = useTogglePinAnnouncementMutation();
  const [remove] = useDeleteAnnouncementMutation();
  // Same rules as the API: admin / principal pin anything, others only their own; admin or author deletes.
  const canPin = (a) => ['admin', 'principal'].includes(me.role) || (['faculty', 'hod'].includes(me.role) && sameId(a.author, me));
  const canDelete = (a) => me.role === 'admin' || sameId(a.author, me);

  const confirmDelete = (a) =>
    Alert.alert('Delete this announcement?', a.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(a._id).unwrap().catch((e) => Alert.alert('Could not delete', errMsg(e))) },
    ]);

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16 }}>
        <Header back title="Announcements" subtitle="Only what’s addressed to you." right={canPostAnnouncements(me) ? <Button small icon={Plus} title="Post" onPress={() => setComposing(true)} /> : null} />
      </View>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <View style={{ padding: 16 }}>
          <ErrorState error={error} onRetry={refetch} />
        </View>
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(a) => a._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={Megaphone} title="No announcements yet" />}
          renderItem={({ item: a }) => (
            <Card style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {a.isPinned ? <Pin size={14} color={colors.primary} /> : null}
                <T v="h3" style={{ flex: 1 }}>
                  {a.title}
                </T>
                {a.priority !== 'normal' ? <Badge label={a.priority} color={a.priority === 'urgent' ? 'danger' : 'warning'} /> : null}
              </View>
              <T v="body">{a.content}</T>
              {a.image ? <FullImage uri={a.image} /> : null}
              {a.deadline ? <T v="small" style={{ color: colors.danger }}>Deadline: {fmtDateTime(a.deadline)}</T> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar user={a.author} size={26} />
                <T v="small" style={{ flex: 1 }}>
                  {displayName(a.author)} · {timeAgo(a.createdAt)}
                </T>
                {canPin(a) ? (
                  <IconButton icon={a.isPinned ? PinOff : Pin} label={a.isPinned ? 'Unpin' : 'Pin'} onPress={() => togglePin(a._id).unwrap().catch((e) => Alert.alert('Could not update', errMsg(e)))} />
                ) : null}
                {canDelete(a) ? <IconButton icon={Trash2} label="Delete" color={colors.danger} onPress={() => confirmDelete(a)} /> : null}
              </View>
            </Card>
          )}
        />
      )}
      <AnnouncementForm open={composing} onClose={() => setComposing(false)} />
    </Screen>
  );
}
