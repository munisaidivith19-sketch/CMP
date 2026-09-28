import fs from 'node:fs/promises';
import path from 'node:path';
import StudyMaterial from '../../models/StudyMaterial.js';
import StudyMaterialChunk from '../../models/StudyMaterialChunk.js';
import { UPLOAD_ROOT } from '../../utils/storage.js';

/**
 * RAG ingestion for the existing Study Materials module:
 *   file → text extraction (per PDF page) → cleanup → overlapping chunks
 *   (with material/subject/page metadata) → StudyMaterialChunk (Mongo text index).
 *
 * Files are read from the same storage the Study Materials module already
 * uses (local /uploads or Cloudinary) — no second copy is kept.
 */

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 200;
const MAX_PAGES = 400;
const MAX_CHUNKS = 1000;
const MAX_REMOTE_BYTES = 25 * 1024 * 1024;
// Only our own file storage is fetched — never an arbitrary URL (no SSRF).
const REMOTE_HOSTS = new Set(['res.cloudinary.com']);

const inFlight = new Map();

async function readFileBuffer(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/uploads/')) {
    const full = path.resolve(UPLOAD_ROOT, path.basename(url));
    if (!full.startsWith(UPLOAD_ROOT)) return null;
    try {
      return await fs.readFile(full);
    } catch {
      return null;
    }
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !REMOTE_HOSTS.has(parsed.hostname)) return null;
  const res = await fetch(parsed, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  if (Number(res.headers.get('content-length')) > MAX_REMOTE_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_REMOTE_BYTES ? null : buf;
}

export function cleanText(text = '') {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/-\n(?=[a-z])/g, '') // re-join hyphenated line breaks
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split text into ~CHUNK_CHARS pieces with overlap, preferring sentence/paragraph breaks. */
export function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const window = text.slice(start + Math.floor(size * 0.6), end);
      const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '));
      if (breakAt > 0) end = start + Math.floor(size * 0.6) + breakAt + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece.length >= 40) out.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

async function extractPages(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).slice(0, MAX_PAGES).map((t, i) => ({ page: i + 1, text: cleanText(t) }));
  }
  if (mimeType === 'text/plain') return [{ page: null, text: cleanText(buffer.toString('utf8')) }];
  return null; // images, .doc/.docx: no text extractor in this project yet
}

async function doIndex(materialId) {
  const material = await StudyMaterial.findById(materialId);
  if (!material || !material.isActive) return null;
  const { file } = material;

  let status = 'failed';
  let chunks = [];
  try {
    const mimeType = file?.mimeType || (/\.pdf$/i.test(file?.url || '') ? 'application/pdf' : /\.txt$/i.test(file?.url || '') ? 'text/plain' : '');
    if (!['application/pdf', 'text/plain'].includes(mimeType)) {
      status = 'unsupported';
    } else {
      const buffer = await readFileBuffer(file.url);
      const pages = buffer ? await extractPages(buffer, mimeType) : null;
      if (pages) {
        for (const { page, text } of pages) {
          for (const piece of chunkText(text)) {
            if (chunks.length >= MAX_CHUNKS) break;
            chunks.push({
              material: material._id,
              subject: material.subject,
              department: material.department,
              section: material.section || '',
              semester: material.semester,
              title: material.title,
              subjectName: material.subjectName,
              fileName: file.name,
              page,
              chunkIndex: chunks.length,
              text: piece.slice(0, 4000),
            });
          }
        }
        status = 'ready';
      }
    }
  } catch (err) {
    console.warn(`[ai] could not index study material ${material._id}: ${err?.name || 'error'}`);
    status = 'failed';
    chunks = [];
  }

  await StudyMaterialChunk.deleteMany({ material: material._id });
  if (chunks.length) await StudyMaterialChunk.insertMany(chunks, { ordered: false });
  material.aiIndex = { status, fileUrl: file?.url, chunkCount: chunks.length, indexedAt: new Date() };
  await material.save();
  return material.aiIndex;
}

/** Index (or re-index) one material. Concurrent calls for the same material share one run. */
export function indexMaterial(materialId) {
  const key = String(materialId);
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      doIndex(materialId)
        .catch((err) => {
          console.warn(`[ai] indexing failed for ${key}: ${err?.name || 'error'}`);
          return null;
        })
        .finally(() => inFlight.delete(key))
    );
  }
  return inFlight.get(key);
}

/** Fire-and-forget indexing after an upload/edit, so the request isn't slowed down. */
export function queueIndex(materialId) {
  if (process.env.NODE_ENV === 'test' && process.env.AI_INDEX_IN_TESTS !== 'true') return;
  setImmediate(() => indexMaterial(materialId));
}

/** Materials whose index is missing or stale (file replaced since indexing). */
export const needsIndex = (m) => !m.aiIndex || m.aiIndex.status === 'pending' || (m.aiIndex.fileUrl && m.aiIndex.fileUrl !== m.file?.url);

/** Drop a removed material's chunks from the index. */
export async function removeFromIndex(materialId) {
  await StudyMaterialChunk.deleteMany({ material: materialId });
}
