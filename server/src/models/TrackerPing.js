import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * The last contact from each GPS tracker device (one small document per
 * device id, `_id` = the device id). Written by the signed tracker webhook —
 * also for a device not yet linked to a bus — so a transport manager can test
 * a tracker from the bus form ("Test tracker") before and after saving it.
 * Holds no personal data; positions stay on the Bus / BusLocation as before.
 */
const trackerPingSchema = new Schema(
  {
    _id: { type: String, maxlength: 80 },
    lastSeenAt: Date,
    // accepted | rejected | unknown_device
    lastResult: { type: String, enum: ['accepted', 'rejected', 'unknown_device'] },
    lastAcceptedAt: Date,
    bus: { type: Schema.Types.ObjectId, ref: 'Bus' },
    received: { type: Number, default: 0 }, // positions received in total
    accepted: { type: Number, default: 0 },
    // Why the last batch's positions were refused (codes and messages only).
    lastRejects: { type: [{ code: String, reason: String, _id: false }], default: [] },
  },
  { versionKey: false }
);

export default mongoose.model('TrackerPing', trackerPingSchema);
