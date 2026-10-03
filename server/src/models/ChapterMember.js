import mongoose from 'mongoose';
import { CHAPTER_ROLES } from '../constants.js';

const { Schema } = mongoose;

const chapterMemberSchema = new Schema(
  {
    chapter: { type: Schema.Types.ObjectId, ref: 'Chapter', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: CHAPTER_ROLES, default: 'member' },
    status: { type: String, enum: ['active', 'pending'], default: 'active', index: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

chapterMemberSchema.index({ chapter: 1, user: 1 }, { unique: true });

export default mongoose.models.ChapterMember || mongoose.model('ChapterMember', chapterMemberSchema);
