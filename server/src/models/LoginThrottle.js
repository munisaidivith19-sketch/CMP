import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Failed sign-in counters. They live in MongoDB, not process memory, so a
 * restart or a deploy does not wipe an attacker's count and every instance
 * behind the load balancer sees the same numbers. Only a SHA-256 hash of the
 * key is stored (never the raw IP, account id or typed email), and a TTL
 * index removes a counter once it has been idle for the retention window
 * (always longer than the longest lock).
 *
 *  - "ip":         one per client IP, whatever account it tried.
 *  - "account":    one per (existing account, client IP). This is where the
 *                  3-strike lock lives, so a stranger guessing from their own
 *                  network locks only their own network out of the account,
 *                  never the owner. `subject` is a hash of the account id so an
 *                  administrator's unlock can clear every network's row at once.
 *  - "anon":       one per (unknown email, client IP) — mirrors "account" so
 *                  the response never tells which emails have accounts.
 *  - "anon_total": one per unknown email across every IP — mirrors the
 *                  account-wide backstop kept on the User document.
 */
const loginThrottleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['ip', 'account', 'anon', 'anon_total'], required: true },
    subject: { type: String, index: true },
    count: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastAttempt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'login_throttle_ttl' });

export default mongoose.model('LoginThrottle', loginThrottleSchema);
