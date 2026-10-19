import mongoose from 'mongoose';
import { SW_PROJECT_MODES, SW_PROJECT_STAGES, SW_REVIEW_STATUSES, SW_VISIBILITY } from '../constants.js';

const { Schema } = mongoose;

/** The project content fields — shared by the live copy and the published copy. */
const contentFields = {
  title: { type: String, trim: true, maxlength: 140 },
  domain: { type: String, maxlength: 40 },
  description: { type: String, trim: true, maxlength: 5000 },
  skills: { type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }], default: undefined },
  stage: { type: String, enum: SW_PROJECT_STAGES },
  startedAt: Date,
  endedAt: { type: Date, default: null },
  image: { type: Schema.Types.ObjectId, ref: 'SkillWalletAsset', default: null },
  githubUrl: { type: String, maxlength: 500, default: null },
  driveUrl: { type: String, maxlength: 500, default: null },
};

/**
 * A student's Skill Wallet project.
 *
 * Privacy model (see docs/SKILL_WALLET.md):
 *  - `visibility` is private by default. College-only and public are separate,
 *    explicit choices; review approval never changes visibility.
 *  - The gallery shows ONLY the `published` copy — a snapshot taken when the
 *    owner publishes. Later edits never leak into the gallery until the owner
 *    publishes again, and a public snapshot must be of an approved revision.
 *  - Team membership lives in TeamMembership (no unbounded member array).
 *  - `revision` increases with each material content change; reviews and
 *    publication refer to a revision.
 *
 * optimisticConcurrency: two parallel edits cannot silently overwrite each
 * other (the second save fails with a VersionError → 409).
 */
const projectSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: SW_PROJECT_MODES, default: 'solo' },
    // Active members including the owner. Changed only by conditional $inc
    // (memberCount < max), so parallel acceptances cannot overfill a team.
    memberCount: { type: Number, default: 1, min: 1 },
    ...contentFields,
    title: { ...contentFields.title, required: true },
    domain: { ...contentFields.domain, required: true },
    description: { ...contentFields.description, required: true },
    skills: { ...contentFields.skills, default: [] },
    stage: { ...contentFields.stage, required: true },
    startedAt: { type: Date, required: true },

    // Owner's class at creation / ownership transfer — gallery filters.
    department: { type: String, maxlength: 80, index: true },
    year: { type: Number },

    revision: { type: Number, default: 1, min: 1 },
    visibility: { type: String, enum: SW_VISIBILITY, default: 'private' },
    published: {
      type: new Schema(
        { ...contentFields, revision: Number, publishedAt: Date },
        { _id: false }
      ),
      default: null,
    },
    // A public publication waiting for every listed contributor to confirm.
    publicRequest: {
      type: new Schema(
        {
          revision: { type: Number, required: true },
          requestedAt: { type: Date, default: Date.now },
          consents: { type: [{ user: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, _id: false }], default: [] },
        },
        { _id: false }
      ),
      default: null,
    },

    review: {
      status: { type: String, enum: SW_REVIEW_STATUSES, default: 'draft' },
      submittedRevision: { type: Number, default: null },
      submittedAt: Date,
      approvedRevision: { type: Number, default: null },
      decidedAt: Date,
      // Faculty assigned by an innovation coordinator (bounded).
      reviewers: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    },
    // Mean weighted rubric total (0–100) of the approving reviews of approvedRevision.
    facultyScore: { type: Number, default: null },

    moderation: {
      hidden: { type: Boolean, default: false },
      reason: { type: String, maxlength: 500 },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },

    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },

    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true, toJSON: { versionKey: false } }
);

projectSchema.path('review.reviewers').validate((v) => v.length <= 5, 'At most 5 reviewers per project');

// Gallery: visible, published projects by audience, newest first.
projectSchema.index({ isDeleted: 1, visibility: 1, 'moderation.hidden': 1, 'published.publishedAt': -1 });
projectSchema.index({ isDeleted: 1, visibility: 1, 'published.domain': 1 });
projectSchema.index({ isDeleted: 1, visibility: 1, likeCount: -1 });
projectSchema.index({ isDeleted: 1, visibility: 1, facultyScore: -1 });
// Review queues.
projectSchema.index({ isDeleted: 1, 'review.status': 1, department: 1, 'review.submittedAt': 1 });
projectSchema.index({ 'review.reviewers': 1, 'review.status': 1 });

export const CONTENT_KEYS = ['title', 'domain', 'description', 'skills', 'stage', 'startedAt', 'endedAt', 'image', 'githubUrl', 'driveUrl'];
// Changing any of these creates a new revision (skills alone is cosmetic).
export const MATERIAL_KEYS = CONTENT_KEYS.filter((k) => k !== 'skills');

export default mongoose.model('InnovationProject', projectSchema);
