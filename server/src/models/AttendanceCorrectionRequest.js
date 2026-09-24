import mongoose from 'mongoose';

const { Schema } = mongoose;

const correctionRequestSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    date: { type: Date, required: true },
    period: { type: Number, required: true, min: 1, max: 12 },

    currentStatus: { type: String, enum: ['present', 'absent'], required: true },
    requestedStatus: { type: String, enum: ['present', 'absent'], required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 300 },
    reviewedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

correctionRequestSchema.index({ student: 1, subject: 1, date: 1, period: 1, status: 1 });
correctionRequestSchema.index({ subject: 1, status: 1 });

export default mongoose.model('AttendanceCorrectionRequest', correctionRequestSchema);
