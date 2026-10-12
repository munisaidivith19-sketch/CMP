import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Failed sign-in counters that are not tied to an existing account: one per
 * client IP ("ip") and one per IP + typed email that has no account ("anon").
 * They live in MongoDB, not process memory, so a restart or a deploy does not
 * wipe an attacker's count and every instance behind the load balancer sees
 * the same numbers. Only a SHA-256 hash of the key is stored (never the raw
 * IP or the typed email), and a TTL index removes a counter once it has been
 * idle for the retention window (always longer than the longest lock).
 */
const loginThrottleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['ip', 'anon'], required: true },
    count: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastAttempt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'login_throttle_ttl' });

export default mongoose.model('LoginThrottle', loginThrottleSchema);
