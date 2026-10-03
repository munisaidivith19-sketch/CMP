import mongoose from 'mongoose';

const { Schema } = mongoose;

const chapterCommentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'ChapterPost', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 600 },
    deletedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

chapterCommentSchema.index({ post: 1, createdAt: 1 });

export default mongoose.models.ChapterComment || mongoose.model('ChapterComment', chapterCommentSchema);
