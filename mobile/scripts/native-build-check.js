#!/usr/bin/env node
/**
 * Keeps the installed Android dev build in step with the JavaScript.
 *
 * Adding or upgrading a package with native code (e.g. expo-location) or
 * changing app.config.js plugins/permissions needs a new native build; reusing
 * the old APK fails at runtime with "Cannot find native module ...". This
 * compares Expo's native fingerprint with the one recorded at the last
 * successful native build.
 *
 *   node scripts/native-build-check.js check   exit 0 = build is current, 1 = rebuild needed
 *   node scripts/native-build-check.js record  save the current fingerprint (after a build)
 */
const fs = require('fs');
const path = require('path');
const { createFingerprintAsync, diffFingerprints } = require('@expo/fingerprint');

const root = path.resolve(__dirname, '..');
// Kept outside android/ (which expo prebuild rewrites); .expo/ is local and git-ignored.
const stampFile = path.join(root, '.expo', 'native-build-fingerprint.json');

async function main() {
  const mode = process.argv[2];
  const current = await createFingerprintAsync(root, { platforms: ['android'] });

  if (mode === 'record') {
    fs.mkdirSync(path.dirname(stampFile), { recursive: true });
    fs.writeFileSync(stampFile, JSON.stringify(current));
    console.log(`[native] Recorded native fingerprint ${current.hash.slice(0, 12)}`);
    return 0;
  }
  if (mode !== 'check') {
    console.error('Usage: node scripts/native-build-check.js check|record');
    return 2;
  }
  if (!fs.existsSync(stampFile)) {
    console.log('[native] No record of the last native build — a rebuild is needed.');
    return 1;
  }
  const previous = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  if (previous.hash === current.hash) {
    console.log('[native] Installed dev build matches the native dependencies.');
    return 0;
  }
  const changed = diffFingerprints(previous, current)
    .map((d) => d.addedSource || d.removedSource || d.afterSource || d.beforeSource)
    .map((s) => s?.filePath || s?.id)
    .filter(Boolean);
  console.log('[native] Native dependencies changed since the last build — a rebuild is needed:');
  [...new Set(changed)].slice(0, 15).forEach((f) => console.log(`  - ${f}`));
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[native] Could not compute the native fingerprint:', err.message);
    process.exit(1);
  }
);
