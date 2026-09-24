import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, Clock, MapPin, XCircle } from 'lucide-react-native';
import { Card, ErrorState, Header, Loading, Screen, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
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
      <Header back title="Gate pass" subtitle={p ? regardingLabel(p.regarding) : ''} right={p ? <StatusBadge status={p.status} /> : null} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            <T v="body">{p.description}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MapPin size={13} color={colors.muted} />
              <T v="small">{destinationLine(p.destination)}</T>
            </View>
            <T v="small">
              {fmtClassDay(p.fromDate)} → {fmtClassDay(p.toDate)}
            </T>
            <T v="small">Parent: {p.parentPhone}</T>
            {p.rejectedReason ? <T v="small" style={{ color: colors.danger }}>Rejected ({p.rejectedStage}): {p.rejectedReason}</T> : null}
            {p.revokeReason ? <T v="small" style={{ color: colors.danger }}>Revoked: {p.revokeReason}</T> : null}
          </Card>
          <Card style={{ gap: 14 }}>
            <Step label="Requested" at={p.createdAt} done />
            <Step label="Faculty review" at={p.facultyReview?.at} done={Boolean(p.facultyReview)} bad={p.facultyReview?.action === 'rejected'} note={p.facultyReview?.action === 'rejected' ? p.facultyReview.reason : null} />
            <Step label="HOD review" at={p.hodReview?.at} done={Boolean(p.hodReview)} bad={p.hodReview?.action === 'rejected'} note={p.hodReview?.action === 'rejected' ? p.hodReview.reason : null} />
            <Step label="Principal approval" at={p.principalReview?.at} done={Boolean(p.principalReview)} bad={p.principalReview?.action === 'rejected'} note={p.principalReview?.action === 'rejected' ? p.principalReview.reason : null} />
            <Step label="Left campus" at={p.actualExit} done={Boolean(p.actualExit)} />
            <Step label="Returned" at={p.actualReturn} done={Boolean(p.actualReturn)} />
            {['cancelled', 'revoked', 'expired'].includes(p.status) ? <Step label={titleCase(p.status)} done bad /> : null}
          </Card>
          {sameId(p.student, me) && ['approved', 'active'].includes(p.status) ? (
            <Card>
              <PassQr pass={p} />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
