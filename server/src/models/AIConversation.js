import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One JNN Study Assistant conversation, owned by exactly one user. Only the
 * visible chat is stored — never API keys, auth tokens or raw web pages.
 */
const sourceSchema = new Schema(
  {
    type: { type: String, enum: ['study_material', 'web', 'dataset'], required: true },
    title: { type: String, trim: true, maxlength: 200, required: true },
    url: { type: String, trim: true, maxlength: 2000 },
    page: Number,
    publisher: { type: String, trim: true, maxlength: 120 },
    materialId: { type: Schema.Types.ObjectId, ref: 'StudyMaterial' },
    retrievedAt: Date,
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 40000 },
    sources: { type: [sourceSchema], default: [] },
    // Honest notes shown with an answer, e.g. "web search was unavailable".
    notices: { type: [String], default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const conversationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: 'New conversation' },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

conversationSchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model('AIConversation', conversationSchema);
