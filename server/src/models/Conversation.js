import mongoose from 'mongoose';
import { GROUP_CATEGORIES } from '../constants.js';

const { Schema } = mongoose;

const CONVERSATION_TYPES = ['private', 'group', 'class', 'club'];

const conversationSchema = new Schema(
  {
    type: { type: String, enum: CONVERSATION_TYPES, default: 'private' },
    name: { type: String, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 300 },
    avatar: String,

    participants: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Denormalised for the conversation list.
    lastMessage: {
      body: { type: String, maxlength: 400 }, // encrypted preview
      sender: { type: Schema.Types.ObjectId, ref: 'User' },
      sentAt: Date,
    },

    // Per-participant unread count.
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },

    // For class/club conversations.
    linkedClub: { type: Schema.Types.ObjectId, ref: 'Club' },
    linkedSection: { type: String, trim: true, maxlength: 20 },
    linkedDepartment: { type: String, trim: true, maxlength: 80 },
    // An academic group is exactly one class: department + year + section.
    linkedYear: { type: Number, min: 1, max: 6 },
    category: { type: String, enum: GROUP_CATEGORIES },
    // Why the group is needed — shown to the approver (principal for HOD groups).
    reason: { type: String, trim: true, maxlength: 500 },

    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],

    // Group/class channels created by faculty wait for an admin, and those
    // created by an HOD for the principal. A pending or rejected conversation
    // stays inactive, so nobody can open or message it.
    status: { type: String, enum: ['active', 'pending', 'rejected'], default: 'active', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectReason: { type: String, trim: true, maxlength: 300 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });
// Fast private conversation lookup: find the one with exactly these 2 participants.
conversationSchema.index({ type: 1, participants: 1 });

export { CONVERSATION_TYPES, GROUP_CATEGORIES };
export default mongoose.model('Conversation', conversationSchema);
