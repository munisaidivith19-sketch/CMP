import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },

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

    deletedAt: Date,
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, body: 'text' });

export default mongoose.model('Message', messageSchema);
