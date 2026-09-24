import mongoose from 'mongoose';

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
      body: { type: String, maxlength: 200 },
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

    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });
// Fast private conversation lookup: find the one with exactly these 2 participants.
conversationSchema.index({ type: 1, participants: 1 });

export { CONVERSATION_TYPES };
export default mongoose.model('Conversation', conversationSchema);
