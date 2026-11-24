import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A device's public key for end-to-end encrypted chat (docs/chat-e2e.md).
 * The private key never reaches the server.
 */
const chatDeviceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, unique: true },
    // ECDH P-256 public key, SPKI DER as base64.
    publicKey: { type: String, required: true, maxlength: 200 },
    platform: { type: String, enum: ['web', 'android', 'ios'], required: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

chatDeviceSchema.index({ user: 1, publicKey: 1 }, { unique: true });

export default mongoose.model('ChatDevice', chatDeviceSchema);
