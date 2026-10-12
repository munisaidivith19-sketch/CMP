/**
 * Login Security & Progressive Backoff Rate Limiting
 *
 * Per-account counters live on the User document. The counters that have no
 * account to live on — per client IP, and per IP + unknown email (so an
 * attacker cannot tell which emails exist) — are kept in MongoDB
 * (LoginThrottle), not process memory: they survive restarts and deploys and
 * are shared by every instance. Thresholds and messages are unchanged.
 */
import crypto from 'node:crypto';
import LoginThrottle from '../models/LoginThrottle.js';

// A counter idle this long is removed by the TTL index (longer than any lock).
const ENTRY_MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours

/** Only a hash of the IP / typed email is stored. */
const throttleKey = (kind, ...parts) => crypto.createHash('sha256').update([kind, ...parts].join('\u0000')).digest('hex');
const ipKey = (ip) => throttleKey('ip', ip);
const anonKey = (ip, email) => throttleKey('anon', ip || 'unknown', String(email).toLowerCase().trim());

/** Count one more failure for `key` atomically and return the updated counter. */
async function bumpCounter(key, kind) {
  const now = new Date();
  return LoginThrottle.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $set: { kind, lastAttempt: now, expiresAt: new Date(now.getTime() + ENTRY_MAX_AGE) } },
    { upsert: true, new: true, lean: true }
  );
}

async function setLock(key, lockUntilMs) {
  const lockUntil = new Date(lockUntilMs);
  await LoginThrottle.updateOne({ key }, { $set: { lockUntil, expiresAt: new Date(Math.max(lockUntilMs, Date.now()) + ENTRY_MAX_AGE) } });
  return lockUntil;
}

/** The active lock of `key`, if any. */
async function activeLock(key) {
  const entry = await LoginThrottle.findOne({ key }).select('count lockUntil').lean();
  if (!entry) return { entry: null, lock: null };
  const now = Date.now();
  const lockMs = entry.lockUntil ? new Date(entry.lockUntil).getTime() : 0;
  return { entry, lock: lockMs > now ? lockMs : null };
}

/**
 * Progressive lockout tiers based on total failed attempts.
 * 3 fails  -> 5 minutes
 * 6 fails  -> 10 minutes
 * 9 fails  -> 30 minutes
 * 12+ fails -> 60 minutes
 */
export function calculateLockoutMs(failedCount) {
  if (failedCount >= 12) return 60 * 60 * 1000; // 60 mins
  if (failedCount >= 9) return 30 * 60 * 1000;  // 30 mins
  if (failedCount >= 6) return 10 * 60 * 1000;  // 10 mins
  if (failedCount >= 3) return 5 * 60 * 1000;   // 5 mins
  return 0;
}

export function getRemainingAttempts(failedCount) {
  const remainder = failedCount % 3;
  return remainder === 0 ? 0 : 3 - remainder;
}

export function getNextLockMinutes(failedCount) {
  const nextTarget = failedCount + getRemainingAttempts(failedCount);
  return Math.round(calculateLockoutMs(nextTarget) / 60000);
}

/**
 * Check if the given client IP is currently throttled due to high-frequency failed attempts.
 */
export async function checkIpThrottled(ip) {
  if (!ip) return { locked: false };
  const { lock } = await activeLock(ipKey(ip));
  if (!lock) return { locked: false };
  const retryAfterSeconds = Math.ceil((lock - Date.now()) / 1000);
  return {
    locked: true,
    ipLocked: true,
    lockUntil: new Date(lock).toISOString(),
    retryAfterSeconds,
    mins: Math.ceil(retryAfterSeconds / 60),
  };
}

/**
 * Record a failed attempt from an IP.
 * Enforces IP-level throttling across multiple account attempts:
 * 10 failed attempts from one IP -> 5m lock
 * 20 failed attempts -> 15m lock
 * 30 failed attempts -> 60m lock
 */
export async function recordIpFailure(ip) {
  if (!ip) return null;
  const key = ipKey(ip);
  const entry = await bumpCounter(key, 'ip');

  let lockMs = 0;
  if (entry.count >= 30) lockMs = 60 * 60 * 1000;
  else if (entry.count >= 20) lockMs = 15 * 60 * 1000;
  else if (entry.count >= 10) lockMs = 5 * 60 * 1000;

  if (lockMs > 0) {
    const lockUntil = await setLock(key, Date.now() + lockMs);
    return {
      locked: true,
      ipLocked: true,
      lockUntil: lockUntil.toISOString(),
      retryAfterSeconds: Math.ceil(lockMs / 1000),
      mins: Math.round(lockMs / 60000),
    };
  }
  return null;
}

/**
 * Clear or decay IP failure count upon successful authentication.
 */
export async function clearIpFailure(ip) {
  if (!ip) return;
  const key = ipKey(ip);
  const entry = await LoginThrottle.findOneAndUpdate({ key }, [{ $set: { count: { $max: [0, { $subtract: ['$count', 2] }] } } }], {
    new: true,
    lean: true,
  });
  if (entry && entry.count === 0) await LoginThrottle.deleteOne({ key, count: 0 });
}

/**
 * Track failed attempts for non-existent emails (keyed by IP + email).
 * Emulates identical progressive lockout and remaining attempts so attackers
 * cannot enumerate which emails exist.
 */
export async function checkAnonLockout(ip, email) {
  const { entry, lock } = await activeLock(anonKey(ip, email));
  if (!entry) return { locked: false, count: 0 };
  if (lock) {
    const retryAfterSeconds = Math.ceil((lock - Date.now()) / 1000);
    return {
      locked: true,
      lockUntil: new Date(lock).toISOString(),
      retryAfterSeconds,
      mins: Math.ceil(retryAfterSeconds / 60),
    };
  }
  return { locked: false, count: entry.count || 0 };
}

export async function recordAnonFailure(ip, email) {
  const key = anonKey(ip, email);
  const entry = await bumpCounter(key, 'anon');

  const remainder = entry.count % 3;
  if (remainder === 0) {
    const lockMs = calculateLockoutMs(entry.count);
    const lockUntil = await setLock(key, Date.now() + lockMs);
    return {
      locked: true,
      lockUntil: lockUntil.toISOString(),
      retryAfterSeconds: Math.ceil(lockMs / 1000),
      mins: Math.round(lockMs / 60000),
    };
  }

  return {
    locked: false,
    remainingAttempts: 3 - remainder,
    nextLockMinutes: getNextLockMinutes(entry.count),
  };
}
