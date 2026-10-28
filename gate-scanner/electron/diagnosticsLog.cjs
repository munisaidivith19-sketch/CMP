'use strict';
// A small, sanitised diagnostics trail for troubleshooting a gate PC: what
// happened and when (connection, sign-in, scan outcome codes), never what was
// scanned or any credential. In memory (for the Diagnostics screen) and in a
// size-capped file under the app's data folder.
const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 300;
const MAX_FILE_BYTES = 1024 * 1024;
const SECRET_KEY = /token|password|secret|payload|authorization|cookie|credential|code$/i;
// Stable machine codes (EXIT_RECORDED, GATE_SCANNER_ROLE_REQUIRED …) are allowed through.
const ALLOWED_CODE_KEYS = new Set(['code']);

function sanitise(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry || {})) {
    if (SECRET_KEY.test(k) && !(ALLOWED_CODE_KEYS.has(k) && /^[A-Z_]{2,40}$/.test(String(v)))) continue;
    if (v === null || ['number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.replace(/[\r\n\t]/g, ' ').slice(0, 120);
  }
  return out;
}

function createDiagnosticsLog(dir) {
  const entries = [];
  const file = path.join(dir, 'logs', 'gate-scanner.log');

  function write(line) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        if (fs.statSync(file).size > MAX_FILE_BYTES) fs.renameSync(file, `${file}.1`);
      } catch {
        /* no file yet */
      }
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      /* diagnostics must never break the app */
    }
  }

  return {
    record(entry) {
      const e = { at: new Date().toISOString(), ...sanitise(entry) };
      entries.push(e);
      if (entries.length > MAX_ENTRIES) entries.shift();
      write(JSON.stringify(e));
      return e;
    },
    recent: (n = 100) => entries.slice(-n),
    file,
  };
}

module.exports = { createDiagnosticsLog, sanitise };
