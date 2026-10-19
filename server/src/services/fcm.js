/**
 * Firebase Cloud Messaging (HTTP v1) for the native Android app.
 *
 * Credentials come only from the server environment — never from the app or
 * the repository:
 *   FCM_SERVICE_ACCOUNT       the service-account JSON (raw, or base64 of it)
 *   FCM_SERVICE_ACCOUNT_FILE  or a path to that JSON file
 * Without either, push is disabled and every send reports "skipped"; the
 * in-app notification is stored either way. Nothing here logs credentials,
 * tokens or message bodies.
 *
 * Messages are data-only, so the app decides channel, priority and what the
 * lock screen may show.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
let cached = { raw: null, account: null };
let access = { token: null, exp: 0 };

function account() {
  const raw = process.env.FCM_SERVICE_ACCOUNT || (process.env.FCM_SERVICE_ACCOUNT_FILE ? safeRead(process.env.FCM_SERVICE_ACCOUNT_FILE) : '');
  if (!raw) return null;
  if (cached.raw === raw) return cached.account;
  let parsed = null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text);
    if (json.client_email && json.private_key && json.project_id) parsed = json;
  } catch {
    parsed = null;
  }
  if (!parsed) console.error('[fcm] FCM_SERVICE_ACCOUNT is set but is not a valid service-account JSON');
  cached = { raw, account: parsed };
  access = { token: null, exp: 0 };
  return parsed;
}

function safeRead(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    console.error('[fcm] FCM_SERVICE_ACCOUNT_FILE could not be read');
    return '';
  }
}

export const fcmConfigured = () => Boolean(account());

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** OAuth2 access token for the service account (JWT bearer grant), cached until shortly before expiry. */
async function accessToken(acc) {
  if (access.token && Date.now() < access.exp - 60_000) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = acc.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: acc.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), acc.private_key).toString('base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`token request failed (${res.status})`);
  const json = await res.json();
  access = { token: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return access.token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one data message to one device token.
 * Returns 'sent' | 'invalid' (token must be deleted) | 'failed' | 'skipped'.
 * Retries 429 / 5xx up to 3 times with backoff; never throws.
 */
export async function sendToToken(token, data, { priority = 'normal', ttlSeconds = 3600 } = {}) {
  const acc = account();
  if (!acc) return 'skipped';
  const body = JSON.stringify({
    message: {
      token,
      data: Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
      android: { priority: priority === 'high' ? 'HIGH' : 'NORMAL', ttl: `${ttlSeconds}s` },
    },
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken(acc)}`, 'content-type': 'application/json' },
        body,
      });
      if (res.ok) return 'sent';
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.find?.((d) => d.errorCode)?.errorCode || err?.error?.status;
      if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')) return 'invalid';
      if (res.status === 401) access = { token: null, exp: 0 };
      if (res.status !== 429 && res.status < 500 && res.status !== 401) return 'failed';
    } catch {
      /* network error — retry */
    }
    await sleep(300 * 2 ** attempt);
  }
  return 'failed';
}

/** Test hook: forget cached credentials and access token. */
export function resetFcmForTests() {
  cached = { raw: null, account: null };
  access = { token: null, exp: 0 };
}
