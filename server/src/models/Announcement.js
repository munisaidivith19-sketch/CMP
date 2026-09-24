import mongoose from 'mongoose';
import { ANNOUNCEMENT_PRIORITIES, AUDIENCE_SCOPES } from '../constants.js';

const { Schema } = mongoose;

const announcementSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    audience: {
      scope: { type: String, enum: AUDIENCE_SCOPES, default: 'all' },
      department: { type: String, trim: true },
      year: { type: Number, min: 1, max: 6 },
      club: { type: Schema.Types.ObjectId, ref: 'Club' },
    },
    priority: { type: String, enum: ANNOUNCEMENT_PRIORITIES, default: 'normal' },
    attachments: [
      {
        url: { type: String, required: true },
        name: String,
        mimeType: String,
      },
    ],
    deadline: Date,
    isPinned: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

announcementSchema.index({ isPinned: -1, createdAt: -1 });
announcementSchema.index({ 'audience.scope': 1, 'audience.department': 1, 'audience.club': 1 });
announcementSchema.index(
  { title: 'text', content: 'text' },
  { weights: { title: 5, content: 1 }, name: 'announcement_text' }
);

export default mongoose.model('Announcement', announcementSchema);
