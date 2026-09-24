import mongoose from 'mongoose';
import crypto from 'node:crypto';

const { Schema } = mongoose;

const GATE_PASS_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'active',     // student has exited
  'completed',  // student has returned
  'expired',
  'revoked',
  'cancelled',  // withdrawn by the student before use
];

const GATE_PASS_REASONS = [
  'medical',
  'family_emergency',
  'personal',
  'official',
  'outing',
  'other',
];

// Unambiguous alphabet (no 0/O, 1/I/L): 32 symbols × 12 chars = 60 random bits.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateVerificationCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const gatePassSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: GATE_PASS_REASONS, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    destination: { type: String, trim: true, maxlength: 160 },

    expectedExit: { type: Date, required: true },
    expectedReturn: { type: Date, required: true },
    actualExit: Date,
    actualReturn: Date,

    status: { type: String, enum: GATE_PASS_STATUSES, default: 'pending', index: true },

    // Approval.
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedReason: { type: String, trim: true, maxlength: 300 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,

    // Verification — backend-generated, crypto-random, issued only on approval.
    // Hidden by default; only the pass owner can fetch it (to show as a QR code).
    verificationCode: { type: String, select: false },
    verificationExpiry: Date,
    lastVerifiedAt: Date,
    lastVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Gate events.
    exitVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    returnVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Withdrawal / revocation.
    cancelledAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
    revokeReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

gatePassSchema.index({ student: 1, status: 1, createdAt: -1 });
gatePassSchema.index({ status: 1, createdAt: -1 });
gatePassSchema.index(
  { verificationCode: 1 },
  { unique: true, name: 'unique_verification_code', partialFilterExpression: { verificationCode: { $type: 'string' } } }
);

gatePassSchema.pre('validate', function checkTimes(next) {
  if (this.expectedExit && this.expectedReturn && this.expectedReturn <= this.expectedExit) {
    this.invalidate('expectedReturn', 'Expected return must be after expected exit');
  }
  next();
});

export { GATE_PASS_STATUSES, GATE_PASS_REASONS };
export default mongoose.model('GatePass', gatePassSchema);
