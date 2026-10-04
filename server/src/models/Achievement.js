import mongoose from 'mongoose';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LEVELS, ACHIEVEMENT_POSITIONS } from '../constants.js';

const { Schema } = mongoose;

/**
 * A student achievement, posted ONLY by the Principal or an HOD (an HOD can
 * only post for students of their own department). Deleting is a soft delete
 * so an Admin can restore it.
 */
const achievementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    category: { type: String, enum: ACHIEVEMENT_CATEGORIES, required: true, index: true },
    level: { type: String, enum: ACHIEVEMENT_LEVELS, required: true, index: true },
    position: { type: String, enum: ACHIEVEMENT_POSITIONS, default: 'participant' },
    eventName: { type: String, trim: true, maxlength: 160 },
    organizer: { type: String, trim: true, maxlength: 160 },
    achievedOn: { type: Date, required: true, index: true },
    externalLink: { type: String, trim: true, maxlength: 500 },
    images: [{ url: { type: String, required: true }, name: String, mimeType: String, _id: false }],
    students: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    // Denormalised from the students so list filters and HOD scope stay one query.
    departments: [{ type: String, index: true }],
    years: [{ type: Number }],
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    announcement: { type: Schema.Types.ObjectId, ref: 'Announcement' },
    congratulations: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    hideRequests: [
      {
        student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        reason: { type: String, trim: true, maxlength: 300 },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

achievementSchema.index({ isDeleted: 1, isFeatured: -1, achievedOn: -1 });
achievementSchema.index(
  { title: 'text', description: 'text', eventName: 'text' },
  { weights: { title: 5, eventName: 3, description: 1 }, name: 'achievement_text' }
);

export default mongoose.model('Achievement', achievementSchema);
