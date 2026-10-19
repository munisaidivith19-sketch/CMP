import mongoose from 'mongoose';
import { DEPARTMENTS, SKILL_WALLET_CAPABILITIES } from '../constants.js';

const { Schema } = mongoose;

/**
 * An explicit Skill Wallet capability held by a staff member:
 *   innovation_coordinator — Innovation / IIC management: reviewer assignment,
 *                            recommendations, milestones, moderation, config;
 *   project_reviewer       — may be assigned projects to review;
 *   certificate_verifier   — may verify NPTEL certificates in scope.
 *
 * Granted and revoked by the Principal only. A revoked grant is kept
 * (revokedAt) for history; at most one live grant per user + capability.
 */
const designationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    capability: { type: String, enum: SKILL_WALLET_CAPABILITIES, required: true },
    scope: { type: String, enum: ['campus', 'department'], default: 'campus' },
    department: { type: String, enum: [...DEPARTMENTS, null], default: null },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

designationSchema.index(
  { user: 1, capability: 1 },
  { unique: true, name: 'one_live_designation', partialFilterExpression: { revokedAt: null } }
);

export default mongoose.model('SkillWalletDesignation', designationSchema);
