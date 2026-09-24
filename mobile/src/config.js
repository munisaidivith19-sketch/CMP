import { NativeModules } from 'react-native';
import Constants from 'expo-constants';

/** Host of the Metro dev server this JS bundle was loaded from, e.g. "172.16.25.65". */
function devServerHost() {
  // Development builds: the URL React Native fetched this bundle from.
  const source = NativeModules?.SourceCode;
  const scriptURL = source?.getConstants?.().scriptURL ?? source?.scriptURL;
  const fromScript = /^https?:\/\/([^/:]+)/.exec(scriptURL || '')?.[1];
  if (fromScript) return fromScript;
  // Expo Go exposes the dev server through the manifest instead.
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost || '';
  return hostUri.split(':')[0] || null;
}

/**
 * Where the Vexon backend lives. The app never assumes localhost:
 *  1. EXPO_PUBLIC_API_URL (set in .env or per EAS build profile) always wins.
 *     Release APKs must set it (a deployed https:// URL).
 *  2. In development only, fall back to the computer serving the JS bundle on
 *     port 5000 — where `npm run dev` runs the API. This follows Wi-Fi changes
 *     automatically, so no LAN IP needs to be hard-coded while developing.
 */
function resolveApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (__DEV__) {
    const host = devServerHost();
    if (host) return `http://${host}:5000`;
  }
  return '';
}

export const API_URL = resolveApiUrl();

/** Turn a server-relative upload path ("/uploads/x.png") into a full URL. */
export const assetUrl = (path) => (!path ? null : /^https?:\/\//.test(path) || path.startsWith('data:') ? path : `${API_URL}${path}`);
