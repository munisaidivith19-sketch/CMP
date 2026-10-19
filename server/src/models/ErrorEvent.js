import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One row per distinct error ("fingerprint"), not per occurrence: repeats
 * increment `count` and move `lastSeenAt`, so an error storm costs one
 * document, not millions. Written only by services/soc/capture.js, which
 * redacts every field first (no request bodies, headers, tokens, OTPs,
 * passwords, connection strings or personal data).
 *
 * Status workflow (enforced in services/soc/errors.js):
 *   open → acknowledged → investigating → fix_applied → resolved
 * `resolved` is only reachable through a passing verification run; a
 * resolved error that occurs again is re-opened automatically (regressed).
 */
export const ERROR_SOURCES = [
  'express', // unhandled / 5xx error reaching the Express error handler
  'authorization', // 403 refusals
  'rate_limit', // 429 responses
  'database', // MongoDB connection events
  'job', // background job / scheduler failures
  'socket', // Socket.IO connection / handler errors
  'process', // uncaught exceptions / unhandled rejections
  'client_web', // reported by the web app (render, promise, network, API)
  'client_mobile', // reported by a native app
];
export const ERROR_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
export const ERROR_STATUSES = ['open', 'acknowledged', 'investigating', 'fix_applied', 'resolved'];

const RETAIN_DAYS = 90;

const errorEventSchema = new Schema(
  {
    fingerprint: { type: String, required: true, unique: true, maxlength: 64 },
    code: { type: String, required: true, maxlength: 60 }, // catalog code or UNCLASSIFIED
    classified: { type: Boolean, default: false },
    source: { type: String, enum: ERROR_SOURCES, required: true },
    module: { type: String, maxlength: 40, default: 'unknown' },
    service: { type: String, maxlength: 40, default: 'api' },
    severity: { type: String, enum: ERROR_SEVERITIES, default: 'medium' },
    environment: { type: String, maxlength: 20 },
    title: { type: String, maxlength: 200 },
    message: { type: String, maxlength: 600 }, // redacted
    errorName: { type: String, maxlength: 80 },
    httpStatus: { type: Number },
    method: { type: String, maxlength: 10 },
    route: { type: String, maxlength: 160 }, // template, never a query string
    count: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    correlationIds: [{ type: String, maxlength: 64 }], // newest last, capped
    actorRoles: [{ type: String, maxlength: 30 }],
    clients: [{ type: String, maxlength: 20 }],
    // Latest redacted sample: stack frames and safe metadata.
    sample: { type: Schema.Types.Mixed },
    status: { type: String, enum: ERROR_STATUSES, default: 'open' },
    statusChangedAt: { type: Date },
    statusChangedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    fixAppliedAt: { type: Date },
    resolvedAt: { type: Date },
    regressedAt: { type: Date },
    regressions: { type: Number, default: 0 },
    notes: [
      {
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        kind: { type: String, maxlength: 30 },
        text: { type: String, maxlength: 1000 },
      },
    ],
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

errorEventSchema.index({ lastSeenAt: -1 });
errorEventSchema.index({ status: 1, lastSeenAt: -1 });
errorEventSchema.index({ source: 1, lastSeenAt: -1 });
errorEventSchema.index({ module: 1, lastSeenAt: -1 });
errorEventSchema.index({ code: 1, lastSeenAt: -1 });
errorEventSchema.index({ correlationIds: 1 });
errorEventSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: RETAIN_DAYS * 24 * 3600, name: 'error_event_retention' });

export default mongoose.model('ErrorEvent', errorEventSchema);
