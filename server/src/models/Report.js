import mongoose from 'mongoose';
import { REPORT_ACTIONS, REPORT_REASONS, REPORT_TARGETS } from '../constants.js';

const { Schema } = mongoose;

const reportSchema = new Schema(
  {
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    replyId: { type: Schema.Types.ObjectId }, // when targetType === 'reply', targetId is the discussion
    reporter: { type: Schema.Types.ObjectId, ref: 'User' }, // null = automatic content filter
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'resolved', 'dismissed'], default: 'pending', index: true },
    resolution: {
      action: { type: String, enum: REPORT_ACTIONS },
      note: { type: String, trim: true, maxlength: 500 },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

reportSchema.index({ targetType: 1, targetId: 1, replyId: 1, status: 1 });

export default mongoose.model('Report', reportSchema);
