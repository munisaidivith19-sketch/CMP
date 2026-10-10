import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { MapPin } from 'lucide-react-native';
import { Card, ErrorState, Header, Loading, Screen, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
import PassTimeline from '../../../components/PassTimeline';
import ReturnToCampus from '../../../components/ReturnToCampus';
import { EmergencyApprovedCode, EmergencyBadge, EmergencyDetails, emergencyStatusLabel, isEmergency } from '../../../components/EmergencyGatePass';
import { useGetGatePassQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { GATE_PASS_REGARDING, colors } from '../../../theme';
import { fmtClassDay, sameId, titleCase } from '../../../utils/format';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);
const isOuting = (p) => Boolean(p?.dayScholarOuting);
const destinationLine = (d) => (d ? [d.area, d.district, d.state].filter(Boolean).join(', ') : '—');

export default function GatePassDetail() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: p, isLoading, error, refetch, isFetching } = useGetGatePassQuery(id);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Gate pass" subtitle={p ? (isEmergency(p) ? 'Emergency gate pass' : isOuting(p) ? `Outing · ${p.subject || ''}` : regardingLabel(p.regarding)) : ''} right={p ? <StatusBadge status={p.status} label={emergencyStatusLabel(p) || undefined} /> : null} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            {isEmergency(p) ? (
              <>
                <EmergencyBadge />
                <EmergencyDetails pass={p} />
              </>
            ) : isOuting(p) ? (
              <>
                <T v="body">{p.description}</T>
                <T v="small">Today, {fmtClassDay(p.fromDate)} · no return check-in needed</T>
                <T v="small">Parent: {p.parentPhone}</T>
              </>
            ) : (
              <>
                <T v="body">{p.description}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MapPin size={13} color={colors.muted} />
                  <T v="small">{destinationLine(p.destination)}</T>
                </View>
                <T v="small">
                  {fmtClassDay(p.fromDate)} → {fmtClassDay(p.toDate)}
                </T>
                <T v="small">Parent: {p.parentPhone}</T>
              </>
            )}
            {p.rejectedReason ? <T v="small" style={{ color: colors.danger }}>Rejected ({p.rejectedStage}): {p.rejectedReason}</T> : null}
            {p.revokeReason ? <T v="small" style={{ color: colors.danger }}>Revoked: {p.revokeReason}</T> : null}
          </Card>
          <Card>
            <PassTimeline pass={p} />
          </Card>
          {sameId(p.student, me) && p.status === 'approved' ? (
            <Card>
              {isEmergency(p) ? <EmergencyApprovedCode pass={p} /> : <PassQr pass={p} />}
            </Card>
          ) : null}
          {sameId(p.student, me) && p.status === 'active' ? (
            <Card>
              <ReturnToCampus pass={p} />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
