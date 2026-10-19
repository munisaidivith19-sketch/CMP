import mongoose from 'mongoose';
import { EXAM_STATUSES } from '../constants.js';

const { Schema } = mongoose;

/**
 * One entry of the exam timetable: a subject's exam on a date and time, for a
 * target group of classes.
 *
 * The target group is a SCOPE, not a list of copies: `departments`, `years`
 * and `sections` each hold the chosen values, and an empty list means "All"
 * (the same convention the Holiday scope uses with null). A class
 * (department + year + section) is affected when every non-empty list
 * contains its value. So "All Departments · 3rd Year · All Sections" is one
 * record that every 3rd-year class retrieves — never one record per class.
 *
 * Dates are class-day values (UTC midnight of the campus calendar date, see
 * utils/dates.js) and times are campus-local HH:mm (24-hour), exactly like
 * TimetableSlot, so exam/period overlap is a plain string comparison.
 */
const historySchema = new Schema(
  {
    action: { type: String, enum: ['created', 'updated', 'published', 'cancelled', 'unpublished'], required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, trim: true, maxlength: 20 },
    at: { type: Date, default: Date.now },
    summary: { type: String, trim: true, maxlength: 400 },
  },
  { _id: false }
);

const examSchema = new Schema(
  {
    subjectCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    subjectName: { type: String, required: true, trim: true, maxlength: 120 },

    date: { type: Date, required: true },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // HH:mm, campus time
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },

    // Target scope — an empty list means "All".
    departments: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
    years: { type: [{ type: Number, min: 1, max: 6 }], default: [] },
    sections: { type: [{ type: String, trim: true, uppercase: true, maxlength: 10 }], default: [] },

    status: { type: String, enum: EXAM_STATUSES, default: 'draft', index: true },
    notes: { type: String, trim: true, maxlength: 300 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 300 },

    // Audit trail of every significant change (who, role, when, what).
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

examSchema.pre('validate', function checkTimes(next) {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'End time must be after start time');
  }
  next();
});

// Lookups by date (attendance blocking, overlap checks) and by department.
examSchema.index({ date: 1, status: 1 });
examSchema.index({ departments: 1, date: 1 });

export default mongoose.model('Exam', examSchema);
