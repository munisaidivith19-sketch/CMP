import mongoose from 'mongoose';
import { MENTORSHIP_DOMAINS, MENTORSHIP_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const goalSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

const mentorshipRequestSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    alumni: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    domain: { type: String, enum: MENTORSHIP_DOMAINS, required: true },
    message: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    status: { type: String, enum: MENTORSHIP_STATUSES, default: 'pending', index: true },
    response: { type: String, trim: true, maxlength: 500 },
    respondedAt: Date,

    rating: { type: Number, min: 1, max: 5 },
    review: { type: String, trim: true, maxlength: 500 },
    ratedAt: Date,

    goals: {
      type: [goalSchema],
      default: [],
      validate: [(v) => !v || v.length <= 5, 'Maximum 5 goals allowed'],
    },
    cancelledAt: Date,
    cancelReason: { type: String, maxlength: 300 },
    expiresAt: { type: Date, index: true },
    completedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

mentorshipRequestSchema.index(
  { student: 1, alumni: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'mentorship_req_pending_unique' }
);
mentorshipRequestSchema.index({ status: 1, expiresAt: 1 });
mentorshipRequestSchema.index({ alumni: 1, status: 1, createdAt: -1 });
mentorshipRequestSchema.index({ student: 1, status: 1, createdAt: -1 });

export default mongoose.models.MentorshipRequest || mongoose.model('MentorshipRequest', mentorshipRequestSchema);
