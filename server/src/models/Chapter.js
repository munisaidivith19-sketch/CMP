import mongoose from 'mongoose';
import { CHAPTER_TYPES } from '../constants.js';

const { Schema } = mongoose;

const chapterSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: CHAPTER_TYPES, required: true },
    gradYear: Number,
    department: { type: String, trim: true },
    city: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 600 },
    cover: String,
    isPrivate: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    memberCount: { type: Number, default: 0, min: 0 },
    postCount: { type: Number, default: 0, min: 0 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

chapterSchema.index({ type: 1, gradYear: 1, department: 1 });

export default mongoose.models.Chapter || mongoose.model('Chapter', chapterSchema);
