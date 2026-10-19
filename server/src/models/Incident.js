import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A security or reliability incident: a group of related errors, security
 * events and alert snapshots under investigation.
 *
 * `assessment` keeps "suspicious" apart from "confirmed": an incident starts
 * as `undetermined`; `confirmed` needs a written justification (enforced in
 * the controller). The timeline is append-only through the API — entries
 * are never edited or removed — and every change is also written to the
 * protected AuditLog.
 */
export const INCIDENT_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved'];
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const INCIDENT_ASSESSMENTS = ['undetermined', 'suspected', 'confirmed', 'false_positive'];

const incidentSchema = new Schema(
  {
    number: { type: Number, unique: true },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, maxlength: 2000 },
    category: { type: String, enum: ['security', 'reliability', 'other'], default: 'reliability' },
    severity: { type: String, enum: INCIDENT_SEVERITIES, default: 'medium' },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'open' },
    assessment: { type: String, enum: INCIDENT_ASSESSMENTS, default: 'undetermined' },
    assignee: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    environment: { type: String, maxlength: 20 },
    errorEvents: [{ type: Schema.Types.ObjectId, ref: 'ErrorEvent' }],
    securityEvents: [{ type: Schema.Types.ObjectId, ref: 'SecurityLog' }],
    diagnosticRuns: [{ type: Schema.Types.ObjectId, ref: 'DiagnosticRun' }],
    // Snapshot of the computed alert the incident was opened from (redacted).
    alert: { type: Schema.Types.Mixed },
    resolution: { type: String, maxlength: 2000 },
    acknowledgedAt: Date,
    resolvedAt: Date,
    timeline: [
      {
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        type: { type: String, maxlength: 30 }, // created | note | status | severity | assessment | assigned | linked | resolution
        text: { type: String, maxlength: 2000 },
        from: { type: String, maxlength: 40 },
        to: { type: String, maxlength: 40 },
      },
    ],
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

incidentSchema.index({ status: 1, updatedAt: -1 });
incidentSchema.index({ createdAt: -1 });
incidentSchema.index({ errorEvents: 1 });

export default mongoose.model('Incident', incidentSchema);
