import mongoose from 'mongoose';
import { NOTIFICATION_TYPES } from '../constants.js';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, maxlength: 400 },
    link: { type: String, maxlength: 200 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
// Auto-delete notifications older than 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default mongoose.model('Notification', notificationSchema);
