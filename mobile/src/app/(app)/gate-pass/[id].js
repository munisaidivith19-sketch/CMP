import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, Clock, MapPin, XCircle } from 'lucide-react-native';
import { Card, ErrorState, Header, Loading, Screen, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
import ReturnToCampus from '../../../components/ReturnToCampus';
import { AUTHORITY_LABELS, EmergencyApprovedCode, EmergencyBadge, EmergencyDetails, emergencyStatusLabel, isEmergency } from '../../../components/EmergencyGatePass';
import { useGetGatePassQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { GATE_PASS_REGARDING, colors } from '../../../theme';
import { fmtClassDay, sameId, timeAgo, titleCase } from '../../../utils/format';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);
const destinationLine = (d) => (d ? [d.area, d.district, d.state].filter(Boolean).join(', ') : '—');

function Step({ label, at, done, bad, note }) {
  const Icon = done ? (bad ? XCircle : CheckCircle2) : Clock;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Icon size={20} color={done ? (bad ? colors.danger : colors.success) : colors.muted} />
      <View>
        <T v="strong" style={!done && { color: colors.muted }}>
          {label}
        </T>
        {done && at ? <T v="small">{timeAgo(at)}</T> : null}
        {note ? <T v="small" style={{ color: colors.danger }}>“{note}”</T> : null}
      </View>
    </View>
  );
}

export default function GatePassDetail() {
  const { id } = useLocalSearchParams();
  const me = useSelector(selectUser);
  const { data: p, isLoading, error, refetch, isFetching } = useGetGatePassQuery(id);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Gate pass" subtitle={p ? (isEmergency(p) ? 'Emergency gate pass' : regardingLabel(p.regarding)) : ''} right={p ? <StatusBadge status={p.status} label={emergencyStatusLabel(p) || undefined} /> : null} />
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
          <Card style={{ gap: 14 }}>
            <Step label="Requested" at={p.createdAt} done />
            {isEmergency(p) ? (
              <Step
                label={`${AUTHORITY_LABELS[p.emergencyAuthority]} approval`}
                at={p.emergencyReview?.at}
                done={Boolean(p.emergencyReview)}
                bad={p.emergencyReview?.action === 'rejected'}
                note={p.emergencyReview?.action === 'rejected' ? p.emergencyReview.reason : null}
              />
            ) : (
            <>
            {p.parentVerifiedAt || ['pending_faculty', 'parent_verified'].includes(p.status) ? (
              <Step label="Parent verified (OTP)" at={p.parentVerifiedAt} done={Boolean(p.parentVerifiedAt)} />
            ) : null}
            <Step label="Faculty review" at={p.facultyReview?.at} done={Boolean(p.facultyReview)} bad={p.facultyReview?.action === 'rejected'} note={p.facultyReview?.action === 'rejected' ? p.facultyReview.reason : null} />
            <Step label="HOD review" at={p.hodReview?.at} done={Boolean(p.hodReview)} bad={p.hodReview?.action === 'rejected'} note={p.hodReview?.action === 'rejected' ? p.hodReview.reason : null} />
            <Step label="Principal approval" at={p.principalReview?.at} done={Boolean(p.principalReview)} bad={p.principalReview?.action === 'rejected'} note={p.principalReview?.action === 'rejected' ? p.principalReview.reason : null} />
            </>
            )}
            <Step label="Left campus" at={p.actualExit} done={Boolean(p.actualExit)} />
            {p.actualExit ? <Step label="Return location verified" at={p.returnLocationVerifiedAt} done={Boolean(p.returnLocationVerifiedAt)} /> : null}
            <Step label="Returned" at={p.actualReturn} done={Boolean(p.actualReturn)} />
            {['cancelled', 'revoked', 'expired'].includes(p.status) ? <Step label={titleCase(p.status)} done bad /> : null}
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
