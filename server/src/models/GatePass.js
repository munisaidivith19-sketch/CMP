import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { EMERGENCY_AUTHORITIES, GATE_PASS_STATUSES, GATE_PASS_REGARDING, GATE_PASS_STAGES, GATE_PASS_TYPES } from '../constants.js';

const { Schema } = mongoose;

// Codes are read aloud to the guard, so the alphabet leaves out characters
// that are easily confused by ear or on a small screen (I/O, 0/1).
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const CODE_ALPHABET = CODE_LETTERS + CODE_DIGITS;
export const GATE_CODE_LENGTH = 4;
/** Any 4 characters from the alphabet that include at least one letter and one digit. */
export const GATE_CODE_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4}$/;

/**
 * The one generator for every gate-pass security code (exit and return):
 * 4 cryptographically random characters, letters and digits in random
 * positions — e.g. "A4G5", "5AG4", "G54A".
 */
export function generateGatePassSecurityCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < GATE_CODE_LENGTH; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (GATE_CODE_PATTERN.test(code)) return code;
  }
}

/** Normalise a typed or scanned gate code ("a4g5", "A4-G5", "CCGP:A4G5" → "A4G5"); null if it can't be one. */
export function normalizeGateCode(input, prefix = '') {
  let code = String(input ?? '').trim().toUpperCase();
  if (prefix && code.startsWith(prefix.toUpperCase())) code = code.slice(prefix.length);
  code = code.replace(/[\s-]/g, '');
  return GATE_CODE_PATTERN.test(code) ? code : null;
}

const isNormal = function isNormal() {
  return this.passType !== 'emergency';
};

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

    passType: { type: String, enum: GATE_PASS_TYPES, default: 'normal', index: true },

    // Normal passes pick a category; an emergency pass's reason is the description.
    regarding: { type: String, enum: GATE_PASS_REGARDING, required: isNormal },
    description: { type: String, required: true, trim: true, maxlength: 500 },

    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    // Emergency passes give exact times (fromDate/toDate are their calendar days).
    leaveAt: Date,
    expectedReturnAt: Date,
    // Typed by the student on a normal pass; copied from their record on an emergency one.
    parentPhone: { type: String, required: isNormal, trim: true, maxlength: 20 },
    destination: {
      state: { type: String, required: isNormal, trim: true, maxlength: 80 },
      district: { type: String, required: isNormal, trim: true, maxlength: 80 },
      area: { type: String, required: true, trim: true, maxlength: 120 },
    },
    supportingDocument: {
      url: { type: String, trim: true, maxlength: 500 },
      name: { type: String, trim: true, maxlength: 200 },
      mimeType: { type: String, trim: true, maxlength: 100 },
    },

    // Emergency only: the one authority the student sent it to, and their decision.
    emergencyAuthority: { type: String, enum: EMERGENCY_AUTHORITIES, required: function needsAuthority() { return this.passType === 'emergency'; } },
    emergencyReview: reviewStage,

    status: { type: String, enum: GATE_PASS_STATUSES, default: 'pending_faculty', index: true },

    // One stage per reviewer — the UI shows exactly one active step at a time.
    // Set only by the OTP service once the parent's OTP checks out.
    parentVerifiedAt: Date,
    parentVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

    // Return-to-campus: issued only after the server accepts the student's
    // location, used once by security ("Student is inside"), then removed.
    returnLocationVerifiedAt: Date,
    returnToken: { type: String, select: false },
    returnCode: { type: String, select: false },
    returnCredentialExpiresAt: Date,

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
gatePassSchema.index({ passType: 1, emergencyAuthority: 1, status: 1, createdAt: -1 });
gatePassSchema.index(
  { verificationCode: 1 },
  { unique: true, name: 'unique_verification_code', partialFilterExpression: { verificationCode: { $type: 'string' } } }
);

gatePassSchema.index({ returnToken: 1 }, { unique: true, name: 'unique_return_token', partialFilterExpression: { returnToken: { $type: 'string' } } });
gatePassSchema.index({ returnCode: 1 }, { unique: true, name: 'unique_return_code', partialFilterExpression: { returnCode: { $type: 'string' } } });

gatePassSchema.pre('validate', function checkDates(next) {
  if (this.fromDate && this.toDate && this.toDate < this.fromDate) {
    this.invalidate('toDate', 'Return date cannot be before the departure date');
  }
  next();
});

export { GATE_PASS_STATUSES, GATE_PASS_REGARDING, GATE_PASS_STAGES };
export default mongoose.model('GatePass', gatePassSchema);
