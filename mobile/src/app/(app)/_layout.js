import { Redirect, Stack } from 'expo-router';
import { useSelector } from 'react-redux';
import { colors } from '../../theme';

/** Every screen in this group needs a signed-in user (the backend enforces it too). */
export default function AppLayout() {
  const user = useSelector((s) => s.auth.user);
  if (!user) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}
