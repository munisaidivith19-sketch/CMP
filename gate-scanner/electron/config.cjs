'use strict';
// Where the Gate Scanner sends its requests, and the gate PC's own settings.
//
// API base URL, in order:
//   1. Development only (not packaged): GATE_SCANNER_API_URL.
//   2. Machine-wide override written by an administrator at install time:
//      %ProgramData%\JNN Gate Scanner\config.json  { "apiBaseUrl": "https://…" }
//      (ProgramData is writable by administrators only, so a guard cannot
//      point the app — and its sign-in — at another server.)
//   3. package.json → gateScanner.productionApiUrl (the production server).
// A packaged build accepts https:// URLs only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pkg = require('../package.json');

const MACHINE_CONFIG = path.join(process.env.ProgramData || 'C:\\ProgramData', 'JNN Gate Scanner', 'config.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Normalise a base URL: origin only (no path, query or credentials). Throws when unusable. */
function normaliseBaseUrl(raw, { packaged }) {
  const url = new URL(String(raw || '').trim());
  if (url.username || url.password) throw new Error('The server URL must not contain credentials');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !packaged)) {
    throw new Error('The server URL must use https://');
  }
  return url.origin;
}

function resolveApiBaseUrl({ packaged, env = process.env, machineConfig = readJson(MACHINE_CONFIG) } = {}) {
  if (!packaged && env.GATE_SCANNER_API_URL) return { url: normaliseBaseUrl(env.GATE_SCANNER_API_URL, { packaged }), source: 'development' };
  if (machineConfig?.apiBaseUrl) return { url: normaliseBaseUrl(machineConfig.apiBaseUrl, { packaged }), source: 'machine' };
  return { url: normaliseBaseUrl(pkg.gateScanner.productionApiUrl, { packaged }), source: 'built-in' };
}

/** A label safe to send in a header (letters, digits, spaces and a few symbols). */
const safeLabel = (v, fallback = '') => String(v || '').replace(/[^\w .#\-()]/g, '').trim().slice(0, 60) || fallback;

const DEFAULT_SETTINGS = {
  gateName: '',
  scannerMode: 'hid', // 'hid' (USB / Bluetooth keyboard emulation) | 'serial' (USB virtual COM)
  terminator: 'Enter', // what the scanner sends after a code: 'Enter' | 'Tab' | 'none'
  maxKeyGapMs: 60, // keystrokes further apart than this are a person typing, not the scanner
  serialBaudRate: 9600,
  serialPortHint: null, // { usbVendorId, usbProductId } of the last port chosen
  alwaysOnTop: false,
};

const LIMITS = { maxKeyGapMs: [15, 250], serialBaudRate: [1200, 921600] };

/** Validate settings from disk or the renderer; unknown keys are dropped. */
function sanitiseSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof input.gateName === 'string') out.gateName = safeLabel(input.gateName);
  if (['hid', 'serial'].includes(input.scannerMode)) out.scannerMode = input.scannerMode;
  if (['Enter', 'Tab', 'none'].includes(input.terminator)) out.terminator = input.terminator;
  for (const key of ['maxKeyGapMs', 'serialBaudRate']) {
    const n = Number(input[key]);
    if (Number.isFinite(n) && n >= LIMITS[key][0] && n <= LIMITS[key][1]) out[key] = Math.round(n);
  }
  if (input.serialPortHint && Number.isInteger(input.serialPortHint.usbVendorId) && Number.isInteger(input.serialPortHint.usbProductId)) {
    out.serialPortHint = { usbVendorId: input.serialPortHint.usbVendorId, usbProductId: input.serialPortHint.usbProductId };
  }
  out.alwaysOnTop = input.alwaysOnTop === true;
  return out;
}

function createSettingsStore(dir) {
  const file = path.join(dir, 'settings.json');
  let current = sanitiseSettings(readJson(file) || {});
  return {
    get: () => ({ ...current }),
    set(patch) {
      current = sanitiseSettings({ ...current, ...patch });
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
      fs.renameSync(tmp, file);
      return { ...current };
    },
  };
}

const deviceName = () => safeLabel(os.hostname(), 'Gate PC');

module.exports = { MACHINE_CONFIG, DEFAULT_SETTINGS, createSettingsStore, deviceName, normaliseBaseUrl, resolveApiBaseUrl, safeLabel, sanitiseSettings };
