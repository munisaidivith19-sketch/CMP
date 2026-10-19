import mongoose from 'mongoose';
import { SW_REVIEW_DECISIONS } from '../constants.js';

const { Schema } = mongoose;

/**
 * One faculty review of one project revision. The rubric (version, labels and
 * weights) is copied in, so later rubric edits never change an old score.
 *
 * `feedback` is shown to the project team; `internalNotes` only to reviewers
 * and innovation coordinators — never to students, never in the gallery.
 * Recommendations are recorded here and in InnovationRecommendation; they
 * never approve or release funding by themselves.
 */
const reviewSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    revision: { type: Number, required: true },
    reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rubricVersion: { type: Number, required: true },
    criteria: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            label: { type: String, required: true },
            weight: { type: Number, required: true },
            score: { type: Number, required: true, min: 0, max: 10 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    totalScore: { type: Number, required: true, min: 0, max: 100 },
    feedback: { type: String, trim: true, maxlength: 3000, default: '' },
    internalNotes: { type: String, trim: true, maxlength: 3000, default: '' },
    decision: { type: String, enum: SW_REVIEW_DECISIONS, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: '' },
    recommendFunding: { type: Boolean, default: false },
    recommendIncubation: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

reviewSchema.index({ project: 1, revision: 1, reviewer: 1 }, { unique: true, name: 'one_review_per_revision' });
reviewSchema.index({ project: 1, createdAt: -1 });
reviewSchema.index({ reviewer: 1, createdAt: -1 });

export default mongoose.model('ProjectReview', reviewSchema);
