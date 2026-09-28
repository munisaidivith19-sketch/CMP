import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Safe usage analytics for the Study Assistant — who/when/how long/which
 * source types/token counts/error category. Never the question text, the
 * answer, the API key or any request headers. Auto-expires after 180 days.
 */
const usageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    model: { type: String, trim: true, maxlength: 80 },
    requestedAt: { type: Date, default: Date.now },
    durationMs: Number,
    success: { type: Boolean, default: false },
    streamed: { type: Boolean, default: false },
    sourceTypes: { type: [String], default: [] },
    webSearchUsed: { type: Boolean, default: false },
    promptTokens: Number,
    completionTokens: Number,
    totalTokens: Number,
    errorCategory: { type: String, trim: true, maxlength: 40 },
  },
  { toJSON: { versionKey: false } }
);

usageSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export default mongoose.model('AIUsageLog', usageSchema);
