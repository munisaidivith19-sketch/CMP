import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { MessageCircle } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, ErrorState, Header, Loading, Screen, T } from '../../../components/ui';
import { errMsg, useCreateConversationMutation, useGetUserQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { ROLE_LABELS } from '../../../theme';
import { sameId } from '../../../utils/format';

export default function Person() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: u, isLoading, error, refetch } = useGetUserQuery(id);
  const [create, { isLoading: starting }] = useCreateConversationMutation();

  if (isLoading) return <Screen><Header back title="Profile" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Profile" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const message = async () => {
    try {
      const conv = await create({ type: 'private', participantIds: [u._id] }).unwrap();
      router.push(`/chat/${conv._id}`);
    } catch (e) {
      Alert.alert('Could not start chat', errMsg(e));
    }
  };

  return (
    <Screen>
      <Header back title={u.name} subtitle={ROLE_LABELS[u.role]} />
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Avatar user={u} size={84} />
        <T v="h2">{u.name}</T>
        <T v="small">
          {u.department || ''}
          {u.year ? ` · Year ${u.year}` : ''}
          {u.designation ? ` · ${u.designation}` : ''}
        </T>
        {!sameId(u, me) ? <Button title="Message" icon={MessageCircle} small loading={starting} onPress={message} /> : null}
      </Card>
      {u.bio ? (
        <Card>
          <T v="body">{u.bio}</T>
        </Card>
      ) : null}
      {u.skills?.length ? (
        <Card style={{ gap: 8 }}>
          <T v="label">Skills</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {u.skills.map((s) => (
              <Badge key={s} label={s} color="neutral" />
            ))}
          </View>
        </Card>
      ) : null}
      <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        {[
          ['Events', u.stats.eventsJoined],
          ['Attended', u.stats.eventsAttended],
          ['Clubs', u.stats.clubs],
          ['Posts', u.stats.discussions],
        ].map(([l, v]) => (
          <View key={l} style={{ alignItems: 'center' }}>
            <T v="h2">{v}</T>
            <T v="small">{l}</T>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
