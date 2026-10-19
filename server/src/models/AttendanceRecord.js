import mongoose from 'mongoose';

const { Schema } = mongoose;

const attendanceRecordSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    date: { type: Date, required: true, index: true },
    period: { type: Number, required: true, min: 1, max: 12 },
    status: { type: String, enum: ['present', 'absent', 'od'], required: true },

    section: { type: String, trim: true, maxlength: 10, index: true },
    department: { type: String, trim: true, maxlength: 80, index: true },
    // The timetable snapshot this record was taken under (absent on records
    // created before sessions existed).
    session: { type: Schema.Types.ObjectId, ref: 'AttendanceSession', index: true },
    // Reference to approved On-Duty or Leave request if applied
    odLeaveRequest: { type: Schema.Types.ObjectId, ref: 'ODLeaveRequest', index: true },

    markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    markedAt: { type: Date, default: Date.now },

    // How the record was written. Absent = marked by a person (the regular
    // workflow). AUTO_EXAM_PERIOD_PRESENT = a regular period blocked by a
    // published exam, set Present because the student was marked Present in
    // the first regular period after that exam (`triggerSession` /
    // `triggerPeriod`); `markedBy` is the person who marked that trigger
    // period. This is still REGULAR period attendance — no exam-attendance
    // record is ever created.
    source: { type: String, enum: ['AUTO_EXAM_PERIOD_PRESENT'] },
    exam: { type: Schema.Types.ObjectId, ref: 'Exam' },
    triggerSession: { type: Schema.Types.ObjectId, ref: 'AttendanceSession' },
    triggerPeriod: { type: Number, min: 1, max: 12 },

    // Correction tracking.
    correctedFrom: { type: String, enum: ['present', 'absent', 'od'] },
    correctedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    correctedAt: Date,
    correctionReason: { type: String, trim: true, maxlength: 300 },

    // Audit trail: every change of status after the first marking.
    history: {
      type: [
        {
          from: { type: String, enum: ['present', 'absent', 'od'] },
          to: { type: String, enum: ['present', 'absent', 'od'] },
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
attendanceRecordSchema.index({ markedBy: 1, date: -1 });
// Per-student totals over a date range (dashboards, low attendance): covers
// student + date + status, so those aggregations read the index only and never
// fetch the documents themselves.
attendanceRecordSchema.index({ student: 1, date: 1, status: 1 }, { name: 'student_date_status' });
// Automatic exam-period records of one exam (idempotency checks, reverts).
attendanceRecordSchema.index({ exam: 1, student: 1 }, { sparse: true });

export default mongoose.model('AttendanceRecord', attendanceRecordSchema);
