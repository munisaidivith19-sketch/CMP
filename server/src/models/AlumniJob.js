import mongoose from 'mongoose';
import { JOB_APPLY_MODES, JOB_STATUSES, JOB_TYPES, JOB_WORK_MODES } from '../constants.js';

const { Schema } = mongoose;

const alumniJobSchema = new Schema(
  {
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: JOB_TYPES, default: 'full_time' },
    workMode: { type: String, enum: JOB_WORK_MODES, default: 'onsite' },
    location: { type: String, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    skills: {
      type: [{ type: String, trim: true, maxlength: 30 }],
      default: [],
      validate: [(v) => !v || v.length <= 15, 'Maximum 15 skills allowed'],
    },
    experienceMin: { type: Number, min: 0, max: 30, default: 0 },
    experienceMax: { type: Number, min: 0, max: 30 },
    stipendOrSalary: { type: String, trim: true, maxlength: 60 },
    applyMode: { type: String, enum: JOB_APPLY_MODES, default: 'referral' },
    externalUrl: { type: String, trim: true, maxlength: 500 },
    deadline: Date,
    eligibleDepartments: { type: [{ type: String, trim: true }], default: [] },
    eligibleYears: { type: [{ type: Number, min: 1, max: 4 }], default: [] },
    status: { type: String, enum: JOB_STATUSES, default: 'open', index: true },
    removedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    removeReason: { type: String, trim: true, maxlength: 300 },
    applicationCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

alumniJobSchema.index({ status: 1, deadline: 1 });
alumniJobSchema.index({ postedBy: 1, createdAt: -1 });
alumniJobSchema.index({ title: 'text', company: 'text', skills: 'text', description: 'text' });

export default mongoose.models.AlumniJob || mongoose.model('AlumniJob', alumniJobSchema);
