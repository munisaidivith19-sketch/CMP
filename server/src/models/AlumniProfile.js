import mongoose from 'mongoose';
import { MENTORSHIP_DOMAINS, PRIVACY_LEVELS } from '../constants.js';

const { Schema } = mongoose;

const privacyField = (defaultLevel) => ({
  type: String,
  enum: PRIVACY_LEVELS,
  default: defaultLevel,
});

const alumniProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    gradYear: { type: Number, required: true, min: 1980, max: 2100 },
    company: { type: String, trim: true, maxlength: 120 },
    designation: { type: String, trim: true, maxlength: 120 },
    location: { type: String, trim: true, maxlength: 120 },
    linkedin: { type: String, trim: true, maxlength: 200 },
    mentorshipAvailable: { type: Boolean, default: false, index: true },
    maxActiveMentees: { type: Number, default: 3, min: 0, max: 20 },
    activeMenteeCount: { type: Number, default: 0, min: 0 },
    domains: { type: [{ type: String, enum: MENTORSHIP_DOMAINS }], default: [] },
    mentorshipNote: { type: String, trim: true, maxlength: 500 },
    isVerified: { type: Boolean, default: false, index: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,

    headline: { type: String, trim: true, maxlength: 140 },
    about: { type: String, trim: true, maxlength: 1000 },
    skills: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
      validate: [(v) => !v || v.length <= 15, 'Maximum 15 skills allowed'],
    },
    program: { type: String, trim: true, maxlength: 80 },
    rejectionReason: { type: String, maxlength: 300 },
    openToReferrals: { type: Boolean, default: false },
    showInDirectory: { type: Boolean, default: true },
    privacy: {
      email: privacyField('mentees'),
      phone: privacyField('hidden'),
      linkedin: privacyField('public'),
      company: privacyField('public'),
      designation: privacyField('public'),
      location: privacyField('public'),
    },
    source: { type: String, enum: ['self', 'import', 'admin'], default: 'self' },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

alumniProfileSchema.index({ isVerified: 1, showInDirectory: 1, mentorshipAvailable: 1, domains: 1 });
alumniProfileSchema.index({ gradYear: 1 });
alumniProfileSchema.index({ company: 'text', designation: 'text', skills: 'text', headline: 'text' });

export default mongoose.models.AlumniProfile || mongoose.model('AlumniProfile', alumniProfileSchema);
