import crypto from 'node:crypto';
import multer from 'multer';
import NptelCertification, { HallTicketClaim } from '../../models/NptelCertification.js';
import CertificationReview from '../../models/CertificationReview.js';
import SkillWalletAsset from '../../models/SkillWalletAsset.js';
import { env } from '../../config/env.js';
import { ApiError, asyncHandler, escapeRegex, pageMeta, paginate } from '../../utils/http.js';
import { seal, open } from '../../utils/cipher.js';
import { logAudit } from '../../utils/auditLog.js';
import { logActivity } from '../../utils/activity.js';
import { activeKeys, getConfig, labelOf } from '../../services/skillWallet/config.js';
import { ImageRejected, convertCertificateToWebp } from '../../services/skillWallet/imagePipeline.js';
import { assetUrl, deleteAsset, storeAsset } from '../../services/skillWallet/assets.js';
import { notifySkillWallet } from '../../services/skillWallet/notify.js';
import { canVerifyCertificate, sameId, verifierQueueFilter } from '../../services/skillWallet/access.js';
import { assertObjectId, parseDay } from '../../services/skillWallet/projects.js';
import { SW_CERT_DECISIONS, SW_CERT_STATUSES } from '../../constants.js';
import User from '../../models/User.js';
import { saveOrConflict } from './projectController.js';

/**
 * NPTEL certifications.
 *
 * Submission order is chosen so that a failure leaves nothing behind:
 * validate every field → validate + convert the image to WebP in memory →
 * claim the hall ticket → store ONLY the WebP → create the record. If any
 * step fails, the stored WebP is deleted and a new hall-ticket claim is
 * released; the original upload is never written anywhere.
 *
 * The student ID always comes from the session (req.user), never the body.
 * Uploading never verifies — a verifier decides (CertificationReview keeps the history).
 *
 * Hall tickets: no official NPTEL verification API is configured, so the
 * number is checked for format, encrypted at rest, deduplicated across
 * students with a keyed hash, and compared by the verifier against the
 * certificate image and the student's identity (manual workflow).
 */

const HMAC_KEY = crypto.createHash('sha256').update(`nptel-hall-ticket:${env.chatKey}`).digest();
const hashHallTicket = (ht) => crypto.createHmac('sha256', HMAC_KEY).update(ht).digest('hex');
const normaliseHallTicket = (v) => String(v || '').toUpperCase().replace(/[\s-]+/g, '');
const courseKeyOf = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Certificate upload: memory only, one file, its own size limit, a clear 413 message. */
const certMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.skillWallet.certMaxUploadMb * 1048576, files: 1, fields: 12, fieldSize: 4096 },
});
export function certificateUpload(req, res, next) {
  certMulter.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new ImageRejected('FILE_TOO_LARGE', `The image is too large (max ${env.skillWallet.certMaxUploadMb} MB)`, 413));
    }
    if (err instanceof multer.MulterError) return next(new ApiError(400, 'The upload could not be read. Send one image in the "file" field.'));
    return next(err);
  });
}

const projectImageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.skillWallet.projectImageMaxUploadMb * 1048576, files: 1, fields: 2 },
});
export function projectImageUpload(req, res, next) {
  projectImageMulter.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new ImageRejected('FILE_TOO_LARGE', `The image is too large (max ${env.skillWallet.projectImageMaxUploadMb} MB)`, 413));
    }
    if (err instanceof multer.MulterError) return next(new ApiError(400, 'The upload could not be read. Send one image in the "file" field.'));
    return next(err);
  });
}

/** Validate certificate fields (all optional when `existing` is given). */
function parseCertInput(body, config, existing = null) {
  const b = body || {};
  const want = (k) => !existing || (b[k] !== undefined && b[k] !== '');
  const out = {};
  if (want('hallTicket')) {
    const ht = normaliseHallTicket(b.hallTicket);
    if (!/^[A-Z0-9]{6,30}$/.test(ht)) throw new ApiError(422, 'Enter the hall ticket number as printed (6–30 letters and digits)');
    out.hallTicket = ht;
  }
  if (want('courseName')) {
    const name = String(b.courseName || '').trim();
    if (name.length < 3 || name.length > 200) throw new ApiError(422, 'Course name must be 3–200 characters');
    out.courseName = name;
    out.courseKey = courseKeyOf(name);
  }
  if (want('startDate')) {
    out.startDate = parseDay(b.startDate, 'Course start date');
    if (!out.startDate) throw new ApiError(422, 'Course start date is required');
  }
  if (want('endDate')) {
    out.endDate = parseDay(b.endDate, 'Course end date');
    if (!out.endDate) throw new ApiError(422, 'Course end date is required');
  }
  if (want('durationWeeks')) {
    const w = Number(b.durationWeeks);
    if (!Number.isInteger(w) || w < 1 || w > 24) throw new ApiError(422, 'Course duration must be 1–24 weeks');
    out.durationWeeks = w;
  }
  if (want('credits')) {
    const c = Number(b.credits);
    if (!Number.isFinite(c) || c < 0 || c > 20 || Math.round(c * 2) !== c * 2) throw new ApiError(422, 'Credits must be a number from 0 to 20 (steps of 0.5)');
    out.credits = c;
  }
  if (want('institution')) {
    const inst = String(b.institution || '').trim();
    if (!activeKeys(config.institutions).includes(inst) && !(existing && existing.institution === inst)) throw new ApiError(422, 'Choose the course-offering institution');
    out.institution = inst;
  }
  const institution = out.institution ?? existing?.institution;
  if (institution === 'other') {
    const other = String(b.institutionOther ?? existing?.institutionOther ?? '').trim();
    if (other.length < 2 || other.length > 120) throw new ApiError(422, 'Name the institution (2–120 characters)');
    out.institutionOther = other;
  } else if (out.institution) {
    out.institutionOther = '';
  }
  const start = out.startDate ?? existing?.startDate;
  const end = out.endDate ?? existing?.endDate;
  if (start && end && end < start) throw new ApiError(422, 'Course end date cannot be earlier than the start date');
  const tomorrow = new Date(Date.now() + 86400000);
  if (end && end > tomorrow) throw new ApiError(422, 'Course end date cannot be in the future');
  return out;
}

/** Claim a hall ticket for this student. Returns true when a NEW claim row was created. */
async function claimHallTicket(hash, studentId) {
  try {
    const before = await HallTicketClaim.findOneAndUpdate(
      { hash },
      { $setOnInsert: { hash, student: studentId } },
      { upsert: true, new: false }
    ).lean();
    if (before && !sameId(before.student, studentId)) {
      throw new ApiError(409, 'This hall ticket number is already registered to another student. Contact your Class In-Charge if it is yours.');
    }
    return !before;
  } catch (err) {
    if (err.code === 11000) return claimHallTicket(hash, studentId);
    throw err;
  }
}

async function releaseClaimIfUnused(studentId, hash) {
  if (!hash) return;
  const inUse = await NptelCertification.exists({ student: studentId, hallTicketHash: hash, isDeleted: false, status: { $ne: 'rejected' } });
  if (!inUse) await HallTicketClaim.deleteOne({ hash, student: studentId });
}

function studentView(c, viewer, config, { hallTicket } = {}) {
  return {
    _id: c._id,
    courseName: c.courseName,
    startDate: c.startDate,
    endDate: c.endDate,
    durationWeeks: c.durationWeeks,
    credits: c.credits,
    institution: { key: c.institution, label: c.institution === 'other' && c.institutionOther ? c.institutionOther : labelOf(config.institutions, c.institution) },
    institutionOther: c.institutionOther,
    status: c.status,
    decisionReason: c.decisionReason,
    decidedAt: c.decidedAt,
    hallTicketMasked: c.hallTicketLast4 ? `••••${c.hallTicketLast4}` : null,
    ...(hallTicket ? { hallTicket } : {}),
    imageUrl: assetUrl(c.image, viewer),
    canEdit: ['pending', 'correction_requested'].includes(c.status),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const history = (certId) =>
  CertificationReview.find({ certification: certId }).populate('actor', 'name title role designation').sort({ createdAt: 1 }).limit(100).lean();

// ── Student ─────────────────────────────────────────────────────────

export const listMyCertifications = asyncHandler(async (req, res) => {
  const config = await getConfig();
  const filter = { student: req.user._id, isDeleted: false };
  if (req.query.status && SW_CERT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const items = await NptelCertification.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items: items.map((c) => studentView(c, req.user, config)) });
});

export const getMyCertification = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'certificate id');
  const c = await NptelCertification.findOne({ _id: req.params.id, student: req.user._id, isDeleted: false }).select('+hallTicketEnc').lean();
  if (!c) throw new ApiError(404, 'Certificate not found');
  const config = await getConfig();
  res.json({ ...studentView(c, req.user, config, { hallTicket: open(c.hallTicketEnc) }), history: await history(c._id) });
});

/** POST /skill-wallet/certifications (multipart: file + fields). */
export const createCertification = asyncHandler(async (req, res) => {
  const config = await getConfig();
  const data = parseCertInput(req.body, config, null);
  if (!req.file) throw new ImageRejected('EMPTY_FILE', 'Attach the certificate image (PNG, JPEG or WebP)', 400);

  const hash = hashHallTicket(data.hallTicket);
  const duplicate = await NptelCertification.exists({ student: req.user._id, courseKey: data.courseKey, isDeleted: false, status: { $ne: 'rejected' } });
  if (duplicate) throw new ApiError(409, 'You have already added this course');

  // 1. Convert first — nothing is stored if the image is refused.
  const image = await convertCertificateToWebp(req.file.buffer);
  // 2. Hall ticket ownership.
  const newClaim = await claimHallTicket(hash, req.user._id);
  let asset = null;
  try {
    // 3. Only the converted WebP is stored.
    asset = await storeAsset({ owner: req.user._id, kind: 'certificate', image });
    const cert = await NptelCertification.create({
      student: req.user._id,
      hallTicketEnc: seal(data.hallTicket),
      hallTicketHash: hash,
      hallTicketLast4: data.hallTicket.slice(-4),
      courseName: data.courseName,
      courseKey: data.courseKey,
      startDate: data.startDate,
      endDate: data.endDate,
      durationWeeks: data.durationWeeks,
      credits: data.credits,
      institution: data.institution,
      institutionOther: data.institutionOther || '',
      image: asset._id,
      department: req.user.department,
      year: req.user.year,
      section: req.user.section,
      semester: req.user.semester,
    });
    await SkillWalletAsset.updateOne({ _id: asset._id }, { $set: { status: 'attached', certification: cert._id } });
    await CertificationReview.create({ certification: cert._id, student: req.user._id, actor: req.user._id, action: 'submitted' });
    logActivity(req, 'skill_wallet.certificate.submit', { entityType: 'nptel_certification', entityId: cert._id, summary: 'NPTEL certificate submitted' });
    res.status(201).json(studentView(cert.toObject(), req.user, config));
  } catch (err) {
    if (asset) await deleteAsset(asset);
    if (newClaim) await HallTicketClaim.deleteOne({ hash, student: req.user._id });
    if (err.code === 11000) throw new ApiError(409, 'This hall ticket and course are already on file');
    throw err;
  }
});

/** PUT /skill-wallet/certifications/:id (multipart; file optional) — while pending or correction requested. */
export const updateCertification = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'certificate id');
  const cert = await NptelCertification.findOne({ _id: req.params.id, student: req.user._id, isDeleted: false }).select('+hallTicketHash +courseKey');
  if (!cert) throw new ApiError(404, 'Certificate not found');
  if (!['pending', 'correction_requested'].includes(cert.status)) throw new ApiError(409, 'A verified or rejected certificate can no longer be edited');
  const config = await getConfig();
  const data = parseCertInput(req.body, config, cert);

  if (data.courseKey && data.courseKey !== cert.courseKey) {
    const dup = await NptelCertification.exists({ _id: { $ne: cert._id }, student: req.user._id, courseKey: data.courseKey, isDeleted: false, status: { $ne: 'rejected' } });
    if (dup) throw new ApiError(409, 'You have already added this course');
  }
  const image = req.file ? await convertCertificateToWebp(req.file.buffer) : null;
  const oldHash = cert.hallTicketHash;
  const newHash = data.hallTicket ? hashHallTicket(data.hallTicket) : oldHash;
  const newClaim = newHash !== oldHash ? await claimHallTicket(newHash, req.user._id) : false;

  let asset = null;
  const oldImage = cert.image;
  const wasCorrection = cert.status === 'correction_requested';
  try {
    if (image) asset = await storeAsset({ owner: req.user._id, kind: 'certificate', image, certification: cert._id, status: 'attached' });
    for (const k of ['courseName', 'courseKey', 'startDate', 'endDate', 'durationWeeks', 'credits', 'institution', 'institutionOther']) if (data[k] !== undefined) cert[k] = data[k];
    if (data.hallTicket) {
      cert.hallTicketEnc = seal(data.hallTicket);
      cert.hallTicketHash = newHash;
      cert.hallTicketLast4 = data.hallTicket.slice(-4);
    }
    if (asset) cert.image = asset._id;
    cert.status = 'pending';
    await saveOrConflict(cert);
  } catch (err) {
    if (asset) await deleteAsset(asset);
    if (newClaim) await HallTicketClaim.deleteOne({ hash: newHash, student: req.user._id });
    if (err.code === 11000) throw new ApiError(409, 'This hall ticket and course are already on file');
    throw err;
  }
  if (asset) await deleteAsset(oldImage);
  if (newHash !== oldHash) await releaseClaimIfUnused(req.user._id, oldHash);
  await CertificationReview.create({ certification: cert._id, student: req.user._id, actor: req.user._id, action: wasCorrection ? 'resubmitted' : 'submitted' });
  res.json(studentView(cert.toObject(), req.user, config));
});

/** DELETE /skill-wallet/certifications/:id — the student withdraws a record (history kept). */
export const deleteCertification = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'certificate id');
  const cert = await NptelCertification.findOne({ _id: req.params.id, student: req.user._id, isDeleted: false }).select('+hallTicketHash');
  if (!cert) throw new ApiError(404, 'Certificate not found');
  cert.isDeleted = true;
  cert.deletedAt = new Date();
  await saveOrConflict(cert);
  await deleteAsset(cert.image);
  await releaseClaimIfUnused(req.user._id, cert.hallTicketHash);
  await CertificationReview.create({ certification: cert._id, student: req.user._id, actor: req.user._id, action: 'withdrawn' });
  res.json({ ok: true });
});

// ── Verifier ────────────────────────────────────────────────────────

/** GET /skill-wallet/review/certifications?status=&q=&page= */
export const verifierQueue = asyncHandler(async (req, res) => {
  const scope = verifierQueueFilter(req.swActor);
  if (!scope) throw new ApiError(403, 'You are not a certificate verifier');
  const { page, limit, skip } = paginate(req, 20, 50);
  const status = SW_CERT_STATUSES.includes(req.query.status) ? req.query.status : 'pending';
  const filter = { ...scope, isDeleted: false, status };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
    const students = await User.find({ $or: [{ name: rx }, { rollNo: rx }] }).limit(200).distinct('_id');
    filter.$and = [{ $or: [{ courseName: rx }, { student: { $in: students } }] }];
  }
  const [items, total, config] = await Promise.all([
    NptelCertification.find(filter).populate('student', 'name title rollNo department year section').sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    NptelCertification.countDocuments(filter),
    getConfig(),
  ]);
  res.json({
    items: items.map((c) => ({ ...studentView(c, req.user, config), canEdit: undefined, student: c.student })),
    ...pageMeta(total, page, limit),
  });
});

async function loadForVerifier(req) {
  assertObjectId(req.params.id, 'certificate id');
  const cert = await NptelCertification.findOne({ _id: req.params.id, isDeleted: false }).select('+hallTicketEnc +hallTicketHash');
  if (!cert || !canVerifyCertificate(req.swActor, cert)) throw new ApiError(404, 'Certificate not found');
  return cert;
}

export const verifierDetail = asyncHandler(async (req, res) => {
  const cert = await loadForVerifier(req);
  const [config, student] = await Promise.all([getConfig(), User.findById(cert.student).select('name title rollNo department year section').lean()]);
  res.json({
    ...studentView(cert.toObject(), req.user, config, { hallTicket: open(cert.hallTicketEnc) }),
    canEdit: undefined,
    // Sent back with the decision: it applies only to the content shown here.
    version: cert.__v,
    student,
    history: await history(cert._id),
  });
});

/** POST /skill-wallet/review/certifications/:id/decision { decision, reason } */
export const decideCertification = asyncHandler(async (req, res) => {
  const cert = await loadForVerifier(req);
  const decision = req.body.decision;
  if (!SW_CERT_DECISIONS.includes(decision)) throw new ApiError(422, 'Decision must be verified, correction_requested or rejected');
  const reason = String(req.body.reason || '').trim().slice(0, 1000);
  if (decision !== 'verified' && reason.length < 5) throw new ApiError(422, 'Give the student a reason (at least 5 characters)');
  // The decision is about the version the verifier opened (verifierDetail →
  // version). A student edit since then (new image, hall ticket …) bumps the
  // version, so a decision can never apply to content the verifier never saw.
  const version = Number(req.body.version);
  if (!Number.isInteger(version) || version < 0) throw new ApiError(422, 'Reload the certificate before recording a decision');
  // Only a pending certificate can be decided; the conditional update makes parallel decisions safe.
  const updated = await NptelCertification.findOneAndUpdate(
    { _id: cert._id, isDeleted: false, status: 'pending', __v: version },
    { $set: { status: decision, decidedBy: req.user._id, decidedAt: new Date(), decisionReason: reason }, $inc: { __v: 1 } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'This certificate is not waiting for verification (it may have been decided or changed already)');
  await CertificationReview.create({ certification: cert._id, student: cert.student, actor: req.user._id, action: decision, reason });
  if (decision === 'rejected') await releaseClaimIfUnused(cert.student, cert.hallTicketHash);
  logAudit(req, 'SKILL_WALLET_CERT_DECISION', { target: cert.student, details: { certification: String(cert._id), decision } });
  const messages = {
    verified: ['NPTEL certificate verified', 'One of your NPTEL certificates was verified.'],
    correction_requested: ['NPTEL certificate needs a correction', 'A verifier asked you to correct one of your NPTEL certificates.'],
    rejected: ['NPTEL certificate not accepted', 'A verifier did not accept one of your NPTEL certificates.'],
  };
  notifySkillWallet([cert.student], { title: messages[decision][0], message: messages[decision][1], link: '/skill-wallet?tab=certifications' }, { eventKey: `sw-cert:${cert._id}:${updated.__v}` });
  res.json({ status: updated.status });
});
