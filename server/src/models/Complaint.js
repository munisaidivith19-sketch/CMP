import mongoose from 'mongoose';
import crypto from 'node:crypto';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  COMPLAINT_PRIORITIES,
} from '../constants.js';

const { Schema } = mongoose;

// Same confusion-free alphabet as GatePass's verification code — this one is
// read on screen (not aloud), so it's a bit longer for extra uniqueness headroom.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
export function generateComplaintCode() {
  const rand = (set) => set[crypto.randomInt(set.length)];
  let code = 'CMP-';
  for (let i = 0; i < 5; i += 1) code += rand(i % 2 === 0 ? CODE_LETTERS : CODE_DIGITS);
  return code;
}

const attachmentSchema = new Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 300 },
    name: { type: String, trim: true, maxlength: 150 },
    mimeType: { type: String, trim: true, maxlength: 100 },
    size: Number,
  },
  { _id: false }
);

const complaintSchema = new Schema(
  {
    complaintCode: { type: String, trim: true, uppercase: true },

    // The submitting student is always stored — anonymity is enforced by
    // field-level filtering on read (see sanitizeComplaint in the controller),
    // never by omitting it here.
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anonymous: { type: Boolean, default: false },

    category: { type: String, enum: COMPLAINT_CATEGORIES, required: true, index: true },
    subCategory: { type: String, trim: true, maxlength: 60 },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    attachments: { type: [attachmentSchema], default: [], validate: [(v) => v.length <= 5, 'At most 5 supporting files'] },

    // Snapshot at submit time, same reasoning as GatePass — routing still
    // works even if the student's own record changes later.
    department: { type: String, trim: true, maxlength: 80 },
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },

    initialEscalationTarget: { type: String, required: true, trim: true, lowercase: true, maxlength: 20 },
    escalationChain: { type: [String], required: true },
    escalationLevel: { type: Number, default: 0, min: 0, index: true },
    currentAuthorityRole: { type: String, trim: true, lowercase: true, maxlength: 20, index: true },
    currentAuthorityUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    status: { type: String, enum: COMPLAINT_STATUSES, default: 'SUBMITTED', index: true },
    priority: { type: String, enum: COMPLAINT_PRIORITIES, default: 'normal' },

    // Escalation ("NOT RESOLVED") is blocked until this timestamp, reset on
    // every (re)assignment so each authority gets the same waiting period.
    notResolvedAvailableAt: Date,

    assignedAt: Date,
    resolvedAt: Date,
    cancelledAt: Date,
    closedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

complaintSchema.index({ student: 1, status: 1, createdAt: -1 });
complaintSchema.index({ status: 1, category: 1, createdAt: -1 });
complaintSchema.index({ currentAuthorityUserId: 1, status: 1 });
complaintSchema.index({ department: 1, status: 1 });
complaintSchema.index(
  { complaintCode: 1 },
  { unique: true, name: 'unique_complaint_code', partialFilterExpression: { complaintCode: { $type: 'string' } } }
);

export default mongoose.model('Complaint', complaintSchema);
