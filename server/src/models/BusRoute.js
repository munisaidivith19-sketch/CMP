import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A college bus route: ordered stops and, when available, the road geometry
 * the bus follows. Without geometry the stops themselves (in order) are the
 * only path known, ETAs computed on it are marked low-confidence, and maps
 * label the line as approximate.
 */
const stopSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  sequence: { type: Number, required: true, min: 1, max: 200 },
  // Optional timetable (campus time, HH:mm) — used for ETA when speed is unknown.
  scheduledTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  // The college itself (normally the last stop on the morning run).
  isCollege: { type: Boolean, default: false },
  // Optional per-stop arrival radius (m) where the default (STOP_ARRIVAL_RADIUS_M)
  // does not fit — a wide bus bay, a stop beside a parallel road, …
  arrivalRadiusM: { type: Number, min: 10, max: 500 },
});

const routeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, trim: true, uppercase: true, maxlength: 20 },
    stops: {
      type: [stopSchema],
      validate: [
        { validator: (v) => v.length >= 2, message: 'A route needs at least two stops' },
        { validator: (v) => new Set(v.map((s) => s.sequence)).size === v.length, message: 'Stop sequence numbers must be unique' },
      ],
    },
    // Road polyline as [lng, lat] pairs (GeoJSON order), in travel order.
    geometry: {
      type: [[Number]],
      default: undefined,
      validate: {
        validator: (v) => !v || (v.length >= 2 && v.every((p) => p.length === 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)),
        message: 'Route geometry must be at least two [longitude, latitude] points',
      },
    },
    // Where the geometry came from: 'generated' (road routing, saved by a
    // manager after previewing it) or 'manual' (pasted). Routes saved before
    // this field existed have geometry but no source recorded.
    geometrySource: { type: String, enum: ['manual', 'generated'] },
    geometryProvider: { type: String, trim: true, maxlength: 40 },
    geometryUpdatedAt: Date,
    // Key of the stop coordinates the geometry was saved for. Stops edited
    // later keep the geometry (never replaced silently) but no longer match
    // this key, so managers are told to regenerate.
    geometryStopsKey: { type: String, maxlength: 64 },
    // The run in the other direction. Unset: the same stops in reverse order.
    // Set: that route's own stops and road geometry (e.g. a one-way street).
    returnRoute: { type: Schema.Types.ObjectId, ref: 'BusRoute' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

routeSchema.pre('validate', function sortStops(next) {
  if (this.stops?.length) this.stops.sort((a, b) => a.sequence - b.sequence);
  next();
});

routeSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isActive: true }, name: 'unique_active_route_name' });
routeSchema.index({ 'stops.name': 1 });

export default mongoose.model('BusRoute', routeSchema);
