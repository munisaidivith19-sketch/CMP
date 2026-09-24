import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Activity + audit trail. Powers analytics and the admin activity log. */
const activitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, required: true, maxlength: 60 }, // e.g. 'event.register'
    entityType: { type: String, maxlength: 30 },
    entityId: { type: Schema.Types.ObjectId },
    summary: { type: String, maxlength: 200 },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

activitySchema.index({ createdAt: -1 });
activitySchema.index({ action: 1, createdAt: -1 });
// Keep 180 days of history.
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export default mongoose.model('Activity', activitySchema);
