import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per signed-in device. The refresh token carries `sid` + `jti`;
 * `jti` rotates on every refresh, so presenting an old one means the token
 * was copied — the whole session is revoked (refresh-token reuse detection).
 */
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, select: false },
    client: { type: String, enum: ['web', 'mobile'], default: 'web' },
    device: { type: String, maxlength: 200 },
    userAgent: { type: String, maxlength: 500 },
    ip: { type: String, maxlength: 45 },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: { type: String, maxlength: 60 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

sessionSchema.index({ user: 1, revokedAt: 1, expiresAt: -1 });
// Drop session rows 30 days after they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

sessionSchema.methods.isLive = function isLive() {
  return !this.revokedAt && this.expiresAt > new Date();
};

export default mongoose.model('Session', sessionSchema);
