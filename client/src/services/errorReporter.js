/**
 * Web client error reporting for the Super Admin SOC (POST /api/client-errors).
 *
 * Kept small and dependency-free so it can be unit-tested:
 *  - the same error (kind + message shape + route) is sent at most once per
 *    DEDUPE_MS, and at most MAX_PER_MINUTE reports leave the browser per minute;
 *  - nothing is sent before sign-in (the endpoint needs a session) — reports
 *    made while signed out are dropped, not queued;
 *  - only the message, error name, the page path (no query string), a short
 *    stack and the component stack are sent — never form data, tokens or
 *    the URL's query;
 *  - reporting can never throw into the app; api.js never reports a failed
 *    report (no loops).
 */
const DEDUPE_MS = 60_000;
const MAX_PER_MINUTE = 10;

const shape = (s = '') => String(s).replace(/\b[a-f0-9]{24}\b/gi, '<id>').replace(/\d+/g, '<n>').slice(0, 160);
const clip = (s, n) => (s === undefined || s === null ? undefined : String(s).slice(0, n));
// Opaque path segments (claim / invite tokens, 24+ URL-safe characters mixing
// letters and digits) never leave the browser: they are sent as ":token".
const TOKEN_SEGMENT = /(?<=\/)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g;
const OBJECT_ID_SEGMENT = /(?<=\/)[a-f0-9]{24}(?![A-Za-z0-9_-])/gi;
export const pathOnly = (p = '/') =>
  String(p || '/').split('?')[0].split('#')[0].replace(OBJECT_ID_SEGMENT, ':id').replace(TOKEN_SEGMENT, ':token').slice(0, 200) || '/';

export function createErrorReporter({ send, now = () => Date.now(), isSignedIn = () => true, getRoute = () => '/', appVersion } = {}) {
  const seen = new Map(); // key -> last sent
  let windowStart = now();
  let sentInWindow = 0;

  function report({ kind, message, name, stack, componentStack, status, endpoint, correlationId, route }) {
    try {
      if (!send || !isSignedIn()) return false;
      const msg = clip(message || 'Unknown error', 1000);
      const where = pathOnly(route ?? getRoute());
      const key = `${kind}|${shape(msg)}|${where}|${endpoint ? pathOnly(endpoint) : ''}`;
      const t = now();
      if (seen.has(key) && t - seen.get(key) < DEDUPE_MS) return false;
      if (t - windowStart >= 60_000) {
        windowStart = t;
        sentInWindow = 0;
      }
      if (sentInWindow >= MAX_PER_MINUTE) return false;
      sentInWindow += 1;
      seen.set(key, t);
      if (seen.size > 200) seen.delete(seen.keys().next().value);
      const body = { kind, message: msg, route: where };
      if (name) body.name = clip(name, 80);
      if (stack) body.stack = clip(stack, 4000);
      if (componentStack) body.componentStack = clip(componentStack, 2000);
      if (Number.isInteger(status)) body.status = status;
      if (endpoint) body.endpoint = pathOnly(endpoint);
      if (correlationId && /^[A-Za-z0-9._-]{8,64}$/.test(correlationId)) body.correlationId = correlationId;
      if (appVersion) body.appVersion = clip(appVersion, 40);
      Promise.resolve()
        .then(() => send(body))
        .catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /** Listen for uncaught script errors and unhandled promise rejections. Returns an uninstall function. */
  function install(target) {
    if (!target?.addEventListener) return () => {};
    const onError = (e) => report({ kind: 'window_error', message: e?.message || 'Script error', name: e?.error?.name, stack: e?.error?.stack });
    const onRejection = (e) => {
      const r = e?.reason;
      report({ kind: 'unhandled_rejection', message: r?.message || (typeof r === 'string' ? r : 'Unhandled promise rejection'), name: r?.name, stack: r?.stack });
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onRejection);
    };
  }

  return { report, install };
}

/** Which RTK Query errors are worth reporting: network failures and 5xx (never 4xx — those are answers). */
export function apiErrorKind(error) {
  if (!error) return null;
  if (error.status === 'FETCH_ERROR' || error.status === 'TIMEOUT_ERROR') return 'network';
  if (typeof error.status === 'number' && error.status >= 500 && error.data?.code !== 'MAINTENANCE') return 'api';
  return null;
}

// ── App-wide singleton (wired in main.jsx / api.js) ─────────────────
let instance = null;
export function setErrorReporter(r) {
  instance = r;
}
export function reportClientError(payload) {
  return instance ? instance.report(payload) : false;
}
