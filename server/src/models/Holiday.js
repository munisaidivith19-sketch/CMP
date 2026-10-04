import mongoose from 'mongoose';
import { HOLIDAY_STATUSES, HOLIDAY_TYPES } from '../constants.js';

const { Schema } = mongoose;

/**
 * A college holiday declared by the Principal: ONE record per declaration,
 * whether it covers a single day or a date range — the individual dates are
 * never materialised. Days are stored as class-day values (UTC midnight of the
 * campus calendar date, see utils/dates.js toDay), the same convention
 * AttendanceRecord / AttendanceSession use, so a holiday and an attendance
 * date always compare exactly.
 *
 * Scope is hierarchical; a null field means "all":
 *   department = null                         → entire college
 *   department = 'CSE', year = null           → whole department
 *   department = 'CSE', year = 3, section=null → that year of the department
 *   department = 'CSE', year = 3, section='A'  → one class
 *
 * Normal timetable entries are never touched — a holiday is an exception laid
 * over the schedule, and cancelling it (status CANCELLED, a soft delete) brings
 * the normal timetable and attendance rules straight back.
 */
const holidaySchema = new Schema(
  {
    reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    type: { type: String, enum: HOLIDAY_TYPES, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    department: { type: String, trim: true, maxlength: 80, default: null },
    year: { type: Number, min: 1, max: 4, default: null },
    section: { type: String, trim: true, uppercase: true, maxlength: 10, default: null },

    status: { type: String, enum: HOLIDAY_STATUSES, default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// The controller validates all of this first with friendlier messages; the
// model re-checks so no write path can ever store an inconsistent holiday.
holidaySchema.pre('validate', function check(next) {
  if (this.startDate && this.endDate && this.startDate > this.endDate) {
    this.invalidate('endDate', 'The end date cannot be before the start date');
  }
  if (this.type === 'SINGLE' && this.startDate && this.endDate && this.startDate.getTime() !== this.endDate.getTime()) {
    this.invalidate('endDate', 'A single-day holiday has one date');
  }
  // The scope is a hierarchy: a year needs a department, a section needs a year.
  if (this.year != null && !this.department) this.invalidate('year', 'Choose a department before a year');
  if (this.section && this.year == null) this.invalidate('section', 'Choose a year before a section');
  next();
});

// "Which active holidays touch this date range?" — every lookup starts here.
holidaySchema.index({ status: 1, startDate: 1, endDate: 1 }, { name: 'active_range' });

export default mongoose.model('Holiday', holidaySchema);
