import mongoose from 'mongoose';
import { POLICY_IDS } from '../legal/registry.js';

const { Schema } = mongoose;

export const POLICY_STATUSES = ['draft', 'published'];

/**
 * One version of a legal document (Terms and Conditions / Privacy Policy).
 * Written only by services/legal.js from legal/registry.js.
 *
 * A published version is immutable: its text, hash, number and dates can
 * never change, and no version can be deleted, so the document behind every
 * PolicyAcceptance stays exactly as the user saw it. The only change the model
 * allows is a draft being published (and a draft's text being revised).
 *
 * "Current" is not stored: it is the highest published version whose
 * effectiveAt has passed (services/legal.js), so two versions can never both
 * be marked current.
 */
const policyVersionSchema = new Schema(
  {
    policyId: { type: String, enum: POLICY_IDS, required: true },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, maxlength: 120 },
    status: { type: String, enum: POLICY_STATUSES, required: true },
    effectiveAt: { type: Date, required: true },
    publishedAt: Date,
    // Terms only: every user must accept this version (or a later one).
    requiresAcceptance: { type: Boolean, default: false },
    changeSummary: { type: String, maxlength: 500 },
    // Markdown, rendered as plain text by every client (never as HTML).
    content: { type: String, required: true, maxlength: 200000 },
    // SHA-256 of `content`, recorded with each acceptance.
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  },
  { timestamps: true, versionKey: false }
);

policyVersionSchema.index({ policyId: 1, version: 1 }, { unique: true });
policyVersionSchema.index({ policyId: 1, status: 1, effectiveAt: -1, version: -1 });

const IMMUTABLE = 'Published policy versions cannot be modified or deleted';
const refuse = (next) => next(new Error(IMMUTABLE));

// Bulk/query updates and every delete are refused outright.
for (const op of ['updateMany', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']) {
  policyVersionSchema.pre(op, function refuseOp(next) {
    refuse(next);
  });
}
policyVersionSchema.pre('deleteOne', { document: true, query: false }, function refuseDoc(next) {
  refuse(next);
});

// Single-document query updates may only touch drafts (publishing one).
for (const op of ['updateOne', 'findOneAndUpdate']) {
  policyVersionSchema.pre(op, function draftsOnly(next) {
    this.where({ status: 'draft' });
    next();
  });
}

policyVersionSchema.pre('save', async function onlyDrafts(next) {
  if (this.isNew) return next();
  const stored = await this.constructor.findById(this._id).select('status').lean();
  if (stored?.status !== 'draft') return refuse(next);
  next();
});

export default mongoose.model('PolicyVersion', policyVersionSchema);
