import { scrub } from '../../utils/securityLog.js';

/**
 * Redaction for everything the SOC stores or shows. Applied before a value is
 * written (error events, diagnostic evidence, incident notes) and is the only
 * way untrusted text (error messages, client reports, log lines) reaches the
 * dashboard.
 *
 * - Credential-looking KEYS are dropped by utils/securityLog.scrub (password,
 *   token, secret, cookie, authorization, otp, code…).
 * - Credential-looking VALUES inside free text are masked here: bearer tokens,
 *   JWTs, connection strings with passwords, API keys, e-mail addresses,
 *   phone numbers and OTP-like digits next to the word "otp"/"code".
 * - Control characters are removed so a message cannot forge extra log lines
 *   or terminal escapes (log injection). The UI renders text, never HTML.
 */
// A path segment of 24+ URL-safe characters mixing letters and digits.
export const TOKEN_SEGMENT = /(?<=\/)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g;

const PATTERNS = [
  // Connection strings: keep scheme + host, drop the credentials.
  [/\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|https?):\/\/[^\s/@:]+:[^\s/@]+@/gi, '$1://[redacted]@'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]'],
  // JSON Web Tokens (three base64url segments, the first starting "eyJ").
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-jwt]'],
  // Common API-key shapes (Groq gsk_, OpenAI sk-, AWS AKIA, generic long hex secrets).
  [/\b(gsk|sk|pk|rk)[-_][A-Za-z0-9]{12,}\b/g, '[redacted-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-key]'],
  [/\b(password|passwd|pwd|secret|token|api[-_]?key|otp)(\s*[=:]\s*)("?)[^\s"',;&]+/gi, '$1$2$3[redacted]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // Phone numbers: 10+ digits with optional + and separators.
  [/(?<![\w.])\+?\d[\d\s-]{8,}\d(?![\w.])/g, '[number]'],
  // High-entropy path segments (alumni-claim / invite / reset tokens such as
  // 64 hex characters, long base64url secrets) become ":token". 24-hex object
  // ids are turned into ":id" by routeTemplate before this runs.
  [TOKEN_SEGMENT, ':token'],
  // The same secrets outside a path: long runs of hex.
  [/\b[a-f0-9]{32,}\b/gi, '[redacted-token]'],
];

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u001B]/g;

/** Mask secrets and personal data inside free text; trim to `max` characters. */
export function redactText(value, max = 500) {
  if (value === undefined || value === null) return undefined;
  let s = String(value).replace(CONTROL, '');
  for (const [re, sub] of PATTERNS) s = s.replace(re, sub);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** A single line: newlines collapsed too (titles, messages, routes). */
export const redactLine = (value, max = 300) => {
  const s = redactText(value, max * 2);
  return s === undefined ? undefined : s.replace(/[\r\n\t]+/g, ' ').slice(0, max);
};

/** Structured evidence: drop credential keys, then mask every string value. */
export function redactObject(value, depth = 0) {
  const clean = depth === 0 ? scrub(value) : value;
  if (clean == null || depth > 4) return undefined;
  if (Array.isArray(clean)) return clean.slice(0, 25).map((v) => redactObject(v, depth + 1));
  if (clean instanceof Date) return clean;
  if (typeof clean === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(clean).slice(0, 40)) {
      const r = redactObject(v, depth + 1);
      if (r !== undefined) out[redactLine(k, 60)] = r;
    }
    return out;
  }
  if (typeof clean === 'string') return redactText(clean, 300);
  if (typeof clean === 'number' || typeof clean === 'boolean') return clean;
  return undefined;
}

/**
 * A stack trace with only file names and line numbers kept: absolute paths
 * (which name the server's directory layout and user) are cut down to the
 * part below the project, and at most `frames` frames are kept.
 */
export function redactStack(stack, frames = 8) {
  if (!stack) return undefined;
  const lines = String(stack).split('\n').slice(1, frames + 1);
  return lines
    .map((l) => redactLine(l.trim().replace(/\(?(?:[A-Za-z]:)?[^\s()]*?[\\/](server|client|src|node_modules)[\\/]/g, '($1/').replace(/\\/g, '/'), 200))
    .filter(Boolean)
    .join('\n');
}

const OBJECT_ID = /\b[a-f0-9]{24}\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const NUMBER_SEGMENT = /\/\d+(?=\/|$)/g;

/** Turn a concrete path into a template: ids and numbers become :id, no query string. */
export function routeTemplate(path = '') {
  return redactLine(String(path).split('?')[0].replace(OBJECT_ID, ':id').replace(UUID, ':id').replace(NUMBER_SEGMENT, '/:n'), 160) || '/';
}

/**
 * The "shape" of a message for grouping: ids, numbers and quoted values are
 * replaced so "User 64f… not found" and "User 650… not found" are one error.
 */
export function messageShape(message = '') {
  return String(message)
    .replace(OBJECT_ID, '<id>')
    .replace(UUID, '<id>')
    .replace(/"[^"]*"|'[^']*'/g, '<v>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}
