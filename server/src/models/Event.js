import mongoose from 'mongoose';
import { EVENT_CATEGORIES } from '../constants.js';

const { Schema } = mongoose;

const registrationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['registered', 'waitlisted', 'attended'], default: 'registered' },
    registeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const eventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    category: { type: String, enum: EVENT_CATEGORIES, default: 'other' },
    club: { type: Schema.Types.ObjectId, ref: 'Club' },
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    registrationDeadline: Date,
    venue: { type: String, required: true, trim: true, maxlength: 160 },
    poster: String,
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],

    // Participation limit (0 = unlimited). `registeredCount` is maintained
    // atomically so concurrent registrations can never exceed capacity.
    capacity: { type: Number, default: 0, min: 0, max: 100000 },
    registeredCount: { type: Number, default: 0, min: 0 },
    registrations: { type: [registrationSchema], default: [] },

    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

eventSchema.index({ startDate: 1, category: 1 });
eventSchema.index({ club: 1, startDate: 1 });
eventSchema.index({ 'registrations.user': 1 });
eventSchema.index(
  { title: 'text', description: 'text', tags: 'text', venue: 'text' },
  { weights: { title: 6, tags: 3, venue: 1, description: 1 }, name: 'event_text' }
);

eventSchema.pre('validate', function checkDates(next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    this.invalidate('endDate', 'End date must be after start date');
  }
  if (this.registrationDeadline && this.endDate && this.registrationDeadline > this.endDate) {
    this.invalidate('registrationDeadline', 'Registration deadline must be before the event ends');
  }
  next();
});

export default mongoose.model('Event', eventSchema);
