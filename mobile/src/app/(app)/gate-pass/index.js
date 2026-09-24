import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2, Clock, DoorOpen, LogIn, LogOut, MapPin, Plus, ShieldCheck, Users, XCircle } from 'lucide-react-native';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, Input, Loading, Screen, SectionTitle, Segmented, StatusBadge, T } from '../../../components/ui';
import PassQr from '../../../components/PassQr';
import {
  errMsg,
  useCancelGatePassMutation,
  useFacultyReviewGatePassMutation,
  useGetGateDashboardQuery,
  useGetGatePassesQuery,
  useGetSecurityDashboardQuery,
  useHodReviewGatePassMutation,
  usePrincipalReviewGatePassMutation,
  useRecordGateInMutation,
  useRecordGateOutMutation,
  useVerifyGatePassMutation,
} from '../../../services/api';
import { selectUser } from '../../../store/authSlice';
import { GATE_PASS_REGARDING, STUDENT_ROLES, colors } from '../../../theme';
import { fmtClassDay, timeAgo, titleCase } from '../../../utils/format';

const OPEN = ['pending_faculty', 'pending_hod', 'pending_principal', 'approved', 'active'];
const PENDING = ['pending_faculty', 'pending_hod', 'pending_principal'];
const destinationLine = (d) => (d ? [d.area, d.district, d.state].filter(Boolean).join(', ') : '');
const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);

/* ── Student ────────────────────────────────────────────────────── */
function StudentGatePasses() {
  const { data, isLoading, isFetching, error, refetch } = useGetGatePassesQuery({ limit: 20 });
  const [cancel, { isLoading: cancelling }] = useCancelGatePassMutation();
  const current = data?.passes.find((p) => OPEN.includes(p.status));

  const confirmCancel = () =>
    Alert.alert('Cancel this gate pass?', 'The request is withdrawn immediately.', [
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
                  {regardingLabel(current.regarding)}
                </T>
                <StatusBadge status={current.status} label={current.status.replace('pending_', 'waiting: ')} />
                {current.overdue ? <StatusBadge status="rejected" label="overdue" /> : null}
              </View>
              <T v="body">{current.description}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <MapPin size={12} color={colors.muted} />
                <T v="small">{destinationLine(current.destination)}</T>
              </View>
              <T v="small">
                {fmtClassDay(current.fromDate)} → {fmtClassDay(current.toDate)} · Parent: {current.parentPhone}
              </T>
              {PENDING.includes(current.status) ? (
                <EmptyState icon={Clock} title="Waiting for approval" text="You’ll get a notification the moment it moves to the next stage." />
              ) : (
                <PassQr pass={current} />
              )}
              {[...PENDING, 'approved'].includes(current.status) ? <Button title="Cancel pass" variant="danger" loading={cancelling} onPress={confirmCancel} /> : null}
            </Card>
          ) : (
            <Card>
              <EmptyState icon={DoorOpen} title="No active gate pass" text="Request one and tell your code to security once approved." action={<Button title="Request gate pass" icon={Plus} onPress={() => router.push('/gate-pass/new')} />} />
            </Card>
          )}
          <SectionTitle title="History" />
          {data.passes.filter((p) => p !== current).map((p) => (
            <Card key={p._id} onPress={() => router.push(`/gate-pass/${p._id}`)} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="strong">{regardingLabel(p.regarding)}</T>
                <StatusBadge status={p.status} />
              </View>
              <T v="small" numberOfLines={1}>
                {p.description}
              </T>
              <T v="small" style={{ color: colors.muted }}>
                {fmtClassDay(p.fromDate)} → {fmtClassDay(p.toDate)}
              </T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

/* ── Staff: faculty / HOD / principal / admin ─────────────────────── */
function StudentLine({ student, extra }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar user={student} size={40} />
      <View style={{ flex: 1 }}>
        <T v="strong" numberOfLines={1}>
          {student?.name}
        </T>
        <T v="small" numberOfLines={1}>
          {student?.rollNo || '—'} · {student?.department}
          {student?.section ? ` · Sec ${student.section}` : ''}
          {extra}
        </T>
      </View>
    </View>
  );
}

const STAGE_BY_STATUS = {
  pending_faculty: { hook: 'faculty', forwardLabel: 'Forward to HOD', action: 'forward' },
  pending_hod: { hook: 'hod', forwardLabel: 'Forward to Principal', action: 'forward' },
  pending_principal: { hook: 'principal', forwardLabel: 'Approve', action: 'approve' },
};

function ReviewCard({ pass, onDone }) {
  const [facultyReview, { isLoading: fLoading }] = useFacultyReviewGatePassMutation();
  const [hodReview, { isLoading: hLoading }] = useHodReviewGatePassMutation();
  const [principalReview, { isLoading: pLoading }] = usePrincipalReviewGatePassMutation();
  const mutations = { faculty: facultyReview, hod: hodReview, principal: principalReview };
  const stage = STAGE_BY_STATUS[pass.status];
  const saving = fLoading || hLoading || pLoading;
  if (!stage) return null;

  const act = async (action, reason) => {
    try {
      await mutations[stage.hook]({ id: pass._id, action, reason }).unwrap();
    } catch (e) {
      Alert.alert('Could not update', errMsg(e));
      return;
    }
    onDone?.();
  };

  const confirmReject = () =>
    Alert.prompt
      ? Alert.prompt('Reject gate pass', 'Reason (shared with the student)', (reason) => act('reject', reason?.trim() || undefined), 'plain-text')
      : Alert.alert('Reject this gate pass?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => act('reject') }]);

  return (
    <Card style={{ gap: 10 }}>
      <StudentLine student={pass.student} extra={` · ${timeAgo(pass.createdAt)}`} />
      <T v="small">
        <T v="strong">{regardingLabel(pass.regarding)}:</T> {pass.description}
      </T>
      <T v="small">{destinationLine(pass.destination)}</T>
      <T v="small" style={{ color: colors.muted }}>
        {fmtClassDay(pass.fromDate)} → {fmtClassDay(pass.toDate)} · Parent: {pass.parentPhone}
      </T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={stage.forwardLabel} variant={stage.action === 'approve' ? 'success' : 'primary'} small style={{ flex: 1 }} loading={saving} onPress={() => act(stage.action)} />
        <Button title="Reject" variant="danger" small style={{ flex: 1 }} loading={saving} onPress={confirmReject} />
      </View>
    </Card>
  );
}

const STAGE_STATUS = { faculty: 'pending_faculty', hod: 'pending_hod', principal: 'pending_principal' };

function ReviewQueue({ role }) {
  const isAdmin = role === 'admin';
  const { data, isLoading, error, refetch } = useGetGatePassesQuery(isAdmin ? { status: PENDING.join(',') } : undefined);
  const mine = isAdmin ? data?.passes : data?.passes.filter((p) => p.status === STAGE_STATUS[role]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!mine?.length) return <Card><EmptyState icon={CheckCircle2} title="No pending requests" text="New requests appear here instantly." /></Card>;

  return (
    <View style={{ gap: 12 }}>
      {mine.map((p) => (
        <ReviewCard key={p._id} pass={p} onDone={refetch} />
      ))}
    </View>
  );
}

function OutsideNow({ dash }) {
  if (!dash.outsideStudents.length) return <Card><EmptyState icon={Users} title="Everyone is on campus" /></Card>;
  return (
    <View style={{ gap: 10 }}>
      {dash.outsideStudents.map((p) => (
        <Card key={p._id} style={{ gap: 6 }}>
          <StudentLine student={p.student} extra={` · left ${timeAgo(p.actualExit)}`} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="small">due back {fmtClassDay(p.toDate)}</T>
            {p.overdue ? <Badge label="overdue" color="danger" /> : null}
          </View>
        </Card>
      ))}
    </View>
  );
}

function StaffGatePasses() {
  const me = useSelector(selectUser);
  const [tab, setTab] = useState('review');
  const { data: dash, isLoading, error, refetch } = useGetGateDashboardQuery();

  return (
    <Screen>
      <Header back title="Gate passes" subtitle={me.role === 'faculty' ? 'Requests from your class' : me.role === 'hod' ? 'Forwarded by your faculty' : me.role === 'principal' ? 'Final approval' : 'All stages'} />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Card style={{ width: '47.8%', gap: 2 }}>
            <T v="label">Pending</T>
            <T v="h2">{dash.pending}</T>
          </Card>
          <Card style={{ width: '47.8%', gap: 2 }}>
            <T v="label">Outside now</T>
            <T v="h2">{dash.studentsOutside}</T>
          </Card>
        </View>
      )}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'review', label: 'Review' },
          { value: 'outside', label: 'Outside' },
        ]}
      />
      {tab === 'review' && <ReviewQueue role={me.role} />}
      {tab === 'outside' && dash && <OutsideNow dash={dash} />}
    </Screen>
  );
}

/* ── Security ───────────────────────────────────────────────────── */
function SecurityConsole() {
  const { data: dash, isLoading, error, refetch } = useGetSecurityDashboardQuery(undefined, { pollingInterval: 30000 });
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [verify, { isLoading: verifying }] = useVerifyGatePassMutation();
  const [out, { isLoading: outLoading }] = useRecordGateOutMutation();
  const [in_, { isLoading: inLoading }] = useRecordGateInMutation();

  const check = async () => {
    if (!code.trim()) return;
    try {
      setResult(await verify(code.trim()).unwrap());
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const act = async (fn, title, message) => {
    try {
      const pass = await fn(result.pass._id).unwrap();
      Alert.alert(title, message);
      setResult({ ...result, pass: { ...result.pass, ...pass }, nextAction: null, done: true });
      setCode('');
      refetch();
    } catch (err) {
      Alert.alert('Could not record', errMsg(err));
    }
  };

  return (
    <Screen>
      <Header back title="Security console" subtitle="Verify a student's code, then record OUT or IN." />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Card style={{ width: '31%', gap: 2, alignItems: 'center' }}>
            <T v="label">Inside</T>
            <T v="h2">{dash.inside}</T>
          </Card>
          <Card style={{ width: '31%', gap: 2, alignItems: 'center' }}>
            <T v="label">Outside</T>
            <T v="h2">{dash.outside}</T>
          </Card>
          <Card style={{ width: '31%', gap: 2, alignItems: 'center' }}>
            <T v="label">Left today</T>
            <T v="h2">{dash.leftToday}</T>
          </Card>
        </View>
      )}
      <Card style={{ gap: 10 }}>
        <T v="h3">Verify a code</T>
        <T v="small">Ask the student for their 4-character code.</T>
        <Input
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="DF45"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={4}
          onSubmitEditing={check}
        />
        <Button title="Verify" icon={ShieldCheck} loading={verifying} onPress={check} />
      </Card>
      {result ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: result.valid ? colors.successSoft : colors.dangerSoft, borderRadius: 16, padding: 10 }}>
            {result.valid ? <CheckCircle2 size={22} color={colors.success} /> : <XCircle size={22} color={colors.danger} />}
            <T v="strong" style={{ color: result.valid ? '#059669' : '#e11d48' }}>
              {result.done ? 'Recorded' : result.valid ? 'Valid pass' : 'Not valid'}
            </T>
          </View>
          {result.problems?.map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} color={colors.danger} />
              <T v="small" style={{ color: colors.danger }}>{p}</T>
            </View>
          ))}
          {result.pass ? (
            <>
              <StudentLine student={result.pass.student} />
              <T v="small">
                {regardingLabel(result.pass.regarding)} · {fmtClassDay(result.pass.fromDate)} → {fmtClassDay(result.pass.toDate)}
              </T>
              {result.nextAction === 'out' ? (
                <Button title="OUT — record exit" icon={LogOut} loading={outLoading} onPress={() => act(out, 'OUT recorded', 'Have a safe trip.')} />
              ) : null}
              {result.nextAction === 'in' ? (
                <Button title="IN — record return" variant="success" icon={LogIn} loading={inLoading} onPress={() => act(in_, 'IN recorded', 'Class faculty has been notified.')} />
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

export default function GatePasses() {
  const me = useSelector(selectUser);
  if (me.role === 'security') return <SecurityConsole />;
  if (STUDENT_ROLES.includes(me.role)) return <StudentGatePasses />;
  return <StaffGatePasses />;
}
