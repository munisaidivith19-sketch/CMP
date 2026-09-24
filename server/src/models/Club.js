import mongoose from 'mongoose';
import { CLUB_CATEGORIES } from '../constants.js';

const { Schema } = mongoose;

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const clubSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80, unique: true },
    slug: { type: String, unique: true, index: true },
    tagline: { type: String, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 3000, required: true },
    category: { type: String, enum: CLUB_CATEGORIES, default: 'other', index: true },
    logo: String,
    coverImage: String,
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
    contactEmail: { type: String, trim: true, lowercase: true },
    socialLinks: {
      website: String,
      instagram: String,
      linkedin: String,
    },

    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    members: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    pendingRequests: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        message: { type: String, trim: true, maxlength: 300 },
        requestedAt: { type: Date, default: Date.now },
      },
    ],
    facultyAdvisor: { type: Schema.Types.ObjectId, ref: 'User' },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewNote: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false }, toObject: { virtuals: true } }
);

clubSchema.index(
  { name: 'text', tagline: 'text', description: 'text', tags: 'text' },
  { weights: { name: 6, tags: 3, tagline: 2, description: 1 }, name: 'club_text' }
);

clubSchema.virtual('memberCount').get(function memberCount() {
  return this.members?.length || 0;
});

clubSchema.pre('validate', function makeSlug(next) {
  if (this.isModified('name') || !this.slug) this.slug = slugify(this.name);
  next();
});

export default mongoose.model('Club', clubSchema);
