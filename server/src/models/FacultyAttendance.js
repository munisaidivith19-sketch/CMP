import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per staff member per campus day — the faculty counterpart of
 * AttendanceRecord (which is per student per period). Marked by the HOD for
 * their department, or by an admin for anyone — or automatically as present
 * for the whole day once the faculty member takes attendance in their class.
 */
const facultyAttendanceSchema = new Schema(
  {
    faculty: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Class-day marker: UTC midnight of the campus calendar date (see utils/dates.js).
    date: { type: Date, required: true, index: true },
    status: { type: String, enum: ['present', 'absent', 'leave'], required: true },
    department: { type: String, trim: true, maxlength: 80, index: true },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    markedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true, maxlength: 200 },
    // 'auto': created when the faculty member took attendance in their own
    // class that day (services/facultyPresence.js); 'manual': HOD / admin.
    source: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    // The class that produced an automatic mark (kept for the record).
    autoFrom: {
      period: Number,
      subjectCode: { type: String, maxlength: 20 },
      department: { type: String, maxlength: 80 },
      section: { type: String, maxlength: 10 },
      at: Date,
    },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// One status per staff member per day.
facultyAttendanceSchema.index({ faculty: 1, date: 1 }, { unique: true, name: 'unique_faculty_day' });
facultyAttendanceSchema.index({ department: 1, date: 1 });

export default mongoose.model('FacultyAttendance', facultyAttendanceSchema);
