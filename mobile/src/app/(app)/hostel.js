import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useSelector } from 'react-redux';
import { BedDouble, Phone } from 'lucide-react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, Segmented, T } from '../../components/ui';
import { useGetHostelStudentsQuery, useGetHostelSummaryQuery } from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { HOSTEL_ROLES, colors } from '../../theme';
import { displayName, fmtClassDay, fmtDateTime } from '../../utils/format';

/**
 * Hostel overview: hostelers inside / outside campus, for boys, girls or
 * everyone. "Outside" comes from gate-pass exits not yet returned (server).
 */
export default function Hostel() {
  const me = useSelector(selectUser);
  const allowed = HOSTEL_ROLES.includes(me.role);
  const [gender, setGender] = useState('');
  const [status, setStatus] = useState('outside');
  const [q, setQ] = useState('');
  const summary = useGetHostelSummaryQuery(undefined, { skip: !allowed, pollingInterval: 60000 });
  const list = useGetHostelStudentsQuery({ status, ...(gender ? { gender } : {}), ...(q.trim() ? { q: q.trim() } : {}), limit: 100 }, { skip: !allowed });

  if (!allowed) {
    return (
      <Screen>
        <Header back title="Hostel" />
        <Card>
          <EmptyState icon={BedDouble} title="Not available for your role" />
        </Card>
      </Screen>
    );
  }

  const s = summary.data;
  const counts = s ? (gender === 'male' ? s.boys : gender === 'female' ? s.girls : s) : null;
  const rows = list.data?.students || [];

  return (
    <Screen refreshing={summary.isFetching || list.isFetching} onRefresh={() => { summary.refetch(); list.refetch(); }}>
      <Header back title="Hostel" subtitle="Who is inside and outside campus right now." />
      <Segmented value={gender} onChange={setGender} options={[{ value: '', label: 'Everyone' }, { value: 'male', label: 'Boys' }, { value: 'female', label: 'Girls' }]} />
      {summary.isLoading ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            ['all', 'Hostelers', counts.total],
            ['inside', 'Inside', counts.inside],
            ['outside', 'Outside', counts.outside],
          ].map(([value, label, n]) => (
            <Card key={value} onPress={() => setStatus(value)} style={{ flex: 1, alignItems: 'center', gap: 2, ...(status === value ? { borderColor: colors.primary, borderWidth: 2 } : {}) }}>
              <T v="label">{label}</T>
              <T v="h2">{n}</T>
            </Card>
          ))}
        </View>
      )}
      <Input placeholder="Search name or roll no." value={q} onChangeText={setQ} autoCorrect={false} maxLength={60} />
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={BedDouble} title={status === 'outside' ? 'Everyone is on campus' : 'No hostelers found'} />
        </Card>
      ) : (
        <>
          {list.data.total > rows.length ? (
            <T v="small">
              Showing {rows.length} of {list.data.total} — search to narrow down.
            </T>
          ) : null}
          {rows.map((st) => (
            <Card key={st._id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={st} size={38} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{displayName(st)}</T>
                  <T v="small" numberOfLines={1}>
                    {st.rollNo || '—'} · {st.department}
                    {st.year ? ` · Y${st.year}` : ''}
                    {st.section ? ` · Sec ${st.section}` : ''}
                  </T>
                </View>
                {st.phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${st.phone.replace(/[^\d+]/g, '')}`)} accessibilityRole="button" accessibilityLabel={`Call ${st.name}`} hitSlop={8}>
                    <Phone size={18} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>
              {status === 'outside' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <T v="small">Left {fmtDateTime(st.leftAt)}</T>
                  {st.returnBy ? <Badge label={`due ${fmtClassDay(st.returnBy)}`} color="info" /> : null}
                </View>
              ) : null}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
