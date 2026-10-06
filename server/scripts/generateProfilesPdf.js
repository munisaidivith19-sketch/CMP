import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { generateProfilesPdfBuffer } from '../src/services/profilesPdfService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CLIENT_PUBLIC_DIR = path.resolve(ROOT_DIR, 'client', 'public');
const ARTIFACT_DIR = path.resolve('C:\\Users\\GAUTHAM P\\.gemini\\antigravity\\brain\\06621f1c-9342-4327-a188-b135f7f803d3');

async function generate() {
  await mongoose.connect('mongodb://localhost:27017/campusconnect');

  const buffer = await generateProfilesPdfBuffer();

  const rootTarget = path.join(ROOT_DIR, 'CampusConnect_Profiles_Directory.pdf');

  writeFileSync(rootTarget, buffer);
  console.log('Saved to:', rootTarget);

  try {
    const artifactTarget = path.join(ARTIFACT_DIR, 'CampusConnect_Profiles_Directory.pdf');
    writeFileSync(artifactTarget, buffer);
    console.log('Saved to artifact:', artifactTarget);
  } catch (err) {
    console.warn('Could not save to artifact dir:', err.message);
  }

  await mongoose.disconnect();
  console.log('PDF generation complete. Size:', buffer.length, 'bytes');
}

generate().catch((err) => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
