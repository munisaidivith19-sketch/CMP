import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Show pushes as banners while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Ask for permission and return this device's Expo push token, or null when
 * pushes are unavailable (emulator, permission denied, no EAS project id).
 * The backend's single notification service decides what to push.
 */
export async function getPushToken() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Vexon',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#6c5dd3',
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

/** Web-style links from notifications map 1:1 onto app routes. */
export function linkFromNotification(data) {
  const link = data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}
