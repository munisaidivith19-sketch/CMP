import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANARY } from './prompt.js';
import { looksSexual } from './scopeGuard.js';

/**
 * Output guard for the self-hosted model.
 *
 * The model has no tools and no database connection, so it can never really
 * "enter" the database. If its answer nevertheless contains anything that
 * only the server knows — the hidden prompt's canary, a real secret from
 * .env, the real database host, this server's folder paths — or it starts
 * emitting tool / function calls, something is badly wrong (a prompt leak or
 * a tampered model). That is a TRIPWIRE: the answer is thrown away and AI
 * Doubts is switched off for everyone until someone runs `npm run ai:resume`
 * on the server.
 *
 * Teaching content never trips it: "mongodb://localhost:27017" or
 * "db.users.find()" in a DBMS answer are fine. Only the platform's REAL
 * values count, and only when they did not come from the student's own
 * question (so a student can't switch AI off by pasting text to echo back).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET_NAME = /(SECRET|KEY|TOKEN|PASSWORD|PASSWD|PASS|MONGO_URI|_URI|_DSN|ACCOUNT)$/i;
const PUBLIC_NAMES = new Set(['TURNSTILE_SITE_KEY']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function secretValues() {
  const out = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || PUBLIC_NAMES.has(name) || !SECRET_NAME.test(name)) continue;
    const v = String(value).trim();
    if (v.length >= 12 && !/^(true|false|\d+)$/i.test(v)) out.push(v);
  }
  return out;
}

function databaseHosts() {
  const hosts = new Set();
  for (const [name, value] of Object.entries(process.env)) {
    if (!/MONGO|DATABASE|DB_?URI|REDIS/i.test(name) || !value) continue;
    for (const m of String(value).matchAll(/@([^/?,\s]+)|:\/\/([^/@?,\s]+)(?=[/?]|$)/g)) {
      for (const h of String(m[1] || m[2]).split(',')) {
        const host = h.replace(/:\d+$/, '').toLowerCase();
        if (host.length >= 6 && !LOCAL_HOSTS.has(host)) hosts.add(host);
      }
    }
  }
  return [...hosts];
}

function serverPaths() {
  const root = path.resolve(here, '..', '..'); // project folder on this machine
  return [...new Set([root, root.replace(/\\/g, '/'), path.resolve(here, '..')])].filter((p) => p.length >= 8);
}

// Built once at start-up; values never leave the server.
let INDICATORS = null;
function indicators() {
  if (!INDICATORS) {
    INDICATORS = [
      { kind: 'canary', values: [CANARY] },
      { kind: 'secret', values: secretValues() },
      { kind: 'database_host', values: databaseHosts() },
      { kind: 'server_path', values: serverPaths() },
    ];
  }
  return INDICATORS;
}
/** Test hook: rebuild after changing process.env. */
export const resetIndicators = () => {
  INDICATORS = null;
};

// The model claiming to call tools / functions / run queries it doesn't have.
const TOOL_CALL = /<\s*\/?\s*(tool_call|tool_use|function_call|function_calls|invoke)\b|<\|?\s*(tool|python_tag|plugin)\s*\|?>|^\s*\{\s*"(name|tool|function)"\s*:\s*"[^"]+"\s*,\s*"(arguments|parameters|args)"\s*:/im;

/**
 * Inspect generated text. `inputs` are the student's own messages this turn
 * (a value they typed themselves is not proof of a leak).
 * @returns {{ tripwire: string|null, sexual: boolean }}
 */
export function inspectOutput(text, inputs = []) {
  const out = String(text || '');
  const lower = out.toLowerCase();
  const typed = inputs.join('\n').toLowerCase();
  for (const { kind, values } of indicators()) {
    for (const v of values) {
      const needle = v.toLowerCase();
      if (lower.includes(needle) && !typed.includes(needle)) return { tripwire: kind, sexual: false };
    }
  }
  if (TOOL_CALL.test(out) && !TOOL_CALL.test(inputs.join('\n'))) return { tripwire: 'tool_call', sexual: false };
  return { tripwire: null, sexual: looksSexual(out) };
}

/**
 * Streaming version: push(delta) returns a verdict as soon as the text so far
 * is unsafe, so generation can be cut off mid-answer.
 */
export function createOutputMonitor(inputs = []) {
  let text = '';
  let verdict = { tripwire: null, sexual: false };
  return {
    push(delta) {
      if (verdict.tripwire || verdict.sexual) return verdict;
      text += delta;
      // Check a window big enough to contain any indicator split across deltas.
      verdict = inspectOutput(text.slice(-800), inputs);
      return verdict;
    },
    get verdict() {
      return verdict;
    },
    get unsafe() {
      return Boolean(verdict.tripwire || verdict.sexual);
    },
  };
}

/**
 * Small models sometimes get stuck repeating one word or phrase (often when
 * asked to write in a language they barely know). push(delta) returns true
 * once that happens; cleanText is the answer up to where the loop started.
 */
export function createLoopDetector() {
  let text = '';
  let looped = false;
  let cleanText = '';
  return {
    push(delta) {
      if (looped) return true;
      text += delta;
      const tail = text.slice(-600);
      // The same word 6+ times in a row, or a short phrase repeated 5+ times back to back.
      const word = /(\S{1,40})(?:\s+\1){5,}\s*$/u.exec(tail);
      const phrase = /(.{4,60}?)\1{4,}$/su.exec(tail);
      const hit = word || phrase;
      if (hit) {
        looped = true;
        cleanText = text.slice(0, text.length - tail.length + hit.index).trim();
      }
      return looped;
    },
    get looped() {
      return looped;
    },
    get cleanText() {
      return cleanText;
    },
  };
}
