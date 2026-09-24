import { asyncHandler } from '../utils/http.js';
import { persistFile } from '../utils/storage.js';
import { logActivity } from '../utils/activity.js';

/** POST /api/uploads?kind=image|document  (multipart field: "file") */
export const uploadFile = asyncHandler(async (req, res) => {
  const kind = req.query.kind === 'document' ? 'document' : 'image';
  const file = await persistFile(req.file, kind);
  logActivity(req, 'file.upload', { summary: `${file.name} (${file.mimeType})` });
  res.status(201).json(file);
});
