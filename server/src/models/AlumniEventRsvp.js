import mongoose from 'mongoose';
import { RSVP_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const alumniEventRsvpSchema = new Schema(
  {
    event: { type: Schema.Types.ObjectId, ref: 'AlumniEvent', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: RSVP_STATUSES, default: 'going', index: true },
    checkedInAt: Date,
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

alumniEventRsvpSchema.index({ event: 1, user: 1 }, { unique: true });
alumniEventRsvpSchema.index({ event: 1, status: 1, createdAt: 1 });

export default mongoose.models.AlumniEventRsvp || mongoose.model('AlumniEventRsvp', alumniEventRsvpSchema);
