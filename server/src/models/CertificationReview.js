import mongoose from 'mongoose';

const { Schema } = mongoose;

export const CERT_REVIEW_ACTIONS = ['submitted', 'resubmitted', 'verified', 'correction_requested', 'rejected', 'withdrawn'];

/**
 * Append-only verification history of an NPTEL certificate: each submission,
 * resubmission and verifier decision with its reason. Holds no hall ticket.
 */
const certReviewSchema = new Schema(
  {
    certification: { type: Schema.Types.ObjectId, ref: 'NptelCertification', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: CERT_REVIEW_ACTIONS, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

certReviewSchema.index({ certification: 1, createdAt: 1 });

export default mongoose.model('CertificationReview', certReviewSchema);
