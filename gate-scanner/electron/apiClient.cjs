'use strict';
// Every request the Gate Scanner makes goes through here, in the Electron main
// process. The page (renderer) never sees a token: it asks for an operation
// over IPC and gets back data or a classified error.
//
// - Identifies itself as the Gate Scanner (x-client-platform: gate-desktop):
//   the server binds a Security-only session and returns the refresh token in
//   the body (stored encrypted, credentialStore.cjs). No cookies.
// - Access token in memory only; on 401 it refreshes once (single flight,
//   rotated refresh token re-saved) and retries the request once.
// - Bounded timeouts and retries. A POST is only retried when the caller says
//   it is idempotent (scans carry a scanId the server de-duplicates on).

const RETRY_DELAYS_MS = [400, 1200, 3000];
const NETWORK_UNREACHED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN']);
const TLS_CODES = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 300) => (typeof s === 'string' ? s.slice(0, n) : undefined);

/** Map a server response to a stable error kind the UI explains (renderer/lib/errors.js). */
function classifyHttp(status, body = {}) {
  const code = typeof body?.code === 'string' ? body.code : undefined;
  if (code === 'GATE_SCANNER_ROLE_REQUIRED') return 'role';
  if (code === 'GATE_SCANNER_SCOPE') return 'scope';
  if (code === 'TERMS_ACCEPTANCE_REQUIRED') return 'terms';
  if (code === 'PASSWORD_CHANGE_REQUIRED') return 'password';
  if (code === 'MAINTENANCE' || body?.maintenance) return 'maintenance';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 423) return 'locked';
  if (status === 429) return 'rate';
  if (status === 400 || status === 409 || status === 410 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'http';
}

/** A fetch that threw: was the server never reached, or might the request have arrived? */
function classifyNetwork(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return { kind: 'timeout', mayHaveArrived: true };
  const code = err?.cause?.code || err?.code || '';
  if (TLS_CODES.test(code)) return { kind: 'tls', mayHaveArrived: false, code };
  if (NETWORK_UNREACHED.has(code)) return { kind: 'offline', mayHaveArrived: false, code };
  // ECONNRESET / socket closed mid-request: it may have been processed.
  return { kind: 'offline', mayHaveArrived: true, code: code || undefined };
}

const retryableKind = (kind, status) => kind === 'offline' || kind === 'timeout' || (kind === 'server' && [502, 503, 504].includes(status));

/**
 * @param {object} o
 * @param {string} o.baseUrl              server origin (https in production)
 * @param {ReturnType<import('./credentialStore.cjs').createCredentialStore>} o.store
 * @param {() => Record<string,string>} o.identityHeaders  device / gate / version headers
 * @param {(e: {reason: string, code?: string, message?: string}) => void} [o.onSignedOut]
 * @param {(e: object) => void} [o.log]   sanitised diagnostics (never tokens, passwords or QR payloads)
 */
function createApiClient({ baseUrl, store, identityHeaders, onSignedOut = () => {}, log = () => {}, fetchImpl = (...a) => fetch(...a), timeoutMs = 10000, retryDelays = RETRY_DELAYS_MS }) {
  let accessToken = null;
  let refreshToken = null;
  let guard = null;
  let refreshing = null;

  const url = (p) => `${baseUrl}/api${p}`;

  async function raw(method, path, { body, auth = true, timeout = timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const started = Date.now();
    try {
      const res = await fetchImpl(url(path), {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...identityHeaders(),
          'x-client-platform': 'gate-desktop',
          ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error', // never follow a redirect with credentials attached
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null; // not JSON (proxy error page): treated by status alone
      }
      return { status: res.status, data, ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  function signedOut(reason, extra = {}) {
    accessToken = null;
    refreshToken = null;
    guard = null;
    store.clear();
    log({ event: 'signed_out', reason, code: extra.code });
    onSignedOut({ reason, ...extra });
  }

  function adopt(data) {
    accessToken = data.accessToken;
    if (data.refreshToken) refreshToken = data.refreshToken;
    if (data.user) guard = { name: data.user.name, role: data.user.role, legal: data.user.legal || null, mustChangePassword: !!data.user.mustChangePassword };
    const persisted = store.save({ refreshToken, guardName: guard?.name });
    return persisted;
  }

  /** Rotate the refresh token. Single flight: concurrent 401s share one refresh. */
  function refresh() {
    if (!refreshToken) return Promise.resolve({ ok: false, kind: 'auth' });
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const res = await raw('POST', '/auth/refresh', { body: { refreshToken }, auth: false });
          if (res.status === 200 && res.data?.accessToken) {
            adopt(res.data);
            return { ok: true };
          }
          const kind = classifyHttp(res.status, res.data);
          if (res.status === 401) {
            signedOut(kind === 'role' ? 'role' : 'session_ended', { code: res.data?.code, message: clip(res.data?.message) });
            return { ok: false, kind: kind === 'role' ? 'role' : 'auth', message: clip(res.data?.message) };
          }
          return { ok: false, kind, status: res.status, message: clip(res.data?.message) };
        } catch (err) {
          return { ok: false, ...classifyNetwork(err) };
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  }

  /**
   * Make an authenticated request. Resolves (never rejects) with
   * { ok: true, status, data } or { ok: false, kind, status?, code?, message?, mayHaveArrived? }.
   */
  async function request(method, path, { body, retries = method === 'GET' ? 2 : 0, timeout } = {}) {
    let attempt = 0;
    for (;;) {
      let result;
      try {
        let res = await raw(method, path, { body, timeout });
        if (res.status === 401 && refreshToken) {
          const r = await refresh();
          if (!r.ok) return { ok: false, kind: r.kind, message: r.message, mayHaveArrived: false };
          res = await raw(method, path, { body, timeout });
        }
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, data: res.data, ms: res.ms };
        const kind = classifyHttp(res.status, res.data);
        if (res.status === 401) signedOut(kind === 'role' ? 'role' : 'session_ended', { code: res.data?.code, message: clip(res.data?.message) });
        result = { ok: false, kind, status: res.status, code: res.data?.code, message: clip(res.data?.message), mayHaveArrived: true };
      } catch (err) {
        result = { ok: false, ...classifyNetwork(err) };
      }
      if (attempt >= retries || !retryableKind(result.kind, result.status)) {
        if (!result.ok) log({ event: 'request_failed', method, path: path.split('?')[0].replace(/\/[A-Za-z0-9-]{8,}$/, '/:id'), kind: result.kind, status: result.status, code: result.code });
        return result;
      }
      await sleep(retryDelays[Math.min(attempt, retryDelays.length - 1)]);
      attempt += 1;
    }
  }

  return {
    get guard() {
      return guard;
    },
    get signedIn() {
      return Boolean(accessToken || refreshToken);
    },

    /** App start: restore the saved session and re-validate it with the server. */
    async restore() {
      const saved = store.load();
      if (!saved) return { status: 'signed-out' };
      refreshToken = saved.refreshToken;
      const r = await refresh();
      if (r.ok) return { status: 'signed-in', guard, persisted: true };
      if (r.kind === 'auth' || r.kind === 'role') return { status: 'signed-out', reason: r.kind === 'role' ? 'role' : 'session_ended', message: r.message };
      // Offline / server down: keep the saved credential and try again later.
      return { status: 'unverified', kind: r.kind, guardName: saved.guardName || null };
    },

    async login(email, password) {
      try {
        const res = await raw('POST', '/auth/login', { body: { email, password }, auth: false });
        if (res.status === 200 && res.data?.accessToken) {
          const persisted = adopt(res.data);
          log({ event: 'signed_in', persisted });
          return { ok: true, guard, persisted };
        }
        return { ok: false, kind: classifyHttp(res.status, res.data), status: res.status, code: res.data?.code, message: clip(res.data?.message) };
      } catch (err) {
        return { ok: false, ...classifyNetwork(err) };
      }
    },

    /** Sign out: revoke the session on the server (best effort), then forget it locally regardless. */
    async logout(reason = 'manual') {
      const token = refreshToken;
      if (token) {
        try {
          await raw('POST', '/auth/logout', { body: { refreshToken: token }, auth: false, timeout: 5000 });
        } catch {
          log({ event: 'logout_unreachable' });
        }
      }
      signedOut(reason);
      return { ok: true };
    },

    request,

    /** Unauthenticated reachability check: GET /api/health with timing. */
    async health() {
      try {
        const res = await raw('GET', '/health', { auth: false, timeout: 5000 });
        return { ok: res.status === 200, status: res.status, ms: res.ms };
      } catch (err) {
        return { ok: false, ...classifyNetwork(err) };
      }
    },

    async publicGet(path) {
      try {
        const res = await raw('GET', path, { auth: false });
        return res.status === 200 ? { ok: true, data: res.data } : { ok: false, kind: classifyHttp(res.status, res.data), message: clip(res.data?.message) };
      } catch (err) {
        return { ok: false, ...classifyNetwork(err) };
      }
    },
  };
}

module.exports = { createApiClient, classifyHttp, classifyNetwork };
