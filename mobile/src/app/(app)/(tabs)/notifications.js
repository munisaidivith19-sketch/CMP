import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, CheckCheck } from 'lucide-react-native';
import { Button, EmptyState, ErrorState, Header, Loading, Screen, T } from '../../../components/ui';
import { useGetNotificationsQuery, useMarkAllNotificationsReadMutation, useMarkNotificationReadMutation } from '../../../services/api';
import { colors } from '../../../theme';
import { timeAgo } from '../../../utils/format';

export default function Notifications() {
  const { data, isLoading, isFetching, error, refetch } = useGetNotificationsQuery({ limit: 50 });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();

  const open = (n) => {
    if (!n.read) markRead(n._id);
    if (n.link) router.push(n.link);
  };

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Header title="Notifications" subtitle={data?.unread ? `${data.unread} unread` : 'You’re all caught up'} right={data?.unread ? <Button small variant="soft" icon={CheckCheck} title="Read all" loading={marking} onPress={() => markAll()} /> : null} />
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
          keyExtractor={(n) => n._id}
          refreshing={isFetching}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={Bell} title="No notifications yet" text="Announcements, events, gate pass updates and more show up here." />}
          renderItem={({ item: n }) => (
            <Pressable onPress={() => open(n)} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 22, backgroundColor: n.read ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.95)', borderWidth: 1, borderColor: colors.border }}>
              <View style={{ width: 8, height: 8, borderRadius: 8, marginTop: 6, backgroundColor: n.read ? 'transparent' : colors.primary }} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong">{n.title}</T>
                {n.message ? <T v="small">{n.message}</T> : null}
                <T v="small" style={{ color: colors.muted }}>
                  {timeAgo(n.createdAt)}
                </T>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
