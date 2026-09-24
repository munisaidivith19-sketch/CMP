import { FlatList, View } from 'react-native';
import { Megaphone, Pin } from 'lucide-react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Header, Loading, Screen, T } from '../../components/ui';
import { useGetAnnouncementsQuery } from '../../services/api';
import { colors } from '../../theme';
import { fmtDateTime, timeAgo } from '../../utils/format';

export default function Announcements() {
  const { data, isLoading, isFetching, error, refetch } = useGetAnnouncementsQuery({ limit: 40 });
  return (
    <Screen scroll={false}>
      <View style={{ padding: 16 }}>
        <Header back title="Announcements" subtitle="Only what’s addressed to you." />
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
              {a.deadline ? <T v="small" style={{ color: colors.danger }}>Deadline: {fmtDateTime(a.deadline)}</T> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar user={a.author} size={26} />
                <T v="small">
                  {a.author?.name} · {timeAgo(a.createdAt)}
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
