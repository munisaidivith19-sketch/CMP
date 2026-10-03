import { useState } from 'react';
import { FlatList, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import {
  CheckCircle,
  ExternalLink,
  GraduationCap,
  Mail,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
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
  T,
} from '../../../../components/ui';
import {
  useGetAlumniQuery,
  useRejectAlumniProfileMutation,
  useVerifyAlumniProfileMutation,
} from '../../../../services/api';
import { selectUser } from '../../../../store/authSlice';
import { colors, fonts, gradients, radius, shadow } from '../../../../theme';

export default function VerificationQueueScreen() {
  const currentUser = useSelector(selectUser);
  const { data, isLoading, isFetching, error, refetch } = useGetAlumniQuery({ unverified: 'true' });
  const [verifyProfile, { isLoading: isVerifying }] = useVerifyAlumniProfileMutation();
  const [rejectProfile, { isLoading: isRejecting }] = useRejectAlumniProfileMutation();

  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingList = data?.items || [];

  const handleVerify = async (profileId) => {
    try {
      await verifyProfile(profileId).unwrap();
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not verify profile');
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingItem || rejectReason.trim().length < 5) return;
    try {
      await rejectProfile({ id: rejectingItem._id, reason: rejectReason.trim() }).unwrap();
      setRejectingItem(null);
      setRejectReason('');
      refetch();
    } catch (e) {
      alert(e?.data?.message || 'Could not reject profile');
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 10 }}>
        <Header
          back
          title="Alumni Verification"
          subtitle={`${pendingList.length} unverified alumni profiles pending review`}
        />
      </View>

      <View style={{ flex: 1, marginTop: 8 }}>
        {isLoading ? (
          <Loading label="Loading verification queue..." />
        ) : error ? (
          <View style={{ padding: 16 }}>
            <ErrorState error={error} onRetry={refetch} />
          </View>
        ) : (
          <FlatList
            data={pendingList}
            keyExtractor={(item) => item._id}
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 40 }}
            ListEmptyComponent={
              <EmptyState
                icon={CheckCircle}
                title="Queue Is Clear"
                text="All alumni profiles have been verified or resolved."
              />
            }
            renderItem={({ item }) => {
              const u = item.user || {};
              return (
                <Card style={{ gap: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <Avatar user={u} name={u.name} size={48} />
                    <View style={{ flex: 1 }}>
                      <T v="strong" numberOfLines={1}>{u.name || 'Alumnus'}</T>
                      <T v="small" style={{ color: colors.ink }}>
                        {item.designation ? `${item.designation}` : ''}
                        {item.designation && item.company ? ' at ' : ''}
                        {item.company || u.email}
                      </T>
                      <T v="small" style={{ color: colors.muted }}>
                        {u.department} · Class of {item.gradYear || 'N/A'}
                      </T>
                    </View>
                    <Badge label="Pending" color="warning" />
                  </View>

                  {/* Degree / Career info */}
                  <View style={{ backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 10, gap: 4 }}>
                    <T v="small">
                      <Text style={{ fontFamily: fonts.bold }}>Email: </Text>{u.email}
                    </T>
                    {item.location ? (
                      <T v="small">
                        <Text style={{ fontFamily: fonts.bold }}>Location: </Text>{item.location}
                      </T>
                    ) : null}
                    {item.linkedin ? (
                      <Pressable
                        onPress={() => Linking.openURL(item.linkedin)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
                      >
                        <ExternalLink size={13} color={colors.primary600} />
                        <T v="small" style={{ color: colors.primary600, fontFamily: fonts.semibold }}>
                          View LinkedIn Profile
                        </T>
                      </Pressable>
                    ) : null}
                  </View>

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Button
                      title="Verify"
                      variant="success"
                      small
                      style={{ flex: 1 }}
                      loading={isVerifying}
                      onPress={() => handleVerify(item._id)}
                    />
                    <Button
                      title="Reject"
                      variant="danger"
                      small
                      style={{ flex: 1 }}
                      onPress={() => {
                        setRejectingItem(item);
                        setRejectReason('');
                      }}
                    />
                  </View>
                </Card>
              );
            }}
          />
        )}
      </View>

      {/* Reject Modal */}
      <Modal visible={Boolean(rejectingItem)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="h3">Reject Verification</T>
              <Pressable onPress={() => setRejectingItem(null)} hitSlop={10}>
                <X size={20} color={colors.ink} />
              </Pressable>
            </View>

            <T v="small">
              Rejecting profile for <Text style={{ fontFamily: fonts.bold }}>{rejectingItem?.user?.name}</Text>
            </T>

            <Input
              label="Rejection Reason *"
              placeholder="State why this profile is not eligible (min 5 chars)..."
              multiline
              numberOfLines={3}
              value={rejectReason}
              onChangeText={setRejectReason}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Button
                title="Cancel"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setRejectingItem(null)}
              />
              <Button
                title="Confirm Reject"
                variant="danger"
                style={{ flex: 1 }}
                loading={isRejecting}
                disabled={rejectReason.trim().length < 5}
                onPress={handleRejectConfirm}
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
