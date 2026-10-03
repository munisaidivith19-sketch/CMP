import mongoose from 'mongoose';
import { CHAPTER_POST_KINDS } from '../constants.js';

const { Schema } = mongoose;

const chapterPostSchema = new Schema(
  {
    chapter: { type: Schema.Types.ObjectId, ref: 'Chapter', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: CHAPTER_POST_KINDS, default: 'post' },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    images: {
      type: [{ type: String }],
      default: [],
      validate: [(v) => !v || v.length <= 4, 'Maximum 4 images allowed'],
    },
    pinned: { type: Boolean, default: false },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    deletedAt: Date,
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

chapterPostSchema.index({ chapter: 1, pinned: -1, createdAt: -1 });

export default mongoose.models.ChapterPost || mongoose.model('ChapterPost', chapterPostSchema);
