import { useState } from 'react';
import { FlatList, Image, View } from 'react-native';
import { router } from 'expo-router';
import { MapPin, PackageSearch, Plus } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, Segmented, StatusBadge, T } from '../../../components/ui';
import { useGetLostFoundQuery } from '../../../services/api';
import { assetUrl } from '../../../config';
import { colors } from '../../../theme';
import { fmtDateTime, timeAgo, titleCase } from '../../../utils/format';

export default function LostFound() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const params = { limit: 30, status: 'open', search: search || undefined, ...(tab === 'lost' || tab === 'found' ? { type: tab } : {}), ...(tab === 'mine' ? { mine: 'true', status: undefined } : {}) };
  const { data, isLoading, isFetching, error, refetch } = useGetLostFoundQuery(params);

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title="Lost & found" subtitle="Matches are suggestions — staff verify ownership." right={<Button small icon={Plus} title="Report" onPress={() => router.push('/lost-found/new')} />} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'lost', label: 'Lost', count: data?.summary?.lostOpen },
            { value: 'found', label: 'Found', count: data?.summary?.foundOpen },
            { value: 'mine', label: 'Mine' },
          ]}
        />
        <Input placeholder="Search items or places" value={search} onChangeText={setSearch} />
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
          keyExtractor={(i) => i._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={PackageSearch} title="Nothing here" text="Lost something? Report it and we’ll look for possible matches." />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/lost-found/${item._id}`)} style={{ flexDirection: 'row', gap: 12 }} padded>
              {item.photo ? (
                <Image source={{ uri: assetUrl(item.photo) }} style={{ width: 72, height: 72, borderRadius: 18 }} />
              ) : (
                <View style={{ width: 72, height: 72, borderRadius: 18, backgroundColor: item.type === 'lost' ? colors.dangerSoft : colors.infoSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <PackageSearch size={28} color={item.type === 'lost' ? colors.danger : colors.info} />
                </View>
              )}
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <T v="label" style={{ color: item.type === 'lost' ? colors.danger : colors.info }}>
                    {item.type}
                  </T>
                  <StatusBadge status={item.status} />
                </View>
                <T v="strong" numberOfLines={1}>
                  {item.itemName}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} color={colors.soft} />
                  <T v="small" numberOfLines={1} style={{ flex: 1 }}>
                    {item.location} · {fmtDateTime(item.dateTime)}
                  </T>
                </View>
                <T v="small" style={{ color: colors.muted }}>
                  {titleCase(item.category)} · {item.isMine ? 'you' : item.reporter?.name} · {timeAgo(item.createdAt)}
                </T>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
