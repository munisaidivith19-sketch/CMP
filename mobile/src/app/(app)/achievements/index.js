import { useState } from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { Heart, Plus, Star, Trophy } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Header, Input, Loading, Screen, Segmented, T } from '../../../components/ui';
import { useGetAchievementsQuery } from '../../../services/api';
import { assetUrl } from '../../../config';
import { selectUser } from '../../../store/authSlice';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LEVEL_COLORS, ACHIEVEMENT_POST_ROLES, STUDENT_ROLES, colors } from '../../../theme';
import { fmtDate, titleCase } from '../../../utils/format';

export function AchievementCard({ a }) {
  const cover = a.images?.[0]?.url;
  const names = (a.students || []).map((s) => s.name).join(', ');
  return (
    <Card onPress={() => router.push(`/achievements/${a._id}`)} padded={false} style={{ overflow: 'hidden' }}>
      {cover ? <Image source={{ uri: assetUrl(cover) }} style={{ width: '100%', height: 150 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      <View style={{ padding: 14, gap: 6 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {a.isFeatured ? <Badge label="Featured" color="warning" /> : null}
          <Badge label={titleCase(a.level)} color={ACHIEVEMENT_LEVEL_COLORS[a.level] || 'neutral'} />
          <Badge label={titleCase(a.category)} color="neutral" />
          {a.position ? <Badge label={titleCase(a.position)} color="success" /> : null}
        </View>
        <T v="h3" numberOfLines={2}>
          {a.title}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {a.students?.[0] ? <Avatar user={a.students[0]} size={26} /> : null}
          <T v="small" numberOfLines={1} style={{ flex: 1 }}>
            {names}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T v="small" style={{ flex: 1, color: colors.muted }} numberOfLines={1}>
            {fmtDate(a.achievedOn)}
            {a.eventName ? ` · ${a.eventName}` : ''}
          </T>
          <Heart size={14} color={a.congratulated ? colors.danger : colors.muted} fill={a.congratulated ? colors.danger : 'transparent'} />
          <T v="small">{a.congratulationCount || 0}</T>
        </View>
      </View>
    </Card>
  );
}

export default function Achievements() {
  const me = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(me.role);
  const canPost = ACHIEVEMENT_POST_ROLES.includes(me.role);
  const [view, setView] = useState('all');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(12);
  const params = {
    limit,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(category ? { category } : {}),
    ...(view === 'featured' ? { featured: 'true' } : {}),
    ...(view === 'mine' ? { mine: 'true' } : {}),
  };
  const { data, isLoading, isFetching, error, refetch } = useGetAchievementsQuery(params);
  const items = data?.items || [];
  // The API returns at most 50 per request.
  const more = data && data.total > items.length && limit < 50;

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Achievements" subtitle="Celebrating our students." right={canPost ? <Button small icon={Plus} title="Post" onPress={() => router.push('/achievements/new')} /> : null} />
      <Segmented
        value={view}
        onChange={(v) => { setView(v); setLimit(12); }}
        options={[{ value: 'all', label: 'All' }, { value: 'featured', label: 'Featured' }, ...(isStudent ? [{ value: 'mine', label: 'Mine' }] : [])]}
      />
      <Input placeholder="Search title, event or organiser" value={q} onChangeText={(v) => { setQ(v); setLimit(12); }} autoCorrect={false} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label="Any category" active={!category} onPress={() => setCategory('')} />
        {ACHIEVEMENT_CATEGORIES.map((c) => (
          <Chip key={c} label={titleCase(c)} active={category === c} onPress={() => { setCategory(c); setLimit(12); }} />
        ))}
      </View>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={view === 'featured' ? Star : Trophy} title="No achievements yet" text={canPost ? 'Post one to celebrate your students.' : 'New achievements will appear here.'} />
        </Card>
      ) : (
        <>
          {items.map((a) => (
            <AchievementCard key={a._id} a={a} />
          ))}
          {more ? <Button title="Load more" variant="soft" loading={isFetching} onPress={() => setLimit((l) => Math.min(50, l + 12))} /> : null}
        </>
      )}
    </Screen>
  );
}
