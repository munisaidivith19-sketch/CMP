import Constants from 'expo-constants';

/**
 * Where the Vexon backend lives. The app never assumes localhost:
 *  1. EXPO_PUBLIC_API_URL (set in .env or per EAS build profile) always wins.
 *  2. In development only, fall back to the computer serving the JS bundle
 *     (`npx expo start`) on port 5000 — that is where `npm run dev` runs the API.
 */
function resolveApiUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (__DEV__) {
    const host = (Constants.expoConfig?.hostUri || '').split(':')[0];
    if (host) return `http://${host}:5000`;
  }
  return '';
}

export const API_URL = resolveApiUrl();

/** Turn a server-relative upload path ("/uploads/x.png") into a full URL. */
export const assetUrl = (path) => (!path ? null : /^https?:\/\//.test(path) || path.startsWith('data:') ? path : `${API_URL}${path}`);
