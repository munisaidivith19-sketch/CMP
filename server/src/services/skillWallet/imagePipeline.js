import crypto from 'node:crypto';
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/http.js';

/**
 * Skill Wallet image validation and re-encoding.
 *
 * Acceptance is decided by the file's own bytes, never by its name or the
 * browser's MIME type:
 *   1. the magic bytes must be PNG, JPEG or WebP (everything else — PDF, SVG,
 *      GIF, HEIC/HEIF, BMP, TIFF … — is refused before any decoder runs);
 *   2. sharp must agree on the format and decode the header, within the pixel
 *      and dimension limits (decompression-bomb guard: limitInputPixels);
 *   3. the image is fully decoded and re-encoded (failOn: 'error' rejects
 *      truncated or corrupted data), which also drops EXIF / XMP / ICC
 *      metadata (GPS location in phone photos, for example).
 *
 * NPTEL certificates are ALWAYS re-encoded to WebP (even WebP input) and the
 * output is decoded again to prove it is a real WebP image. Project images
 * keep their own format (the WebP rule is specific to certificates).
 *
 * Everything happens in memory — no temporary files are written.
 */

const SIG = {
  png: (b) => b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a,
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

/** 'png' | 'jpeg' | 'webp' | null — from the magic bytes only. */
export function sniffImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  for (const [fmt, test] of Object.entries(SIG)) if (test(buffer)) return fmt;
  return null;
}

export const isWebp = (buffer) => SIG.webp(buffer);

/** A rejection with a safe, user-facing message and a machine-readable code. */
export class ImageRejected extends ApiError {
  constructor(code, message, status = 422) {
    super(status, message, undefined, { code });
    this.code = code;
  }
}

const limits = () => ({
  maxPixels: env.skillWallet.maxImagePixels,
  maxDim: env.skillWallet.maxImageDimension,
  minDim: env.skillWallet.minImageDimension,
});

/** Shared checks: signature, header decode, format agreement, dimensions. */
async function inspect(buffer, maxBytes, { minDimOverride } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ImageRejected('EMPTY_FILE', 'Choose an image file to upload', 400);
  if (buffer.length > maxBytes) {
    throw new ImageRejected('FILE_TOO_LARGE', `The image is too large (max ${Math.round(maxBytes / 1048576)} MB)`, 413);
  }
  const format = sniffImageFormat(buffer);
  if (!format) throw new ImageRejected('UNSUPPORTED_FORMAT', 'Only PNG, JPEG or WebP images are accepted', 415);

  const { maxPixels, maxDim, minDim: defaultMin } = limits();
  const minDim = minDimOverride ?? defaultMin;
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error' }).metadata();
  } catch {
    throw new ImageRejected('CORRUPT_IMAGE', 'The image could not be read. It may be damaged — try exporting it again.');
  }
  // sharp reports 'jpeg' | 'png' | 'webp'; anything else means the signature lied.
  if (meta.format !== format) throw new ImageRejected('UNSUPPORTED_FORMAT', 'Only PNG, JPEG or WebP images are accepted', 415);
  if ((meta.pages || 1) > 1) throw new ImageRejected('ANIMATED_IMAGE', 'Animated images are not accepted — upload a still image');
  const { width = 0, height = 0 } = meta;
  if (!width || !height) throw new ImageRejected('CORRUPT_IMAGE', 'The image could not be read. It may be damaged — try exporting it again.');
  if (width > maxDim || height > maxDim || width * height > maxPixels) {
    throw new ImageRejected('IMAGE_TOO_LARGE', `The image dimensions are too large (max ${maxDim} × ${maxDim} pixels)`, 413);
  }
  if (width < minDim || height < minDim) {
    throw new ImageRejected('IMAGE_TOO_SMALL', `The image is too small (at least ${minDim} × ${minDim} pixels)`);
  }
  return { format, width, height };
}

const pipelineFor = (buffer) =>
  // rotate(): bake the EXIF orientation into the pixels before metadata is dropped.
  sharp(buffer, { limitInputPixels: limits().maxPixels, failOn: 'error' }).rotate();

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * NPTEL certificate: validate and convert to WebP. Returns the WebP bytes and
 * their facts. Throws ImageRejected (safe message) on any failure — the
 * original bytes are never returned or stored.
 */
export async function convertCertificateToWebp(buffer, { maxBytes = env.skillWallet.certMaxUploadMb * 1048576 } = {}) {
  const { format } = await inspect(buffer, maxBytes);
  let out;
  try {
    out = await pipelineFor(buffer).webp({ quality: env.skillWallet.webpQuality, effort: 4 }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted. It may be damaged — try exporting it again.');
  }
  // Prove the output is a real, decodable WebP image — not a renamed file.
  if (!isWebp(out.data)) throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted.');
  let check;
  try {
    check = await sharp(out.data, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted.');
  }
  if (check.format !== 'webp') throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted.');
  return {
    buffer: out.data,
    mimeType: 'image/webp',
    ext: 'webp',
    width: out.info.width,
    height: out.info.height,
    size: out.data.length,
    sha256: sha256(out.data),
    sourceFormat: format,
  };
}

/**
 * Profile photo: PNG / JPEG / WebP only (checked from the bytes), always
 * re-encoded to WebP, metadata stripped, shrunk to at most 1024 px. Throws
 * ImageRejected — the original bytes are never returned.
 */
export async function convertAvatarToWebp(buffer, { maxBytes = 10 * 1048576 } = {}) {
  await inspect(buffer, maxBytes, { minDimOverride: 1 });
  let out;
  try {
    out = await pipelineFor(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: env.skillWallet.webpQuality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted. It may be damaged — try another photo.');
  }
  if (!isWebp(out.data)) throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted.');
  try {
    const check = await sharp(out.data, { failOn: 'error' }).metadata();
    if (check.format !== 'webp') throw new Error('not webp');
  } catch {
    throw new ImageRejected('CONVERSION_FAILED', 'The image could not be converted.');
  }
  return { buffer: out.data, mimeType: 'image/webp', ext: 'webp', size: out.data.length };
}

const ENCODE = {
  png: { ext: 'png', mimeType: 'image/png', run: (p) => p.png({ compressionLevel: 9 }) },
  jpeg: { ext: 'jpg', mimeType: 'image/jpeg', run: (p) => p.jpeg({ quality: 85, mozjpeg: true }) },
  webp: { ext: 'webp', mimeType: 'image/webp', run: (p) => p.webp({ quality: 85 }) },
};

/**
 * Project image: same validation, re-encoded in its OWN format (PNG / JPEG /
 * WebP) so metadata is stripped and the bytes are known-good.
 */
export async function processProjectImage(buffer, { maxBytes = env.skillWallet.projectImageMaxUploadMb * 1048576 } = {}) {
  const { format } = await inspect(buffer, maxBytes);
  const enc = ENCODE[format];
  let out;
  try {
    out = await enc.run(pipelineFor(buffer)).toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageRejected('CONVERSION_FAILED', 'The image could not be processed. It may be damaged — try exporting it again.');
  }
  if (sniffImageFormat(out.data) !== format) throw new ImageRejected('CONVERSION_FAILED', 'The image could not be processed.');
  return {
    buffer: out.data,
    mimeType: enc.mimeType,
    ext: enc.ext,
    width: out.info.width,
    height: out.info.height,
    size: out.data.length,
    sha256: sha256(out.data),
    sourceFormat: format,
  };
}
