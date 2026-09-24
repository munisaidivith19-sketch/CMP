import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { GATE_PASS_STATUSES, GATE_PASS_REGARDING, GATE_PASS_STAGES } from '../constants.js';

const { Schema } = mongoose;

// Spoken aloud by the student to the security guard, so the alphabet skips
// characters that are easily confused by ear or on a small screen (I/O, 0/1).
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
/** 2 letters + 2 digits, e.g. "DF45" — matches the spec exactly. */
export function generateVerificationCode() {
  const rand = (set) => set[crypto.randomInt(set.length)];
  return rand(CODE_LETTERS) + rand(CODE_LETTERS) + rand(CODE_DIGITS) + rand(CODE_DIGITS);
}

const reviewStage = {
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  at: Date,
  action: { type: String, enum: ['forwarded', 'approved', 'rejected'] },
  reason: { type: String, trim: true, maxlength: 300 },
};

const gatePassSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Which department/section this pass was raised from — captured at request
    // time so it still routes correctly even if the student's record changes later.
    department: { type: String, trim: true, maxlength: 80 },
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },

    regarding: { type: String, enum: GATE_PASS_REGARDING, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },

    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    parentPhone: { type: String, required: true, trim: true, maxlength: 20 },
    destination: {
      state: { type: String, required: true, trim: true, maxlength: 80 },
      district: { type: String, required: true, trim: true, maxlength: 80 },
      area: { type: String, required: true, trim: true, maxlength: 120 },
    },

    status: { type: String, enum: GATE_PASS_STATUSES, default: 'pending_faculty', index: true },

    // One stage per reviewer — the UI shows exactly one active step at a time.
    facultyReview: reviewStage,
    hodReview: reviewStage,
    principalReview: reviewStage,
    // Convenience copies of whichever stage rejected the request.
    rejectedStage: { type: String, enum: GATE_PASS_STAGES },
    rejectedReason: { type: String, trim: true, maxlength: 300 },

    actualExit: Date,
    actualReturn: Date,
    exitVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    returnVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Verification — issued only once the principal approves. Hidden by
    // default; only the pass owner can fetch it (student reads it aloud).
    verificationCode: { type: String, select: false },
    verificationExpiry: Date,
    lastVerifiedAt: Date,
    lastVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    cancelledAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    revokeReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

gatePassSchema.index({ student: 1, status: 1, createdAt: -1 });
gatePassSchema.index({ status: 1, createdAt: -1 });
gatePassSchema.index({ status: 1, department: 1, section: 1 });
gatePassSchema.index(
  { verificationCode: 1 },
  { unique: true, name: 'unique_verification_code', partialFilterExpression: { verificationCode: { $type: 'string' } } }
);

gatePassSchema.pre('validate', function checkDates(next) {
  if (this.fromDate && this.toDate && this.toDate < this.fromDate) {
    this.invalidate('toDate', 'Return date cannot be before the departure date');
  }
  next();
});

export { GATE_PASS_STATUSES, GATE_PASS_REGARDING, GATE_PASS_STAGES };
export default mongoose.model('GatePass', gatePassSchema);
