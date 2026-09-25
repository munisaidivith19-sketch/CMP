import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { Avatar, Badge, Button, Card, ErrorState, Header, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import { errMsg, useCancelJoinMutation, useGetClubQuery, useJoinClubMutation, useLeaveClubMutation } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { STUDENT_ROLES, colors } from '../../../theme';
import { fmtDateTime, titleCase } from '../../../utils/format';

export default function ClubDetail() {
  const { slug } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: c, isLoading, error, refetch, isFetching } = useGetClubQuery(slug);
  const [join, { isLoading: joining }] = useJoinClubMutation();
  const [cancel, { isLoading: cancelling }] = useCancelJoinMutation();
  const [leave, { isLoading: leaving }] = useLeaveClubMutation();

  if (isLoading) return <Screen><Header back title="Club" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Club" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const run = (fn, msg) => async () => {
    try {
      await fn().unwrap();
      if (msg) Alert.alert(msg);
    } catch (e) {
      Alert.alert('Something went wrong', errMsg(e));
    }
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Header back title={c.name} subtitle={titleCase(c.category)} />
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Avatar name={c.name} uri={c.logo} size={72} />
        {c.tagline ? <T v="strong" style={{ textAlign: 'center' }}>{c.tagline}</T> : null}
        <T v="small">{c.memberCount} members</T>
        {STUDENT_ROLES.includes(me.role) ? (
          c.isMember ? (
            <Button title="Leave club" variant="danger" small loading={leaving} onPress={() => Alert.alert('Leave this club?', '', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: run(() => leave(c._id)) }])} />
          ) : c.hasRequested ? (
            <Button title="Cancel join request" variant="soft" small loading={cancelling} onPress={run(() => cancel(c._id), 'Request withdrawn')} />
          ) : (
            <Button title="Request to join" small loading={joining} onPress={run(() => join({ id: c._id, message: '' }), 'Request sent — club admins will review it')} />
          )
        ) : null}
      </Card>
      <Card>
        <T v="body">{c.description}</T>
      </Card>

      {c.upcomingEvents?.length ? (
        <>
          <SectionTitle title="Upcoming events" />
          {c.upcomingEvents.map((e) => (
            <Card key={e._id} onPress={() => router.push(`/events/${e._id}`)} style={{ gap: 2 }}>
              <T v="strong">{e.title}</T>
              <T v="small">
                {fmtDateTime(e.startDate)} · {e.venue}
              </T>
            </Card>
          ))}
        </>
      ) : null}

      {c.announcements?.length ? (
        <>
          <SectionTitle title="Club announcements" />
          {c.announcements.map((a) => (
            <Card key={a._id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <T v="strong" style={{ flex: 1 }}>{a.title}</T>
                {a.priority !== 'normal' ? <Badge label={a.priority} color="warning" /> : null}
              </View>
              <T v="small" numberOfLines={3}>
                {a.content}
              </T>
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle title="Admins" />
      <Card style={{ gap: 10 }}>
        {(c.admins || []).map((m) => (
          <View key={m._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar user={m} size={34} />
            <T v="strong" style={{ flex: 1 }}>{m.name}</T>
            <T v="small" style={{ color: colors.muted }}>{m.department}</T>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
