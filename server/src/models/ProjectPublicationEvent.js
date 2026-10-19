import mongoose from 'mongoose';
import { SW_VISIBILITY } from '../constants.js';

const { Schema } = mongoose;

export const PUBLICATION_ACTIONS = [
  'college_published',
  'public_requested',
  'public_consent',
  'public_consent_withdrawn',
  'public_request_cancelled',
  'public_published',
  'unpublished',
  'republished',
  'hidden',
  'unhidden',
];

/**
 * Append-only history of every consent and visibility change of a project:
 * who chose what audience, for which revision, and when. Shown to the
 * project team and to innovation coordinators.
 */
const eventSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: PUBLICATION_ACTIONS, required: true },
    revision: Number,
    from: { type: String, enum: [...SW_VISIBILITY, null], default: null },
    to: { type: String, enum: [...SW_VISIBILITY, null], default: null },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

eventSchema.index({ project: 1, createdAt: -1 });

export default mongoose.model('ProjectPublicationEvent', eventSchema);
