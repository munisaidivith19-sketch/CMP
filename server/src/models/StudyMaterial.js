import mongoose from 'mongoose';
import { STUDY_MATERIAL_CATEGORIES, yearOfSemester } from '../constants.js';

const { Schema } = mongoose;

/**
 * A single uploaded file scoped to one class (department + section + semester
 * + subject). Write access is never based on role alone — see
 * utils/studyMaterialScope.js, which checks the *current* timetable
 * assignment for faculty, so permission always follows who is actually
 * teaching the class today, not who originally uploaded the file.
 */
const studyMaterialSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: String, enum: STUDY_MATERIAL_CATEGORIES, default: 'notes' },

    // Academic scope snapshot — what class this material belongs to.
    department: { type: String, required: true, trim: true, maxlength: 80, index: true },
    section: { type: String, trim: true, uppercase: true, maxlength: 10 },
    semester: { type: Number, min: 1, max: 12, index: true },
    year: { type: Number, min: 1, max: 6 },

    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    // Snapshots so the title/code still read correctly if the subject is later renamed/retired.
    subjectName: { type: String, trim: true, maxlength: 120 },
    subjectCode: { type: String, trim: true, maxlength: 20 },

    file: {
      url: { type: String, required: true, trim: true, maxlength: 300 },
      name: { type: String, trim: true, maxlength: 150 },
      mimeType: { type: String, trim: true, maxlength: 100 },
      size: Number,
    },

    // Who uploaded it originally — audit only, never the permission check itself.
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    isActive: { type: Boolean, default: true },

    // Study Assistant RAG index state (text extracted into StudyMaterialChunk).
    aiIndex: {
      status: { type: String, enum: ['pending', 'ready', 'failed', 'unsupported'], default: 'pending' },
      fileUrl: { type: String, trim: true, maxlength: 300 }, // which file version was indexed
      chunkCount: { type: Number, default: 0 },
      indexedAt: Date,
    },
  },
  { timestamps: true, toJSON: { versionKey: false } }
);

studyMaterialSchema.index({ department: 1, year: 1, semester: 1, section: 1, isActive: 1 }, { name: 'class_materials' });
studyMaterialSchema.index({ subject: 1, isActive: 1 });
studyMaterialSchema.index({ title: 'text', subjectName: 'text', subjectCode: 'text' }, { name: 'study_material_text' });

// Year always follows the semester, so class scoping by year never misses a material.
studyMaterialSchema.pre('validate', function deriveYear(next) {
  if (this.semester) {
    const expected = yearOfSemester(this.semester);
    if (this.year == null) this.year = expected;
    else if (this.year !== expected) this.invalidate('year', `Semester ${this.semester} belongs to year ${expected}, not year ${this.year}`);
  }
  next();
});

export default mongoose.model('StudyMaterial', studyMaterialSchema);
