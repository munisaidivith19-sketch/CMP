import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants.js';

const { Schema } = mongoose;

const achievementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    date: Date,
  },
  { _id: true }
);

const tagList = {
  type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
  validate: [(v) => v.length <= 25, 'Too many items (max 25)'],
  default: [],
};

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, default: 'student', index: true },

    // Academic profile
    department: { type: String, trim: true, maxlength: 80, index: true },
    year: { type: Number, min: 1, max: 6 },
    // Class section + current semester drive the timetable and attendance roster.
    // Assigned by an administrator (never self-assigned by students).
    section: { type: String, trim: true, uppercase: true, maxlength: 10, index: true },
    semester: { type: Number, min: 1, max: 12 },
    rollNo: { type: String, trim: true, maxlength: 30 },
    designation: { type: String, trim: true, maxlength: 80 }, // faculty
    bio: { type: String, trim: true, maxlength: 500 },
    avatar: String,
    phone: { type: String, trim: true, maxlength: 20 },

    interests: tagList,
    skills: tagList,
    extracurriculars: tagList,
    achievements: { type: [achievementSchema], default: [] },

    clubs: [{ type: Schema.Types.ObjectId, ref: 'Club' }],

    // Security
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, select: false },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLogin: Date,
    lastSeenAt: Date, // last Socket.io disconnect (chat "last seen")

    // Password reset: only a SHA-256 hash of the emailed token is stored.
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },

    // Expo push tokens for the Android app (one per installed device).
    pushTokens: {
      type: [{ token: { type: String, maxlength: 200 }, addedAt: { type: Date, default: Date.now } }],
      default: [],
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, department: 1, section: 1, isActive: 1 });
userSchema.index(
  { name: 'text', department: 'text', skills: 'text', interests: 'text' },
  { weights: { name: 5, skills: 3, interests: 2, department: 1 }, name: 'user_text' }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.failedLogins;
    delete ret.lockUntil;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;
    delete ret.pushTokens;
    return ret;
  },
});

export const PUBLIC_USER_FIELDS = 'name email role department year section avatar designation';

export default mongoose.model('User', userSchema);
