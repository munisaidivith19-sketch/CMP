import StudyMaterial from '../models/StudyMaterial.js';
import Subject from '../models/Subject.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate, pick } from '../utils/http.js';
import { logActivity } from '../utils/activity.js';
import { assertFacultyAssignment, canManageStudyMaterial, facultyAssignments, materialReadFilter, STUDY_MATERIAL_STUDENT_ROLES } from '../utils/studyMaterialScope.js';
import { queueIndex, removeFromIndex } from '../services/ai/pdfIndexer.js';

const STUDENT_ROLES = STUDY_MATERIAL_STUDENT_ROLES;
const UPLOADED_BY_FIELDS = 'name role';

/** Faculty's real teaching assignments — the only classes they may upload/edit for. */
export const getMyAssignments = asyncHandler(async (req, res) => {
  res.json(await facultyAssignments(req.user._id));
});

/**
 * Resolve and validate the academic scope { department, section, semester,
 * year, subject } a write request wants to save under. Every role gets its
 * scope resolved differently, but none of it is ever trusted blindly from
 * the client — faculty must have a real assignment, HOD is pinned to their
 * own department, and the subject itself must actually exist.
 */
async function resolveScope(user, body, fallback) {
  const subjectId = body.subjectId || fallback?.subject;
  const subject = await Subject.findById(subjectId);
  if (!subject || !subject.isActive) throw new ApiError(404, 'Subject not found');

  const section = body.section !== undefined ? String(body.section).trim().toUpperCase() : fallback?.section || '';
  const semester = body.semester !== undefined ? Number(body.semester) : fallback?.semester ?? subject.semester;
  const year = body.year !== undefined ? Number(body.year) : fallback?.year ?? subject.year;

  let department;
  if (user.role === 'hod') {
    department = user.department; // never trust a client-supplied department for HOD
    if (subject.department !== department) throw new ApiError(403, `${subject.code} belongs to another department — you can only manage your own`);
  } else if (user.role === 'admin') {
    department = body.department !== undefined ? String(body.department).trim() : fallback?.department || subject.department;
  } else if (user.role === 'faculty') {
    department = body.department !== undefined ? String(body.department).trim() : fallback?.department;
    if (!department) throw new ApiError(422, 'Department is required');
    await assertFacultyAssignment(user._id, { department, section, semester, subjectId: subject._id });
  } else {
    throw new ApiError(403, 'Not authorized to manage study materials');
  }

  return { department, section, semester, year, subject: subject._id, subjectName: subject.name, subjectCode: subject.code };
}

// ── List / read ──────────────────────────────────────────────────────

export const listMaterials = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req, 20);
  // Students automatically see their own class — never a client-chosen scope.
  const filter = materialReadFilter(req.user);

  if (!STUDENT_ROLES.includes(req.user.role)) {
    if (req.query.department) filter.department = req.query.department;
    if (req.query.section) filter.section = String(req.query.section).toUpperCase();
    if (req.query.semester) filter.semester = Number(req.query.semester);
  }
  if (req.query.subject) filter.subject = req.query.subject;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.q) filter.title = new RegExp(escapeRegex(req.query.q), 'i');

  const [items, total] = await Promise.all([
    StudyMaterial.find(filter).populate('uploadedBy', UPLOADED_BY_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StudyMaterial.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(total, page, limit) });
});

export const getMaterial = asyncHandler(async (req, res) => {
  const material = await StudyMaterial.findOne({ ...materialReadFilter(req.user), _id: req.params.id }).populate('uploadedBy', UPLOADED_BY_FIELDS).lean();
  if (!material) throw new ApiError(404, 'Material not found');
  res.json(material);
});

// ── Upload ───────────────────────────────────────────────────────────

export const createMaterial = asyncHandler(async (req, res) => {
  const data = pick(req.body, ['title', 'description', 'category']);
  const scope = await resolveScope(req.user, req.body);
  const file = pick(req.body.file || {}, ['url', 'name', 'mimeType', 'size']);
  if (!file.url) throw new ApiError(422, 'A file is required');

  const material = await StudyMaterial.create({ ...data, ...scope, file, uploadedBy: req.user._id });
  queueIndex(material._id); // Study Assistant RAG index
  logActivity(req, 'study_material.upload', {
    entityType: 'study_material',
    entityId: material._id,
    summary: `[${req.user.role}] ${material.subjectCode} ${material.department}-${material.section || '*'}`,
  });
  res.status(201).json(await StudyMaterial.findById(material._id).populate('uploadedBy', UPLOADED_BY_FIELDS));
});

// ── Edit ─────────────────────────────────────────────────────────────

export const updateMaterial = asyncHandler(async (req, res) => {
  const material = await StudyMaterial.findOne({ _id: req.params.id, isActive: true });
  if (!material) throw new ApiError(404, 'Material not found');
  if (!(await canManageStudyMaterial(req.user, material))) throw new ApiError(403, 'You are not authorized to manage this material');

  const data = pick(req.body, ['title', 'description', 'category']);
  // Reassigning the academic scope re-validates the NEW scope, not the old one —
  // a faculty member can't smuggle their way into another subject this way.
  if (req.body.subjectId !== undefined || req.body.department !== undefined || req.body.section !== undefined || req.body.semester !== undefined) {
    Object.assign(data, await resolveScope(req.user, req.body, material));
  }
  if (req.body.file?.url) data.file = pick(req.body.file, ['url', 'name', 'mimeType', 'size']);

  Object.assign(material, data);
  await material.save();
  queueIndex(material._id); // scope/title/file may have changed — refresh the RAG chunks
  logActivity(req, 'study_material.update', { entityType: 'study_material', entityId: material._id, summary: `[${req.user.role}] ${material.subjectCode}` });
  res.json(await StudyMaterial.findById(material._id).populate('uploadedBy', UPLOADED_BY_FIELDS));
});

// ── Delete ───────────────────────────────────────────────────────────

export const deleteMaterial = asyncHandler(async (req, res) => {
  const material = await StudyMaterial.findOne({ _id: req.params.id, isActive: true });
  if (!material) throw new ApiError(404, 'Material not found');
  if (!(await canManageStudyMaterial(req.user, material))) throw new ApiError(403, 'You are not authorized to manage this material');

  material.isActive = false;
  await material.save();
  removeFromIndex(material._id).catch(() => {});
  logActivity(req, 'study_material.delete', { entityType: 'study_material', entityId: material._id, summary: `[${req.user.role}] ${material.subjectCode}` });
  res.json({ message: 'Material removed' });
});
