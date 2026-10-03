import mongoose from 'mongoose';
import { SESSION_MODES, SESSION_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const actionItemSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
    dueDate: Date,
  },
  { _id: true }
);

const mentorshipSessionSchema = new Schema(
  {
    request: { type: Schema.Types.ObjectId, ref: 'MentorshipRequest', required: true, index: true },
    alumni: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slot: { type: Schema.Types.ObjectId, ref: 'MentorshipSlot' },
    agenda: { type: String, trim: true, maxlength: 300 },
    scheduledAt: { type: Date, required: true, index: true },
    durationMin: { type: Number, default: 30 },
    mode: { type: String, enum: SESSION_MODES, default: 'video' },
    meetingLink: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: SESSION_STATUSES, default: 'confirmed', index: true },
    sharedNotes: { type: String, trim: true, maxlength: 2000 },
    alumniPrivateNotes: { type: String, trim: true, maxlength: 2000 },
    actionItems: [actionItemSchema],
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 300 },
    completedAt: Date,
    reminder24hSentAt: Date,
    reminder1hSentAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

mentorshipSessionSchema.index({ alumni: 1, scheduledAt: 1 });
mentorshipSessionSchema.index({ student: 1, scheduledAt: 1 });
mentorshipSessionSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.models.MentorshipSession || mongoose.model('MentorshipSession', mentorshipSessionSchema);
