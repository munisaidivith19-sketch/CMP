/**
 * Minimal PNG decoder for embedding a logo in a PDF without a new dependency.
 * Handles 8-bit, non-interlaced greyscale / RGB / (grey|RGB)+alpha PNGs and
 * returns the raw samples split into colour and alpha planes, which is what a
 * PDF image XObject (with an /SMask for transparency) needs.
 */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** @returns {{ width, height, colorSpace: 'DeviceGray'|'DeviceRGB', color: Buffer, alpha: Buffer|null }} */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');

  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  for (let pos = 8; pos + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('Only 8-bit PNGs are supported');
      colorType = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (!channels || !width || !height) throw new Error('Unsupported PNG colour type');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('Truncated PNG data');

  // Undo the per-scanline filters.
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? px[dst + i - channels] : 0;
      const up = y ? px[dst - stride + i] : 0;
      const upLeft = y && i >= channels ? px[dst - stride + i - channels] : 0;
      const x = raw[src + i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + left;
      else if (filter === 2) v = x + up;
      else if (filter === 3) v = x + ((left + up) >> 1);
      else if (filter === 4) v = x + paeth(left, up, upLeft);
      else throw new Error('Bad PNG filter');
      px[dst + i] = v & 0xff;
    }
  }

  const hasAlpha = colorType === 4 || colorType === 6;
  const colorChannels = hasAlpha ? channels - 1 : channels;
  if (!hasAlpha) {
    return { width, height, colorSpace: colorChannels === 1 ? 'DeviceGray' : 'DeviceRGB', color: px, alpha: null };
  }
  const count = width * height;
  const color = Buffer.alloc(count * colorChannels);
  const alpha = Buffer.alloc(count);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < colorChannels; c++) color[i * colorChannels + c] = px[i * channels + c];
    alpha[i] = px[i * channels + colorChannels];
  }
  return { width, height, colorSpace: colorChannels === 1 ? 'DeviceGray' : 'DeviceRGB', color, alpha };
}
