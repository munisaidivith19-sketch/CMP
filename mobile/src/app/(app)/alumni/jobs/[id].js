import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSelector } from 'react-redux';
import { format } from 'date-fns';
import {
  Briefcase,
  Building,
  CalendarDays,
  CheckCircle,
  ExternalLink,
  MapPin,
  Send,
  Trash2,
  User,
  Users,
  X,
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
  StatusBadge,
  T,
} from '../../../../components/ui';
import {
  useApplyToJobMutation,
  useCloseAlumniJobMutation,
  useGetAlumniJobQuery,
  useGetJobApplicationsQuery,
  useGetMyApplicationsQuery,
  useRemoveAlumniJobMutation,
  useReopenAlumniJobMutation,
  useUpdateApplicationMutation,
  useWithdrawApplicationMutation,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

const APP_STATUSES = ['pending', 'referred', 'shortlisted', 'rejected', 'hired'];

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams();
  const currentUser = useSelector(selectUser);

  const { data: job, isLoading, error, refetch } = useGetAlumniJobQuery(id);
  const [applyToJob, { isLoading: isApplying }] = useApplyToJobMutation();
  const [withdrawApp, { isLoading: isWithdrawing }] = useWithdrawApplicationMutation();
  const [closeJob, { isLoading: isClosing }] = useCloseAlumniJobMutation();
  const [reopenJob, { isLoading: isReopening }] = useReopenAlumniJobMutation();
  const [removeJob, { isLoading: isRemoving }] = useRemoveAlumniJobMutation();
  const [updateAppStatus] = useUpdateApplicationMutation();

  const isStudent = ['student', 'club_admin'].includes(currentUser?.role);
  const isPoster = job?.postedBy?._id === currentUser?._id || job?.postedBy === currentUser?._id;
  const isStaff = ['admin', 'hod', 'principal'].includes(currentUser?.role);
  const canManage = isPoster || isStaff;

  // Student applications
  const { data: myAppsData } = useGetMyApplicationsQuery(undefined, { skip: !isStudent });
  const myApp = (myAppsData || []).find((a) => (a.job?._id || a.job) === id);

  // Poster applications
  const { data: applications = [], refetch: refetchApps } = useGetJobApplicationsQuery(id, { skip: !canManage });

  // Apply Modal state
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [coverNote, setCoverNote] = useState('');
  const [askReferral, setAskReferral] = useState(false);

  if (isLoading) {
    return (
      <Screen>
        <Header back title="Job Opportunity" />
        <Loading label="Loading job details..." />
      </Screen>
    );
  }

  if (error || !job) {
    return (
      <Screen>
        <Header back title="Job Opportunity" />
        <ErrorState error={error} onRetry={refetch} />
      </Screen>
    );
  }

  const handleApply = async () => {
    try {
      await applyToJob({
        id,
        note: coverNote.trim(),
        referralRequested: askReferral,
      }).unwrap();
      setShowApplyModal(false);
      setCoverNote('');
      alert('Application submitted successfully!');
    } catch (e) {
      alert(e?.data?.message || 'Could not submit application');
    }
  };

  const handleWithdraw = async () => {
    if (!myApp) return;
    try {
      await withdrawApp(myApp._id).unwrap();
      alert('Application withdrawn');
    } catch (e) {
      alert(e?.data?.message || 'Could not withdraw application');
    }
  };

  const handleStatusChange = async (appId, newStatus) => {
    try {
      await updateAppStatus({ id: appId, status: newStatus }).unwrap();
      refetchApps();
    } catch (e) {
      alert(e?.data?.message || 'Could not update status');
    }
  };

  return (
    <Screen>
      <Header back title={job.company} />

      {/* Main Job Card */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <T v="h2">{job.title}</T>
            <T v="strong" style={{ color: colors.ink }}>{job.company}</T>
          </View>
          <Badge label={job.status || 'open'} color={job.status === 'open' ? 'success' : 'neutral'} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Briefcase size={14} color={colors.soft} />
            <T v="small">{job.type.replace('_', ' ')}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MapPin size={14} color={colors.soft} />
            <T v="small">{job.location} ({job.workMode})</T>
          </View>
          {job.deadline && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CalendarDays size={14} color={colors.soft} />
              <T v="small">Deadline: {format(new Date(job.deadline), 'MMM d, yyyy')}</T>
            </View>
          )}
        </View>

        {/* Posted by card */}
        <Pressable
          onPress={() => {
            const uid = job.postedBy?._id || job.postedBy;
            if (uid) router.push(`/alumni/${uid}`);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.03)', padding: 10, borderRadius: 12 }}
        >
          <Avatar user={job.postedBy} name={job.postedBy?.name} size={36} />
          <View style={{ flex: 1 }}>
            <T v="strong">{job.postedBy?.name || 'Alumnus'}</T>
            <T v="small" style={{ color: colors.muted }}>
              {job.postedBy?.designation || 'Verified Alumnus'} · Tap to view profile
            </T>
          </View>
        </Pressable>
      </Card>

      {/* Description */}
      <Card style={{ gap: 8 }}>
        <T v="strong">Job Description</T>
        <T v="body" style={{ color: colors.ink, lineHeight: 22 }}>
          {job.description}
        </T>
      </Card>

      {/* Student Apply Section */}
      {isStudent && (
        <Card style={{ gap: 10 }}>
          <T v="strong">Application Status</T>
          {myApp ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="body">Current Status:</T>
                <StatusBadge status={myApp.status} />
              </View>
              {myApp.referralRequested && (
                <Badge label="Referral Requested" color="primary" />
              )}
              {myApp.status === 'pending' && (
                <Button
                  title="Withdraw Application"
                  variant="outline"
                  loading={isWithdrawing}
                  onPress={handleWithdraw}
                />
              )}
            </View>
          ) : job.applyMode === 'external' && job.externalUrl ? (
            <Button
              title="Apply on Company Website"
              icon={ExternalLink}
              onPress={() => Linking.openURL(job.externalUrl)}
            />
          ) : (
            <Button
              title="Apply for this Role"
              onPress={() => setShowApplyModal(true)}
            />
          )}
        </Card>
      )}

      {/* Poster / Staff Management Section */}
      {canManage && (
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="h3">Manage Job ({job.applicantCount || applications.length} Applicants)</T>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {job.status === 'open' ? (
                <Button title="Close" small variant="outline" loading={isClosing} onPress={() => closeJob(id)} />
              ) : (
                <Button title="Reopen" small variant="soft" loading={isReopening} onPress={() => reopenJob(id)} />
              )}
            </View>
          </View>

          {applications.length === 0 ? (
            <T v="small" style={{ color: colors.muted }}>No candidate applications yet.</T>
          ) : (
            applications.map((app) => {
              const cand = app.student || {};
              return (
                <View key={app._id} style={styles.applicantCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 }}>
                      <Avatar user={cand} name={cand.name} size={40} />
                      <View style={{ flex: 1 }}>
                        <T v="strong" numberOfLines={1}>{cand.name || 'Student'}</T>
                        <T v="small" style={{ color: colors.muted }}>
                          {cand.department} · {cand.rollNo || cand.email}
                        </T>
                      </View>
                    </View>
                    <StatusBadge status={app.status} />
                  </View>

                  {app.note ? (
                    <T v="small" style={{ color: colors.ink, backgroundColor: '#fff', padding: 8, borderRadius: 8 }}>
                      "{app.note}"
                    </T>
                  ) : null}

                  {/* Status Picker Chips */}
                  <View style={{ gap: 6 }}>
                    <T v="label">Update Status</T>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {APP_STATUSES.map((st) => (
                        <Chip
                          key={st}
                          label={st}
                          active={app.status === st}
                          onPress={() => handleStatusChange(app._id, st)}
                        />
                      ))}
                    </ScrollView>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      )}

      {/* Apply Modal for Students */}
      <Modal visible={showApplyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Apply for {job.title}</T>
              <Pressable onPress={() => setShowApplyModal(false)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <Input
              label="Cover Note / Why you're a fit"
              placeholder="Introduce yourself, your relevant coursework or projects, and why you're interested..."
              multiline
              numberOfLines={4}
              value={coverNote}
              onChangeText={setCoverNote}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="body">Request Alumnus Referral</T>
              <Chip
                label={askReferral ? 'Yes' : 'No'}
                active={askReferral}
                onPress={() => setAskReferral(!askReferral)}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Button
                title="Cancel"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setShowApplyModal(false)}
              />
              <Button
                title="Submit Application"
                style={{ flex: 1 }}
                loading={isApplying}
                onPress={handleApply}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  applicantCard: {
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
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
