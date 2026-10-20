import mongoose from 'mongoose';
import StoredFile from '../models/StoredFile.js';
import { escapeRegex } from '../utils/http.js';

/**
 * Orphan sweep for files uploaded through POST /api/uploads and kept in
 * MongoDB (StoredFile). A file uploaded but never attached to a record (the
 * form was abandoned, or the upload endpoint was abused) is deleted once it
 * is older than ORPHAN_AGE_MS.
 *
 * "Attached" means some document in any other collection references
 * /uploads/<filename> in one of its string fields (top level, nested, arrays
 * of strings or arrays of sub-documents). A file found referenced is marked
 * attachedAt and never checked or deleted again. Only rows with an uploader
 * (uploadedBy, set by POST /uploads) are ever candidates; files stored by
 * other paths are left alone.
 *
 * Fail safe: when any lookup errors, or too many referencing documents come
 * back to inspect, nothing is deleted in that run.
 */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;
const MAX_MATCHES_PER_MODEL = 2000;
const SKIP_MODELS = new Set(['StoredFile', 'UploadQuota']);

/** Every path of `schema` that can hold a string (String, Mixed, [String], nested). */
export function stringPaths(schema, prefix = '') {
  const out = [];
  schema.eachPath((p, type) => {
    const full = `${prefix}${p}`;
    const inner = type.embeddedSchemaType || type.caster;
    if (type.instance === 'String' || type.instance === 'Mixed') out.push(full);
    else if (type.instance === 'Array' && inner && ['String', 'Mixed'].includes(inner.instance)) out.push(full);
    if (type.schema) out.push(...stringPaths(type.schema, `${full}.`));
  });
  return out;
}

/** The candidate filenames that some record references. Throws on lookup failure. */
async function referencedFilenames(filenames) {
  const found = new Set();
  const rx = new RegExp(filenames.map(escapeRegex).join('|'));
  for (const model of Object.values(mongoose.models)) {
    if (SKIP_MODELS.has(model.modelName)) continue;
    const paths = stringPaths(model.schema);
    if (!paths.length) continue;
    const docs = await model.collection
      .find({ $or: paths.map((p) => ({ [p]: { $regex: rx } })) })
      .limit(MAX_MATCHES_PER_MODEL + 1)
      .toArray();
    // Too many to inspect: treat every candidate as attached (never guess).
    if (docs.length > MAX_MATCHES_PER_MODEL) return new Set(filenames);
    for (const d of docs) {
      const text = JSON.stringify(d);
      for (const f of filenames) if (text.includes(f)) found.add(f);
    }
    if (found.size === filenames.length) break;
  }
  return found;
}

/** Delete unattached uploads older than ORPHAN_AGE_MS. Returns { checked, attached, deleted }. */
export async function sweepOrphanUploads({ now = Date.now() } = {}) {
  const cutoff = new Date(now - ORPHAN_AGE_MS);
  const candidates = await StoredFile.find({ uploadedBy: { $ne: null }, attachedAt: null, createdAt: { $lt: cutoff } })
    .select('_id filename')
    .sort({ createdAt: 1 })
    .limit(BATCH)
    .lean();
  if (!candidates.length) return { checked: 0, attached: 0, deleted: 0 };
  const referenced = await referencedFilenames(candidates.map((c) => c.filename));
  const attached = candidates.filter((c) => referenced.has(c.filename));
  const orphans = candidates.filter((c) => !referenced.has(c.filename));
  if (attached.length) await StoredFile.updateMany({ _id: { $in: attached.map((c) => c._id) } }, { $set: { attachedAt: new Date(now) } });
  const { deletedCount } = orphans.length
    ? await StoredFile.deleteMany({ _id: { $in: orphans.map((c) => c._id) }, attachedAt: null, createdAt: { $lt: cutoff } })
    : { deletedCount: 0 };
  return { checked: candidates.length, attached: attached.length, deleted: deletedCount };
}
