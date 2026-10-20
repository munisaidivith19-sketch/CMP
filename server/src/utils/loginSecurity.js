/**
 * Login Security & Progressive Backoff Rate Limiting
 *
 * Per-account counters live on the User document. The counters that have no
 * account to live on — per client IP, and per unknown email (so an
 * attacker cannot tell which emails exist) — are kept in MongoDB
 * (LoginThrottle), not process memory: they survive restarts and deploys and
 * are shared by every instance. Thresholds and messages are unchanged.
 */
import crypto from 'node:crypto';
import LoginThrottle from '../models/LoginThrottle.js';

// A counter idle this long is removed by the TTL index (longer than any lock).
const ENTRY_MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours
// Unknown-email counters live as long as an account's failure count does
// (authController resets failedLogins 24 hours after the last failure).
const ANON_MAX_AGE = 24 * 60 * 60 * 1000;
const maxAgeOf = (kind) => (kind === 'anon' ? ANON_MAX_AGE : ENTRY_MAX_AGE);

/** Only a hash of the IP / typed email is stored. */
const throttleKey = (kind, ...parts) => crypto.createHash('sha256').update([kind, ...parts].join('\u0000')).digest('hex');
const ipKey = (ip) => throttleKey('ip', ip);
const anonKey = (email) => throttleKey('anon', String(email).toLowerCase().trim());

/** Count one more failure for `key` atomically and return the updated counter. */
async function bumpCounter(key, kind) {
  const now = new Date();
  return LoginThrottle.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $set: { kind, lastAttempt: now, expiresAt: new Date(now.getTime() + maxAgeOf(kind)) } },
    { upsert: true, new: true, lean: true }
  );
}

async function setLock(key, lockUntilMs, kind) {
  const lockUntil = new Date(lockUntilMs);
  await LoginThrottle.updateOne({ key }, { $set: { lockUntil, expiresAt: new Date(Math.max(lockUntilMs, Date.now()) + maxAgeOf(kind)) } });
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
    const lockUntil = await setLock(key, Date.now() + lockMs, 'ip');
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

// A successful sign-in never clears or decays the per-IP counter: otherwise an
// attacker holding one valid account could interleave its logins with guesses
// against other accounts and never reach the IP throttle. The counter only
// expires through its TTL (ENTRY_MAX_AGE after the last failure).

/**
 * Track failed attempts for non-existent emails. Emulates the per-account
 * counter exactly so attackers cannot enumerate which emails exist: one
 * counter per typed email whatever the client IP (an account's counter is
 * shared by every IP too), the same progressive lockout and remaining
 * attempts, and the same 24-hour cooldown before the count starts over.
 */
export async function checkAnonLockout(email) {
  const { entry, lock } = await activeLock(anonKey(email));
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

export async function recordAnonFailure(email) {
  const key = anonKey(email);
  const entry = await bumpCounter(key, 'anon');

  const remainder = entry.count % 3;
  if (remainder === 0) {
    const lockMs = calculateLockoutMs(entry.count);
    const lockUntil = await setLock(key, Date.now() + lockMs, 'anon');
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
