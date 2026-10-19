import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A PRIVATE file kept in MongoDB (Skill Wallet certificates and project
 * images when SKILL_WALLET_PRIVATE_STORAGE=db, the production default).
 *
 * Deliberately separate from StoredFile: StoredFile rows are served to anyone
 * by GET /uploads/:filename, these never are. They are read only through
 * utils/privateStorage.js after the caller has authorized the download.
 */
const privateFileSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 120 },
    mimeType: { type: String, required: true, maxlength: 60 },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

export default mongoose.model('PrivateFile', privateFileSchema);
