import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import PrivateFile from '../models/PrivateFile.js';

/**
 * Private object storage for Skill Wallet files (NPTEL certificates, project
 * images). Nothing here is reachable by URL: the public /uploads static route
 * serves UPLOAD_ROOT and StoredFile only, and this store uses neither.
 *
 *   disk — files under SKILL_WALLET_PRIVATE_DIR (default ./private-uploads),
 *          written to a temporary name and renamed, so a failed write never
 *          leaves a partial object behind;
 *   db   — PrivateFile documents (production default: the host disk is ephemeral).
 *
 * Keys are always server-generated (`sw/<uuid>.<ext>`); a user-supplied
 * filename never reaches the storage layer.
 */
export const PRIVATE_ROOT = path.resolve(process.cwd(), env.skillWallet.privateDir);
const KEY_RE = /^sw\/[0-9a-f-]{36}\.(webp|png|jpg)$/;

const diskPath = (key) => path.join(PRIVATE_ROOT, key.slice(3));
export const isValidKey = (key) => typeof key === 'string' && KEY_RE.test(key);
const backend = () => env.skillWallet.privateStorage;

/** Store bytes under a new generated key. Returns the key. */
export async function putPrivate(buffer, ext, mimeType) {
  if (!['webp', 'png', 'jpg'].includes(ext)) throw new Error('Unsupported private file extension');
  const key = `sw/${crypto.randomUUID()}.${ext}`;
  if (backend() === 'db') {
    await PrivateFile.create({ key, mimeType, data: buffer });
    return key;
  }
  await fs.mkdir(PRIVATE_ROOT, { recursive: true });
  const final = diskPath(key);
  const tmp = `${final}.${crypto.randomBytes(6).toString('hex')}.part`;
  try {
    await fs.writeFile(tmp, buffer, { mode: 0o600 });
    await fs.rename(tmp, final);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    await fs.rm(final, { force: true }).catch(() => {});
    throw err;
  }
  return key;
}

/** The stored bytes, or null. Callers must authorize first. */
export async function getPrivate(key) {
  if (!isValidKey(key)) return null;
  if (backend() === 'db') {
    const doc = await PrivateFile.findOne({ key }).lean();
    return doc ? Buffer.from(doc.data.buffer ? doc.data.buffer : doc.data) : null;
  }
  try {
    return await fs.readFile(diskPath(key));
  } catch {
    return null;
  }
}

/** Remove a stored object. Never throws. */
export async function removePrivate(key) {
  if (!isValidKey(key)) return;
  try {
    if (backend() === 'db') await PrivateFile.deleteOne({ key });
    else await fs.rm(diskPath(key), { force: true });
  } catch (err) {
    console.error('[private-storage] remove failed:', err.message);
  }
}

/** Leftover *.part files from an interrupted write (disk backend only). */
export async function sweepPartialWrites(olderThanMs = 60 * 60 * 1000) {
  if (backend() !== 'disk') return 0;
  let removed = 0;
  try {
    const names = await fs.readdir(PRIVATE_ROOT);
    await Promise.all(
      names
        .filter((n) => n.endsWith('.part'))
        .map(async (n) => {
          const p = path.join(PRIVATE_ROOT, n);
          const st = await fs.stat(p).catch(() => null);
          if (st && Date.now() - st.mtimeMs > olderThanMs) {
            await fs.rm(p, { force: true });
            removed += 1;
          }
        })
    );
  } catch {
    /* directory not created yet */
  }
  return removed;
}
