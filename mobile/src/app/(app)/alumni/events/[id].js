import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  MapPin,
  QrCode,
  UserCheck,
  Users,
  Video,
} from 'lucide-react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  Loading,
  ProgressBar,
  Screen,
  StatusBadge,
  T,
} from '../../../../components/ui';
import {
  useCancelRsvpMutation,
  useCheckInAttendeeMutation,
  useGetAlumniEventQuery,
  useGetAttendeesQuery,
  useRsvpEventMutation,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams();
  const currentUser = useSelector(selectUser);

  const { data: event, isLoading, error, refetch } = useGetAlumniEventQuery(id);
  const [rsvpEvent, { isLoading: isRsvping }] = useRsvpEventMutation();
  const [cancelRsvp, { isLoading: isCancelling }] = useCancelRsvpMutation();
  const [checkInAttendee, { isLoading: isCheckingIn }] = useCheckInAttendeeMutation();

  const isStaff = ['admin', 'hod', 'principal'].includes(currentUser?.role);
  const isHost = event?.organizer?._id === currentUser?._id || event?.organizer === currentUser?._id;
  const canManage = isHost || isStaff;

  const { data: attendees = [], refetch: refetchAttendees } = useGetAttendeesQuery(id, { skip: !canManage });

  if (isLoading) {
    return (
      <Screen>
        <Header back title="Alumni Event" />
        <Loading label="Loading event details..." />
      </Screen>
    );
  }

  if (error || !event) {
    return (
      <Screen>
        <Header back title="Alumni Event" />
        <ErrorState error={error} onRetry={refetch} />
      </Screen>
    );
  }

  const userRsvp = event.userRsvp;
  const isFull = event.capacity && event.attendeeCount >= event.capacity;
  const canSeeLink = Boolean(userRsvp || canManage);

  const handleRsvp = async () => {
    try {
      await rsvpEvent(id).unwrap();
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not RSVP for event');
    }
  };

  const handleCancelRsvp = async () => {
    try {
      await cancelRsvp(id).unwrap();
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not cancel RSVP');
    }
  };

  const handleCheckIn = async (userId) => {
    try {
      await checkInAttendee({ id, userId }).unwrap();
      refetchAttendees();
    } catch (e) {
      alert(e?.data?.message || 'Could not check in attendee');
    }
  };

  return (
    <Screen>
      <Header back title={event.type.toUpperCase()} />

      {/* Main Info Card */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <T v="h2">{event.title}</T>
            <T v="small" style={{ color: colors.muted }}>
              {format(new Date(event.startsAt), 'EEEE, MMMM d, yyyy')}
            </T>
          </View>
          <Badge label={event.type} color="primary" />
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CalendarDays size={15} color={colors.primary} />
            <T v="body" style={{ fontFamily: fonts.semibold }}>
              {format(new Date(event.startsAt), 'h:mm a')} – {format(new Date(event.endsAt), 'h:mm a')}
            </T>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {event.mode === 'virtual' ? (
              <Video size={15} color={colors.primary} />
            ) : (
              <MapPin size={15} color={colors.primary} />
            )}
            <T v="body">
              {event.mode === 'virtual' ? 'Online Video Session' : (event.venue || 'Campus Venue')}
            </T>
          </View>
        </View>

        {/* Virtual Link if RSVP'd */}
        {event.meetingLink && canSeeLink && (
          <Button
            title="Join Video Meeting"
            icon={ExternalLink}
            variant="soft"
            onPress={() => Linking.openURL(event.meetingLink)}
          />
        )}

        {/* Capacity / Attendance bar */}
        {event.capacity ? (
          <View style={{ gap: 6, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="small">Attendance Capacity</T>
              <T v="small" style={{ fontFamily: fonts.bold }}>
                {event.attendeeCount || 0} / {event.capacity} seats taken
              </T>
            </View>
            <ProgressBar value={((event.attendeeCount || 0) / event.capacity) * 100} />
          </View>
        ) : null}

        {/* Host card */}
        {event.organizer && (
          <Pressable
            onPress={() => {
              const uid = event.organizer?._id || event.organizer;
              if (uid) router.push(`/alumni/${uid}`);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 12, marginTop: 4 }}
          >
            <Avatar user={event.organizer} name={event.organizer?.name} size={36} />
            <View style={{ flex: 1 }}>
              <T v="strong">{event.organizer?.name || 'Organizer'}</T>
              <T v="small" style={{ color: colors.muted }}>
                {event.organizer?.designation || 'Host'} · Tap for profile
              </T>
            </View>
          </Pressable>
        )}
      </Card>

      {/* Description */}
      <Card style={{ gap: 8 }}>
        <T v="strong">About this Event</T>
        <T v="body" style={{ color: colors.ink, lineHeight: 22 }}>
          {event.description}
        </T>
      </Card>

      {/* RSVP Action Card */}
      <Card style={{ gap: 12 }}>
        <T v="strong">RSVP & Participation</T>
        {userRsvp ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="body">Your Status:</T>
              <StatusBadge status={userRsvp.status || 'registered'} />
            </View>
            <Button
              title="Cancel RSVP"
              variant="outline"
              loading={isCancelling}
              onPress={handleCancelRsvp}
            />
          </View>
        ) : (
          <Button
            title={isFull ? 'Join Waitlist' : 'RSVP for Event'}
            variant="primary"
            loading={isRsvping}
            onPress={handleRsvp}
          />
        )}
      </Card>

      {/* Host / Staff Attendee List */}
      {canManage && (
        <Card style={{ gap: 12 }}>
          <T v="h3">Attendee Roster ({attendees.length})</T>
          {attendees.length === 0 ? (
            <T v="small" style={{ color: colors.muted }}>No RSVPs yet.</T>
          ) : (
            attendees.map((att) => {
              const u = att.user || {};
              const checkedIn = att.status === 'attended';
              return (
                <View key={att._id} style={styles.attendeeRow}>
                  <Avatar user={u} name={u.name} size={38} />
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>{u.name || 'Attendee'}</T>
                    <T v="small" style={{ color: colors.muted }}>
                      {u.department} · {att.status}
                    </T>
                  </View>
                  {!checkedIn ? (
                    <Button
                      title="Check In"
                      small
                      variant="soft"
                      loading={isCheckingIn}
                      onPress={() => handleCheckIn(u._id || att.user)}
                    />
                  ) : (
                    <Badge label="Attended ✓" color="success" />
                  )}
                </View>
              );
            })
          )}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 10,
    borderRadius: 12,
  },
});
