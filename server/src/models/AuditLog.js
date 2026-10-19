import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Protected audit trail for privileged (Super Admin) operations: admin account
 * changes, policy changes, password resets, session revocations, re-auth and
 * every emergency-mode operation.
 *
 * Separate from SecurityLog on purpose:
 *   - never shown in routine Admin views (Security & Logs, Activity),
 *   - no retention TTL — records are kept until removed by a database
 *     operator outside the application,
 *   - append-only AND undeletable at the model level: there is no API that
 *     edits or deletes a record, and the model refuses updates and deletes.
 *
 * Written only through utils/auditLog.js, which scrubs secrets the same way
 * SecurityLog does. Never stores passwords, tokens, OTPs or cookies.
 */
export const AUDIT_ACTIONS = [
  'SUPER_ADMIN_REAUTH',
  'ADMIN_CREATED',
  'ADMIN_UPDATED',
  'ADMIN_ACTIVATED',
  'ADMIN_DEACTIVATED',
  'ADMIN_PASSWORD_RESET',
  'ADMIN_SESSIONS_REVOKED',
  'POLICIES_CHANGED',
  'DELEGATION_CHANGED',
  'PRIVILEGE_ESCALATION_BLOCKED',
  'EMERGENCY_TRANSITION',
  'EMERGENCY_HEALTH_CHECK',
  'PROTECTED_AUDIT_VIEWED',
  'CHAT_VIEWED',
  // SOC and troubleshooting (controllers/socController.js)
  'SOC_DIAGNOSTIC_RUN',
  'SOC_DIAGNOSTIC_COMPLETED',
  'SOC_DIAGNOSTIC_CANCELLED',
  'SOC_VERIFICATION_STARTED',
  'SOC_VERIFICATION_COMPLETED',
  'SOC_ERROR_STATUS_CHANGED',
  'SOC_INCIDENT_CREATED',
  'SOC_INCIDENT_UPDATED',
  'SOC_HEALTH_CHECK',
  'SOC_AI_EXPLANATION',
  // Skill Wallet: sensitive academic, publication and moderation decisions.
  'SKILL_WALLET_REVIEW_DECISION',
  'SKILL_WALLET_REVIEWER_ASSIGNED',
  'SKILL_WALLET_PUBLICATION_CHANGED',
  'SKILL_WALLET_CERT_DECISION',
  'SKILL_WALLET_DESIGNATION_CHANGED',
  'SKILL_WALLET_MODERATION',
  'SKILL_WALLET_CONFIG_CHANGED',
  'SKILL_WALLET_MILESTONE_DECISION',
  'SKILL_WALLET_RECOMMENDATION',
];

const auditLogSchema = new Schema(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    outcome: { type: String, enum: ['success', 'denied', 'failed', 'unchanged'], default: 'success' },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, maxlength: 30 },
    target: { type: Schema.Types.ObjectId, ref: 'User' },
    targetRole: { type: String, maxlength: 30 },
    reason: { type: String, maxlength: 500 },
    details: { type: Schema.Types.Mixed },
    ip: { type: String, maxlength: 45 },
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false }, minimize: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ target: 1, createdAt: -1 });

const refuse = function refuseChange(next) {
  next(new Error('Protected audit records cannot be modified or deleted'));
};
for (const op of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove',
]) {
  auditLogSchema.pre(op, refuse);
}
// Document-level deleteOne() as well as the query form.
auditLogSchema.pre('deleteOne', { document: true, query: false }, refuse);
auditLogSchema.pre('save', function onlyInsert(next) {
  if (!this.isNew) return next(new Error('Protected audit records cannot be modified or deleted'));
  next();
});

export default mongoose.model('AuditLog', auditLogSchema);
