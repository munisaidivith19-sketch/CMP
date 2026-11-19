/**
 * Sign-in password envelope. The web app encrypts the password with this
 * server's RSA public key (RSA-OAEP / SHA-256) before it leaves the browser,
 * so the request body shows unreadable ciphertext instead of the password
 * (DevTools, proxies, request logs). Only this server can decrypt it.
 *
 * What it is and is not: it hides the password from anyone who can merely
 * SEE the request body. It is not a replacement for HTTPS. To stop a captured
 * envelope being replayed, each one carries a timestamp and a one-time nonce:
 * stale or reused envelopes are refused.
 *
 * Key: LOGIN_RSA_PRIVATE_KEY (PKCS#8 PEM, "\n" escapes allowed) keeps one key
 * across restarts and instances; without it a key is generated per process
 * (a client holding an older key is told to fetch the new one and retries).
 * Plain `password` bodies are still accepted so the mobile apps and the gate
 * scanner keep working.
 */
import crypto from 'node:crypto';
import { ApiError } from '../utils/http.js';

const MAX_AGE_MS = 2 * 60 * 1000;
const NONCE_TTL_MS = MAX_AGE_MS * 2;

function loadKey() {
  const pem = process.env.LOGIN_RSA_PRIVATE_KEY;
  if (pem) {
    const privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
    return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
  }
  return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
}

const { privateKey, publicKey } = loadKey();
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const publicB64 = publicDer.toString('base64');
export const LOGIN_KEY_ID = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 16);

const seen = new Map(); // nonce -> expiry
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of seen) if (exp < now) seen.delete(n);
}, 60 * 1000).unref();

export const loginPublicKey = () => ({ keyId: LOGIN_KEY_ID, publicKey: publicB64 });

const stale = (msg) => new ApiError(400, msg, null, { code: 'LOGIN_KEY_STALE' });

/** If the body carries an encrypted password, replace it with the plain `password` the rest of login expects. */
export function decryptLoginPassword(req, _res, next) {
  try {
    const { encryptedPassword, keyId } = req.body || {};
    if (encryptedPassword === undefined) return next();
    if (typeof encryptedPassword !== 'string' || encryptedPassword.length > 1024) throw new ApiError(400, 'Invalid sign-in request');
    if (keyId !== LOGIN_KEY_ID) throw stale('Sign-in key changed — please try again');

    let envelope;
    try {
      const plain = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(encryptedPassword, 'base64')
      );
      envelope = JSON.parse(plain.toString('utf8'));
    } catch {
      throw stale('Sign-in key changed — please try again');
    }
    const { p, t, n } = envelope || {};
    if (typeof p !== 'string' || typeof n !== 'string' || n.length < 8 || n.length > 64 || !Number.isFinite(t)) {
      throw new ApiError(400, 'Invalid sign-in request');
    }
    if (Math.abs(Date.now() - t) > MAX_AGE_MS) throw stale('Your device clock looks wrong or the request expired — please try again');
    if (seen.has(n)) throw new ApiError(400, 'Invalid sign-in request');
    seen.set(n, Date.now() + NONCE_TTL_MS);

    req.body = { email: req.body.email, password: p, captchaToken: req.body.captchaToken };
    next();
  } catch (err) {
    next(err);
  }
}
