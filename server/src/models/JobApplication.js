import mongoose from 'mongoose';
import { JOB_APPLICATION_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const jobApplicationSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'AlumniJob', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    poster: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    note: { type: String, trim: true, maxlength: 500 },
    resumeUrl: { type: String, trim: true },
    referralRequested: { type: Boolean, default: false },
    status: { type: String, enum: JOB_APPLICATION_STATUSES, default: 'applied', index: true },
    posterNote: { type: String, trim: true, maxlength: 500 },
    statusChangedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

jobApplicationSchema.index({ job: 1, student: 1 }, { unique: true });
jobApplicationSchema.index({ poster: 1, status: 1, createdAt: -1 });
jobApplicationSchema.index({ student: 1, createdAt: -1 });

export default mongoose.models.JobApplication || mongoose.model('JobApplication', jobApplicationSchema);
