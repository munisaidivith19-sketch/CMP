import mongoose from 'mongoose';
import { BUS_GPS_SOURCES } from '../constants.js';

const { Schema } = mongoose;

/**
 * One run of a bus. Phone-shared locations are accepted ONLY during an active
 * trip and only from the person who started it (`sharedBy`); a trip ends on
 * completion, an authorized stop, or the idle / maximum-duration timeout — so
 * nobody is ever tracked outside a trip.
 */
const tripSchema = new Schema(
  {
    bus: { type: Schema.Types.ObjectId, ref: 'Bus', required: true },
    route: { type: Schema.Types.ObjectId, ref: 'BusRoute' },
    source: { type: String, enum: BUS_GPS_SOURCES, required: true },
    sharedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // phone source only
    startedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'completed', 'stopped', 'timeout'], default: 'active' },
    endedAt: Date,
    endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    endReason: { type: String, maxlength: 120 },
    lastLocationAt: Date,
    // Highest stop sequence the bus has reached on this trip (route progress).
    reachedSequence: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// One active trip per bus — a second faculty member cannot take over a running trip.
tripSchema.index({ bus: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_trip' });
tripSchema.index({ status: 1, lastLocationAt: 1 });
tripSchema.index({ sharedBy: 1, status: 1 });

export default mongoose.model('BusTrip', tripSchema);
