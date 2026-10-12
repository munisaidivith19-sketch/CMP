/**
 * Generates the profiles directory PDF (it contains personal data).
 *
 *   node scripts/generateProfilesPdf.js [output.pdf]
 *
 * The file is written only to the path given on the command line, or to the
 * OS temp directory by default — never into the repository (a path inside it
 * is refused), so the PDF cannot end up committed. MONGO_URI selects the
 * database (default: the local development database).
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { generateProfilesPdfBuffer } from '../src/services/profilesPdfService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function resolveOutputPath(arg, tmpDir = os.tmpdir()) {
  const target = path.resolve(arg || path.join(tmpDir, `CampusConnect_Profiles_Directory_${Date.now()}.pdf`));
  const rel = path.relative(REPO_ROOT, target);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`Refusing to write the profiles PDF inside the repository (${target}). Choose a path outside it.`);
  }
  return target;
}

async function generate() {
  const target = resolveOutputPath(process.argv[2]);
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/campusconnect');
  try {
    const buffer = await generateProfilesPdfBuffer();
    writeFileSync(target, buffer, { mode: 0o600 });
    console.log('Saved to:', target, `(${buffer.length} bytes) — contains personal data; delete it when done.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generate().catch((err) => {
    console.error('Error generating PDF:', err.message);
    process.exit(1);
  });
}
