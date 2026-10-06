import mongoose from 'mongoose';
import { SOS_TYPES, SOS_STATUSES } from '../constants.js';
const { Schema } = mongoose;

const sosAlertSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: String, trim: true, maxlength: 80 },          // copied from sender at creation
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },

    type: { type: String, enum: SOS_TYPES, required: true },
    note: { type: String, trim: true, maxlength: 300 },

    location: { lat: Number, lng: Number, accuracy: Number },

    status: { type: String, enum: SOS_STATUSES, default: 'active', index: true },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: Date,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolutionNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);
sosAlertSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.SOSAlert || mongoose.model('SOSAlert', sosAlertSchema);

