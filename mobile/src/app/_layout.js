import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Provider, useDispatch, useSelector, useStore } from 'react-redux';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react-native';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { store } from '../store';
import { loggedOut, sessionChecked, setCredentials } from '../store/authSlice';
import { api, useRegisterPushTokenMutation } from '../services/api';
import { refreshSession } from '../services/session';
import { connectSocket, disconnectSocket } from '../services/socket';
import { getPushToken, linkFromNotification } from '../services/push';
import { colors, fonts } from '../theme';
import { getApiUrl, loadServerOverride } from '../config';
import { useOnline } from '../services/connection';
import { Button, T } from '../components/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Live event → cached data to refresh (identical to the web app's mapping).
const LIVE_TAGS = {
  notification: ['Notification', 'Dashboard'],
  'announcement:changed': ['Announcement', 'Dashboard'],
  'event:changed': ['Event', 'Dashboard'],
  'club:changed': ['Club', 'Dashboard'],
  'discussion:changed': ['Discussion', 'Dashboard'],
  'attendance:updated': ['Attendance', 'Correction'],
  'gatepass:updated': ['GatePass'],
  'timetable:updated': ['Timetable'],
  'lostfound:updated': ['LostFound'],
  'chat:message': ['Chat'],
  'chat:conversation': ['Chat'],
  'chat:read': ['Chat'],
  'chat:messageDeleted': ['Chat'],
};

/**
 * Restore the session from SecureStore once at launch. If the phone is offline
 * (or the server is down) we must not throw the user back to the login screen —
 * their saved session is still valid — so report "offline" and let them retry.
 */
function useSessionRestore() {
  const dispatch = useDispatch();
  const [offline, setOffline] = useState(false);
  const restore = useCallback(async () => {
    setOffline(false);
    await loadServerOverride();
    const session = await refreshSession();
    if (session?.offline) {
      setOffline(true);
      return;
    }
    if (session?.accessToken) dispatch(setCredentials(session));
    dispatch(sessionChecked());
  }, [dispatch]);
  useEffect(() => {
    restore();
  }, [restore]);
  const skip = useCallback(() => {
    setOffline(false);
    dispatch(sessionChecked());
  }, [dispatch]);
  return { offline, retry: restore, skip };
}

/** Shown at launch when the saved session could not be checked because the server is unreachable. */
function OfflineLaunch({ onRetry, onSkip }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <CloudOff size={32} color={colors.primary} />
      </View>
      <T v="h2" style={{ textAlign: 'center' }}>
        Can’t reach Vexon
      </T>
      <T v="small" style={{ textAlign: 'center' }}>
        Check your mobile data or Wi-Fi. You are still signed in — we’ll pick up where you left off.
      </T>
      <T v="small" style={{ textAlign: 'center', color: colors.muted }}>
        Server: {getApiUrl().replace(/^https?:[/][/]/, '') || 'not configured'}
      </T>
      <Button
        title="Try again"
        icon={RefreshCw}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          await onRetry();
          setBusy(false);
        }}
        style={{ alignSelf: 'stretch' }}
      />
      <Button title="Change server / sign in" variant="ghost" onPress={onSkip} />
    </View>
  );
}

/** Thin banner while the server is unreachable; RTK Query refetches when it comes back. */
function ConnectionBanner() {
  const online = useOnline();
  const signedIn = useSelector((s) => Boolean(s.auth.user));
  const insets = useSafeAreaInsets();
  if (online || !signedIn) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 4, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1b1d3a', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, opacity: 0.92 }}
      accessibilityLiveRegion="polite"
    >
      <WifiOff size={14} color="#fff" />
      <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 12 }}>Offline — reconnecting…</Text>
    </View>
  );
}

/** Any render error in a screen lands here instead of closing the app. */
export function ErrorBoundary({ error, retry }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 20, color: colors.ink, textAlign: 'center' }}>Something went wrong</Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.soft, textAlign: 'center' }}>
        This screen hit an unexpected problem. Your data is safe.
      </Text>
      {__DEV__ ? <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center' }}>{String(error?.message || error)}</Text> : null}
      <Button title="Try again" icon={RefreshCw} onPress={retry} />
      <Button title="Go home" variant="ghost" onPress={() => router.replace('/')} />
    </View>
  );
}

/** One socket per signed-in session + push registration + notification taps. */
function useRealtime() {
  const dispatch = useDispatch();
  const reduxStore = useStore();
  const userId = useSelector((s) => s.auth.user?._id);
  const [registerPush] = useRegisterPushTokenMutation();
  const pushed = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;
    const socket = connectSocket(() => reduxStore.getState().auth.accessToken, {
      onUnauthorized: async () => {
        const session = await refreshSession();
        if (session?.accessToken) {
          dispatch(setCredentials(session));
          return true;
        }
        if (!session?.offline) dispatch(loggedOut());
        return false;
      },
    });
    const handlers = Object.entries(LIVE_TAGS).map(([event, tags]) => {
      const fn = () => dispatch(api.util.invalidateTags(tags));
      socket.on(event, fn);
      return [event, fn];
    });
    // Coming back online: refetch everything that may have changed meanwhile.
    const onConnect = () => dispatch(api.util.invalidateTags(Object.values(LIVE_TAGS).flat()));
    socket.on('connect', onConnect);

    if (pushed.current !== userId) {
      pushed.current = userId;
      getPushToken().then((token) => token && registerPush(token));
    }
    return () => {
      handlers.forEach(([event, fn]) => socket.off(event, fn));
      socket.off('connect', onConnect);
      disconnectSocket();
    };
  }, [userId, dispatch, reduxStore, registerPush]);

  // Tapping a push opens the matching screen (links are shared with the web app).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = linkFromNotification(response.notification.request.content.data);
      if (link) router.push(link);
    });
    return () => sub.remove();
  }, []);
}

function Root() {
  const ready = useSelector((s) => s.auth.ready);
  const [fontsReady, fontError] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  // A font that fails to load must never leave the app stuck on the splash screen.
  const fontsLoaded = fontsReady || Boolean(fontError);
  const launch = useSessionRestore();
  useRealtime();

  useEffect(() => {
    if ((ready || launch.offline) && fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [ready, launch.offline, fontsLoaded]);

  if (!fontsLoaded) return null;
  if (launch.offline) return <OfflineLaunch onRetry={launch.retry} onSkip={launch.skip} />;
  if (!ready) return null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
      <ConnectionBanner />
    </>
  );
}

export default function Layout() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </Provider>
  );
}
