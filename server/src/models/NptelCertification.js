import mongoose from 'mongoose';
import { SW_CERT_STATUSES } from '../constants.js';

const { Schema } = mongoose;

/**
 * An NPTEL certificate claimed by a student.
 *
 * The hall ticket number is sensitive: it is stored encrypted (AES-256-GCM,
 * utils/cipher.js) plus a keyed hash for duplicate detection, and is returned
 * only to the student and to verifiers — never in public / gallery / portfolio
 * responses, notifications or logs.
 *
 * Uploading never verifies: status starts at `pending` and only an authorized
 * verifier moves it (history in CertificationReview).
 */
const certSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hallTicketEnc: { type: String, required: true, select: false },
    hallTicketHash: { type: String, required: true, select: false },
    hallTicketLast4: { type: String, maxlength: 4 },
    courseName: { type: String, required: true, trim: true, maxlength: 200 },
    // Normalised course name: duplicate detection.
    courseKey: { type: String, required: true, maxlength: 200, select: false },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    durationWeeks: { type: Number, required: true, min: 1, max: 52 },
    credits: { type: Number, required: true, min: 0, max: 20 },
    institution: { type: String, required: true, maxlength: 40 },
    institutionOther: { type: String, trim: true, maxlength: 120, default: '' },
    image: { type: Schema.Types.ObjectId, ref: 'SkillWalletAsset', required: true },
    status: { type: String, enum: SW_CERT_STATUSES, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionReason: { type: String, trim: true, maxlength: 1000, default: '' },
    // Owner's class: verifier scope (HOD, Class In-Charge).
    department: { type: String, maxlength: 80 },
    year: Number,
    section: { type: String, maxlength: 10 },
    semester: Number,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true, toJSON: { versionKey: false } }
);

certSchema.index({ student: 1, isDeleted: 1, createdAt: -1 });
certSchema.index({ isDeleted: 1, status: 1, department: 1, createdAt: 1 });
// The same hall ticket + course can be on file only once (any student).
certSchema.index(
  { hallTicketHash: 1, courseKey: 1 },
  { unique: true, name: 'one_cert_per_hallticket_course', partialFilterExpression: { isDeleted: false } }
);

/**
 * Which student a hall ticket number belongs to. The first student to claim
 * a number owns it; another student entering the same number is refused.
 * A claim is released when the claimant has no remaining non-rejected
 * certificate with that number (e.g. a verifier rejected a wrong entry).
 */
const claimSchema = new Schema(
  {
    hash: { type: String, required: true, unique: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const HallTicketClaim = mongoose.model('HallTicketClaim', claimSchema);
export default mongoose.model('NptelCertification', certSchema);
