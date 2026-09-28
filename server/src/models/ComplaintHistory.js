import mongoose from 'mongoose';

const { Schema } = mongoose;

// Dedicated per-complaint timeline (as distinct from the generic Activity log)
// so the detail page can render a full audit trail with before/after status
// and authority, not just a one-line summary.
const complaintHistorySchema = new Schema(
  {
    complaint: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, index: true },
    action: {
      type: String,
      required: true,
      enum: [
        'submitted',
        'authority_update',
        'not_resolved',
        'escalated',
        'resolved',
        'closed',
        'cancelled',
        'identity_accessed',
      ],
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, trim: true, maxlength: 20 },
    previousStatus: { type: String, trim: true, maxlength: 20 },
    newStatus: { type: String, trim: true, maxlength: 20 },
    previousAuthority: { type: String, trim: true, maxlength: 20 },
    newAuthority: { type: String, trim: true, maxlength: 20 },
    comment: { type: String, trim: true, maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

complaintHistorySchema.index({ complaint: 1, timestamp: 1 });

export default mongoose.model('ComplaintHistory', complaintHistorySchema);
