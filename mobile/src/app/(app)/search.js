import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Search as SearchIcon } from 'lucide-react-native';
import { Avatar, Card, EmptyState, Header, Input, Loading, Screen, SectionTitle, T } from '../../components/ui';
import { useSearchQuery } from '../../services/api';
import { ROLE_LABELS } from '../../theme';
import { fmtDateTime } from '../../utils/format';

export default function Search() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const { data, isFetching } = useSearchQuery(q, { skip: q.length < 2 });
  const total = data ? data.users.length + data.clubs.length + data.events.length + data.discussions.length + data.announcements.length : 0;

  return (
    <Screen>
      <Header back title="Search" />
      <Input placeholder="People, clubs, events, discussions…" value={text} onChangeText={setText} autoFocus />
      {q.length < 2 ? (
        <EmptyState icon={SearchIcon} title="Search Vexon" text="Type at least 2 characters." />
      ) : isFetching && !data ? (
        <Loading />
      ) : !total ? (
        <EmptyState icon={SearchIcon} title={`Nothing found for “${q}”`} />
      ) : (
        <>
          {data.users.length ? <SectionTitle title="People" /> : null}
          {data.users.map((u) => (
            <Card key={u._id} onPress={() => router.push(`/people/${u._id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar user={u} size={38} />
              <View style={{ flex: 1 }}>
                <T v="strong">{u.name}</T>
                <T v="small">
                  {ROLE_LABELS[u.role]}
                  {u.department ? ` · ${u.department}` : ''}
                </T>
              </View>
            </Card>
          ))}
          {data.clubs.length ? <SectionTitle title="Clubs" /> : null}
          {data.clubs.map((c) => (
            <Card key={c._id} onPress={() => router.push(`/clubs/${c.slug}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={c.name} uri={c.logo} size={38} />
              <T v="strong" style={{ flex: 1 }}>{c.name}</T>
              <T v="small">{c.memberCount} members</T>
            </Card>
          ))}
          {data.events.length ? <SectionTitle title="Events" /> : null}
          {data.events.map((e) => (
            <Card key={e._id} onPress={() => router.push(`/events/${e._id}`)}>
              <T v="strong">{e.title}</T>
              <T v="small">{fmtDateTime(e.startDate)}</T>
            </Card>
          ))}
          {data.discussions.length ? <SectionTitle title="Discussions" /> : null}
          {data.discussions.map((d) => (
            <Card key={d._id} onPress={() => router.push(`/discussions/${d._id}`)}>
              <T v="strong">{d.title}</T>
              <T v="small">{d.replyCount} replies</T>
            </Card>
          ))}
          {data.announcements.length ? <SectionTitle title="Announcements" /> : null}
          {data.announcements.map((a) => (
            <Card key={a._id} onPress={() => router.push('/announcements')}>
              <T v="strong">{a.title}</T>
              <T v="small" numberOfLines={2}>{a.content}</T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
