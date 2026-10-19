import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Accepted membership of a project team. The owner has a row too
 * (role: owner). Rows are never deleted: leaving or removal ends the row
 * (status left / removed) so the history stays.
 *
 * Only ACTIVE rows grant access. A unique partial index makes a second active
 * row for the same project + user impossible, so a doubled invitation
 * acceptance can never create two memberships.
 */
const membershipSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'left', 'removed'], default: 'active' },
    invitation: { type: Schema.Types.ObjectId, ref: 'TeamInvitation' },
    joinedAt: { type: Date, default: Date.now },
    endedAt: Date,
    endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

membershipSchema.index(
  { project: 1, user: 1 },
  { unique: true, name: 'one_active_membership', partialFilterExpression: { status: 'active' } }
);
membershipSchema.index({ user: 1, status: 1 });
membershipSchema.index({ project: 1, status: 1 });

export default mongoose.model('TeamMembership', membershipSchema);
