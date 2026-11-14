import { env } from '../config/env.js';

/**
 * HTTPS enforcement.
 *
 * FORCE_HTTPS=true|false; unset means on in production. Turn it off only for a
 * plain-HTTP campus server with no TLS in front of it. When on:
 *  - a GET/HEAD over plain HTTP is redirected (301) to the same path on the
 *    configured https APP_URL origin. The target is never built from the Host
 *    header, so the redirect cannot be pointed at another site;
 *  - any other method over HTTP is refused (403 HTTPS_REQUIRED) rather than
 *    redirected: its body has already crossed the network in cleartext, and a
 *    silent replay over HTTPS would hide that from the client;
 *  - the realtime socket refuses plain-HTTP handshakes (see socket.js);
 *  - HSTS and CSP upgrade-insecure-requests are sent (see app.js).
 * /api/health stays reachable over HTTP: the hosting platform's health probe
 * calls it on the internal network without TLS.
 */
export function forceHttpsEnabled(raw = process.env.FORCE_HTTPS, isProd = env.isProd) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (['false', '0', 'off', 'no'].includes(v)) return false;
  if (['true', '1', 'on', 'yes'].includes(v)) return true;
  return isProd;
}

/**
 * How many reverse-proxy hops to trust for X-Forwarded-For / -Proto, so req.ip
 * (rate limits, sign-in lockouts, audit logs) is the real visitor and req.secure
 * reflects the visitor's connection, not the proxy's. TRUST_PROXY=<hops> sets
 * it (1 = Render; 2 = Cloudflare in front of Render), TRUST_PROXY=false turns
 * it off. Unset: 1 in production — the app is always deployed behind a proxy
 * there, and trusting none would make every visitor share the proxy's IP (one
 * attacker could lock everyone out) — and off in development, where a client
 * could otherwise spoof its IP with the header. A hop count, never `true`:
 * trusting every hop lets a client pick its own IP.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY, isProd = env.isProd) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return false;
  const hops = Number.parseInt(v, 10);
  if (Number.isInteger(hops) && hops > 0) return Math.min(hops, 5);
  return isProd ? 1 : false;
}

/**
 * Whether a raw Node request (no Express helpers, e.g. a socket.io handshake)
 * arrived over TLS: directly, or — when a proxy is trusted — as the proxy
 * reports it, the same way Express computes req.secure.
 */
export function isSecureRawRequest(req, trustProxy = trustProxySetting()) {
  if (req.socket?.encrypted) return true;
  if (!trustProxy) return false;
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

/** The https origin a plain-HTTP request is sent to, or null when none is configured. */
function httpsOrigin(req) {
  try {
    const app = new URL(env.appUrl);
    if (app.protocol === 'https:') return app.origin;
  } catch {
    /* fall through */
  }
  // No https APP_URL: the request's own host only if it is a configured origin.
  const candidate = `https://${req.hostname}`.toLowerCase();
  const allowed = (env.clientUrls || []).map((u) => {
    try {
      return new URL(u).origin.toLowerCase();
    } catch {
      return null;
    }
  });
  return allowed.includes(candidate) ? candidate : null;
}

export function httpsOnly(enabled = forceHttpsEnabled()) {
  return function enforceHttps(req, res, next) {
    if (!enabled || req.secure || req.path === '/api/health') return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      const origin = httpsOrigin(req);
      if (origin) return res.redirect(301, `${origin}${req.originalUrl}`);
    }
    res.status(403).json({ message: 'HTTPS is required', code: 'HTTPS_REQUIRED' });
  };
}
