import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * What happens to one timetabled period on one date when its scheduled
 * faculty member cannot take it (absent, on leave, early exit):
 *
 *   - substitute           another faculty member takes the class and may
 *                          submit its attendance (and only this period's);
 *   - not_conducted        the class did not take place — no attendance is
 *                          recorded, and it never counts as held;
 *   - pending_verification the HOD has not yet confirmed what happened.
 *
 * The scheduled assignment is never changed: the timetable slot keeps its
 * faculty, and this record says who actually covered it. Only one ACTIVE
 * arrangement per period per date; a cancelled one stays for the audit trail.
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

const periodCoverSchema = new Schema(
  {
    date: { type: Date, required: true }, // class day (UTC midnight of the campus date)
    timetableSlot: { type: Schema.Types.ObjectId, ref: 'TimetableSlot', required: true },

    // Snapshot of the period as scheduled.
    period: { type: Number, min: 1, max: 12 },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    department: { type: String, required: true, trim: true, maxlength: 80 },
    year: { type: Number, min: 1, max: 6 },
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },
    semester: { type: Number, min: 1, max: 12 },
    room: { type: String, trim: true, maxlength: 60 },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject' },
    subjectCode: { type: String, maxlength: 20 },
    originalFaculty: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    kind: { type: String, enum: ['substitute', 'not_conducted', 'pending_verification'], required: true },
    substitute: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 300 },

    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

periodCoverSchema.index(
  { timetableSlot: 1, date: 1 },
  { unique: true, name: 'one_active_cover', partialFilterExpression: { status: 'active' } }
);
periodCoverSchema.index({ substitute: 1, date: 1 });
periodCoverSchema.index({ originalFaculty: 1, date: 1 });
periodCoverSchema.index({ department: 1, date: 1 });

export default mongoose.model('PeriodCover', periodCoverSchema);
