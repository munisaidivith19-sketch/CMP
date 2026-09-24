import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { CheckCircle2, LaptopMinimal, Smartphone, XCircle } from 'lucide-react-native';
import { Badge, Button, Card, ErrorState, Header, Input, Loading, Screen, SectionTitle, T } from '../../../components/ui';
import { errMsg, useChangePasswordMutation, useGetLoginHistoryQuery, useGetSessionsQuery, useRevokeOtherSessionsMutation, useRevokeSessionMutation } from '../../../services/api';
import { saveRefreshToken } from '../../../services/session';
import { setCredentials } from '../../../store/authSlice';
import { colors } from '../../../theme';
import { fmtDateTime, timeAgo } from '../../../utils/format';

function ChangePassword() {
  const dispatch = useDispatch();
  const [change, { isLoading }] = useChangePasswordMutation();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const submit = async () => {
    if (f.next.length < 8 || !/[A-Za-z]/.test(f.next) || !/\d/.test(f.next)) return Alert.alert('Weak password', 'Use 8+ characters with a letter and a number.');
    if (f.next !== f.confirm) return Alert.alert('Passwords do not match');
    try {
      const session = await change({ currentPassword: f.current, newPassword: f.next }).unwrap();
      await saveRefreshToken(session.refreshToken);
      dispatch(setCredentials(session));
      setF({ current: '', next: '', confirm: '' });
      Alert.alert('Password changed', 'Your other devices were signed out.');
    } catch (e) {
      Alert.alert('Could not change password', errMsg(e));
    }
  };
  return (
    <Card style={{ gap: 12 }}>
      <Input label="Current password" secureTextEntry value={f.current} onChangeText={(current) => setF((s) => ({ ...s, current }))} />
      <Input label="New password" secureTextEntry value={f.next} onChangeText={(next) => setF((s) => ({ ...s, next }))} hint="8–72 characters, a letter and a number" />
      <Input label="Confirm new password" secureTextEntry value={f.confirm} onChangeText={(confirm) => setF((s) => ({ ...s, confirm }))} />
      <Button title="Update password" onPress={submit} loading={isLoading} disabled={!f.current || !f.next} />
    </Card>
  );
}

export default function Security() {
  const sessions = useGetSessionsQuery();
  const history = useGetLoginHistoryQuery({ limit: 15 });
  const [revoke] = useRevokeSessionMutation();
  const [revokeOthers, { isLoading: revoking }] = useRevokeOtherSessionsMutation();
  const others = (sessions.data || []).filter((s) => !s.current);

  return (
    <Screen refreshing={sessions.isFetching} onRefresh={() => [sessions, history].forEach((q) => !q.isUninitialized && q.refetch())}>
      <Header back title="Account security" subtitle="Devices, password and sign-in history." />
      <SectionTitle title="Signed-in devices" />
      {sessions.isLoading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorState error={sessions.error} onRetry={sessions.refetch} />
      ) : (
        <Card style={{ gap: 12 }}>
          {sessions.data.map((s) => {
            const Icon = s.client === 'mobile' ? Smartphone : LaptopMinimal;
            return (
              <View key={s._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <T v="strong" numberOfLines={1}>{s.device || 'Unknown device'}</T>
                  <T v="small">Active {timeAgo(s.lastUsedAt)}</T>
                </View>
                {s.current ? (
                  <Badge label="This device" color="success" />
                ) : (
                  <Button small variant="ghost" title="Sign out" onPress={() => revoke(s._id).unwrap().catch((e) => Alert.alert('Error', errMsg(e)))} />
                )}
              </View>
            );
          })}
          {others.length ? (
            <Button
              title="Sign out all other devices"
              variant="danger"
              loading={revoking}
              onPress={() =>
                Alert.alert('Sign out other devices?', 'Every other browser and phone will need to sign in again.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => revokeOthers().unwrap().catch((e) => Alert.alert('Error', errMsg(e))) },
                ])
              }
            />
          ) : null}
        </Card>
      )}

      <SectionTitle title="Change password" />
      <ChangePassword />

      <SectionTitle title="Sign-in history" />
      <Card style={{ gap: 10 }}>
        {history.isLoading ? (
          <Loading />
        ) : (
          (history.data?.records || []).map((r) => (
            <View key={r._id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {r.success ? <CheckCircle2 size={18} color={colors.success} /> : <XCircle size={18} color={colors.danger} />}
              <View style={{ flex: 1 }}>
                <T v="strong" numberOfLines={1}>{r.success ? 'Signed in' : 'Failed sign-in'} · {r.device || 'Unknown'}</T>
                <T v="small">{fmtDateTime(r.createdAt)}</T>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
