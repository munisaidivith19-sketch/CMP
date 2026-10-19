import mongoose from 'mongoose';
import { SW_INVITATION_STATUSES } from '../constants.js';

const { Schema } = mongoose;

/**
 * An invitation to join a team project, addressed to an internal user ID
 * (resolved on the server from a college roll number — the roll number itself
 * is not stored and never grants anything).
 *
 * pending → accepted | declined | cancelled | expired. Every transition is a
 * conditional update on `status: 'pending'`, so two parallel answers cannot
 * both win. One pending invitation per project + invitee (unique partial index).
 */
const invitationSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    inviter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: SW_INVITATION_STATUSES, default: 'pending' },
    message: { type: String, trim: true, maxlength: 300 },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

invitationSchema.index(
  { project: 1, invitee: 1 },
  { unique: true, name: 'one_pending_invitation', partialFilterExpression: { status: 'pending' } }
);
invitationSchema.index({ invitee: 1, status: 1, createdAt: -1 });
invitationSchema.index({ project: 1, status: 1 });
invitationSchema.index({ inviter: 1, createdAt: -1 });

export default mongoose.model('TeamInvitation', invitationSchema);
