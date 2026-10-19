import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One execution of a registered diagnostic test (services/soc/diagnostics).
 *
 * Results are only ever written by the runner from what the test actually
 * observed. QUEUED/RUNNING are transient; every other status is final.
 * A run that never executed is never PASS.
 */
export const RESULT_STATUSES = ['PASS', 'FAIL', 'WARNING', 'SKIPPED', 'INCONCLUSIVE', 'TIMED_OUT', 'CANCELLED'];
export const RUN_STATUSES = ['QUEUED', 'RUNNING', ...RESULT_STATUSES];

const diagnosticRunSchema = new Schema(
  {
    testId: { type: String, required: true, maxlength: 60 },
    testName: { type: String, maxlength: 120 },
    testVersion: { type: Number },
    status: { type: String, enum: RUN_STATUSES, default: 'QUEUED' },
    purpose: { type: String, enum: ['diagnosis', 'verification'], default: 'diagnosis' },
    errorEvent: { type: Schema.Types.ObjectId, ref: 'ErrorEvent' },
    errorCode: { type: String, maxlength: 60 },
    incident: { type: Schema.Types.ObjectId, ref: 'Incident' },
    verificationBatch: { type: String, maxlength: 40 },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    environment: { type: String, maxlength: 20 },
    // What the test looked at, what it saw, and why it chose the status.
    checked: { type: String, maxlength: 600 },
    observed: { type: String, maxlength: 1500 },
    reason: { type: String, maxlength: 600 },
    evidence: { type: Schema.Types.Mixed }, // redacted
    nextSteps: [{ type: String, maxlength: 400 }],
    confirmsCause: { type: String, maxlength: 60 }, // set only when the test's FAIL/WARNING supports a catalog cause
    readOnly: { type: Boolean, default: true },
    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number },
    timeoutMs: { type: Number },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

diagnosticRunSchema.index({ createdAt: -1 });
diagnosticRunSchema.index({ errorEvent: 1, createdAt: -1 });
diagnosticRunSchema.index({ testId: 1, createdAt: -1 });
diagnosticRunSchema.index({ verificationBatch: 1 });
diagnosticRunSchema.index({ status: 1 });
diagnosticRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600, name: 'diagnostic_run_retention' });

export default mongoose.model('DiagnosticRun', diagnosticRunSchema);
