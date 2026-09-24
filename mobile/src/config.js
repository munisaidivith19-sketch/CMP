import { NativeModules } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const SERVER_KEY = 'vexon.serverUrl';

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

const clean = (url) => String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');

/**
 * Where the Vexon backend lives. The app never assumes localhost:
 *  1. A server address saved on the device (login screen → "Server") wins, so
 *     one APK can point at a deployed URL or an internet tunnel without a rebuild.
 *  2. EXPO_PUBLIC_API_URL (set in .env or per EAS build profile).
 *  3. In development only, the computer serving the JS bundle on port 5000.
 */
function buildTimeUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return clean(fromEnv);
  if (__DEV__) {
    const host = devServerHost();
    if (host) return `http://${host}:5000`;
  }
  return '';
}

const DEFAULT_URL = buildTimeUrl();
let current = DEFAULT_URL;
let overridden = false;

export const getApiUrl = () => current;
export const isServerOverridden = () => overridden;
export const defaultApiUrl = () => DEFAULT_URL;

/** Read the saved server address once at launch (before restoring the session). */
export async function loadServerOverride() {
  try {
    const saved = await SecureStore.getItemAsync(SERVER_KEY);
    if (saved) {
      current = clean(saved);
      overridden = true;
    }
  } catch {
    /* SecureStore unavailable — keep the build-time address */
  }
  return current;
}

/** Save (or clear, with an empty value) the server address used by every request. */
export async function setServerUrl(url) {
  const next = clean(url);
  if (next) {
    await SecureStore.setItemAsync(SERVER_KEY, next);
    current = next;
    overridden = true;
  } else {
    await SecureStore.deleteItemAsync(SERVER_KEY);
    current = DEFAULT_URL;
    overridden = false;
  }
  return current;
}

/** fetch() with a hard timeout — mobile networks can hang a request forever. */
export async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Is a Vexon server answering at this address? Resolves { ok, message }. */
export async function checkServer(url) {
  const base = clean(url);
  if (!/^https?:\/\/[^\s/]+/.test(base)) return { ok: false, message: 'Enter a full address starting with http:// or https://' };
  try {
    const res = await fetchWithTimeout(`${base}/api/health`, {}, 8000);
    const body = await res.json().catch(() => null);
    return res.ok && body?.status === 'ok' ? { ok: true, message: 'Connected' } : { ok: false, message: `Server answered ${res.status} — is this the Vexon API?` };
  } catch (e) {
    return { ok: false, message: e?.name === 'AbortError' ? 'The server did not answer in time' : 'Cannot reach this address' };
  }
}

/** Turn a server-relative upload path ("/uploads/x.png") into a full URL. */
export const assetUrl = (path) => (!path ? null : /^https?:\/\//.test(path) || path.startsWith('data:') ? path : `${current}${path}`);
