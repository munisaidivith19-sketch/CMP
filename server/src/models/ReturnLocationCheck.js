import mongoose from 'mongoose';

const { Schema } = mongoose;

export const RETURN_REJECTION_REASONS = ['outside_geofence', 'low_accuracy', 'stale_location'];
const RETAIN_DAYS = 90;

/**
 * One return-to-campus location check, made only when the student taps
 * "Return to campus". Not a location history: nothing else writes here.
 */
const returnLocationCheckSchema = new Schema(
  {
    gatePass: { type: Schema.Types.ObjectId, ref: 'GatePass', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    distanceMeters: { type: Number, required: true },
    // As reported by the device; used only to reject stale readings.
    locationTimestamp: { type: Date, required: true },
    result: { type: String, enum: ['verified', 'rejected'], required: true },
    rejectionReason: { type: String, enum: RETURN_REJECTION_REASONS },
    // Server clock — the authoritative time of a successful check.
    verifiedAt: Date,
  },
  { timestamps: { createdAt: 'serverTimestamp', updatedAt: false }, toJSON: { versionKey: false } }
);

returnLocationCheckSchema.index({ gatePass: 1, serverTimestamp: -1 });
returnLocationCheckSchema.index({ serverTimestamp: 1 }, { expireAfterSeconds: RETAIN_DAYS * 24 * 3600, name: 'return_check_retention' });

export default mongoose.model('ReturnLocationCheck', returnLocationCheckSchema);
