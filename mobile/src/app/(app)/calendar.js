import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Card, ErrorState, Header, IconButton, Screen, T } from '../../components/ui';
import { useGetEventsQuery } from '../../services/api';
import { colors, fonts } from '../../theme';

// Slightly under 1/7 so float rounding never pushes Sunday onto the next row.
const CELL = '14.28%';
const DOT = { technical: '#7c6cf0', hackathon: '#c05cf0', workshop: '#38a9f0', seminar: '#22b8c9', cultural: '#f0609e', sports: '#f5a524', career: '#4f7bf0' };

/** Full campus calendar (opened from the calendar icon on Home). Loads one month at a time. */
export default function Calendar() {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const { from, to, days } = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return { from: start, to: end, days: eachDayOfInterval({ start, end }) };
  }, [month]);
  const { data, isFetching, error, refetch } = useGetEventsQuery({ when: 'all', from: from.toISOString(), to: to.toISOString(), limit: 50 });
  const events = data?.items || [];
  const on = (day) => events.filter((e) => isSameDay(new Date(e.startDate), day));
  const picked = on(selected);

  return (
    <Screen refreshing={false} onRefresh={refetch}>
      <Header back title="Calendar" subtitle="Events across campus" right={isFetching ? <ActivityIndicator color={colors.primary} /> : null} />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T v="h3" style={{ flex: 1 }}>
            {format(month, 'MMMM yyyy')}
          </T>
          <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setMonth((m) => subMonths(m, 1))} />
          <View style={{ width: 8 }} />
          <IconButton icon={ChevronRight} label="Next month" onPress={() => setMonth((m) => addMonths(m, 1))} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <T key={d} v="label" style={{ width: CELL, textAlign: 'center' }}>
              {d}
            </T>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {days.map((day) => {
            const evs = on(day);
            const active = isSameDay(day, selected);
            return (
              <Pressable key={day.toISOString()} onPress={() => setSelected(day)} style={{ width: CELL, aspectRatio: 1, padding: 2 }} accessibilityLabel={`${format(day, 'd MMMM')}, ${evs.length} events`}>
                <View
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? colors.primary : isToday(day) ? colors.primarySoft : 'transparent',
                  }}
                >
                  <T v="small" style={{ fontFamily: fonts.bold, color: active ? '#fff' : !isSameMonth(day, month) ? 'rgba(146,149,179,0.5)' : colors.ink }}>
                    {format(day, 'd')}
                  </T>
                  {evs.length ? (
                    <View style={{ flexDirection: 'row', gap: 2, marginTop: 2 }}>
                      {evs.slice(0, 3).map((e) => (
                        <View key={e._id} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: active ? '#fff' : DOT[e.category] || colors.primary }} />
                      ))}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>
      {error ? <ErrorState error={error} onRetry={refetch} /> : null}
      <T v="label">{format(selected, 'EEEE, dd MMM')}</T>
      {picked.length ? (
        picked.map((e) => (
          <Card key={e._id} onPress={() => router.push(`/events/${e._id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 6, height: 36, borderRadius: 3, backgroundColor: DOT[e.category] || colors.primary }} />
            <View style={{ flex: 1 }}>
              <T v="strong" numberOfLines={1}>
                {e.title}
              </T>
              <T v="small" numberOfLines={1}>
                {format(new Date(e.startDate), 'h:mm a')} · {e.venue}
              </T>
            </View>
          </Card>
        ))
      ) : (
        <T v="small">No events on this day.</T>
      )}
    </Screen>
  );
}
