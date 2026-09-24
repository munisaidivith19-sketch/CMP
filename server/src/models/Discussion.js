import mongoose from 'mongoose';
import { DISCUSSION_CATEGORIES } from '../constants.js';

const { Schema } = mongoose;

const replySchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 3000 },
    upvotes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isHidden: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const discussionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: { type: String, enum: DISCUSSION_CATEGORIES, default: 'general', index: true },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
    club: { type: Schema.Types.ObjectId, ref: 'Club' },

    upvotes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    replies: { type: [replySchema], default: [] },
    views: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now, index: true },

    // Moderation
    isLocked: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

discussionSchema.index(
  { title: 'text', body: 'text', tags: 'text' },
  { weights: { title: 5, tags: 3, body: 1 }, name: 'discussion_text' }
);

export default mongoose.model('Discussion', discussionSchema);
