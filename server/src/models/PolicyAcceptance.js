import mongoose from 'mongoose';
import { POLICY_IDS } from '../legal/registry.js';

const { Schema } = mongoose;

/**
 * A user's acceptance of one policy version — the server-side record that
 * decides whether the Terms gate lets the account through. Never exposed as
 * a history screen in any client.
 *
 * Append-only: created by services/legal.js from the authenticated user only;
 * the model refuses every update and delete, and (user, policyId, version) is
 * unique so a repeated or concurrent accept cannot create a second record.
 * Holds no passwords, tokens or other secrets.
 */
const policyAcceptanceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    policyId: { type: String, enum: POLICY_IDS, required: true },
    version: { type: Number, required: true, min: 1 },
    // The exact PolicyVersion document and the hash of the text accepted.
    policyVersion: { type: Schema.Types.ObjectId, ref: 'PolicyVersion', required: true },
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    status: { type: String, enum: ['accepted'], default: 'accepted' },
    // The affirmative action and the statement the user ticked.
    method: { type: String, enum: ['checkbox'], default: 'checkbox' },
    consentText: { type: String, required: true, maxlength: 300 },
    // The Privacy Policy version linked on the acceptance screen at the time.
    privacyVersionShown: { type: Number, min: 1 },
    // web | mobile — from the server-side session row, never the request body.
    client: { type: String, enum: ['web', 'mobile', 'gate_desktop'] },
    // Server clock only.
    acceptedAt: { type: Date, required: true },
  },
  { versionKey: false }
);

policyAcceptanceSchema.index({ user: 1, policyId: 1, version: 1 }, { unique: true });
policyAcceptanceSchema.index({ policyId: 1, version: 1 });

const refuse = function refuseChange(next) {
  next(new Error('Policy acceptance records cannot be modified or deleted'));
};
for (const op of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove',
]) {
  policyAcceptanceSchema.pre(op, refuse);
}
policyAcceptanceSchema.pre('deleteOne', { document: true, query: false }, refuse);
policyAcceptanceSchema.pre('save', function onlyInsert(next) {
  if (!this.isNew) return next(new Error('Policy acceptance records cannot be modified or deleted'));
  next();
});

export default mongoose.model('PolicyAcceptance', policyAcceptanceSchema);
