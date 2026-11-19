/**
 * Login Security & Progressive Backoff Rate Limiting
 *
 * Who gets locked out, and by whom:
 *
 *  - The 3-strike lock is per (account, client IP). Three wrong passwords
 *    from one network lock that network out of that account for 5 minutes
 *    (then 10, 30, 60). The account's owner, on any other network, is not
 *    affected — so a stranger who knows someone's email cannot keep them
 *    locked out by typing wrong passwords from their own device.
 *  - Per client IP, failures against any account add up: 10 → 5 m lock,
 *    20 → 15 m, 30 → 60 m. This caps guessing from one address.
 *  - Account-wide backstop: once an account has collected many failures
 *    across every network (ACCOUNT_WIDE_LOCK_AFTER), the account itself is
 *    locked briefly (ACCOUNT_WIDE_LOCK_MS) — except for networks the owner
 *    has signed in from recently (isKnownNetwork), which still get in. This
 *    bounds a distributed guess without handing the attacker a lockout button.
 *  - Unknown emails get the same counters (per email + IP, and per email
 *    across IPs) so the answers never reveal which emails have accounts.
 *
 * Every counter that is not on the User document lives in MongoDB
 * (LoginThrottle), not process memory: it survives restarts and deploys and
 * is shared by every instance. Only hashes of IPs, emails and ids are stored.
 */
import crypto from 'node:crypto';
import LoginThrottle from '../models/LoginThrottle.js';
import LoginHistory from '../models/LoginHistory.js';

// A counter idle this long is removed by the TTL index (longer than any lock).
const ENTRY_MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours
// Per-account and unknown-email counters live as long as an account's failure
// count does (authController resets failedLogins 24 hours after the last failure).
const ACCOUNT_MAX_AGE = 24 * 60 * 60 * 1000;
const maxAgeOf = (kind) => (kind === 'ip' ? ENTRY_MAX_AGE : ACCOUNT_MAX_AGE);

/** Account-wide backstop: total failures across every network before the account itself locks, and for how long. */
export const ACCOUNT_WIDE_LOCK_AFTER = 30;
export const ACCOUNT_WIDE_LOCK_MS = 15 * 60 * 1000;
/** A network the owner signed in from within this window is trusted past the account-wide lock. */
export const KNOWN_NETWORK_DAYS = 30;

/** Only a hash of the IP / typed email / account id is stored. */
const throttleKey = (kind, ...parts) => crypto.createHash('sha256').update([kind, ...parts].join('\u0000')).digest('hex');
const ipKey = (ip) => throttleKey('ip', ip);
const normEmail = (email) => String(email).toLowerCase().trim();
const anonKey = (email, ip) => throttleKey('anon', normEmail(email), String(ip || ''));
const anonTotalKey = (email) => throttleKey('anon_total', normEmail(email));
const accountSubject = (userId) => throttleKey('subject', String(userId));
const accountKey = (userId, ip) => throttleKey('account', String(userId), String(ip || ''));

/** Count one more failure for `key` atomically and return the updated counter. */
async function bumpCounter(key, kind, subject) {
  const now = new Date();
  return LoginThrottle.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $set: { kind, lastAttempt: now, expiresAt: new Date(now.getTime() + maxAgeOf(kind)), ...(subject ? { subject } : {}) } },
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

const lockedView = (lockMs) => {
  const retryAfterSeconds = Math.ceil((lockMs - Date.now()) / 1000);
  return { locked: true, lockUntil: new Date(lockMs).toISOString(), retryAfterSeconds, mins: Math.ceil(retryAfterSeconds / 60) };
};

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

/** One more failure on a 3-strike counter: lock it when a tier is reached, else say how many attempts remain. */
async function strike(key, kind, subject) {
  const entry = await bumpCounter(key, kind, subject);
  const remainder = entry.count % 3;
  if (remainder === 0) {
    const lockMs = calculateLockoutMs(entry.count);
    const lockUntil = await setLock(key, Date.now() + lockMs, kind);
    return {
      locked: true,
      count: entry.count,
      lockUntil: lockUntil.toISOString(),
      retryAfterSeconds: Math.ceil(lockMs / 1000),
      mins: Math.round(lockMs / 60000),
    };
  }
  return {
    locked: false,
    count: entry.count,
    remainingAttempts: 3 - remainder,
    nextLockMinutes: getNextLockMinutes(entry.count),
  };
}

// ── Per client IP ────────────────────────────────────────────────────

/**
 * Check if the given client IP is currently throttled due to high-frequency failed attempts.
 */
export async function checkIpThrottled(ip) {
  if (!ip) return { locked: false };
  const { lock } = await activeLock(ipKey(ip));
  if (!lock) return { locked: false };
  return { ...lockedView(lock), ipLocked: true };
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

// ── Per (account, client IP) ─────────────────────────────────────────

/** Is this network locked out of this account right now? */
export async function checkAccountLockout(userId, ip) {
  const { lock } = await activeLock(accountKey(userId, ip));
  return lock ? lockedView(lock) : { locked: false };
}

/** One more wrong password for this account from this network (3-strike tiers). */
export const recordAccountFailure = (userId, ip) => strike(accountKey(userId, ip), 'account', accountSubject(userId));

/** The owner signed in from this network: its strike counter for the account starts over. */
export const clearAccountLock = (userId, ip) => LoginThrottle.deleteOne({ key: accountKey(userId, ip) });

/** An administrator unlocked the account: every network's strike counter for it is cleared. */
export const clearAccountLocks = (userId) => LoginThrottle.deleteMany({ kind: 'account', subject: accountSubject(userId) });

/**
 * Has the account's owner signed in successfully from this IP recently? Such a
 * network is let past the account-wide backstop lock (never past its own
 * 3-strike lock), so an attacker elsewhere cannot lock the owner out of their
 * usual device, while the attacker's own network stays locked.
 */
export async function isKnownNetwork(userId, ip) {
  if (!ip) return false;
  const since = new Date(Date.now() - KNOWN_NETWORK_DAYS * 24 * 60 * 60 * 1000);
  return Boolean(await LoginHistory.exists({ user: userId, ip, success: true, createdAt: { $gte: since } }));
}

// ── CAPTCHA (services/turnstile.js) ─────────────────────────────────

/** Failures from this network on this account (or unknown email) before a web sign-in must pass the CAPTCHA. */
export const CAPTCHA_AFTER_NETWORK_FAILURES = 2;
/** Failures from this IP on any account before every web sign-in from it must pass the CAPTCHA. */
export const CAPTCHA_AFTER_IP_FAILURES = 5;

/**
 * Does a web sign-in from `ip` to this account (or unknown `email`) need the
 * CAPTCHA? Reads the same counters for real and unknown emails, so the answer
 * never tells which emails have accounts.
 */
export async function captchaRequiredFor({ userId, email, ip }) {
  const networkKey = userId ? accountKey(userId, ip) : anonKey(email, ip);
  const [network, perIp] = await Promise.all([
    LoginThrottle.findOne({ key: networkKey }).select('count').lean(),
    ip ? LoginThrottle.findOne({ key: ipKey(ip) }).select('count').lean() : null,
  ]);
  return (network?.count || 0) >= CAPTCHA_AFTER_NETWORK_FAILURES || (perIp?.count || 0) >= CAPTCHA_AFTER_IP_FAILURES;
}

// ── Unknown emails (anti-enumeration mirror) ────────────────────────

/**
 * Track failed attempts for non-existent emails. Emulates the per-account
 * behaviour exactly so attackers cannot enumerate which emails exist: a
 * 3-strike counter per (typed email, client IP) with the same progressive
 * lockout and remaining attempts, a per-email total across every IP with the
 * same account-wide backstop, and the same 24-hour cooldown before the count
 * starts over.
 */
export async function checkAnonLockout(email, ip, { perNetwork = true } = {}) {
  const [{ lock: total }, { entry, lock }] = await Promise.all([activeLock(anonTotalKey(email)), activeLock(anonKey(email, ip))]);
  const active = Math.max(total || 0, perNetwork ? lock || 0 : 0);
  if (active) return lockedView(active);
  return { locked: false, count: entry?.count || 0 };
}

export async function recordAnonFailure(email, ip) {
  const [result, total] = await Promise.all([strike(anonKey(email, ip), 'anon'), bumpCounter(anonTotalKey(email), 'anon_total')]);
  if (total.count >= ACCOUNT_WIDE_LOCK_AFTER && !(total.lockUntil && new Date(total.lockUntil) > new Date())) {
    await setLock(anonTotalKey(email), Date.now() + ACCOUNT_WIDE_LOCK_MS, 'anon_total');
  }
  return result;
}
