/**
 * Skill Wallet test helpers: real image bytes (built with sharp), hostile
 * inputs, a multipart upload helper and a private-storage temp directory.
 *
 * Import this BEFORE helpers.js (it sets SKILL_WALLET_PRIVATE_DIR so test
 * files never land in the development private-uploads folder).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const PRIVATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-private-'));
process.env.SKILL_WALLET_PRIVATE_DIR = PRIVATE_DIR;
process.env.SKILL_WALLET_PRIVATE_STORAGE = 'disk';
// One test user performs many writes in a few seconds; production keeps the default.
process.env.SKILL_WALLET_WRITE_LIMIT ||= '1000';
process.env.SKILL_WALLET_INVITE_LIMIT ||= '1000';

const { default: sharp } = await import('sharp');
export { sharp };

const base = (w = 320, h = 240) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 90, b: 160 } } });

export const images = {
  png: () => base().png().toBuffer(),
  jpeg: () => base().jpeg({ quality: 80 }).toBuffer(),
  // A JPEG carrying EXIF metadata (camera make) that must be stripped.
  jpegWithExif: () => base().jpeg().withMetadata({ exif: { IFD0: { Make: 'TestCam', Model: 'SecretModel' } } }).toBuffer(),
  webp: () => base().webp().toBuffer(),
  gif: () => base().gif().toBuffer(),
  tiff: () => base().tiff().toBuffer(),
  small: () => base(20, 20).png().toBuffer(),
  wide: () => base(9000, 50).png().toBuffer(),
};

export const hostile = {
  pdf: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><script>alert(1)</script></svg>'),
  // ISO-BMFF "ftyp" box with the HEIC brand.
  heic: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]),
  bmp: Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)]),
  text: Buffer.from('just some text pretending to be an image'),
};

/** A PNG whose header claims huge dimensions (decompression-bomb shape), CRC fixed. */
export async function bombPng(width = 30000, height = 30000) {
  const png = Buffer.from(await images.png());
  // IHDR data starts at byte 16 (8 signature + 4 length + 4 type).
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  const crc = zlib.crc32(png.subarray(12, 29));
  png.writeUInt32BE(crc >>> 0, 29);
  return png;
}

export async function truncatedJpeg() {
  const j = await images.jpeg();
  return j.subarray(0, Math.floor(j.length / 2));
}

/** Multipart request (fields + optional file). Returns { status, body }. */
export async function multipart(ctx, method, urlPath, { token, fields = {}, file, filename = 'upload.png', type = 'image/png' } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  if (file) fd.append('file', new Blob([file], { type }), filename);
  const res = await fetch(`${ctx.base}/api${urlPath}`, {
    method,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: fd,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Fetch a signed file URL (as returned by the API). */
export async function fetchFile(ctx, url) {
  const res = await fetch(`${ctx.base}${url}`);
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Files currently in the private storage directory (excluding none). */
export const storedFiles = () => (fs.existsSync(PRIVATE_DIR) ? fs.readdirSync(PRIVATE_DIR) : []);

export const isWebpBytes = (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';

export const day = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
