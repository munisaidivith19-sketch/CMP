import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { RotateCw, Send, ShieldCheck } from 'lucide-react-native';
import { Badge, Button, Input, Loading, T } from './ui';
import { errMsg, useGetParentOtpQuery, useRequestParentOtpMutation, useVerifyParentOtpMutation } from '../services/api';
import { YEAR_LABELS, colors, radius } from '../theme';

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const secondsUntil = (d, now) => (d ? Math.max(0, Math.ceil((new Date(d).getTime() - now) / 1000)) : 0);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const NOT_LIVE_TEXT = {
  expired: 'The OTP expired. Send a new one to the parent.',
  locked: 'Too many incorrect attempts. Send a new OTP to the parent.',
  failed: 'The last OTP could not be sent. Try again.',
};

/** Faculty step: confirm the parent with a backend-issued OTP before forwarding to the HOD. */
export default function ParentVerification({ pass, onVerified }) {
  const { data, isLoading, error, refetch } = useGetParentOtpQuery(pass._id);
  const [send, { isLoading: sending }] = useRequestParentOtpMutation();
  const [verify, { isLoading: verifying }] = useVerifyParentOtpMutation();
  const [sent, setSent] = useState(null);
  const [otp, setOtp] = useState('');
  const [problem, setProblem] = useState('');

  const state = sent || data;
  const now = useNow(Boolean(state?.resendAvailableAt || state?.status === 'active'));
  const expiresIn = state?.status === 'active' ? secondsUntil(state.expiresAt, now) : 0;
  const live = expiresIn > 0;
  const resendIn = secondsUntil(state?.resendAvailableAt, now);
  const length = state?.otpLength ?? 0;
  const status = state?.status === 'active' && !live ? 'expired' : state?.status;

  const sendOtp = async () => {
    try {
      setSent(await send(pass._id).unwrap());
      setOtp('');
      setProblem('');
    } catch (e) {
      Alert.alert('Could not send OTP', errMsg(e));
      refetch();
    }
  };

  const submit = async () => {
    if (otp.length !== length) {
      setProblem(`Enter the ${length}-digit OTP`);
      return;
    }
    try {
      await verify({ id: pass._id, otp }).unwrap();
      Alert.alert('Parent verified', 'You can now forward the request to the HOD.');
      onVerified?.();
    } catch (err) {
      setProblem(errMsg(err, 'Could not verify the OTP'));
      setOtp('');
      setSent(null);
      refetch();
    }
  };

  const student = pass.student || {};
  const details = [
    ['Student', student.name],
    ['Department', student.department || pass.department],
    ['Year', YEAR_LABELS[student.year] || (student.year ? `Year ${student.year}` : '—')],
    ['Section', student.section || pass.section],
    ['Parent mobile', state?.parentMobile || pass.parentPhone],
  ];

  return (
    <View accessibilityLabel="Parent verification" style={{ gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <ShieldCheck size={16} color={colors.primary} />
        <T v="strong">Parent verification</T>
        {state?.devMode ? <Badge label="Development OTP service" color="warning" /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
        {details.map(([label, value]) => (
          <View key={label} style={{ width: '50%', paddingRight: 8 }}>
            <T v="small" style={{ color: colors.muted }}>
              {label}
            </T>
            <T v="strong">{value || '—'}</T>
          </View>
        ))}
      </View>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <T v="small" style={{ color: colors.danger }}>
          {errMsg(error)}
        </T>
      ) : live ? (
        <View style={{ gap: 8 }}>
          <T v="small">OTP sent to the registered parent mobile number.</T>
          <Input
            label={`Enter ${length}-digit OTP`}
            value={otp}
            onChangeText={(v) => {
              setOtp(v.replace(/\D/g, '').slice(0, length));
              setProblem('');
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={length}
            placeholder={'•'.repeat(length)}
            onSubmitEditing={submit}
            error={problem || undefined}
            accessibilityLabel="Enter OTP"
            style={{ alignSelf: 'stretch' }}
          />
          <Button title="Verify OTP" icon={ShieldCheck} loading={verifying} onPress={submit} />
          <Button title={resendIn > 0 ? `Resend OTP in ${resendIn}s` : 'Resend OTP'} icon={RotateCw} variant="outline" disabled={resendIn > 0} loading={sending} onPress={sendOtp} />
          <T v="small" style={{ color: colors.muted }}>
            {mmss(expiresIn)} remaining · {state.attemptsLeft} attempt{state.attemptsLeft === 1 ? '' : 's'} left
          </T>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {problem ? (
            <T v="small" style={{ color: colors.danger }}>
              {problem}
            </T>
          ) : null}
          <T v="small">{NOT_LIVE_TEXT[status] || 'Send an OTP to the parent’s registered mobile number, then enter the code they read out.'}</T>
          <Button
            title={resendIn > 0 ? `Send new OTP in ${resendIn}s` : status && status !== 'none' ? 'Send new OTP' : 'Send OTP'}
            icon={Send}
            disabled={resendIn > 0}
            loading={sending}
            onPress={sendOtp}
          />
        </View>
      )}
    </View>
  );
}
