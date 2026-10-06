import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  Flame,
  HeartPulse,
  HelpCircle,
  MapPin,
  Phone,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react-native';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Input,
  Loading,
  Screen,
  SectionTitle,
  Segmented,
  StatusBadge,
  T,
} from '../../components/ui';
import {
  errMsg,
  useAckSOSAlertMutation,
  useCreateSOSAlertMutation,
  useGetSOSAlertsQuery,
  useResolveSOSAlertMutation,
} from '../../services/api';
import { selectUser } from '../../store/authSlice';
import { SOS_RESPONDER_ROLES, colors, radius, shadow } from '../../theme';
import { timeAgo } from '../../utils/format';

const TYPE_CONFIG = [
  { type: 'medical', label: 'Medical Emergency', icon: HeartPulse },
  { type: 'security', label: 'Security Threat', icon: ShieldAlert },
  { type: 'fire', label: 'Fire Hazard', icon: Flame },
  { type: 'ragging', label: 'Ragging / Harassment', icon: Users },
  { type: 'other', label: 'Other Immediate Help', icon: HelpCircle },
];

const TYPE_ICONS = {
  medical: HeartPulse,
  security: ShieldAlert,
  fire: Flame,
  ragging: Users,
  other: HelpCircle,
};

function TriggerSOSModal({ visible, onClose, onCreated }) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState('medical');
  const [note, setNote] = useState('');
  const [createSOS, { isLoading }] = useCreateSOSAlertMutation();

  const handleSend = async () => {
    try {
      await createSOS({
        type,
        note: note.trim() || undefined,
      }).unwrap();
      Alert.alert(
        'Emergency Alert Sent',
        'Campus security, wardens, and management have been notified immediately.'
      );
      setNote('');
      setType('medical');
      onClose();
      onCreated?.();
    } catch (err) {
      Alert.alert('Failed to send SOS', errMsg(err));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close modal" />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <T v="h2" style={{ color: colors.danger }}>
              Emergency SOS Alert
            </T>
            <T v="small">Alerts campus security & administration immediately</T>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <X size={20} color={colors.soft} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          <T v="label">Select Emergency Type</T>
          <View style={{ gap: 8 }}>
            {TYPE_CONFIG.map((item) => {
              const Icon = item.icon;
              const isSelected = type === item.type;
              return (
                <Pressable
                  key={item.type}
                  onPress={() => setType(item.type)}
                  style={[
                    styles.typeCard,
                    isSelected && {
                      borderColor: colors.danger,
                      backgroundColor: colors.dangerSoft,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.typeIconBox,
                      isSelected && { backgroundColor: colors.danger },
                    ]}
                  >
                    <Icon size={18} color={isSelected ? '#fff' : colors.soft} />
                  </View>
                  <T
                    v="strong"
                    style={{
                      flex: 1,
                      color: isSelected ? colors.danger : colors.ink,
                    }}
                  >
                    {item.label}
                  </T>
                </Pressable>
              );
            })}
          </View>

          <Input
            label="Additional note (optional)"
            placeholder="e.g. Near chemistry lab ground floor"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
          />

          <Button
            title="Confirm & Broadcast SOS"
            variant="danger"
            onPress={handleSend}
            loading={isLoading}
            icon={AlertTriangle}
            style={{ marginTop: 6 }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function ResolveModal({ alert, visible, onClose, onResolved }) {
  const insets = useSafeAreaInsets();
  const [outcome, setOutcome] = useState('resolved');
  const [note, setNote] = useState('');
  const [resolveSOS, { isLoading }] = useResolveSOSAlertMutation();

  const handleResolve = async () => {
    if (!note.trim()) {
      Alert.alert('Note required', 'Please enter a brief resolution note');
      return;
    }
    try {
      await resolveSOS({
        id: alert._id,
        status: outcome,
        resolutionNote: note.trim(),
      }).unwrap();
      Alert.alert('Resolved', 'Emergency incident marked resolved.');
      setNote('');
      setOutcome('resolved');
      onClose();
      onResolved?.();
    } catch (err) {
      Alert.alert('Failed to resolve', errMsg(err));
    }
  };

  if (!alert) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close modal" />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <T v="h2">Resolve Emergency Alert</T>
            <T v="small">
              {alert.user?.name} · {alert.type}
            </T>
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <X size={20} color={colors.soft} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
          <T v="label">Resolution Outcome</T>
          <Segmented
            options={[
              { label: 'Resolved', value: 'resolved' },
              { label: 'False Alarm', value: 'false_alarm' },
            ]}
            value={outcome}
            onChange={setOutcome}
          />

          <Input
            label="Action taken / Resolution note"
            placeholder="Describe action taken to resolve this alert"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={500}
          />

          <Button
            title="Submit Resolution"
            onPress={handleResolve}
            loading={isLoading}
            style={{ marginTop: 4 }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function SOSScreen() {
  const me = useSelector(selectUser);
  const isResponder = SOS_RESPONDER_ROLES.includes(me?.role);

  const [triggerOpen, setTriggerOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [filter, setFilter] = useState('all');

  const statusParam = filter === 'all' ? undefined : filter;
  const { data, isLoading, isFetching, error, refetch } = useGetSOSAlertsQuery(
    { status: statusParam },
    { pollingInterval: isResponder ? 10000 : undefined }
  );

  const [ackSOS, { isLoading: isAcking }] = useAckSOSAlertMutation();

  const handleAck = async (alertId) => {
    try {
      await ackSOS(alertId).unwrap();
      Alert.alert(
        'Acknowledged',
        'Alert acknowledged. Student has been notified that help is dispatched.'
      );
    } catch (err) {
      Alert.alert('Error', errMsg(err));
    }
  };

  // REQUIRED correction §14 #2: read from data?.items (source used data?.alerts)
  const alerts = data?.items || [];

  return (
    <Screen
      scroll
      refreshing={isFetching && !isLoading}
      onRefresh={refetch}
      contentStyle={{ gap: 14 }}
    >
      <Header
        back
        title="Campus SOS"
        subtitle={
          isResponder
            ? 'Live emergency dispatch & responder feed'
            : 'Rapid emergency alert system'
        }
        right={
          <Button
            title="SOS"
            variant="danger"
            small
            onPress={() => setTriggerOpen(true)}
          />
        }
      />

      {/* Red-tinted quick trigger hero */}
      <Card
        style={{
          backgroundColor: colors.dangerSoft,
          borderColor: 'rgba(244,63,94,0.3)',
          borderWidth: 1,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <T v="strong" style={{ color: colors.danger }}>
              Need Immediate Emergency Help?
            </T>
            <T v="small">
              Press below to alert Security & Administration instantly.
            </T>
          </View>
        </View>

        <Button
          title="Trigger Emergency SOS"
          variant="danger"
          icon={AlertTriangle}
          onPress={() => setTriggerOpen(true)}
        />
      </Card>

      {isResponder ? (
        <Segmented
          options={[
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Acked', value: 'acknowledged' },
            { label: 'Resolved', value: 'resolved' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      ) : (
        <SectionTitle title="Alert History" />
      )}

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title={isResponder ? 'No emergency alerts' : 'No alerts recorded'}
          subtitle={
            isResponder
              ? 'All clear on campus. Live alerts will appear here.'
              : 'You have not triggered any SOS alerts.'
          }
        />
      ) : (
        alerts.map((item) => {
          const Icon = TYPE_ICONS[item.type] || HelpCircle;
          const isActive = item.status === 'active';
          const isAcked = item.status === 'acknowledged';
          const hasCoords = item.location?.lat != null && item.location?.lng != null;

          return (
            <Card
              key={item._id}
              style={[
                { gap: 10 },
                isActive && {
                  borderColor: colors.danger,
                  borderWidth: 1.5,
                  backgroundColor: 'rgba(244,63,94,0.04)',
                },
              ]}
            >
              {/* Type header + Status */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: radius.sm,
                      backgroundColor: isActive ? colors.danger : colors.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={16} color={isActive ? '#fff' : colors.primary600} />
                  </View>
                  <T v="strong" style={{ textTransform: 'capitalize' }}>
                    {item.type} Alert
                  </T>
                </View>
                <StatusBadge status={item.status} />
              </View>

              {/* Sender Info */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={item.user} size={36} />
                <View style={{ flex: 1 }}>
                  <T v="strong">{item.user?.name || 'Unknown'}</T>
                  <T v="small">
                    {item.department || item.user?.department || 'Campus'}
                    {item.section || item.user?.section ? ` · Sec ${item.section || item.user?.section}` : ''}
                    {' · '}
                    {timeAgo(item.createdAt)}
                  </T>
                </View>
              </View>

              {/* Phone */}
              {item.user?.phone ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Phone size={13} color={colors.primary} />
                  <T v="small">Contact: {item.user.phone}</T>
                </View>
              ) : null}

              {/* Note */}
              {item.note ? (
                <View
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.03)',
                    padding: 10,
                    borderRadius: radius.sm,
                  }}
                >
                  <T v="small" style={{ color: colors.ink }}>
                    {item.note}
                  </T>
                </View>
              ) : null}

              {/* Location Coordinates */}
              {hasCoords ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MapPin size={13} color={colors.soft} />
                  <T v="small">
                    GPS: {item.location.lat.toFixed(4)}, {item.location.lng.toFixed(4)}
                    {item.location.accuracy ? ` (±${item.location.accuracy}m)` : ''}
                  </T>
                </View>
              ) : null}

              {/* Resolution box */}
              {item.resolutionNote ? (
                <View
                  style={{
                    backgroundColor: colors.successSoft,
                    borderColor: 'rgba(16,185,129,0.3)',
                    borderWidth: 1,
                    padding: 10,
                    borderRadius: radius.sm,
                    gap: 2,
                  }}
                >
                  <T v="small" style={{ color: '#059669', fontFamily: 'PlusJakartaSans_700Bold' }}>
                    Resolution ({item.resolvedBy?.name || 'Staff'}):
                  </T>
                  <T v="small" style={{ color: '#047857' }}>
                    {item.resolutionNote}
                  </T>
                </View>
              ) : null}

              {/* Responder action buttons */}
              {isResponder && (isActive || isAcked) ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 10,
                    marginTop: 4,
                    justifyContent: 'flex-end',
                  }}
                >
                  {isActive ? (
                    <Button
                      title="Acknowledge"
                      variant="outline"
                      small
                      loading={isAcking}
                      onPress={() => handleAck(item._id)}
                    />
                  ) : null}
                  <Button
                    title="Resolve"
                    variant="primary"
                    small
                    onPress={() => setResolveTarget(item)}
                  />
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <TriggerSOSModal
        visible={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        onCreated={refetch}
      />

      <ResolveModal
        alert={resolveTarget}
        visible={Boolean(resolveTarget)}
        onClose={() => setResolveTarget(null)}
        onResolved={refetch}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,27,45,0.45)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 18,
    maxHeight: '85%',
    ...shadow,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(72,86,108,0.25)',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
