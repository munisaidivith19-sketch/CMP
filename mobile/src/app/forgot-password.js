import { useState } from 'react';
import { MailCheck } from 'lucide-react-native';
import { Button, Card, EmptyState, Header, Input, Screen, T } from '../components/ui';
import { errMsg, useForgotPasswordMutation } from '../services/api';
import { colors } from '../theme';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState('');
  const [send, { isLoading }] = useForgotPasswordMutation();

  const submit = async () => {
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email');
    try {
      const res = await send({ email: email.trim() }).unwrap();
      setSent(res.message);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Screen>
      <Header back title="Reset password" subtitle="We’ll email you a secure, single-use link." />
      <Card style={{ gap: 14 }}>
        {sent ? (
          <EmptyState icon={MailCheck} title="Check your inbox" text={`${sent} The link expires in 15 minutes and opens the Vexon web app to set a new password.`} />
        ) : (
          <>
            <Input label="College email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@campus.edu" />
            {error ? <T v="small" style={{ color: colors.danger }}>{error}</T> : null}
            <Button title="Send reset link" onPress={submit} loading={isLoading} />
          </>
        )}
      </Card>
    </Screen>
  );
}
