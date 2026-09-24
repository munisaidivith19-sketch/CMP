import mongoose from 'mongoose';

const { Schema } = mongoose;

const attendanceRecordSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    date: { type: Date, required: true, index: true },
    period: { type: Number, required: true, min: 1, max: 12 },
    status: { type: String, enum: ['present', 'absent'], required: true },

    section: { type: String, trim: true, maxlength: 10, index: true },
    department: { type: String, trim: true, maxlength: 80, index: true },

    markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    markedAt: { type: Date, default: Date.now },

    // Correction tracking.
    correctedFrom: { type: String, enum: ['present', 'absent'] },
    correctedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    correctedAt: Date,
    correctionReason: { type: String, trim: true, maxlength: 300 },

    // Audit trail: every change of status after the first marking.
    history: {
      type: [
        {
          from: { type: String, enum: ['present', 'absent'] },
          to: { type: String, enum: ['present', 'absent'] },
          by: { type: Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
          reason: { type: String, trim: true, maxlength: 300 },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// Prevent duplicate: same student, same subject, same date, same period.
attendanceRecordSchema.index(
  { student: 1, subject: 1, date: 1, period: 1 },
  { unique: true, name: 'unique_attendance' }
);
// For aggregation queries.
attendanceRecordSchema.index({ subject: 1, date: 1, section: 1 });
attendanceRecordSchema.index({ department: 1, date: 1 });

export default mongoose.model('AttendanceRecord', attendanceRecordSchema);
