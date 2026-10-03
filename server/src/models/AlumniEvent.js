import mongoose from 'mongoose';
import { ALUMNI_EVENT_MODES, ALUMNI_EVENT_STATUSES, ALUMNI_EVENT_TYPES } from '../constants.js';

const { Schema } = mongoose;

const alumniEventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 4000 },
    type: { type: String, enum: ALUMNI_EVENT_TYPES, default: 'reunion' },
    mode: { type: String, enum: ALUMNI_EVENT_MODES, default: 'in_person' },
    venue: { type: String, trim: true, maxlength: 200 },
    meetingLink: { type: String, trim: true, maxlength: 300 },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    registrationDeadline: Date,
    capacity: { type: Number, default: 0, min: 0 },
    audience: {
      gradYears: { type: [{ type: Number }], default: [] },
      departments: { type: [{ type: String, trim: true }], default: [] },
      roles: { type: [{ type: String }], default: [] },
    },
    cover: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organizerName: { type: String, trim: true, maxlength: 100 },
    status: { type: String, enum: ALUMNI_EVENT_STATUSES, default: 'pending_approval', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectReason: { type: String, trim: true, maxlength: 300 },
    cancelReason: { type: String, trim: true, maxlength: 300 },
    goingCount: { type: Number, default: 0, min: 0 },
    waitlistCount: { type: Number, default: 0, min: 0 },
    reminder24hSentAt: Date,
    reminder1hSentAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

alumniEventSchema.index({ status: 1, startsAt: 1 });
alumniEventSchema.index({ title: 'text', description: 'text' });

export default mongoose.models.AlumniEvent || mongoose.model('AlumniEvent', alumniEventSchema);
