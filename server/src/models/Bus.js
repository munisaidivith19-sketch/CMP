import mongoose from 'mongoose';
import { BUS_GPS_SOURCES } from '../constants.js';

const { Schema } = mongoose;

/**
 * A college bus. `lastLocation` is the latest VALID position the ingestion
 * service accepted (from the vehicle tracker or an authorized trip phone) —
 * never a client claim, never fabricated. Its age decides whether the map
 * shows it as live, stale or offline.
 */
const busSchema = new Schema(
  {
    number: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    registrationNumber: { type: String, trim: true, uppercase: true, maxlength: 20 },
    isActive: { type: Boolean, default: true },
    route: { type: Schema.Types.ObjectId, ref: 'BusRoute' },
    gpsSource: { type: String, enum: BUS_GPS_SOURCES, default: 'phone' },
    // The vehicle tracker's own device id, when a tracker integration is configured.
    trackerDeviceId: { type: String, trim: true, maxlength: 80 },
    // Staff allowed to start a trip and share their phone's location for this bus.
    trackingStaff: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    lastLocation: {
      lat: Number,
      lng: Number,
      at: Date, // the GPS fix time
      accuracy: Number, // metres
      speed: Number, // m/s
      heading: Number, // degrees, 0 = north
      source: { type: String, enum: BUS_GPS_SOURCES },
      trip: { type: Schema.Types.ObjectId, ref: 'BusTrip' },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

busSchema.index({ number: 1 }, { unique: true, name: 'unique_bus_number' });
busSchema.index({ trackerDeviceId: 1 }, { unique: true, partialFilterExpression: { trackerDeviceId: { $type: 'string' } }, name: 'unique_tracker_device' });
busSchema.index({ route: 1, isActive: 1 });
busSchema.index({ trackingStaff: 1 });

export default mongoose.model('Bus', busSchema);
