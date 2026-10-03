import mongoose from 'mongoose';
import { INVITE_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const alumniInviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    gradYear: { type: Number, required: true },
    company: { type: String, trim: true },
    designation: { type: String, trim: true },
    location: { type: String, trim: true },
    phone: { type: String, trim: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: INVITE_STATUSES, default: 'pending', index: true },
    batch: { type: Schema.Types.ObjectId, ref: 'AlumniImportBatch' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    claimedAt: Date,
    lastSentAt: Date,
    sendCount: { type: Number, default: 1 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

alumniInviteSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'alumni_invite_email_pending_unique' }
);

export default mongoose.models.AlumniInvite || mongoose.model('AlumniInvite', alumniInviteSchema);
