import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A searchable slice of an uploaded study material's extracted text — the
 * RAG index behind the JNN Study Assistant. The academic scope is copied from
 * the parent StudyMaterial so retrieval can be filtered by it, but the real
 * authorization boundary is always the set of material ids the requesting
 * user may read (see services/ai/sources/studyMaterialSource.js).
 */
const chunkSchema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'StudyMaterial', required: true, index: true },
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', index: true },
    department: { type: String, trim: true },
    section: { type: String, trim: true },
    semester: Number,
    title: { type: String, trim: true, maxlength: 150 },
    subjectName: { type: String, trim: true, maxlength: 120 },
    fileName: { type: String, trim: true, maxlength: 150 },
    page: { type: Number, default: null }, // 1-based PDF page; null when the file has no pages (e.g. .txt)
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true, maxlength: 4000 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { versionKey: false } }
);

chunkSchema.index({ text: 'text', title: 'text', subjectName: 'text' }, { name: 'study_chunk_text', weights: { text: 1, title: 3, subjectName: 2 } });
chunkSchema.index({ material: 1, chunkIndex: 1 }, { unique: true });

export default mongoose.model('StudyMaterialChunk', chunkSchema);
