import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { Shapes } from 'lucide-react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, T } from '../../../components/ui';
import { useGetClubsQuery } from '../../../services/api';
import { titleCase } from '../../../utils/format';

export default function Clubs() {
  const [q, setQ] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useGetClubsQuery({ q: q || undefined, limit: 40 });
  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title="Clubs" subtitle="Find your people." />
        <Input placeholder="Search clubs" value={q} onChangeText={setQ} />
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
          keyExtractor={(c) => c._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={Shapes} title="No clubs found" />}
          renderItem={({ item: c }) => (
            <Card onPress={() => router.push(`/clubs/${c.slug}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={c.name} uri={c.logo} size={50} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong" numberOfLines={1}>
                  {c.name}
                </T>
                <T v="small" numberOfLines={1}>
                  {c.tagline || titleCase(c.category)}
                </T>
                <T v="small">{c.memberCount} members</T>
              </View>
              {c.isMember ? <Badge label="Member" color="success" /> : c.hasRequested ? <Badge label="Requested" color="warning" /> : null}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
