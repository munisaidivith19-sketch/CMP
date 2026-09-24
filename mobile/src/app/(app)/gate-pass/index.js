import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { Clock, DoorOpen, Monitor, Plus } from 'lucide-react-native';
import { Button, Card, EmptyState, ErrorState, Header, Loading, Screen, SectionTitle, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
import { errMsg, useCancelGatePassMutation, useGetGatePassesQuery } from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { STUDENT_ROLES, colors } from '../../../theme';
import { fmtDateTime, titleCase } from '../../../utils/format';

export default function GatePasses() {
  const me = useSelector(selectUser);
  const isStudent = STUDENT_ROLES.includes(me.role);
  const { data, isLoading, isFetching, error, refetch } = useGetGatePassesQuery({ limit: 20 }, { skip: !isStudent });
  const [cancel, { isLoading: cancelling }] = useCancelGatePassMutation();
  const current = data?.passes.find((p) => ['pending', 'approved', 'active'].includes(p.status));

  if (!isStudent) {
    return (
      <Screen>
        <Header back title="Gate pass" />
        <Card>
          <EmptyState icon={Monitor} title="Review and verify on the web console" text="Faculty and admins approve requests and verify codes at the gate from the Vexon web app." />
        </Card>
      </Screen>
    );
  }

  const confirmCancel = () =>
    Alert.alert('Cancel this gate pass?', 'Its QR code stops working immediately.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel pass', style: 'destructive', onPress: () => cancel(current._id).unwrap().catch((e) => Alert.alert('Could not cancel', errMsg(e))) },
    ]);

  return (
    <Screen refreshing={isFetching && !isLoading} onRefresh={refetch}>
      <Header back title="Gate pass" subtitle="Leave campus with an approved pass." right={!current ? <Button small icon={Plus} title="Request" onPress={() => router.push('/gate-pass/new')} /> : null} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {current ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T v="h2" style={{ flex: 1 }}>
                  {titleCase(current.reason)}
                </T>
                <StatusBadge status={current.status} />
                {current.overdue ? <StatusBadge status="rejected" label="overdue" /> : null}
              </View>
              <T v="body">{current.description}</T>
              <T v="small">
                {current.destination ? `${current.destination} · ` : ''}
                {fmtDateTime(current.expectedExit)} → {fmtDateTime(current.expectedReturn)}
              </T>
              {current.status === 'pending' ? <EmptyState icon={Clock} title="Waiting for approval" text="You’ll get a notification the moment it’s reviewed." /> : <PassQr pass={current} />}
              {['pending', 'approved'].includes(current.status) ? <Button title="Cancel pass" variant="danger" loading={cancelling} onPress={confirmCancel} /> : null}
            </Card>
          ) : (
            <Card>
              <EmptyState icon={DoorOpen} title="No active gate pass" text="Request one and show its QR code at the gate once approved." action={<Button title="Request gate pass" icon={Plus} onPress={() => router.push('/gate-pass/new')} />} />
            </Card>
          )}
          <SectionTitle title="History" />
          {data.passes.filter((p) => p !== current).map((p) => (
            <Card key={p._id} onPress={() => router.push(`/gate-pass/${p._id}`)} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="strong">{titleCase(p.reason)}</T>
                <StatusBadge status={p.status} />
              </View>
              <T v="small" numberOfLines={1}>
                {p.description}
              </T>
              <T v="small" style={{ color: colors.muted }}>
                {fmtDateTime(p.expectedExit)} → {fmtDateTime(p.expectedReturn)}
              </T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
