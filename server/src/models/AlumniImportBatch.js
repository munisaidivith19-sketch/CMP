import mongoose from 'mongoose';
import { IMPORT_STATUSES } from '../constants.js';

const { Schema } = mongoose;

const importRowSchema = new Schema(
  {
    line: Number,
    name: String,
    email: String,
    department: String,
    gradYear: Number,
    company: String,
    designation: String,
    location: String,
    phone: String,
    state: { type: String, enum: ['valid', 'invalid', 'duplicate', 'exists'] },
    errors: [String],
  },
  { _id: false }
);

const alumniImportBatchSchema = new Schema(
  {
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filename: String,
    department: String,
    totals: {
      rows: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      invalid: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      alreadyExist: { type: Number, default: 0 },
    },
    rows: [importRowSchema],
    status: { type: String, enum: IMPORT_STATUSES, default: 'validated', index: true },
    committedAt: Date,
    invitesCreated: { type: Number, default: 0 },
    emailsSent: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

export default mongoose.models.AlumniImportBatch || mongoose.model('AlumniImportBatch', alumniImportBatchSchema);
