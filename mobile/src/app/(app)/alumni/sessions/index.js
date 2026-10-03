import { useState } from 'react';
import { FlatList, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  Plus,
  Video,
  X,
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
  Input,
  Loading,
  Screen,
  Segmented,
  StatusBadge,
  T,
} from '../../../../components/ui';
import {
  useCancelSessionMutation,
  useCompleteSessionMutation,
  useGetMentorshipSessionsQuery,
  useUpdateSessionNotesMutation,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function MentorshipSessionsScreen() {
  const currentUser = useSelector(selectUser);
  const [scope, setScope] = useState('upcoming');

  const isStudent = ['student', 'club_admin'].includes(currentUser?.role);
  const isAlumni = currentUser?.role === 'alumni';

  const { data, isLoading, isFetching, error, refetch } = useGetMentorshipSessionsQuery({ scope });
  const [cancelSession, { isLoading: isCancelling }] = useCancelSessionMutation();
  const [completeSession, { isLoading: isCompleting }] = useCompleteSessionMutation();
  const [updateNotes, { isLoading: isUpdatingNotes }] = useUpdateSessionNotesMutation();

  const sessions = Array.isArray(data) ? data : data?.sessions || data?.items || [];

  // Notes Modal state
  const [editingSession, setEditingSession] = useState(null);
  const [sharedNotes, setSharedNotes] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');

  const handleOpenNotes = (sess) => {
    setEditingSession(sess);
    setSharedNotes(sess.sharedNotes || '');
    setPrivateNotes(sess.alumniPrivateNotes || '');
  };

  const handleSaveNotes = async () => {
    if (!editingSession) return;
    try {
      await updateNotes({
        id: editingSession._id,
        sharedNotes: sharedNotes.trim(),
        alumniPrivateNotes: isAlumni ? privateNotes.trim() : undefined,
      }).unwrap();
      setEditingSession(null);
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not update notes');
    }
  };

  const handleCancel = async (sessionId) => {
    if (!confirm('Are you sure you want to cancel this session? Cancellations less than 2 hours before the start time may affect scheduling limits.')) {
      return;
    }
    try {
      await cancelSession({ id: sessionId, reason: 'Cancelled by user' }).unwrap();
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not cancel session');
    }
  };

  const handleComplete = async (sessionId, outcome = 'completed') => {
    try {
      await completeSession({ id: sessionId, outcome }).unwrap();
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not complete session');
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
        <Header
          back
          title="Mentorship Sessions"
          subtitle="1-on-1 Guidance, reviews and career advice"
          right={
            isStudent ? (
              <Button
                title="Book"
                icon={Plus}
                small
                onPress={() => router.push('/alumni/sessions/book')}
              />
            ) : null
          }
        />

        <Segmented
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past Sessions' },
          ]}
          value={scope}
          onChange={setScope}
        />
      </View>

      <View style={{ flex: 1, marginTop: 8 }}>
        {isLoading ? (
          <Loading label="Loading sessions..." />
        ) : error ? (
          <View style={{ padding: 16 }}>
            <ErrorState error={error} onRetry={refetch} />
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(s) => s._id}
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 40 }}
            ListEmptyComponent={
              <EmptyState
                icon={CalendarDays}
                title="No Sessions Found"
                text={
                  scope === 'upcoming'
                    ? 'No upcoming mentorship appointments scheduled.'
                    : 'No past mentorship records found.'
                }
              />
            }
            renderItem={({ item: s }) => {
              const counterpart = isStudent ? s.mentor : s.student;
              const isScheduled = s.status === 'scheduled';
              return (
                <Card style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                      <Avatar user={counterpart} name={counterpart?.name} size={42} />
                      <View style={{ flex: 1 }}>
                        <T v="strong" numberOfLines={1}>{counterpart?.name || 'Counterpart'}</T>
                        <T v="small" style={{ color: colors.muted }}>
                          {isStudent ? (counterpart?.designation || 'Alumnus Mentor') : (counterpart?.department || 'Student Mentee')}
                        </T>
                      </View>
                    </View>
                    <StatusBadge status={s.status} />
                  </View>

                  {/* Slot Time Details */}
                  <View style={{ gap: 4, backgroundColor: 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} color={colors.primary} />
                      <T v="strong">
                        {format(new Date(s.slot?.startsAt || s.createdAt), 'EEEE, MMM d · h:mm a')}
                      </T>
                    </View>
                    <T v="small" style={{ color: colors.soft }}>
                      Duration: {s.slot?.durationMin || 30} minutes · Mode: {s.slot?.mode || 'virtual'}
                    </T>
                  </View>

                  {/* Agenda */}
                  {s.agenda ? (
                    <T v="small" style={{ color: colors.ink }}>
                      <Text style={{ fontFamily: fonts.bold }}>Agenda: </Text>{s.agenda}
                    </T>
                  ) : null}

                  {/* Virtual Video Link */}
                  {s.slot?.meetingLink && isScheduled && (
                    <Button
                      title="Join Video Meeting"
                      icon={ExternalLink}
                      variant="soft"
                      small
                      onPress={() => Linking.openURL(s.slot.meetingLink)}
                    />
                  )}

                  {/* Shared Notes Preview */}
                  {s.sharedNotes ? (
                    <View style={{ gap: 2 }}>
                      <T v="label">Session Notes</T>
                      <T v="small" numberOfLines={3} style={{ color: colors.soft }}>
                        {s.sharedNotes}
                      </T>
                    </View>
                  ) : null}

                  {/* Action buttons */}
                  <View style={{ flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}>
                    <Button
                      title="Notes"
                      icon={FileText}
                      small
                      variant="outline"
                      style={{ flex: 1 }}
                      onPress={() => handleOpenNotes(s)}
                    />

                    {isScheduled && (
                      <Button
                        title="Cancel"
                        small
                        variant="outline"
                        style={{ flex: 1 }}
                        loading={isCancelling}
                        onPress={() => handleCancel(s._id)}
                      />
                    )}

                    {isScheduled && isAlumni && (
                      <Button
                        title="Mark Complete"
                        small
                        variant="success"
                        style={{ flex: 1 }}
                        loading={isCompleting}
                        onPress={() => handleComplete(s._id, 'completed')}
                      />
                    )}
                  </View>
                </Card>
              );
            }}
          />
        )}
      </View>

      {/* Edit Notes Modal */}
      <Modal visible={Boolean(editingSession)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Session Notes</T>
              <Pressable onPress={() => setEditingSession(null)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <Input
              label="Shared Meeting Notes (Visible to Mentor & Mentee)"
              placeholder="Action items, advice, recommended learning resources..."
              multiline
              numberOfLines={4}
              value={sharedNotes}
              onChangeText={setSharedNotes}
            />

            {isAlumni && (
              <Input
                label="Private Mentor Notes (Only visible to you)"
                placeholder="Candidate strengths, private evaluation notes..."
                multiline
                numberOfLines={3}
                value={privateNotes}
                onChangeText={setPrivateNotes}
              />
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Button
                title="Close"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setEditingSession(null)}
              />
              <Button
                title="Save Notes"
                style={{ flex: 1 }}
                loading={isUpdatingNotes}
                onPress={handleSaveNotes}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
    maxHeight: '85%',
  },
});
