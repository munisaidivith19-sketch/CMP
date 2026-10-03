import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { Controller, useForm } from 'react-hook-form';
import { GraduationCap, Eye, EyeOff, Server, ShieldAlert } from 'lucide-react-native';
import { Button, Card, Input, Screen, T } from '../components/ui';
import { errMsg, useLoginMutation } from '../services/api';
import { saveRefreshToken } from '../services/session';
import { setCredentials } from '../store/authSlice';
import { checkServer, defaultApiUrl, getApiUrl, isServerOverridden, setServerUrl } from '../config';
import { colors, gradients } from '../theme';

/**
 * Where the app finds the backend. A phone on mobile data needs a public address
 * (a deployed https:// URL or an internet tunnel); this lets one APK use any of them.
 */
function ServerSettings() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getApiUrl());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const shown = getApiUrl().replace(/^https?:[/][/]/, '');

  const save = async () => {
    setBusy(true);
    const res = await checkServer(url);
    setStatus(res);
    if (res.ok) await setServerUrl(url);
    setBusy(false);
  };
  const reset = async () => {
    const next = await setServerUrl('');
    setUrl(next);
    setStatus(null);
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }} hitSlop={8} accessibilityRole="button">
        <Server size={14} color={colors.muted} />
        <T v="small" style={{ color: colors.muted }}>
          {shown ? `Server: ${shown}` : 'No server configured — tap to set one'}
        </T>
      </Pressable>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <T v="h3">Server address</T>
      <T v="small">Use your college's Vexon address, e.g. https://vexon.example.edu</T>
      <Input value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" />
      {status ? <T v="small" style={{ color: status.ok ? colors.success : colors.danger }}>{status.message}</T> : null}
      <Button title="Test & save" onPress={save} loading={busy} disabled={!url.trim()} />
      {isServerOverridden() && defaultApiUrl() ? <Button title="Use default server" variant="ghost" onPress={reset} /> : null}
      <Button title="Close" variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

export default function Login() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [login, { isLoading }] = useLoginMutation();
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [lockedInfo, setLockedInfo] = useState(null);
  const [remainingAttempts, setRemainingAttempts] = useState(null);
  const { control, handleSubmit, formState: { errors } } = useForm({ defaultValues: { email: '', password: '' } });

  if (user) return <Redirect href="/" />;

  const onSubmit = async (values) => {
    setError('');
    try {
      const session = await login({ email: values.email.trim(), password: values.password }).unwrap();
      setLockedInfo(null);
      setRemainingAttempts(null);
      await saveRefreshToken(session.refreshToken);
      dispatch(setCredentials(session));
    } catch (e) {
      const data = e?.data;
      if (e?.status === 423 || data?.locked) {
        setLockedInfo(data?.message || 'Account temporarily locked due to multiple failed sign-in attempts.');
        setRemainingAttempts(null);
      } else {
        if (data?.remainingAttempts !== undefined) {
          setRemainingAttempts(data.remainingAttempts);
        }
        setError(errMsg(e, 'Sign in failed'));
      }
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: 18, paddingTop: 30 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <LinearGradient colors={gradients.primary} style={{ width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
            <GraduationCap size={30} color="#fff" />
          </LinearGradient>
          <T v="h1">Welcome back 👋</T>
          <T v="small" style={{ textAlign: 'center' }}>
            Sign in with your college email to continue.
          </T>
        </View>
        <Card style={{ gap: 14 }}>
          {lockedInfo ? (
            <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 12, gap: 6, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.25)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ShieldAlert size={18} color={colors.danger} />
                <T v="strong" style={{ color: colors.danger }}>Account Temporarily Locked</T>
              </View>
              <T v="small" style={{ color: colors.danger }}>{lockedInfo}</T>
            </View>
          ) : null}

          {!lockedInfo && remainingAttempts !== null && remainingAttempts > 0 ? (
            <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.25)' }}>
              <T v="small" style={{ color: '#d97706' }}>
                ⚠️ Invalid credentials. {remainingAttempts} attempt{remainingAttempts > 1 ? 's' : ''} remaining before temporary lockout.
              </T>
            </View>
          ) : null}

          <Controller
            control={control}
            name="email"
            rules={{ required: 'Email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } }}
            render={({ field }) => (
              <Input label="College email" value={field.value} onChangeText={field.onChange} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@campus.edu" error={errors.email} editable={!lockedInfo} />
            )}
          />
          <View>
            <Controller
              control={control}
              name="password"
              rules={{ required: 'Password is required' }}
              render={({ field }) => (
                <Input label="Password" value={field.value} onChangeText={field.onChange} secureTextEntry={!show} autoComplete="password" placeholder="••••••••" error={errors.password} onSubmitEditing={handleSubmit(onSubmit)} editable={!lockedInfo} />
              )}
            />
            <Pressable onPress={() => setShow((s) => !s)} style={{ position: 'absolute', right: 12, top: 34 }} accessibilityLabel={show ? 'Hide password' : 'Show password'} hitSlop={8}>
              {show ? <EyeOff size={18} color={colors.muted} /> : <Eye size={18} color={colors.muted} />}
            </Pressable>
          </View>
          {error && !lockedInfo ? <T v="small" style={{ color: colors.danger }}>{error}</T> : null}
          <Button title={lockedInfo ? 'Locked' : 'Sign in'} onPress={handleSubmit(onSubmit)} loading={isLoading} disabled={Boolean(lockedInfo)} />
          <Link href="/forgot-password" style={{ alignSelf: 'center' }}>
            <T v="small" style={{ color: colors.primary }}>Forgot password?</T>
          </Link>
        </Card>
        <ServerSettings />
      </KeyboardAvoidingView>
    </Screen>
  );
}
