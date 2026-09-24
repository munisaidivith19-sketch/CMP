import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { API_URL } from '../config';

const REFRESH_KEY = 'vexon.refreshToken';

/** Headers that tell the backend this is the Android app (refresh token in body, device label). */
export const mobileHeaders = () => ({
  'x-client-platform': 'mobile',
  'x-device-name': [Device.manufacturer, Device.modelName].filter(Boolean).join(' ').slice(0, 60) || 'Android',
});

export const saveRefreshToken = (token) => (token ? SecureStore.setItemAsync(REFRESH_KEY, token) : SecureStore.deleteItemAsync(REFRESH_KEY));
export const readRefreshToken = () => SecureStore.getItemAsync(REFRESH_KEY);
export const clearRefreshToken = () => SecureStore.deleteItemAsync(REFRESH_KEY);

/**
 * Exchange the stored refresh token for a new session. The server rotates the
 * token on every call (and revokes the session if an old one is replayed), so a
 * single in-flight refresh is shared by every caller.
 */
let inflight = null;
export function refreshSession() {
  if (!inflight) {
    inflight = (async () => {
      const refreshToken = await readRefreshToken();
      if (!refreshToken || !API_URL) return null;
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...mobileHeaders() },
          body: JSON.stringify({ refreshToken }),
        });
        if (res.status === 401) {
          await clearRefreshToken();
          return null;
        }
        if (!res.ok) return { offline: true };
        const session = await res.json();
        await saveRefreshToken(session.refreshToken);
        return session;
      } catch {
        return { offline: true }; // network down — keep the stored token
      }
    })().finally(() => {
      setTimeout(() => {
        inflight = null;
      }, 0);
    });
  }
  return inflight;
}
