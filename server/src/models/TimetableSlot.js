import mongoose from 'mongoose';
import { yearOfSemester } from '../constants.js';

const { Schema } = mongoose;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const timetableSlotSchema = new Schema(
  {
    // Breaks (lunch etc.) have no subject or faculty.
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: function needsSubject() { return !this.isBreak; } },
    faculty: { type: Schema.Types.ObjectId, ref: 'User', required: function needsFaculty() { return !this.isBreak; } },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 10, index: true },
    department: { type: String, required: true, trim: true, maxlength: 80, index: true },
    room: { type: String, trim: true, maxlength: 60 },

    dayOfWeek: { type: String, enum: DAYS, required: true, index: true },
    period: { type: Number, required: true, min: 1, max: 12 },
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ }, // HH:mm
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },

    semester: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 1, max: 6 },
    academicYear: { type: String, trim: true, maxlength: 20 }, // e.g. '2026-27'

    isBreak: { type: Boolean, default: false },
    breakLabel: { type: String, trim: true, maxlength: 40 }, // e.g. 'Lunch Break'

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// Prevent double-booking: one ACTIVE slot per section, day and period. Partial so
// soft-deleted (inactive) slots never collide with each other.
timetableSlotSchema.index(
  { section: 1, department: 1, dayOfWeek: 1, period: 1, semester: 1 },
  { unique: true, name: 'unique_active_slot', partialFilterExpression: { isActive: true } }
);
// Faculty schedule index.
timetableSlotSchema.index({ faculty: 1, dayOfWeek: 1, period: 1, semester: 1 });
timetableSlotSchema.index({ room: 1, dayOfWeek: 1, isActive: 1 });
// Class timetable lookup: department + year + section + semester.
timetableSlotSchema.index({ department: 1, year: 1, section: 1, semester: 1, isActive: 1 }, { name: 'class_timetable' });

timetableSlotSchema.pre('validate', function checkTimes(next) {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'End time must be after start time');
  }
  if (this.semester) {
    const expected = yearOfSemester(this.semester);
    if (this.year == null) this.year = expected;
    else if (this.year !== expected) this.invalidate('year', `Semester ${this.semester} belongs to year ${expected}, not year ${this.year}`);
  }
  next();
});

export { DAYS };
export default mongoose.model('TimetableSlot', timetableSlotSchema);
