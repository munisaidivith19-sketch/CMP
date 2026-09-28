import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One class meeting whose attendance was taken: a frozen snapshot of the
 * timetable entry as it was on that date. Later timetable edits never touch
 * it, so historical attendance keeps its original time, subject and faculty.
 */
const attendanceSessionSchema = new Schema(
  {
    timetableSlot: { type: Schema.Types.ObjectId, ref: 'TimetableSlot', required: true },
    date: { type: Date, required: true },

    period: { type: Number, required: true, min: 1, max: 12 },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },

    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    subjectName: { type: String, trim: true, maxlength: 120 },
    subjectCode: { type: String, trim: true, maxlength: 20 },

    faculty: { type: Schema.Types.ObjectId, ref: 'User' },
    facultyName: { type: String, trim: true, maxlength: 80 },

    department: { type: String, required: true, trim: true, maxlength: 80 },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 10 },
    semester: { type: Number, min: 1, max: 12 },
    year: { type: Number, min: 1, max: 6 },
    room: { type: String, trim: true, maxlength: 60 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// One session per timetable entry per day.
attendanceSessionSchema.index({ timetableSlot: 1, date: 1 }, { unique: true, name: 'unique_session' });
attendanceSessionSchema.index({ faculty: 1, date: -1 });
attendanceSessionSchema.index({ department: 1, section: 1, date: -1 });

export default mongoose.model('AttendanceSession', attendanceSessionSchema);
