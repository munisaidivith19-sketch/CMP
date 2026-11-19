/**
 * Encrypts the sign-in password in the browser with the server's RSA public
 * key (RSA-OAEP / SHA-256), so the request shows unreadable ciphertext
 * instead of the password. A timestamp and one-time nonce travel inside the
 * envelope so a captured copy cannot be replayed (checked by the server).
 *
 * Returns null when it cannot be done (no WebCrypto — an insecure http page —
 * or the key could not be fetched); the caller then signs in the usual way.
 */
let cached = null; // { keyId, key }

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function loadKey(force) {
  if (cached && !force) return cached;
  const res = await fetch('/api/auth/login-key', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('login key unavailable');
  const { keyId, publicKey } = await res.json();
  const key = await crypto.subtle.importKey('spki', b64ToBytes(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  cached = { keyId, key };
  return cached;
}

export async function encryptPassword(password, { refreshKey = false } = {}) {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const { keyId, key } = await loadKey(refreshKey);
    const nonce = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    const data = new TextEncoder().encode(JSON.stringify({ p: password, t: Date.now(), n: nonce }));
    const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, data);
    return { encryptedPassword: bytesToB64(cipher), keyId };
  } catch {
    return null;
  }
}
