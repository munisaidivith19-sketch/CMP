import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * An Android device registered for FCM push. A token belongs to exactly one
 * user — the account signed in on that device when it registered — and to the
 * session it was registered from: when that session ends (logout, revoke,
 * expiry) the device stops receiving that user's pushes. Tokens FCM reports as
 * unregistered are deleted.
 */
const deviceTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session', index: true },
    token: { type: String, required: true, maxlength: 4096 },
    provider: { type: String, enum: ['fcm'], default: 'fcm' },
    platform: { type: String, enum: ['android'], default: 'android' },
    deviceName: { type: String, trim: true, maxlength: 80 },
    appVersion: { type: String, trim: true, maxlength: 40 },
    lastSeenAt: { type: Date, default: Date.now },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

deviceTokenSchema.index({ token: 1 }, { unique: true, name: 'unique_token' });

export default mongoose.model('DeviceToken', deviceTokenSchema);
