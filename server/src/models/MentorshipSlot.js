import mongoose from 'mongoose';
import { SESSION_MODES, SLOT_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const mentorshipSlotSchema = new Schema(
  {
    alumni: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startsAt: { type: Date, required: true, index: true },
    durationMin: { type: Number, enum: [15, 30, 45, 60], default: 30 },
    mode: { type: String, enum: SESSION_MODES, default: 'video' },
    meetingLink: { type: String, trim: true, maxlength: 300 },
    note: { type: String, trim: true, maxlength: 200 },
    status: { type: String, enum: SLOT_STATUSES, default: 'open', index: true },
    bookedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    session: { type: Schema.Types.ObjectId, ref: 'MentorshipSession' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

mentorshipSlotSchema.index({ alumni: 1, status: 1, startsAt: 1 });

export default mongoose.models.MentorshipSlot || mongoose.model('MentorshipSlot', mentorshipSlotSchema);
