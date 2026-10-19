import mongoose from 'mongoose';
import { SW_MILESTONE_KINDS, SW_MILESTONE_STATUSES } from '../constants.js';

const { Schema } = mongoose;

/**
 * A patent / startup / funding milestone CLAIMED by the project team. Only an
 * innovation coordinator can mark it verified (or rejected); a claim is never
 * shown as verified until then.
 */
const milestoneSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true, index: true },
    kind: { type: String, enum: SW_MILESTONE_KINDS, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    reference: { type: String, trim: true, maxlength: 200, default: '' },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: SW_MILESTONE_STATUSES, default: 'claimed' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

milestoneSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model('ProjectMilestone', milestoneSchema);
