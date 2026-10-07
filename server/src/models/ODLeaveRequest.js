import mongoose from 'mongoose';

const { Schema } = mongoose;

export const OD_LEAVE_TYPES = ['od', 'leave'];
export const OD_LEAVE_STATUSES = [
  'pending_faculty',
  'pending_hod',
  'pending_principal',
  'approved',
  'rejected',
  'cancelled',
];

const reviewStageSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    action: { type: String, enum: ['forwarded', 'approved', 'rejected'] },
    reason: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const odLeaveRequestSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: String, required: true, trim: true, maxlength: 80, index: true },
    section: { type: String, required: true, trim: true, uppercase: true, maxlength: 10, index: true },
    year: { type: Number, required: true, min: 1, max: 5, index: true },
    semester: { type: Number, min: 1, max: 10 },

    requestType: { type: String, enum: OD_LEAVE_TYPES, required: true, index: true },
    category: { type: String, required: true, trim: true, maxlength: 120 },

    fromDate: { type: Date, required: true, index: true },
    toDate: { type: Date, required: true, index: true },
    daysCount: { type: Number, required: true, min: 1, default: 1 },

    description: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
    document: {
      url: { type: String, trim: true },
      name: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number },
    },

    status: {
      type: String,
      enum: OD_LEAVE_STATUSES,
      default: 'pending_faculty',
      index: true,
    },

    facultyReview: reviewStageSchema,
    hodReview: reviewStageSchema,
    principalReview: reviewStageSchema,

    rejectedStage: { type: String, enum: ['faculty', 'hod', 'principal'] },
    rejectedReason: { type: String, trim: true, maxlength: 500 },

    cancelledAt: { type: Date },
    attendanceApplied: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

odLeaveRequestSchema.index({ student: 1, fromDate: 1, toDate: 1 });
odLeaveRequestSchema.index({ status: 1, department: 1, section: 1 });
odLeaveRequestSchema.index({ fromDate: 1, toDate: 1, status: 1 });

export default mongoose.model('ODLeaveRequest', odLeaveRequestSchema);

