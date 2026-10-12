#!/usr/bin/env node
/**
 * Fails (exit 1) if the built web bundle contains anything that looks like a
 * server secret, or a source map. Run after `npm run build`:
 *
 *   npm run verify:bundle            # scans client/dist
 *   node scripts/verify-bundle.mjs <dir>
 *
 * Matches are reported by file and rule name only; the matched text is
 * truncated so the scan output itself never re-publishes a secret.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(ROOT, 'client', 'dist'));

// Note: a bare /SECRET/ would flag React's own internal symbol
// (__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED), so secrets are
// matched by their env-var names and by known key formats instead.
const RULES = [
  ['Groq API key', /gsk_[A-Za-z0-9]{10,}/],
  ['MongoDB connection string', /mongodb(?:\+srv)?:\/\/[^\s"'`]+/],
  ['SMS_API_KEY name', /SMS_API_KEY/],
  ['GROQ env var', /GROQ_[A-Z_]*(?:KEY|SECRET|TOKEN)/],
  ['JWT secret env var', /JWT_[A-Z_]*(?:SECRET|KEY)/],
  ['*_SECRET env var', /(?<![A-Za-z0-9_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_SECRET(?![A-Za-z0-9])/],
  ['SECRET assignment', /(?<![A-Za-z0-9_])[A-Za-z_]*SECRET[A-Za-z_]*\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/],
  ['SMTP / mail password env var', /SMTP_PASS(?:WORD)?/],
  ['Cloudinary API secret', /CLOUDINARY_API_SECRET|cloudinary:\/\/\d+:[^@\s]+@/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['OpenAI / Anthropic style key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['API key assignment', /api[_-]?key["']?\s*[:=]\s*["'`][A-Za-z0-9_-]{16,}["'`]/i],
];

/** Real secret values from server/.env (if present) must not appear either. */
function localSecretValues() {
  const file = path.join(ROOT, 'server', '.env');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line))
    .filter((m) => m && /SECRET|KEY|PASS|TOKEN|MONGO_URI/.test(m[1]) && m[2].trim().length >= 12)
    .map((m) => ({ name: m[1], value: m[2].trim() }));
}

function* walk(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const TEXT = /\.(?:js|mjs|cjs|css|html|json|txt|svg|webmanifest|map)$/i;

if (!fs.existsSync(dir)) {
  console.error(`[verify:bundle] ${dir} does not exist — run the client build first.`);
  process.exit(2);
}

const values = localSecretValues();
const problems = [];
let scanned = 0;
for (const file of walk(dir)) {
  const rel = path.relative(dir, file);
  if (/\.map$/i.test(file)) problems.push(`${rel}: source map in the bundle`);
  if (!TEXT.test(file)) continue;
  scanned += 1;
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, re] of RULES) {
    const m = re.exec(text);
    if (m) problems.push(`${rel}: ${name} (${m[0].slice(0, 12)}…)`);
  }
  for (const { name, value } of values) {
    if (text.includes(value)) problems.push(`${rel}: the value of server/.env ${name}`);
  }
}

if (problems.length) {
  console.error(`[verify:bundle] FAILED — ${problems.length} problem(s) in ${dir}:`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(`[verify:bundle] OK — ${scanned} file(s) scanned in ${dir}, no secrets or source maps found.`);
