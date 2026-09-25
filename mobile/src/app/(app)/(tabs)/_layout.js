import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Home, LayoutGrid, MessageCircle, UserRound } from 'lucide-react-native';
import { useGetChatUnreadQuery, useGetNotificationsQuery } from '../../../services/api';
import { colors, fonts } from '../../../theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { data: chat } = useGetChatUnreadQuery();
  const { data: notes } = useGetNotificationsQuery({ limit: 1 });
  const badge = (n) => (n ? (n > 99 ? '99+' : n) : undefined);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        // Leave room for the Android gesture bar / iOS home indicator.
        tabBarStyle: { backgroundColor: 'rgba(255,255,255,0.96)', borderTopColor: 'rgba(29,111,235,0.12)', height: 60 + insets.bottom, paddingBottom: 8 + insets.bottom, paddingTop: 6 },
        tabBarBadgeStyle: { backgroundColor: colors.danger, fontFamily: fonts.bold, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Home size={22} color={color} /> }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarBadge: badge(chat?.total), tabBarIcon: ({ color }) => <MessageCircle size={22} color={color} /> }} />
      <Tabs.Screen name="campus" options={{ title: 'Campus', tabBarIcon: ({ color }) => <LayoutGrid size={22} color={color} /> }} />
      <Tabs.Screen name="notifications" options={{ title: 'Alerts', tabBarBadge: badge(notes?.unread), tabBarIcon: ({ color }) => <Bell size={22} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <UserRound size={22} color={color} /> }} />
    </Tabs>
  );
}
