import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Bulk gate-pass approval ("Bind"). A class in-charge collects parent-verified
 * requests from their class into one group and sends it on; the HOD forwards or
 * rejects the whole group, the principal approves or rejects it, and either may
 * drop single students. The students' requests stay ordinary GatePass records
 * (linked by GatePass.bindGroup) so every other gate-pass screen keeps working.
 */
export const BIND_GROUP_STATUSES = ['open', 'pending_hod', 'pending_principal', 'approved', 'rejected'];

const reviewStage = {
  by: { type: Schema.Types.ObjectId, ref: 'User' },
  at: Date,
  action: { type: String, enum: ['forwarded', 'approved', 'rejected'] },
  reason: { type: String, trim: true, maxlength: 300 },
};

const bindGroupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: BIND_GROUP_STATUSES, default: 'open' },

    // The one class this group belongs to — set from the first student bound,
    // so the group always routes to the right HOD (first-year vs branch).
    department: { type: String, trim: true, maxlength: 80 },
    year: Number,
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },
    semester: Number,

    sentToHodAt: Date,
    hodReview: reviewStage,
    principalReview: reviewStage,
    rejectedStage: { type: String, enum: ['hod', 'principal'] },
    rejectedReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

bindGroupSchema.index({ createdBy: 1, status: 1, createdAt: -1 });
bindGroupSchema.index({ status: 1, department: 1, year: 1 });

export default mongoose.model('GatePassBindGroup', bindGroupSchema);
