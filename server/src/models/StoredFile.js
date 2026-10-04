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
  },
  { timestamps: true }
);

export default mongoose.model('StoredFile', storedFileSchema);
