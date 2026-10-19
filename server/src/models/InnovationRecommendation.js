import mongoose from 'mongoose';
import { SW_RECOMMENDATION_KINDS, SW_RECOMMENDATION_STATUSES } from '../constants.js';

const { Schema } = mongoose;

/**
 * A reviewer's recommendation of a project for funding or for IIC /
 * incubation. It is a note for the innovation coordinators to act on — it
 * does not approve, allocate or release any funding.
 */
const recommendationSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    kind: { type: String, enum: SW_RECOMMENDATION_KINDS, required: true },
    review: { type: Schema.Types.ObjectId, ref: 'ProjectReview' },
    revision: Number,
    recommendedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: SW_RECOMMENDATION_STATUSES, default: 'open' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    handledAt: Date,
    handlingNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

recommendationSchema.index({ status: 1, createdAt: -1 });
recommendationSchema.index({ project: 1, kind: 1, recommendedBy: 1 }, { unique: true });

export default mongoose.model('InnovationRecommendation', recommendationSchema);
