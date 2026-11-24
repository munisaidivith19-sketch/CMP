import mongoose from 'mongoose';

const { Schema } = mongoose;

/** End-to-end encrypted text (docs/chat-e2e.md): only participants' devices can open it. */
export const e2eSchema = new Schema(
  {
    v: { type: Number, required: true },
    epk: { type: String, required: true },
    iv: { type: String, required: true },
    ct: { type: String, required: true },
    keys: [{ _id: false, d: String, iv: String, wk: String }],
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // AES-256-GCM ciphertext (see utils/cipher.js); the API caps plaintext at 5000 chars.
    // Absent when the message is end-to-end encrypted (`e2e`).
    body: {
      type: String,
      required() {
        return !this.e2e;
      },
      maxlength: 8000,
    },
    e2e: e2eSchema,

    replyTo: { type: Schema.Types.ObjectId, ref: 'Message' },
    attachment: {
      url: String,
      name: { type: String, maxlength: 200 },
      mimeType: { type: String, maxlength: 50 },
      size: Number,
    },

    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    pinnedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    pinnedAt: Date,

    editedAt: Date,

    deletedAt: Date,
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

export default mongoose.model('Message', messageSchema);
