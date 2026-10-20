import mongoose from 'mongoose';
import { BUS_TRIP_DIRECTIONS } from '../constants.js';

const { Schema } = mongoose;

// Journey history retention (TRANSPORT_JOURNEY_RETENTION_DAYS, default 365) —
// the same period as the trips themselves (models/BusTrip.js).
export const JOURNEY_RETENTION_DAYS = Math.min(730, Math.max(30, Number(process.env.TRANSPORT_JOURNEY_RETENTION_DAYS) || 365));

/**
 * What actually happened on a trip, in order: the trip starting, the bus
 * arriving at / departing from each planned stop, and the trip ending.
 *
 * Only RECORDED facts live here — a prediction is never stored as an actual
 * time (the prediction made before an arrival is kept beside it, in its own
 * fields, for comparison). `source` says how the event was recorded: 'gps'
 * (detected by the server from accepted fixes), 'manual' (entered by a
 * transport manager, with a reason) or 'system' (trip start / end).
 *
 * One event per trip, type and stop position: the unique index makes
 * repeated fixes, retries, a second device or concurrent requests unable to
 * record a stop twice. A later trip reaching the same stop is a new visit.
 * No GPS coordinates are stored — only the stop, the distance from it and
 * the fix accuracy.
 */
const eventSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'BusTrip', required: true },
    bus: { type: Schema.Types.ObjectId, ref: 'Bus', required: true },
    route: { type: Schema.Types.ObjectId, ref: 'BusRoute' }, // the route whose stops were followed
    direction: { type: String, enum: BUS_TRIP_DIRECTIONS },
    type: { type: String, enum: ['trip_started', 'arrival', 'departure', 'trip_ended'], required: true },
    // Position in the trip's planned stop order (0-based); -1 for trip-level events.
    order: { type: Number, required: true, min: -1, max: 199 },
    stop: { type: Schema.Types.ObjectId },
    stopName: { type: String, maxlength: 80 },
    isCollege: Boolean,
    isFinal: Boolean,
    at: { type: Date, required: true }, // UTC — the fix time (or the time entered for a manual record)
    detectedAt: Date, // the fix that confirmed it
    source: { type: String, enum: ['gps', 'manual', 'system'], required: true },
    // GPS quality behind a detected event.
    distanceM: Number,
    accuracy: Number,
    fixes: Number,
    // The prediction in force before the arrival (never the actual time).
    predictedArrivalAt: Date,
    predictedAt: Date,
    predictionMethod: String,
    // Timetable, when the stop has a real scheduled time.
    scheduledAt: Date,
    // Manual records / corrections.
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, maxlength: 300 },
    correction: {
      previousAt: Date,
      previousSource: String,
      correctedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      correctedAt: Date,
    },
    endStatus: String, // trip_ended: completed | stopped | timeout
    tripStartedAt: { type: Date, required: true }, // retention anchor
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

eventSchema.index({ trip: 1, type: 1, order: 1 }, { unique: true, name: 'one_event_per_trip_stop' });
eventSchema.index({ route: 1, direction: 1, source: 1, tripStartedAt: -1 });
eventSchema.index({ bus: 1, at: -1 });
eventSchema.index({ tripStartedAt: 1 }, { expireAfterSeconds: JOURNEY_RETENTION_DAYS * 86400, name: 'retention' });

export default mongoose.model('BusStopEvent', eventSchema);
