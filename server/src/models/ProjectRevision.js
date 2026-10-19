import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Immutable history of a project's content: one row per revision, written
 * when the project is created and on every material change. Reviews refer to
 * a revision number, so a reviewer's decision is always tied to the exact
 * content they saw.
 */
const revisionSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', required: true },
    number: { type: Number, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    editedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changed: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

revisionSchema.index({ project: 1, number: 1 }, { unique: true });

export default mongoose.model('ProjectRevision', revisionSchema);
