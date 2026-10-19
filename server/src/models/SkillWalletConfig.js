import mongoose from 'mongoose';

const { Schema } = mongoose;

const option = new Schema(
  {
    key: { type: String, required: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    // Retired options stay so existing records keep a readable label.
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

/**
 * The single, editable Skill Wallet configuration document (key "default"):
 * project domains, NPTEL institutions and the review rubric. Defaults live in
 * services/skillWallet/config.js; the document is created from them on first
 * read. The rubric is versioned — every change bumps `rubric.version` and each
 * review stores the version and weights it was scored with.
 */
const skillWalletConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    domains: { type: [option], default: [] },
    institutions: { type: [option], default: [] },
    rubric: {
      version: { type: Number, default: 1 },
      criteria: {
        type: [
          new Schema(
            {
              key: { type: String, required: true, maxlength: 40 },
              label: { type: String, required: true, trim: true, maxlength: 80 },
              weight: { type: Number, required: true, min: 1, max: 100 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

export default mongoose.model('SkillWalletConfig', skillWalletConfigSchema);
