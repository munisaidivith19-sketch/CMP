import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { CheckCircle2, Clock, XCircle } from 'lucide-react-native';
import { Card, ErrorState, Header, Loading, Screen, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
import { useGetGatePassQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { colors } from '../../../theme';
import { fmtDateTime, sameId, titleCase } from '../../../utils/format';

function Step({ label, at, done, bad }) {
  const Icon = done ? (bad ? XCircle : CheckCircle2) : Clock;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon size={20} color={done ? (bad ? colors.danger : colors.success) : colors.muted} />
      <View>
        <T v="strong" style={!done && { color: colors.muted }}>
          {label}
        </T>
        {done && at ? <T v="small">{fmtDateTime(at)}</T> : null}
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
      <Header back title="Gate pass" subtitle={p ? titleCase(p.reason) : ''} right={p ? <StatusBadge status={p.status} /> : null} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            <T v="body">{p.description}</T>
            {p.destination ? <T v="small">Destination: {p.destination}</T> : null}
            <T v="small">
              {fmtDateTime(p.expectedExit)} → {fmtDateTime(p.expectedReturn)}
            </T>
            {p.rejectedReason ? <T v="small" style={{ color: colors.danger }}>Rejected: {p.rejectedReason}</T> : null}
            {p.revokeReason ? <T v="small" style={{ color: colors.danger }}>Revoked: {p.revokeReason}</T> : null}
          </Card>
          <Card style={{ gap: 12 }}>
            <Step label="Requested" at={p.createdAt} done />
            <Step label={p.status === 'rejected' ? 'Rejected' : 'Approved'} at={p.reviewedAt || p.approvedAt} done={Boolean(p.reviewedAt || p.approvedAt)} bad={p.status === 'rejected'} />
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
