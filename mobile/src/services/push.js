import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { isExpoGo } from '../utils/native';

// Expo Go (SDK 53+) throws as soon as expo-notifications is imported on
// Android, which used to crash the root layout. Load it only in real builds.
const Notifications = isExpoGo ? null : require('expo-notifications');

// Show pushes as banners while the app is open too.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Ask for permission and return this device's Expo push token, or null when
 * pushes are unavailable (Expo Go, emulator, permission denied, no EAS project id).
 * The backend's single notification service decides what to push.
 */
export async function getPushToken() {
  if (!Notifications) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Vexon',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#1D6FEB',
    });
  }
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] No EAS projectId configured — push notifications disabled');
    return null;
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    console.warn('[push] Could not get a push token:', err?.message);
    return null;
  }
}

/** Run `onTap(data)` when the user taps a push. Returns an unsubscribe function. */
export function onNotificationTap(onTap) {
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => onTap(response.notification.request.content.data));
  return () => sub.remove();
}

/** Web-style links from notifications map 1:1 onto app routes. */
export function linkFromNotification(data) {
  const link = data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}
