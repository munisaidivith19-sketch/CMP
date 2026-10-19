import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Emergency early exit: a faculty member who was on campus (and so may
 * already be Present for the day) has to leave. Their daily attendance is not
 * changed; the periods they would miss are listed so the HOD can arrange
 * substitutes. Approved / rejected only by an authorized person (HOD of the
 * department, Principal, Admin); every step is kept in `history`.
 */
const historySchema = new Schema(
  {
    action: { type: String, required: true, maxlength: 40 },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, maxlength: 20 },
    at: { type: Date, default: Date.now },
    note: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const earlyExitSchema = new Schema(
  {
    faculty: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    department: { type: String, trim: true, maxlength: 80 },
    date: { type: Date, required: true }, // class day
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    // When they leave (campus time, HH:mm); periods starting at/after it are affected.
    departureTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    actualDepartureAt: Date, // the real instant they left, once recorded

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: { type: String, trim: true, maxlength: 300 },

    affectedPeriods: {
      type: [
        {
          timetableSlot: { type: Schema.Types.ObjectId, ref: 'TimetableSlot' },
          period: Number,
          startTime: String,
          endTime: String,
          subjectCode: String,
          department: String,
          year: Number,
          section: String,
          _id: false,
        },
      ],
      default: [],
    },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// At most one open (pending / approved) early exit per faculty member per day.
earlyExitSchema.index(
  { faculty: 1, date: 1 },
  { unique: true, name: 'one_open_exit', partialFilterExpression: { status: { $in: ['pending', 'approved'] } } }
);
earlyExitSchema.index({ department: 1, date: 1 });

export default mongoose.model('FacultyEarlyExit', earlyExitSchema);
