import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PLATFORM_MODES = ['normal', 'maintenance', 'lockdown', 'recovery'];

/**
 * The single platform emergency-state document (_id 'platform'). Changed only
 * through services/platformState.js, which enforces the state machine and an
 * optimistic `version` check so concurrent or repeated requests cannot
 * interleave. Never deletes or alters any other data.
 */
const platformStateSchema = new Schema(
  {
    _id: { type: String, default: 'platform' },
    mode: { type: String, enum: PLATFORM_MODES, default: 'normal' },
    version: { type: Number, default: 0 },
    // Shown to ordinary users on the maintenance page. Plain text.
    message: { type: String, maxlength: 300 },
    reason: { type: String, maxlength: 500 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    changedAt: Date,
    enteredRecoveryAt: Date,
    lastHealthCheck: {
      ok: Boolean,
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      checks: { type: Schema.Types.Mixed },
    },
  },
  { versionKey: false }
);

export default mongoose.model('PlatformState', platformStateSchema);
