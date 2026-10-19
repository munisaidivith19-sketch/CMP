import mongoose from 'mongoose';
import { REPORT_REASONS } from '../constants.js';

const { Schema } = mongoose;

/**
 * Innovation Gallery interactions. Separate collections (not arrays on the
 * project) so a popular project never grows an unbounded document.
 * Only signed-in college users interact; public visitors read counts only.
 */

/** One like per user per project. */
const likeSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
likeSchema.index({ project: 1, user: 1 }, { unique: true });
likeSchema.index({ createdAt: -1, project: 1 }); // trending window

const commentSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['visible', 'hidden', 'deleted'], default: 'visible' },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);
commentSchema.index({ project: 1, status: 1, createdAt: -1 });

/** A content report on a project or one of its comments, for the coordinators. */
const reportSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    comment: { type: Schema.Types.ObjectId, ref: 'ProjectComment', default: null },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['open', 'dismissed', 'actioned'], default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    action: { type: String, maxlength: 40 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);
reportSchema.index(
  { project: 1, comment: 1, reporter: 1 },
  { unique: true, name: 'one_open_report', partialFilterExpression: { status: 'open' } }
);
reportSchema.index({ status: 1, createdAt: -1 });

/**
 * A protected contact request: the requester never sees the team's contact
 * details unless the owner accepts, and then only the college email.
 */
const contactSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    respondedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);
contactSchema.index(
  { project: 1, requester: 1 },
  { unique: true, name: 'one_pending_contact', partialFilterExpression: { status: 'pending' } }
);
contactSchema.index({ owner: 1, status: 1, createdAt: -1 });
contactSchema.index({ requester: 1, createdAt: -1 });

export const ProjectLike = mongoose.model('ProjectLike', likeSchema);
export const ProjectComment = mongoose.model('ProjectComment', commentSchema);
export const ProjectReport = mongoose.model('ProjectReport', reportSchema);
export const ProjectContactRequest = mongoose.model('ProjectContactRequest', contactSchema);
