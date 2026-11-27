import mongoose from 'mongoose';

/**
 * Saved chats for the self-hosted Study Doubts assistant (AI Doubts tab).
 * Separate collection from the Groq Study Assistant's conversations.
 *
 * - Each chat is deleted automatically when `expiresAt` passes (MongoDB TTL
 *   index; queries also filter on it so an expired chat is never shown even
 *   before the TTL monitor runs).
 * - At most LOCAL_AI_MAX_CONVERSATIONS chats per user (enforced in the
 *   service: starting a new one removes the least recently used).
 */

const sourceSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true, maxlength: 30 },
    title: { type: String, trim: true, maxlength: 300 },
    publisher: { type: String, trim: true, maxlength: 300 },
    page: Number,
    url: { type: String, trim: true, maxlength: 2000 },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial' },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 20000 },
  sources: { type: [sourceSchema], default: undefined },
  refused: { type: Boolean, default: undefined },
  // Answer details (assistant messages): short / detailed, served from cache, credits charged.
  mode: { type: String, enum: ['short', 'detailed', 'exam'], default: undefined },
  // Exam answers: the marks asked for, and whether the answer hit the length limit ("continue").
  marks: { type: Number, min: 1, max: 20 },
  truncated: Boolean,
  cached: { type: Boolean, default: undefined },
  cost: { type: Number, default: undefined },
  // Study material the student attached to this question (user messages).
  material: {
    type: new mongoose.Schema({ id: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyMaterial' }, title: { type: String, maxlength: 200 } }, { _id: false }),
    default: undefined,
  },
  createdAt: { type: Date, default: Date.now },
});

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, trim: true, maxlength: 80, required: true },
    messages: { type: [messageSchema], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'local_ai_conversations', toJSON: { versionKey: false } }
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ user: 1, updatedAt: -1 });

export default mongoose.models.LocalAIConversation || mongoose.model('LocalAIConversation', schema);
