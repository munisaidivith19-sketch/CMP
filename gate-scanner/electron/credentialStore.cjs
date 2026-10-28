'use strict';
// The signed-in guard's refresh token, kept between restarts.
//
// Encrypted with Electron safeStorage, which on Windows is DPAPI bound to the
// Windows user account: the file is unreadable to anyone else (and on another
// PC). It lives in its own file in the app's data folder, apart from the
// browser cache, so clearing cache never signs the guard out; deleting this
// file (or revoking the session on the server) always does.
//
// Never stored: the password, or the short-lived access token (memory only).
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'credentials.dat';

/**
 * @param {string} dir   folder for the file (app.getPath('userData'))
 * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }} safeStorage
 */
function createCredentialStore(dir, safeStorage) {
  const file = path.join(dir, FILE);

  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  return {
    /** True when the OS can encrypt; without it nothing is persisted (sign-in lasts until the app closes). */
    available,

    load() {
      if (!available()) return null;
      let raw;
      try {
        raw = fs.readFileSync(file);
      } catch {
        return null;
      }
      try {
        const data = JSON.parse(safeStorage.decryptString(raw));
        return typeof data?.refreshToken === 'string' && data.refreshToken ? data : null;
      } catch {
        // Unreadable (another Windows user, another PC, corrupted): discard it.
        this.clear();
        return null;
      }
    },

    save({ refreshToken, guardName }) {
      if (!available() || typeof refreshToken !== 'string' || !refreshToken) return false;
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify({ refreshToken, guardName: guardName || null, savedAt: new Date().toISOString() })));
      fs.renameSync(tmp, file); // atomic: a crash never leaves half a token
      return true;
    },

    clear() {
      for (const f of [file, `${file}.tmp`]) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* already gone */
        }
      }
    },

    exists: () => fs.existsSync(file),
  };
}

module.exports = { createCredentialStore, CREDENTIAL_FILE: FILE };
