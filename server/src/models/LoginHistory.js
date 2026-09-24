import mongoose from 'mongoose';

const { Schema } = mongoose;

const loginHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ip: { type: String, maxlength: 45 },
    userAgent: { type: String, maxlength: 500 },
    device: { type: String, maxlength: 200 },
    success: { type: Boolean, default: true },
    reason: { type: String, maxlength: 100 }, // e.g. 'invalid_password', 'account_locked'
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

loginHistorySchema.index({ createdAt: -1 });
// Keep 90 days of login history.
loginHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default mongoose.model('LoginHistory', loginHistorySchema);
