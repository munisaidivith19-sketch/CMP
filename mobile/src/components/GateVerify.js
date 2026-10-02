import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, CheckCircle2, LogIn, LogOut, ScanLine, ShieldCheck, XCircle } from 'lucide-react-native';
import { Avatar, Button, Card, Header, Input, Screen, StatusBadge, T } from './ui';
import QrScanner from './QrScanner';
import { scanProblem } from '../utils/gateQr';
import {
  errMsg,
  useGetSecurityDashboardQuery,
  useRecordGateInMutation,
  useRecordGateOutMutation,
  useVerifyGatePassMutation,
  useVerifyReturnCredentialMutation,
} from '../services/api';
import { GATE_PASS_REGARDING, YEAR_LABELS, colors } from '../theme';
import { fmtClassDay, titleCase } from '../utils/format';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);

const COPY = {
  in: {
    title: 'Return verification',
    subtitle: "Scan the student's Return QR or enter their Return Code.",
    placeholder: 'Return code',
    icon: LogIn,
    button: 'Student is inside',
    successTitle: 'Return recorded',
    successMessage: 'The parent and class faculty have been notified.',
    mismatch: '',
  },
  out: {
    title: 'Student OUT',
    subtitle: 'Ask the student for their code, then confirm they’re leaving.',
    placeholder: 'A4G5',
    icon: LogOut,
    button: 'Confirm OUT',
    successTitle: 'OUT recorded',
    successMessage: 'Have a safe trip.',
    mismatch: 'This student is already outside — use Return verification when they come back.',
  },
};

function Detail({ label, value }) {
  return (
    <View style={{ width: '50%', paddingRight: 8 }}>
      <T v="small" style={{ color: colors.muted }}>
        {label}
      </T>
      <T v="strong">{value || '—'}</T>
    </View>
  );
}

/** Gate guard's dedicated OUT page (exit code) and Return verification page (return QR/code). */
export default function GateVerify({ direction }) {
  const copy = COPY[direction];
  const isReturn = direction === 'in';
  const [code, setCode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [verifyExit, { isLoading: exitChecking }] = useVerifyGatePassMutation();
  const [verifyReturn, { isLoading: returnChecking }] = useVerifyReturnCredentialMutation();
  const [recordOut, { isLoading: outLoading }] = useRecordGateOutMutation();
  const [recordIn, { isLoading: inLoading }] = useRecordGateInMutation();
  const { refetch: refetchDash } = useGetSecurityDashboardQuery();
  const acting = outLoading || inLoading;

  // Accepts the typed code or a scanned QR value — same verification either way.
  const check = async (raw) => {
    const value = (typeof raw === 'string' ? raw : code).trim();
    if (!value) return;
    try {
      setResult({ ...(await (isReturn ? verifyReturn(value) : verifyExit(value)).unwrap()), credential: value });
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const confirm = async () => {
    try {
      if (isReturn) await recordIn({ id: result.pass._id, code: result.credential }).unwrap();
      else await recordOut({ id: result.pass._id, code: result.credential }).unwrap();
      Alert.alert(copy.successTitle, copy.successMessage);
      setResult(null);
      setCode('');
      refetchDash();
      router.back();
    } catch (err) {
      Alert.alert('Could not record', errMsg(err));
    }
  };

  const matches = isReturn ? result?.nextAction === 'inside' : result?.nextAction === 'out';
  const student = result?.pass?.student;

  return (
    <Screen>
      <Header back title={copy.title} subtitle={copy.subtitle} />
      <Card style={{ gap: 10 }}>
        <Button title="Scan QR code" icon={ScanLine} onPress={() => setScanOpen(true)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <T v="small" style={{ color: colors.muted }}>
            or enter code manually
          </T>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </View>
        <Input
          value={code}
          onChangeText={(v) => setCode(isReturn && /^ccrt:/i.test(v) ? v : v.toUpperCase())}
          placeholder={copy.placeholder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={isReturn ? 80 : 4}
          onSubmitEditing={() => check()}
          accessibilityLabel={isReturn ? 'Return code or QR' : 'Verification code'}
        />
        <Button title="Verify" icon={ShieldCheck} loading={exitChecking || returnChecking} onPress={() => check()} />
      </Card>
      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title={isReturn ? 'Scan return QR' : 'Scan gate pass QR'}
        onScanned={(value) => {
          setScanOpen(false);
          const problem = scanProblem(value, isReturn ? 'return' : 'exit');
          if (problem) setResult({ valid: false, problems: [problem] });
          else check(value);
        }}
      />

      {result ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: result.valid ? colors.successSoft : colors.dangerSoft, borderRadius: 16, padding: 10 }}>
            {result.valid ? <CheckCircle2 size={22} color={colors.success} /> : <XCircle size={22} color={colors.danger} />}
            <T v="strong" style={{ color: result.valid ? '#059669' : '#e11d48', flex: 1 }}>
              {result.valid ? (isReturn ? 'Return verification ready' : 'Valid pass') : 'Not valid'}
            </T>
          </View>
          {result.problems?.map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} color={colors.danger} />
              <T v="small" style={{ color: colors.danger, flex: 1 }}>{p}</T>
            </View>
          ))}
          {!result.valid ? <Button title="Scan again" icon={ScanLine} variant="outline" onPress={() => setScanOpen(true)} /> : null}
          {result.pass ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={student} size={40} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={2}>
                    {student?.name}
                  </T>
                  <T v="small" numberOfLines={1}>
                    {student?.rollNo || '—'}
                  </T>
                </View>
                {isReturn ? null : <StatusBadge status={result.pass.status} />}
              </View>
              {isReturn ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
                  <Detail label="Department" value={student?.department} />
                  <Detail label="Year" value={YEAR_LABELS[student?.year] || student?.year} />
                  <Detail label="Section" value={student?.section} />
                  <Detail label="Gate pass" value={result.passRef} />
                  <Detail label="Status" value="Return verification ready" />
                </View>
              ) : (
                <T v="small">
                  {result.pass.passType === 'emergency' ? 'Emergency gate pass' : regardingLabel(result.pass.regarding)} · {fmtClassDay(result.pass.fromDate)} → {fmtClassDay(result.pass.toDate)}
                </T>
              )}
              {result.valid && !matches && copy.mismatch ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} color={colors.warning} />
                  <T v="small" style={{ color: '#b45309', flex: 1 }}>{copy.mismatch}</T>
                </View>
              ) : null}
              {matches ? <Button title={copy.button} icon={copy.icon} variant={isReturn ? 'success' : 'primary'} loading={acting} onPress={confirm} /> : null}
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
