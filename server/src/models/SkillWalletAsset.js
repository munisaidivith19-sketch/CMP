import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A privately stored Skill Wallet file (utils/privateStorage.js): a project
 * image or an NPTEL certificate image (always WebP).
 *
 * Knowing an asset's ID grants nothing. Every download goes through a signed,
 * short-lived, viewer-bound URL and is re-authorized against the asset's
 * project / certificate at download time (services/skillWallet/assets.js).
 *
 * pending  — uploaded, not yet attached (removed after SKILL_WALLET_ORPHAN_ASSET_HOURS);
 * attached — referenced by a project or certificate;
 * deleted  — bytes removed from storage, row kept for history.
 */
const assetSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['project_image', 'certificate'], required: true },
    project: { type: Schema.Types.ObjectId, ref: 'InnovationProject', default: null },
    certification: { type: Schema.Types.ObjectId, ref: 'NptelCertification', default: null },
    storageKey: { type: String, required: true, maxlength: 120 },
    mimeType: { type: String, enum: ['image/webp', 'image/png', 'image/jpeg'], required: true },
    size: { type: Number, required: true },
    width: Number,
    height: Number,
    sha256: { type: String, maxlength: 64 },
    status: { type: String, enum: ['pending', 'attached', 'deleted'], default: 'pending' },
    deletedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

assetSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model('SkillWalletAsset', assetSchema);
