/**
 * Cloudflare Turnstile (CAPTCHA) for web sign-in.
 *
 * Why: the per-network sign-in lock cannot tell people apart behind one
 * shared address (the college Wi-Fi), so a stranger on the same Wi-Fi could
 * still lock the Principal out. With Turnstile on, a web sign-in from a
 * network that has failed recently must pass a CAPTCHA instead, and a passed
 * CAPTCHA is never locked out by that network's failures. Bots cannot pass
 * it; a person who solves it still guesses only at human speed.
 *
 * Off until both keys are set (TURNSTILE_SITE_KEY + TURNSTILE_SECRET), so
 * development and the tests run unchanged. The secret is read only here and
 * is only ever sent to Cloudflare's siteverify endpoint.
 *
 * TURNSTILE_HOSTNAMES (comma-separated) lists the web app hostnames a token
 * may come from; unset, it is the hostnames of CLIENT_URL / APP_URL.
 */
import { env } from '../config/env.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const LOGIN_CAPTCHA_ACTION = 'login';
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 10_000;

const hostnameOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Read on every call so a key change in the environment takes effect on restart (and tests can toggle it). */
export function turnstileConfig() {
  const siteKey = (process.env.TURNSTILE_SITE_KEY || '').trim();
  const secret = (process.env.TURNSTILE_SECRET || '').trim();
  const explicit = String(process.env.TURNSTILE_HOSTNAMES || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hostnames = new Set(explicit.length ? explicit : [...(env.clientUrls || []), env.appUrl].map(hostnameOf).filter(Boolean));
  return { enabled: Boolean(siteKey && secret), siteKey, secret, hostnames };
}

export const turnstileEnabled = () => turnstileConfig().enabled;

/**
 * Check one Turnstile token with Cloudflare. Fails closed: a missing,
 * malformed, reused or foreign token, a wrong action or hostname, a network
 * error or a non-JSON answer all return { ok: false, reason }.
 */
export async function verifyTurnstile(token, remoteIp, expectedAction = LOGIN_CAPTCHA_ACTION) {
  const { enabled, secret, hostnames } = turnstileConfig();
  if (!enabled) return { ok: false, reason: 'not_configured' };
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'missing_token' };
  if (!hostnames.size) return { ok: false, reason: 'no_hostnames' };

  let result;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
    });
    if (!res.ok) return { ok: false, reason: 'siteverify_unavailable' };
    result = await res.json();
  } catch {
    return { ok: false, reason: 'siteverify_unavailable' };
  }
  if (!result || result.success !== true) return { ok: false, reason: 'rejected' };
  if (result.action !== expectedAction) return { ok: false, reason: 'wrong_action' };
  if (!hostnames.has(String(result.hostname || '').toLowerCase())) return { ok: false, reason: 'wrong_hostname' };
  return { ok: true };
}
