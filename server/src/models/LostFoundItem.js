import mongoose from 'mongoose';

const { Schema } = mongoose;

const ITEM_TYPES = ['lost', 'found'];
const ITEM_CATEGORIES = [
  'electronics',
  'documents',
  'clothing',
  'accessories',
  'books',
  'keys',
  'wallet',
  'bag',
  'sports',
  'other',
];
const ITEM_STATUSES = [
  'lost',
  'found',
  'possible_match',
  'under_verification',
  'returned',
  'closed',
];

const lostFoundItemSchema = new Schema(
  {
    type: { type: String, enum: ITEM_TYPES, required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    itemName: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ITEM_CATEGORIES, required: true, index: true },
    description: { type: String, trim: true, maxlength: 1000 },
    photo: String,
    location: { type: String, required: true, trim: true, maxlength: 200 },
    dateTime: { type: Date, required: true },
    additionalDetails: { type: String, trim: true, maxlength: 500 },

    // Contact preferences (visible only to admins + owner).
    contactMethod: {
      type: String,
      enum: ['email', 'phone', 'in_person'],
      default: 'email',
    },

    status: { type: String, enum: ITEM_STATUSES, default: function defaultStatus() { return this.type; }, index: true },

    // Resolution.
    matchedWith: { type: Schema.Types.ObjectId, ref: 'LostFoundItem' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolutionNote: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

lostFoundItemSchema.index({ createdAt: -1 });
lostFoundItemSchema.index(
  { itemName: 'text', description: 'text', location: 'text' },
  { weights: { itemName: 5, location: 3, description: 1 }, name: 'lostfound_text' }
);

export { ITEM_TYPES, ITEM_CATEGORIES, ITEM_STATUSES };
export default mongoose.model('LostFoundItem', lostFoundItemSchema);
