import mongoose from 'mongoose';
import { BUS_GPS_SOURCES } from '../constants.js';

const { Schema } = mongoose;

// Retention set by institutional policy (TRANSPORT_LOCATION_RETENTION_DAYS, default 7).
const RETENTION_DAYS = Math.min(365, Math.max(1, Number(process.env.TRANSPORT_LOCATION_RETENTION_DAYS) || 7));

/**
 * Accepted bus positions (history), used for the travelled path, recent speed
 * and audits. Thinned on write (see services/transport/ingest.js) and deleted
 * automatically after the retention period.
 */
const locationSchema = new Schema(
  {
    bus: { type: Schema.Types.ObjectId, ref: 'Bus', required: true },
    trip: { type: Schema.Types.ObjectId, ref: 'BusTrip' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    at: { type: Date, required: true },
    accuracy: Number,
    speed: Number,
    heading: Number,
    source: { type: String, enum: BUS_GPS_SOURCES, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { toJSON: { versionKey: false } }
);

locationSchema.index({ bus: 1, at: -1 });
locationSchema.index({ trip: 1, at: 1 });
locationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400, name: 'retention' });

export default mongoose.model('BusLocation', locationSchema);
