import mongoose from 'mongoose';

const { Schema } = mongoose;

const placementSchema = new Schema(
  {
    role: { type: String, maxlength: 30 },
    year: Number,
    section: { type: String, maxlength: 10 },
    semester: Number,
  },
  { _id: false }
);

/**
 * One promotion the Principal ran: who it covered, and each student's placement
 * before and after, so it can be shown later and undone exactly.
 */
const promotionBatchSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: {
      kind: { type: String, enum: ['student', 'section', 'year', 'department', 'college'], required: true },
      department: { type: String, maxlength: 80 },
      year: Number,
      section: { type: String, maxlength: 10 },
      rollNos: { type: [String], default: undefined },
    },
    status: { type: String, enum: ['applied', 'undoing', 'undone'], default: 'applied', index: true },
    counts: {
      promoted: { type: Number, default: 0 },
      moved: { type: Number, default: 0 },
      graduated: { type: Number, default: 0 },
      heldBack: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    items: [
      {
        _id: false,
        student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, maxlength: 80 },
        rollNo: { type: String, maxlength: 30 },
        department: { type: String, maxlength: 80 },
        outcome: { type: String, enum: ['promoted', 'moved', 'graduated', 'held_back', 'skipped'], required: true },
        reason: { type: String, maxlength: 40 },
        from: placementSchema,
        to: placementSchema,
      },
    ],
    undoneBy: { type: Schema.Types.ObjectId, ref: 'User' },
    undoneAt: Date,
    undoResult: { restored: Number, notRestored: Number },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

promotionBatchSchema.index({ createdAt: -1 });
promotionBatchSchema.index({ 'items.student': 1, status: 1, createdAt: -1 });

export default mongoose.model('PromotionBatch', promotionBatchSchema);
