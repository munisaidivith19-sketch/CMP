import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * An uploaded file kept in MongoDB. Used in production when Cloudinary isn't
 * configured: the host's disk (e.g. Render) is wiped on every deploy/restart,
 * so files written there vanish and every banner/logo turns into a broken image.
 */
const storedFileSchema = new Schema(
  {
    filename: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number },
    // Who uploaded it through POST /api/uploads. Only such rows are candidates
    // for the orphan sweep (services/orphanUploads.js); files stored by other
    // paths (e.g. avatars, attached at once) carry no uploader and are kept.
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Set by the orphan sweep once a record was found referencing the file:
    // an attached file is never checked or deleted again.
    attachedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

storedFileSchema.index({ uploadedBy: 1, attachedAt: 1, createdAt: 1 });

export default mongoose.model('StoredFile', storedFileSchema);
