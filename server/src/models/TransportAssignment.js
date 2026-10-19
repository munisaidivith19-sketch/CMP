import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A student's (or staff member's) bus route and boarding stop. Used for the
 * "assigned" visibility mode, for "approaching your stop" alerts, and to pick
 * the stop shown by default. It records no location and says nothing about
 * whether the person is on the bus.
 */
const assignmentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    route: { type: Schema.Types.ObjectId, ref: 'BusRoute', required: true },
    bus: { type: Schema.Types.ObjectId, ref: 'Bus' },
    stop: { type: Schema.Types.ObjectId }, // a stop _id on the route
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

assignmentSchema.index({ user: 1 }, { unique: true, name: 'one_assignment_per_user' });
assignmentSchema.index({ route: 1 });
assignmentSchema.index({ bus: 1 });

export default mongoose.model('TransportAssignment', assignmentSchema);
