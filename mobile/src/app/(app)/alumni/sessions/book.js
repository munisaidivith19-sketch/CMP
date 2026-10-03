import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  CalendarDays,
  Clock,
  ExternalLink,
  Sparkles,
  User,
  Users,
} from 'lucide-react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  Input,
  Loading,
  Screen,
  T,
} from '../../../../components/ui';
import {
  useBookSessionMutation,
  useGetMentorshipRequestsQuery,
  useGetSlotsQuery,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function BookMentorshipSessionScreen() {
  const { mentor: queryMentorId } = useLocalSearchParams();
  const currentUser = useSelector(selectUser);

  const { data: requestsData, isLoading: isReqLoading } = useGetMentorshipRequestsQuery();
  const acceptedRequests = (requestsData?.items || []).filter((r) => r.status === 'accepted');

  const [selectedReq, setSelectedReq] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [agenda, setAgenda] = useState('');

  // Auto-select request if query parameter or if only 1 accepted request exists
  const activeReq = selectedReq || (queryMentorId
    ? acceptedRequests.find((r) => (r.alumni?._id || r.alumni) === queryMentorId)
    : acceptedRequests[0]);

  const mentorId = activeReq ? (activeReq.alumni?._id || activeReq.alumni) : null;
  const { data: slotsData, isLoading: isSlotsLoading } = useGetSlotsQuery(
    { alumni: mentorId },
    { skip: !mentorId }
  );

  const [bookSession, { isLoading: isBooking }] = useBookSessionMutation();
  const availableSlots = (slotsData?.slots || []).filter((s) => !s.isBooked);

  const handleConfirm = async () => {
    if (!activeReq || !selectedSlot) {
      alert('Please choose an active mentor connection and an open slot.');
      return;
    }

    try {
      await bookSession({
        request: activeReq._id,
        slot: selectedSlot._id,
        agenda: agenda.trim() || 'General career guidance and mentorship',
      }).unwrap();

      alert('1-on-1 mentorship session booked successfully!');
      router.replace('/alumni/sessions');
    } catch (e) {
      alert(e?.data?.message || 'Could not book session');
    }
  };

  if (isReqLoading) {
    return (
      <Screen>
        <Header back title="Book Session" />
        <Loading label="Checking mentorship connections..." />
      </Screen>
    );
  }

  if (acceptedRequests.length === 0) {
    return (
      <Screen>
        <Header back title="Book Session" />
        <Card style={{ gap: 12, alignItems: 'center', paddingVertical: 32 }}>
          <Users size={36} color={colors.primary} />
          <T v="h3" style={{ textAlign: 'center' }}>No Active Mentors Yet</T>
          <T v="body" style={{ textAlign: 'center', color: colors.soft }}>
            You need an accepted mentorship request from an alumnus before you can schedule 1-on-1 sessions.
          </T>
          <Button
            title="Explore Alumni Directory"
            variant="primary"
            onPress={() => router.replace('/alumni')}
            style={{ marginTop: 8 }}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header back title="Schedule 1-on-1" subtitle="Select an available slot with your mentor" />

      {/* Select Mentor if multiple */}
      {acceptedRequests.length > 1 && (
        <View style={{ gap: 6 }}>
          <T v="label">Choose Mentor</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {acceptedRequests.map((r) => {
              const m = r.alumni || {};
              const isSelected = activeReq?._id === r._id;
              return (
                <Chip
                  key={r._id}
                  label={m.name || 'Mentor'}
                  active={isSelected}
                  onPress={() => {
                    setSelectedReq(r);
                    setSelectedSlot(null);
                  }}
                />
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Selected Mentor Card */}
      {activeReq && (
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Avatar user={activeReq.alumni} name={activeReq.alumni?.name} size={48} />
          <View style={{ flex: 1 }}>
            <T v="strong">{activeReq.alumni?.name}</T>
            <T v="small" style={{ color: colors.muted }}>
              {activeReq.alumni?.designation || 'Alumnus Mentor'} · {activeReq.domain?.replace('_', ' ')}
            </T>
          </View>
          <Badge label="Accepted" color="success" />
        </Card>
      )}

      {/* Open Slots */}
      <View style={{ gap: 10 }}>
        <T v="strong">Available Open Slots</T>
        {isSlotsLoading ? (
          <Loading label="Loading mentor's availability..." />
        ) : availableSlots.length === 0 ? (
          <Card style={{ padding: 20, alignItems: 'center', gap: 6 }}>
            <CalendarDays size={28} color={colors.soft} />
            <T v="strong" style={{ textAlign: 'center' }}>No Open Slots</T>
            <T v="small" style={{ textAlign: 'center', color: colors.muted }}>
              This mentor does not have open slots right now. Check back soon or message them in Campus Chat.
            </T>
          </Card>
        ) : (
          availableSlots.map((slot) => {
            const isSelected = selectedSlot?._id === slot._id;
            return (
              <Card
                key={slot._id}
                onPress={() => setSelectedSlot(slot)}
                style={[
                  { gap: 8 },
                  isSelected && { borderColor: colors.primary, borderWidth: 2, backgroundColor: 'rgba(67, 150, 239, 0.05)' },
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Clock size={16} color={isSelected ? colors.primary600 : colors.soft} />
                    <T v="strong" style={isSelected && { color: colors.primary600 }}>
                      {format(new Date(slot.startsAt), 'EEE, MMM d · h:mm a')}
                    </T>
                  </View>
                  <Badge label={`${slot.durationMin} mins`} color={isSelected ? 'primary' : 'neutral'} />
                </View>
                <T v="small" style={{ color: colors.muted }}>
                  Format: {slot.mode === 'virtual' ? 'Online Video Call' : 'In-Person Meeting'}
                </T>
              </Card>
            );
          })
        )}
      </View>

      {/* Session Agenda Input */}
      {selectedSlot && (
        <Card style={{ gap: 12 }}>
          <T v="strong">Session Agenda</T>
          <Input
            label="What would you like to discuss?"
            placeholder="e.g. Resume review for frontend roles, interview prep tips..."
            multiline
            numberOfLines={3}
            value={agenda}
            onChangeText={setAgenda}
          />

          <Button
            title="Confirm Booking"
            loading={isBooking}
            onPress={handleConfirm}
          />
        </Card>
      )}
    </Screen>
  );
}
