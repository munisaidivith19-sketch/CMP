import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { MessageSquare, MessagesSquare, Plus, ThumbsUp } from 'lucide-react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { useGetDiscussionsQuery } from '../../../services/api';
import { colors } from '../../../theme';
import { timeAgo } from '../../../utils/format';

export default function Discussions() {
  const [q, setQ] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useGetDiscussionsQuery({ q: q || undefined, limit: 30 });
  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title="Discussions" subtitle="Ask, answer and share." right={<Button small icon={Plus} title="New" onPress={() => router.push('/discussions/new')} />} />
        <Input placeholder="Search discussions" value={q} onChangeText={setQ} />
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
          keyExtractor={(d) => d._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={MessagesSquare} title="No discussions yet" />}
          renderItem={({ item: d }) => (
            <Card onPress={() => router.push(`/discussions/${d._id}`)} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Badge label={d.category} color="neutral" />
                {d.isPinned ? <Badge label="Pinned" /> : null}
              </View>
              <T v="strong">{d.title}</T>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                  <ThumbsUp size={13} color={colors.soft} />
                  <T v="small">{d.upvoteCount ?? 0}</T>
                </View>
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                  <MessageSquare size={13} color={colors.soft} />
                  <T v="small">{d.replyCount ?? 0}</T>
                </View>
                <T v="small" style={{ color: colors.muted }}>
                  {d.author?.name} · {timeAgo(d.lastActivityAt || d.createdAt)}
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
