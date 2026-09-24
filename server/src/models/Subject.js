import mongoose from 'mongoose';

const { Schema } = mongoose;

const subjectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    department: { type: String, required: true, trim: true, maxlength: 80, index: true },
    semester: { type: Number, required: true, min: 1, max: 12, index: true },
    year: { type: Number, min: 1, max: 6 },
    credits: { type: Number, min: 0, max: 10, default: 3 },
    type: { type: String, enum: ['theory', 'lab', 'elective'], default: 'theory' },

    // Faculty teaching this subject (can have multiple for different sections).
    faculty: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // Sections this subject is taught to.
    sections: [{ type: String, trim: true, maxlength: 10 }],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

subjectSchema.index({ code: 1, department: 1, semester: 1 });
subjectSchema.index(
  { name: 'text', code: 'text' },
  { weights: { code: 5, name: 3 }, name: 'subject_text' }
);

export default mongoose.model('Subject', subjectSchema);
