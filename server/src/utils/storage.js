import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../config/env.js';
import { ApiError } from './http.js';

export const UPLOAD_ROOT = path.resolve(process.cwd(), env.uploadDir);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// x-cfb = legacy .doc (OLE compound file); the OOXML .docx signature is detected
// by file-type as the full vnd.openxmlformats mimetype below.
const DOCUMENT_TYPES = [
  'application/pdf',
  'application/x-cfb',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Plain text has no magic bytes — the closest thing to signature-checking it
 * is confirming the buffer is actually text: no NUL bytes, valid UTF-8. */
function looksLikePlainText(buffer) {
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) return false;
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Files are held in memory first so the real type can be checked from the
 * file's magic bytes — the client-supplied MIME type / extension is never trusted.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1, fields: 5 },
});

const safeName = (name = 'file') =>
  path
    .basename(name)
    .replace(/[^\w.\- ]+/g, '')
    .slice(0, 100) || 'file';

let cloudinaryClient = null;
async function getCloudinary() {
  if (!cloudinaryClient) {
    const { v2 } = await import('cloudinary');
    v2.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
      secure: true,
    });
    cloudinaryClient = v2;
  }
  return cloudinaryClient;
}

/**
 * Validate and store an uploaded file.
 * @param {Express.Multer.File} file
 * @param {'image'|'document'} kind  'document' allows images and PDFs
 */
export async function persistFile(file, kind = 'image') {
  if (!file) throw new ApiError(400, 'No file uploaded');

  const detected = await fileTypeFromBuffer(file.buffer);
  const allowed = kind === 'document' ? [...IMAGE_TYPES, ...DOCUMENT_TYPES] : IMAGE_TYPES;
  const isPlainText = kind === 'document' && !detected && looksLikePlainText(file.buffer);
  if (!isPlainText && (!detected || !allowed.includes(detected.mime))) {
    throw new ApiError(
      415,
      kind === 'document'
        ? 'Only JPG, PNG, WEBP, GIF, PDF, DOC, DOCX or TXT files are allowed'
        : 'Only JPG, PNG, WEBP or GIF images are allowed'
    );
  }

  const mimeType = isPlainText ? 'text/plain' : detected.mime;
  const ext = isPlainText ? 'txt' : detected.ext;
  const meta = { name: safeName(file.originalname), mimeType, size: file.size };

  if (env.cloudinary.enabled) {
    const cloudinary = await getCloudinary();
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'campusconnect', resource_type: mimeType.startsWith('image/') ? 'image' : 'raw' },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return { ...meta, url: result.secure_url };
  }

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_ROOT, filename), file.buffer, { mode: 0o644 });
  return { ...meta, url: `/uploads/${filename}` };
}
