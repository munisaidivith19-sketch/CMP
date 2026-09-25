import { Alert, Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { CalendarDays, MapPin, Users } from 'lucide-react-native';
import { Button, Card, ErrorState, Header, Loading, ProgressBar, Screen, StatusBadge, T } from '../../../components/ui';
import { errMsg, useCancelRegistrationMutation, useGetEventQuery, useRegisterEventMutation } from '../../../services/api';
import { assetUrl } from '../../../config';
import { selectUser } from '../../../store/authSlice';
import { STUDENT_ROLES, colors } from '../../../theme';
import { fmtDateTime, titleCase } from '../../../utils/format';

export default function EventDetail() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: e, isLoading, error, refetch, isFetching } = useGetEventQuery(id);
  const [register, { isLoading: registering }] = useRegisterEventMutation();
  const [cancel, { isLoading: cancelling }] = useCancelRegistrationMutation();

  if (isLoading) return <Screen><Header back title="Event" /><Loading /></Screen>;
  if (error) return <Screen><Header back title="Event" /><ErrorState error={error} onRetry={refetch} /></Screen>;

  const full = e.capacity > 0 && e.spotsLeft === 0;
  const act = async () => {
    try {
      if (e.myStatus) {
        await cancel(e._id).unwrap();
        Alert.alert('Registration cancelled');
      } else {
        const res = await register(e._id).unwrap();
        Alert.alert(res.status === 'waitlisted' ? 'You’re on the waitlist' : 'You’re registered! 🎉');
      }
    } catch (err) {
      Alert.alert('Something went wrong', errMsg(err));
    }
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Header back title={e.title} subtitle={titleCase(e.category)} />
      {e.poster ? <Image source={{ uri: assetUrl(e.poster) }} style={{ width: '100%', height: 190, borderRadius: 28 }} /> : null}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CalendarDays size={16} color={colors.primary} />
          <T v="small" style={{ flex: 1 }}>
            {fmtDateTime(e.startDate)} → {fmtDateTime(e.endDate)}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MapPin size={16} color={colors.primary} />
          <T v="small">{e.venue}</T>
        </View>
        {e.club ? (
          <T v="small" onPress={() => router.push(`/clubs/${e.club.slug}`)} style={{ color: colors.primary }}>
            Hosted by {e.club.name}
          </T>
        ) : null}
        {e.capacity ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Users size={14} color={colors.soft} />
              <T v="small">
                {e.registeredCount}/{e.capacity} registered{e.waitlistCount ? ` · ${e.waitlistCount} waitlisted` : ''}
              </T>
            </View>
            <ProgressBar value={(e.registeredCount / e.capacity) * 100} threshold={0} />
          </View>
        ) : null}
        <T v="body">{e.description}</T>
      </Card>
      {e.myStatus ? <StatusBadge status={e.myStatus} label={`You are ${e.myStatus}`} /> : null}
      {!STUDENT_ROLES.includes(me.role) ? null : e.isPast ? (
        <T v="small" style={{ textAlign: 'center' }}>This event has ended.</T>
      ) : (
        <Button title={e.myStatus ? 'Cancel registration' : full ? 'Join waitlist' : 'Register'} variant={e.myStatus ? 'danger' : 'primary'} loading={registering || cancelling} onPress={act} />
      )}
    </Screen>
  );
}
