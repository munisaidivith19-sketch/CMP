import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Security / audit events shown in Admin → Security & Logs.
 *
 * Every field is written by the server: the actor and their role come from
 * the authenticated session, the time from the server clock, the client
 * details from the request. Never stores passwords, password hashes, tokens,
 * cookies or OTP values — see utils/securityLog.js, the only writer.
 *
 * Append-only: there is no API that edits or deletes a record, and the model
 * refuses updates outright. Records age out after RETAIN_DAYS.
 */
export const SECURITY_EVENTS = [
  // Authentication / sessions
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_CREATED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'FORCED_LOGOUT',
  'REFRESH_FAILED',
  // Passwords
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'PASSWORD_RESET_FAILED',
  // User management
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ENABLED',
  'USER_DISABLED',
  'USER_DELETED',
  'ROLE_CHANGED',
  // Academic scope
  'ACADEMIC_SCOPE_CHANGED',
  'CLASS_IN_CHARGE_CHANGED',
  // Parent OTP
  'OTP_CREATED',
  'OTP_SENT',
  'OTP_VERIFIED',
  'OTP_FAILED',
  'OTP_EXPIRED',
  'OTP_RESEND',
  'OTP_LOCKED',
  'OTP_VIEWED',
  // Gate pass
  'GATE_PASS_APPROVED',
  'GATE_PASS_MASS_APPROVED',
  'GATE_PASS_REJECTED',
  'GATE_PASS_CANCELLED',
  'GATE_PASS_REVOKED',
  'GATE_PASS_QR_VERIFIED',
  'GATE_PASS_VERIFICATION_FAILED',
  'GATE_PASS_EXIT_CONFIRMED',
  'GATE_PASS_RETURN_CONFIRMED',
];

const RETAIN_DAYS = 365;

const securityLogSchema = new Schema(
  {
    event: { type: String, enum: SECURITY_EVENTS, required: true },
    success: { type: Boolean, default: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, maxlength: 30 },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User' },
    targetRole: { type: String, maxlength: 30 },
    // The sign-in name typed on a failed login for an unknown account.
    identifier: { type: String, maxlength: 120 },
    client: { type: String, enum: ['web', 'mobile', 'system'], default: 'web' },
    device: { type: String, maxlength: 200 },
    os: { type: String, maxlength: 40 },
    browser: { type: String, maxlength: 60 },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 45 },
    reason: { type: String, maxlength: 300 },
    entityType: { type: String, maxlength: 30 },
    entityId: { type: Schema.Types.ObjectId },
    // Non-secret context: previous/new role or scope, changed field names…
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false }, minimize: true }
);

securityLogSchema.index({ createdAt: -1 });
securityLogSchema.index({ event: 1, createdAt: -1 });
securityLogSchema.index({ actor: 1, createdAt: -1 });
securityLogSchema.index({ targetUser: 1, createdAt: -1 });
securityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETAIN_DAYS * 24 * 3600, name: 'security_log_retention' });

// Append-only at the model level too: any attempt to rewrite a record fails.
const refuse = function refuseUpdate(next) {
  next(new Error('Security logs are append-only'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
  securityLogSchema.pre(op, refuse);
}
securityLogSchema.pre('save', function onlyInsert(next) {
  if (!this.isNew) return next(new Error('Security logs are append-only'));
  next();
});

export default mongoose.model('SecurityLog', securityLogSchema);
