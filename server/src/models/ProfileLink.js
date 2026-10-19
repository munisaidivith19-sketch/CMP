import mongoose from 'mongoose';
import { SW_LINK_PLATFORMS, SW_VISIBILITY } from '../constants.js';

const { Schema } = mongoose;

/**
 * A student's external profile link (GitHub, LinkedIn, LeetCode, …). The URL
 * is validated on write and never fetched by the server; a link is a claim
 * by the student, not a verified account.
 */
const linkSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: SW_LINK_PLATFORMS, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    url: { type: String, required: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    visibility: { type: String, enum: SW_VISIBILITY, default: 'private' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

linkSchema.index({ user: 1, createdAt: 1 });

export const MAX_LINKS_PER_USER = 30;
export default mongoose.model('ProfileLink', linkSchema);
