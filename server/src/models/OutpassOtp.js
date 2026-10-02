import mongoose from 'mongoose';

const { Schema } = mongoose;

export const OTP_STATUSES = ['active', 'used', 'expired', 'superseded', 'locked', 'failed'];
const RETAIN_DAYS = 30;

/** One parent-verification OTP for a gate pass. Only a keyed hash of the code is stored. */
const outpassOtpSchema = new Schema(
  {
    gatePass: { type: Schema.Types.ObjectId, ref: 'GatePass', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    faculty: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parentMobileMasked: { type: String, required: true },
    otpHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    lastSentAt: { type: Date, required: true },
    usedAt: Date,
    provider: { type: String, required: true },
    status: { type: String, enum: OTP_STATUSES, default: 'active' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

outpassOtpSchema.index({ gatePass: 1, createdAt: -1 });
outpassOtpSchema.index({ status: 1, createdAt: -1 });
outpassOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETAIN_DAYS * 24 * 3600, name: 'otp_retention' });

export default mongoose.model('OutpassOtp', outpassOtpSchema);
