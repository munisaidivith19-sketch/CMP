import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { CalendarDays, MapPin } from 'lucide-react-native';
import { Card, EmptyState, ErrorState, Header, Loading, Screen, Segmented, StatusBadge, T } from '../../../components/ui';
import { useGetEventsQuery } from '../../../services/api';
import { colors, fonts, gradients } from '../../../theme';

export default function Events() {
  const [when, setWhen] = useState('upcoming');
  const params = when === 'mine' ? { mine: 'true', when: 'all', limit: 30 } : { when, limit: 30 };
  const { data, isLoading, isFetching, error, refetch } = useGetEventsQuery(params);

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 12 }}>
        <Header back title="Events" subtitle="Workshops, fests, talks and more." />
        <Segmented value={when} onChange={setWhen} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'mine', label: 'Registered' }, { value: 'past', label: 'Past' }]} />
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
          keyExtractor={(e) => e._id}
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon={CalendarDays} title="No events here" />}
          renderItem={({ item: e }) => (
            <Card onPress={() => router.push(`/events/${e._id}`)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <LinearGradient colors={gradients.sky} style={{ width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ color: '#fff', fontSize: 10, fontFamily: fonts.bold }}>{format(new Date(e.startDate), 'MMM').toUpperCase()}</T>
                <T style={{ color: '#fff', fontSize: 20, fontFamily: fonts.extrabold, lineHeight: 22 }}>{format(new Date(e.startDate), 'dd')}</T>
              </LinearGradient>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong" numberOfLines={1}>
                  {e.title}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} color={colors.soft} />
                  <T v="small" numberOfLines={1} style={{ flex: 1 }}>
                    {e.venue} · {format(new Date(e.startDate), 'h:mm a')}
                  </T>
                </View>
                <T v="small" style={{ color: colors.muted }}>
                  {e.club?.name || e.category}
                  {e.capacity ? ` · ${e.spotsLeft} spots left` : ''}
                </T>
              </View>
              {e.myStatus ? <StatusBadge status={e.myStatus} /> : null}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
