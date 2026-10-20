import UploadQuota from '../models/UploadQuota.js';
import { env } from '../config/env.js';
import { ApiError } from './http.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (now = new Date()) => now.toISOString().slice(0, 10);

export const uploadQuotaLimits = () => ({ files: env.uploadDailyMaxFiles, bytes: env.uploadDailyMaxMb * 1024 * 1024 });

/**
 * Reserve one upload of `bytes` for `userId` today, atomically: the counter is
 * only incremented when both the file count and the byte total stay within the
 * daily limits. Throws 429 when they would not. Returns a release function
 * that gives the reservation back (call it when storing the file failed).
 */
export async function reserveUpload(userId, bytes) {
  const { files, bytes: maxBytes } = uploadQuotaLimits();
  const size = Math.max(0, Number(bytes) || 0);
  const day = dayKey();
  const refuse = () => new ApiError(429, `Daily upload limit reached (${files} files / ${env.uploadDailyMaxMb} MB per day). Try again tomorrow.`, undefined, { code: 'UPLOAD_QUOTA' });
  if (size > maxBytes) throw refuse();
  try {
    const row = await UploadQuota.findOneAndUpdate(
      { user: userId, day, count: { $lt: files }, bytes: { $lte: maxBytes - size } },
      { $inc: { count: 1, bytes: size }, $setOnInsert: { expiresAt: new Date(Date.now() + 2 * DAY_MS) } },
      { upsert: true, new: true, lean: true }
    );
    if (!row) throw refuse();
  } catch (err) {
    // The row exists but the condition failed: the upsert collides with the unique index.
    if (err?.code === 11000) throw refuse();
    throw err;
  }
  return () => UploadQuota.updateOne({ user: userId, day }, { $inc: { count: -1, bytes: -size } }).catch(() => {});
}
