import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSelector } from 'react-redux';
import {
  Briefcase,
  Building,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
  T,
} from '../../../components/ui';
import {
  useCreateMentorshipRequestMutation,
  useGetAlumniProfileQuery,
  useRejectAlumniProfileMutation,
  useVerifyAlumniProfileMutation,
} from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../theme';

const DOMAINS = [
  { key: 'software_engineering', label: 'Software Eng' },
  { key: 'data_science', label: 'Data & AI' },
  { key: 'core_engineering', label: 'Core Eng' },
  { key: 'cybersecurity', label: 'Cybersecurity' },
  { key: 'higher_studies', label: 'Higher Studies' },
  { key: 'entrepreneurship', label: 'Startups' },
];

export default function AlumniProfileScreen() {
  const { id } = useLocalSearchParams();
  const currentUser = useSelector(selectUser);

  const { data, isLoading, error, refetch } = useGetAlumniProfileQuery(id);
  const [verifyProfile, { isLoading: isVerifying }] = useVerifyAlumniProfileMutation();
  const [rejectProfile, { isLoading: isRejecting }] = useRejectAlumniProfileMutation();
  const [createMentorshipRequest, { isLoading: isSubmittingReq }] = useCreateMentorshipRequestMutation();

  // Modals state
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqDomain, setReqDomain] = useState('software_engineering');
  const [reqMessage, setReqMessage] = useState('');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isStaff = ['admin', 'hod', 'principal'].includes(currentUser?.role);
  const isStudent = ['student', 'club_admin'].includes(currentUser?.role);

  if (isLoading) {
    return (
      <Screen>
        <Header back title="Profile" />
        <Loading label="Loading alumni profile..." />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <Header back title="Profile" />
        <ErrorState error={error} onRetry={refetch} />
      </Screen>
    );
  }

  const profile = data.profile || data;
  const user = data.user || profile.user || {};
  const isVerified = Boolean(profile.isVerified);
  const mentorshipStatus = data.mentorshipStatus;

  const handleSendRequest = async () => {
    if (reqMessage.trim().length < 5) return;
    try {
      await createMentorshipRequest({
        alumni: user._id || id,
        domain: reqDomain,
        message: reqMessage.trim(),
      }).unwrap();
      setShowReqModal(false);
      setReqMessage('');
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not send mentorship request');
    }
  };

  const handleVerify = async () => {
    try {
      await verifyProfile(profile._id).unwrap();
      alert('Alumni profile verified successfully!');
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not verify profile');
    }
  };

  const handleReject = async () => {
    if (rejectReason.trim().length < 5) return;
    try {
      await rejectProfile({ id: profile._id, reason: rejectReason.trim() }).unwrap();
      setShowRejectModal(false);
      alert('Alumni profile rejected');
      router.back();
    } catch (e) {
      alert(e?.data?.message || 'Could not reject profile');
    }
  };

  return (
    <Screen>
      <Header back title="Alumnus Profile" />

      {/* Profile Header Card */}
      <Card style={{ gap: 12, alignItems: 'center' }}>
        <Avatar user={user} name={user.name} size={72} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T v="h2">{user.name}</T>
            {isVerified ? (
              <Badge label="Verified" color="success" />
            ) : (
              <Badge label="Unverified" color="warning" />
            )}
          </View>
          <T v="strong" style={{ color: colors.ink, textAlign: 'center' }}>
            {profile.designation ? `${profile.designation}` : ''}
            {profile.designation && profile.company ? ' at ' : ''}
            {profile.company ? `${profile.company}` : (user.designation || 'Alumnus')}
          </T>
          <T v="small" style={{ color: colors.muted }}>
            {user.department} {profile.gradYear ? `· Class of ${profile.gradYear}` : ''}
          </T>
          {profile.location || profile.currentLocation ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <MapPin size={13} color={colors.soft} />
              <T v="small">{profile.location || profile.currentLocation}</T>
            </View>
          ) : null}
        </View>

        {/* Quick badging */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {profile.mentorshipAvailable && <Badge label="Mentorship Available" color="primary" />}
          {profile.openToReferrals && <Badge label="Open to Referrals" color="info" />}
        </View>
      </Card>

      {/* Staff Verification Banner if unverified */}
      {isStaff && !isVerified && (
        <Card style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.3)', gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <ShieldAlert size={18} color="#b45309" />
            <T v="strong" style={{ color: '#b45309' }}>Verification Required</T>
          </View>
          <T v="small">
            This alumnus profile is pending verification. Confirm their degree and credentials before approving.
          </T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button
              title="Verify Profile"
              small
              variant="success"
              style={{ flex: 1 }}
              loading={isVerifying}
              onPress={handleVerify}
            />
            <Button
              title="Reject"
              small
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => setShowRejectModal(true)}
            />
          </View>
        </Card>
      )}

      {/* Mentorship Offer & Action */}
      {profile.mentorshipAvailable && (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Sparkles size={18} color={colors.primary} />
              <T v="h3">Mentorship Offering</T>
            </View>
            <T v="small" style={{ color: colors.muted }}>
              {profile.activeMenteeCount || 0} / {profile.maxActiveMentees || 3} mentees
            </T>
          </View>

          {profile.domains && profile.domains.length > 0 && (
            <View style={{ gap: 6 }}>
              <T v="label">Domains of Guidance</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {profile.domains.map((d) => (
                  <Badge key={d} label={d.replace('_', ' ')} color="primary" />
                ))}
              </View>
            </View>
          )}

          {isStudent && (
            <View style={{ marginTop: 4 }}>
              {mentorshipStatus === 'accepted' ? (
                <View style={{ gap: 8 }}>
                  <Badge label="You are actively mentoring with this alumnus ✓" color="success" />
                  <Button
                    title="Book 1-on-1 Session"
                    variant="primary"
                    onPress={() => router.push(`/alumni/sessions/book?mentor=${user._id || id}`)}
                  />
                </View>
              ) : mentorshipStatus === 'pending' ? (
                <Badge label="Mentorship Request Pending Review ⏳" color="warning" />
              ) : (
                <Button
                  title="Request 1-on-1 Mentorship"
                  variant="primary"
                  onPress={() => {
                    setReqDomain(profile.domains?.[0] || 'software_engineering');
                    setShowReqModal(true);
                  }}
                />
              )}
            </View>
          )}
        </Card>
      )}

      {/* Skills */}
      {profile.skills && profile.skills.length > 0 && (
        <Card style={{ gap: 10 }}>
          <T v="strong">Expertise & Skills</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {profile.skills.map((s, idx) => (
              <Chip key={idx} label={s} />
            ))}
          </View>
        </Card>
      )}

      {/* Contact & Socials */}
      <Card style={{ gap: 12 }}>
        <T v="strong">Contact & Social</T>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Mail size={16} color={colors.soft} />
          <View style={{ flex: 1 }}>
            <T v="label">Email</T>
            {user.email ? (
              <Pressable onPress={() => Linking.openURL(`mailto:${user.email}`)}>
                <T v="body" style={{ color: colors.primary600, fontFamily: fonts.semibold }}>
                  {user.email}
                </T>
              </Pressable>
            ) : (
              <T v="small" style={{ color: colors.muted }}>Hidden by user privacy</T>
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Phone size={16} color={colors.soft} />
          <View style={{ flex: 1 }}>
            <T v="label">Phone</T>
            {user.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${user.phone}`)}>
                <T v="body" style={{ color: colors.primary600, fontFamily: fonts.semibold }}>
                  {user.phone}
                </T>
              </Pressable>
            ) : (
              <T v="small" style={{ color: colors.muted }}>Hidden by user privacy</T>
            )}
          </View>
        </View>

        {profile.linkedin ? (
          <Pressable
            onPress={() => Linking.openURL(profile.linkedin)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6 }}
          >
            <ExternalLink size={16} color={colors.primary600} />
            <T v="strong" style={{ color: colors.primary600 }}>LinkedIn Profile</T>
          </Pressable>
        ) : null}
      </Card>

      {/* Mentorship Request Modal */}
      <Modal visible={showReqModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Request Mentorship</T>
              <Pressable onPress={() => setShowReqModal(false)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <T v="small">
              Guidance request to <Text style={{ fontFamily: fonts.bold }}>{user.name}</Text>
            </T>

            <View style={{ gap: 6 }}>
              <T v="label">Mentorship Domain</T>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {DOMAINS.map((d) => (
                  <Chip
                    key={d.key}
                    label={d.label}
                    active={reqDomain === d.key}
                    onPress={() => setReqDomain(d.key)}
                  />
                ))}
              </ScrollView>
            </View>

            <Input
              label="Note to mentor"
              placeholder="Explain your goals, questions, and what guidance you are seeking..."
              multiline
              numberOfLines={4}
              value={reqMessage}
              onChangeText={setReqMessage}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Button
                title="Cancel"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setShowReqModal(false)}
              />
              <Button
                title="Send Request"
                style={{ flex: 1 }}
                loading={isSubmittingReq}
                disabled={reqMessage.trim().length < 5}
                onPress={handleSendRequest}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject Modal */}
      <Modal visible={showRejectModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Reject Alumni Profile</T>
              <Pressable onPress={() => setShowRejectModal(false)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <Input
              label="Reason for rejection"
              placeholder="Please explain why this profile cannot be verified (min 5 chars)..."
              multiline
              numberOfLines={3}
              value={rejectReason}
              onChangeText={setRejectReason}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="Cancel"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setShowRejectModal(false)}
              />
              <Button
                title="Confirm Reject"
                variant="danger"
                style={{ flex: 1 }}
                loading={isRejecting}
                disabled={rejectReason.trim().length < 5}
                onPress={handleReject}
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
