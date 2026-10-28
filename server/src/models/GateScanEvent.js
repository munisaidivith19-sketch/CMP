import mongoose from 'mongoose';

const { Schema } = mongoose;

export const GATE_SCAN_OUTCOMES = ['success', 'rejected', 'duplicate'];
export const GATE_SCAN_SOURCES = ['hid', 'serial', 'manual'];
export const GATE_SCAN_DIRECTIONS = ['out', 'in'];

/**
 * One scan submitted by the Windows Gate Scanner — the attempt, not the gate
 * event. The gate event itself stays on the GatePass (actualExit / actualReturn
 * + exitVerifiedBy / returnVerifiedBy), written by the same commit the web OUT
 * and Return screens use; this row never changes a pass.
 *
 * It exists for three things:
 *  - idempotency: (guard, scanId) is unique, so a retried request after a
 *    timeout returns the original result instead of acting twice;
 *  - duplicate detection: payloadDigest (keyed HMAC, never the raw QR) lets a
 *    repeated hardware read be answered "already recorded";
 *  - history of rejected attempts, attributable to the authenticated guard.
 */
const gateScanEventSchema = new Schema(
  {
    // Client-generated per scan (UUID). Unique per guard, never trusted for anything else.
    scanId: { type: String, required: true, maxlength: 64 },
    guard: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    session: { type: Schema.Types.ObjectId, ref: 'Session' },
    // Display labels configured on the gate PC (sanitised); informational only.
    gate: { type: String, trim: true, maxlength: 60 },
    device: { type: String, trim: true, maxlength: 60 },
    source: { type: String, enum: GATE_SCAN_SOURCES, default: 'hid' },

    state: { type: String, enum: ['processing', 'done'], default: 'processing' },
    direction: { type: String, enum: GATE_SCAN_DIRECTIONS },
    payloadDigest: { type: String, maxlength: 64 },
    gatePass: { type: Schema.Types.ObjectId, ref: 'GatePass' },
    student: { type: Schema.Types.ObjectId, ref: 'User' },

    outcome: { type: String, enum: GATE_SCAN_OUTCOMES },
    // Stable machine code (EXIT_RECORDED, EXPIRED, …) and the guard-safe message.
    code: { type: String, maxlength: 40 },
    message: { type: String, maxlength: 300 },
    recordedAt: Date,
    completedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

gateScanEventSchema.index({ guard: 1, scanId: 1 }, { unique: true, name: 'unique_guard_scan' });
gateScanEventSchema.index({ payloadDigest: 1, outcome: 1, createdAt: -1 });
gateScanEventSchema.index({ createdAt: -1, outcome: 1 });
gateScanEventSchema.index({ gatePass: 1, direction: 1, outcome: 1 }, { partialFilterExpression: { gatePass: { $exists: true } } });
// Attempts are kept for a year, like the Security log.
gateScanEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600, name: 'retention' });

export default mongoose.model('GateScanEvent', gateScanEventSchema);
