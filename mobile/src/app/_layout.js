import { useEffect, useRef } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Provider, useDispatch, useSelector, useStore } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { store } from '../store';
import { loggedOut, sessionChecked, setCredentials } from '../store/authSlice';
import { api, useRegisterPushTokenMutation } from '../services/api';
import { refreshSession } from '../services/session';
import { connectSocket, disconnectSocket } from '../services/socket';
import { getPushToken, linkFromNotification } from '../services/push';
import { colors } from '../theme';

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

/** Restore the session from SecureStore once at launch. */
function useSessionRestore() {
  const dispatch = useDispatch();
  useEffect(() => {
    refreshSession().then((session) => {
      if (session?.accessToken) dispatch(setCredentials(session));
      dispatch(sessionChecked());
    });
  }, [dispatch]);
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
  const [fontsLoaded] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  useSessionRestore();
  useRealtime();

  useEffect(() => {
    if (ready && fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [ready, fontsLoaded]);

  if (!ready || !fontsLoaded) return null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
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
