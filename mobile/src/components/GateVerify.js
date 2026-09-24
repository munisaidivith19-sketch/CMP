import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, CheckCircle2, LogIn, LogOut, ShieldCheck, XCircle } from 'lucide-react-native';
import { Avatar, Button, Card, Header, Input, Screen, StatusBadge, T } from './ui';
import { errMsg, useGetSecurityDashboardQuery, useRecordGateInMutation, useRecordGateOutMutation, useVerifyGatePassMutation } from '../services/api';
import { GATE_PASS_REGARDING, colors } from '../theme';
import { fmtClassDay, titleCase } from '../utils/format';

const regardingLabel = (r) => GATE_PASS_REGARDING[r] || titleCase(r);

const COPY = {
  in: {
    title: 'Student IN',
    subtitle: "Ask the student for their code, then confirm they're entering.",
    icon: LogIn,
    button: 'Confirm IN',
    successTitle: 'IN recorded',
    successMessage: 'Class faculty has been notified.',
    mismatch: 'This student has not left campus yet — use the OUT page first.',
  },
  out: {
    title: 'Student OUT',
    subtitle: 'Ask the student for their code, then confirm they’re leaving.',
    icon: LogOut,
    button: 'Confirm OUT',
    successTitle: 'OUT recorded',
    successMessage: 'Have a safe trip.',
    mismatch: 'This code is already outside — use the IN page instead.',
  },
};

/** Shared verify → act flow for the gate guard's dedicated IN and OUT pages. */
export default function GateVerify({ direction }) {
  const copy = COPY[direction];
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [verify, { isLoading: verifying }] = useVerifyGatePassMutation();
  const [recordOut, { isLoading: outLoading }] = useRecordGateOutMutation();
  const [recordIn, { isLoading: inLoading }] = useRecordGateInMutation();
  const { refetch: refetchDash } = useGetSecurityDashboardQuery();
  const acting = outLoading || inLoading;

  const check = async () => {
    if (!code.trim()) return;
    try {
      setResult(await verify(code.trim()).unwrap());
    } catch (err) {
      setResult({ valid: false, problems: [errMsg(err, 'Invalid code')] });
    }
  };

  const confirm = async () => {
    const fn = direction === 'in' ? recordIn : recordOut;
    try {
      await fn(result.pass._id).unwrap();
      Alert.alert(copy.successTitle, copy.successMessage);
      setResult(null);
      setCode('');
      refetchDash();
      router.back();
    } catch (err) {
      Alert.alert('Could not record', errMsg(err));
    }
  };

  const matches = result?.nextAction === direction;

  return (
    <Screen>
      <Header back title={copy.title} subtitle={copy.subtitle} />
      <Card style={{ gap: 10 }}>
        <Input
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="DF45"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={4}
          autoFocus
          onSubmitEditing={check}
        />
        <Button title="Verify" icon={ShieldCheck} loading={verifying} onPress={check} />
      </Card>

      {result ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: result.valid ? colors.successSoft : colors.dangerSoft, borderRadius: 16, padding: 10 }}>
            {result.valid ? <CheckCircle2 size={22} color={colors.success} /> : <XCircle size={22} color={colors.danger} />}
            <T v="strong" style={{ color: result.valid ? '#059669' : '#e11d48' }}>
              {result.valid ? 'Valid pass' : 'Not valid'}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={result.pass.student} size={40} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>
                    {result.pass.student?.name}
                  </T>
                  <T v="small" numberOfLines={1}>
                    {result.pass.student?.rollNo || '—'} · Year {result.pass.student?.year || '—'} · {result.pass.student?.department || '—'}
                  </T>
                </View>
                <StatusBadge status={result.pass.status} />
              </View>
              <T v="small">
                {regardingLabel(result.pass.regarding)} · {fmtClassDay(result.pass.fromDate)} → {fmtClassDay(result.pass.toDate)}
              </T>
              {result.valid && !matches ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} color={colors.warning} />
                  <T v="small" style={{ color: '#b45309', flex: 1 }}>{copy.mismatch}</T>
                </View>
              ) : null}
              {matches ? <Button title={copy.button} icon={copy.icon} variant={direction === 'in' ? 'success' : 'primary'} loading={acting} onPress={confirm} /> : null}
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
