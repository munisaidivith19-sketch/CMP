import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { Controller, useForm } from 'react-hook-form';
import { GraduationCap, Eye, EyeOff } from 'lucide-react-native';
import { Button, Card, Input, Screen, T } from '../components/ui';
import { errMsg, useLoginMutation } from '../services/api';
import { saveRefreshToken } from '../services/session';
import { setCredentials } from '../store/authSlice';
import { API_URL } from '../config';
import { colors, gradients } from '../theme';

export default function Login() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const [login, { isLoading }] = useLoginMutation();
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const { control, handleSubmit, formState: { errors } } = useForm({ defaultValues: { email: '', password: '' } });

  if (user) return <Redirect href="/" />;

  const onSubmit = async (values) => {
    setError('');
    try {
      const session = await login({ email: values.email.trim(), password: values.password }).unwrap();
      await saveRefreshToken(session.refreshToken);
      dispatch(setCredentials(session));
    } catch (e) {
      setError(errMsg(e, 'Sign in failed'));
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
          <Controller
            control={control}
            name="email"
            rules={{ required: 'Email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' } }}
            render={({ field }) => (
              <Input label="College email" value={field.value} onChangeText={field.onChange} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@campus.edu" error={errors.email} />
            )}
          />
          <View>
            <Controller
              control={control}
              name="password"
              rules={{ required: 'Password is required' }}
              render={({ field }) => (
                <Input label="Password" value={field.value} onChangeText={field.onChange} secureTextEntry={!show} autoComplete="password" placeholder="••••••••" error={errors.password} onSubmitEditing={handleSubmit(onSubmit)} />
              )}
            />
            <Pressable onPress={() => setShow((s) => !s)} style={{ position: 'absolute', right: 12, top: 34 }} accessibilityLabel={show ? 'Hide password' : 'Show password'} hitSlop={8}>
              {show ? <EyeOff size={18} color={colors.muted} /> : <Eye size={18} color={colors.muted} />}
            </Pressable>
          </View>
          {error ? <T v="small" style={{ color: colors.danger }}>{error}</T> : null}
          <Button title="Sign in" onPress={handleSubmit(onSubmit)} loading={isLoading} />
          <Link href="/forgot-password" style={{ alignSelf: 'center' }}>
            <T v="small" style={{ color: colors.primary }}>Forgot password?</T>
          </Link>
        </Card>
        <T v="small" style={{ textAlign: 'center', color: colors.muted }}>
          {API_URL ? `Server: ${API_URL.replace(/^https?:\/\//, '')}` : 'No server configured — set EXPO_PUBLIC_API_URL'}
        </T>
      </KeyboardAvoidingView>
    </Screen>
  );
}
