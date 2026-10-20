import mongoose from 'mongoose';
import { BUS_GPS_SOURCES, BUS_TRIP_DIRECTIONS } from '../constants.js';
import { JOURNEY_RETENTION_DAYS } from './BusStopEvent.js';

const { Schema } = mongoose;

/**
 * One run of a bus. Phone-shared locations are accepted ONLY during an active
 * trip and only from the person who started it (`sharedBy`); a trip ends on
 * completion, an authorized stop, or the idle / maximum-duration timeout — so
 * nobody is ever tracked outside a trip.
 */
// The trip's planned stops, in travel order, fixed when it starts (route edits
// mid-trip never reshuffle a running journey or its history).
const planStopSchema = new Schema(
  {
    stop: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, maxlength: 80 },
    lat: Number,
    lng: Number,
    isCollege: Boolean,
    scheduledTime: String, // HH:mm campus time, only from a real timetable
    radiusM: Number,
  },
  { _id: false }
);

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
    // Device binding (opt-in; the web sharing page always uses it): SHA-256 of
    // a random key handed once to the device that started the trip. Locations
    // must then carry that key, so a second tab or device of the same person
    // cannot feed — and silently overwrite — this trip's position. Trips
    // started without it (the Android app) behave as before.
    deviceKeyHash: { type: String, select: false },
    channel: { type: String, enum: ['app', 'web'], default: 'app' },
    // Direction-aware journey (trips started before this existed have no plan).
    direction: { type: String, enum: BUS_TRIP_DIRECTIONS },
    directionAssumed: { type: Boolean, default: false },
    baseRoute: { type: Schema.Types.ObjectId, ref: 'BusRoute' }, // the bus's route; `route` is the one followed
    routeMode: { type: String, enum: ['forward', 'return_route', 'reverse'] },
    plan: { type: [planStopSchema], default: undefined },
    // Server-side progress / arrival-detection state (services/transport/journey.js).
    tracker: { type: Schema.Types.Mixed },
    finalArrivalAt: Date,
    collegeArrivedAt: Date,
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

// One active trip per bus — a second faculty member cannot take over a running trip.
tripSchema.index({ bus: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_trip' });
tripSchema.index({ status: 1, lastLocationAt: 1 });
tripSchema.index({ sharedBy: 1, status: 1 });
tripSchema.index({ bus: 1, startedAt: -1 });
tripSchema.index({ baseRoute: 1, direction: 1, startedAt: -1 });
// Journey history is kept for TRANSPORT_JOURNEY_RETENTION_DAYS (default 365), then removed.
tripSchema.index({ startedAt: 1 }, { expireAfterSeconds: JOURNEY_RETENTION_DAYS * 86400, name: 'retention' });
// One phone-shared trip per person at a time: one device position cannot stand for two buses.
tripSchema.index({ sharedBy: 1 }, { unique: true, partialFilterExpression: { status: 'active', sharedBy: { $type: 'objectId' } }, name: 'one_active_share_per_user' });

export default mongoose.model('BusTrip', tripSchema);
