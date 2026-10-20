import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Per-user, per-day upload counter for POST /api/uploads (utils/uploadQuota.js).
 * One row per user and UTC day; the TTL index removes it two days later.
 */
const uploadQuotaSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    count: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

uploadQuotaSchema.index({ user: 1, day: 1 }, { unique: true });
uploadQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'upload_quota_ttl' });

export default mongoose.model('UploadQuota', uploadQuotaSchema);
