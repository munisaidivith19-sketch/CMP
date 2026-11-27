import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Collections used only by the self-hosted AI Doubts assistant. None of them
 * is ever shown to the model: they hold usage limits, credits and caches.
 */

// Per-student state: misuse strikes / temporary block and credit usage.
const userStateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    strikes: [{ _id: false, at: { type: Date, required: true }, category: { type: String, maxlength: 40 } }],
    blockedUntil: { type: Date, default: null },
    blockReason: { type: String, maxlength: 200 },
    credits: {
      period: { type: String, default: '' }, // YYYY-MM (college time zone); no rollover
      used: { type: Number, default: 0, min: 0 },
      bonus: { type: Number, default: 0, min: 0 }, // granted by IT support for this month
      day: { type: String, default: '' }, // YYYY-MM-DD
      dayUsed: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true, collection: 'local_ai_user_state' }
);
userStateSchema.index({ blockedUntil: 1 });
export const LocalAIUserState = mongoose.models.LocalAIUserState || mongoose.model('LocalAIUserState', userStateSchema);

// Credit ledger: every charge, refund and grant (kept 13 months).
const ledgerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['charge', 'grant'], required: true },
    amount: { type: Number, required: true }, // credits spent (charge) or added (grant)
    size: { type: String, enum: ['short', 'normal', 'long', 'cached', 'refused', 'error', 'bonus'] },
    mode: { type: String, enum: ['short', 'detailed', 'exam'] },
    conversation: { type: Schema.Types.ObjectId },
    material: { type: Schema.Types.ObjectId },
    by: { type: Schema.Types.ObjectId, ref: 'User' }, // grants: IT support account
    reason: { type: String, maxlength: 300 },
    period: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'local_ai_credit_ledger' }
);
ledgerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const LocalAICreditLedger = mongoose.models.LocalAICreditLedger || mongoose.model('LocalAICreditLedger', ledgerSchema);

// Shared answer cache. The key already includes the exact study-material
// excerpts that were found for the asking student, so a cached answer is only
// ever served to someone whose own (scoped) search found the same materials.
const answerCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    content: { type: String, required: true, maxlength: 20000 },
    sources: [{ _id: false, type: { type: String }, title: String, publisher: String, page: Number, url: String, materialId: Schema.Types.ObjectId }],
    mode: { type: String, enum: ['short', 'detailed', 'exam'] },
    material: { type: Schema.Types.ObjectId, index: true }, // attached material, if any
    materialIds: [{ type: Schema.Types.ObjectId }],
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'local_ai_answer_cache' }
);
answerCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
answerCacheSchema.index({ materialIds: 1 });
export const LocalAIAnswerCache = mongoose.models.LocalAIAnswerCache || mongoose.model('LocalAIAnswerCache', answerCacheSchema);

// One short analysis per study material version, made once and reused by every student.
const digestSchema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, required: true, unique: true },
    fileUrl: { type: String, maxlength: 300 }, // the file version it was made from
    status: { type: String, enum: ['pending', 'ready', 'failed'], default: 'pending' },
    summary: { type: String, maxlength: 4000 },
  },
  { timestamps: true, collection: 'local_ai_material_digests' }
);
export const LocalAIMaterialDigest = mongoose.models.LocalAIMaterialDigest || mongoose.model('LocalAIMaterialDigest', digestSchema);
