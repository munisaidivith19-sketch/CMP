import mongoose from 'mongoose';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } from '../constants.js';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, maxlength: 400 },
    link: { type: String, maxlength: 200 },
    read: { type: Boolean, default: false },
    readAt: Date,

    // Preference / channel bucket (constants.NOTIFICATION_CATEGORIES).
    category: { type: String, enum: NOTIFICATION_CATEGORIES },
    // One notification per user per event: a repeated event (retry, double
    // submit, a reminder tick) never creates a second one.
    eventKey: { type: String, maxlength: 160 },
    // Push delivery to the user's Android devices. The notification itself is
    // stored BEFORE any push is tried, so history never depends on delivery.
    delivery: {
      status: { type: String, enum: ['pending', 'sent', 'skipped', 'failed'], default: 'pending' },
      devices: { type: Number, default: 0 },
      at: Date,
    },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
notificationSchema.index(
  { user: 1, eventKey: 1 },
  { unique: true, name: 'one_per_event', partialFilterExpression: { eventKey: { $type: 'string' } } }
);
// Auto-delete notifications older than 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default mongoose.model('Notification', notificationSchema);
