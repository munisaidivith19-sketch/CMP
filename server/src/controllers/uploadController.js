import { asyncHandler } from '../utils/http.js';
import { persistFile } from '../utils/storage.js';
import { logActivity } from '../utils/activity.js';
import { reserveUpload } from '../utils/uploadQuota.js';

/** POST /api/uploads?kind=image|document  (multipart field: "file") */
export const uploadFile = asyncHandler(async (req, res) => {
  const kind = req.query.kind === 'document' ? 'document' : 'image';
  // Per-user daily quota (count + bytes); a failed store gives the reservation back.
  const release = req.file ? await reserveUpload(req.user._id, req.file.size) : null;
  let file;
  try {
    file = await persistFile(req.file, kind, { owner: req.user._id });
  } catch (err) {
    if (release) await release();
    throw err;
  }
  logActivity(req, 'file.upload', { summary: `${file.name} (${file.mimeType})` });
  res.status(201).json(file);
});
