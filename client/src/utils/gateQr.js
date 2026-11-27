// Gate-pass QR helpers shared by the web Security screens.

export const GATE_QR_PREFIX = { exit: 'CCGP:', return: 'CCRT:' };

/**
 * Early, UX-only check that a scanned value is a Vexon gate-pass QR for this
 * screen. It can only reject — anything that passes still goes to the
 * backend, which alone decides whether the credential is valid.
 */
export function scanProblem(value, expected) {
  const v = String(value || '').trim().toUpperCase();
  const isExit = v.startsWith(GATE_QR_PREFIX.exit);
  const isReturn = v.startsWith(GATE_QR_PREFIX.return);
  if (!isExit && !isReturn) return 'Invalid Gate Pass QR code.';
  if (expected === 'exit' && isReturn) return 'This is a return QR. Use Return verification to record the student coming back.';
  if (expected === 'return' && isExit) return 'This is an exit QR. Use the OUT screen to record the student leaving.';
  return null;
}

/** Fires onScan once until re-armed, however many frames show the same QR. */
export function createScanGate(onScan) {
  let fired = false;
  return {
    handle(value) {
      if (fired || !value) return false;
      fired = true;
      onScan(String(value));
      return true;
    },
    reset() {
      fired = false;
    },
  };
}

/**
 * True once a typed code is a complete 4-character gate code (letters + at
 * least one digit and one letter) — the screens auto-verify at that point.
 * Mirrors GATE_CODE_PATTERN on the server, which still makes the decision.
 */
export const isCompleteGateCode = (value) => /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4}$/.test(String(value || '').trim().toUpperCase());

/**
 * Fast (supermarket-style) scanning: fires for every NEW value straight away,
 * while the same QR held in front of the camera is ignored until it has been
 * out of view for `windowMs` — so one student is sent once, and the next
 * student can be scanned immediately after.
 */
export function createRepeatGate(onScan, { windowMs = 3000, now = () => Date.now() } = {}) {
  const lastSeen = new Map(); // value → last time it was in a frame
  return {
    handle(value) {
      if (!value) return false;
      const v = String(value);
      const t = now();
      const seen = lastSeen.get(v);
      lastSeen.set(v, t);
      for (const [k, at] of lastSeen) if (t - at > windowMs * 4) lastSeen.delete(k);
      if (seen !== undefined && t - seen < windowMs) return false;
      onScan(v);
      return true;
    },
    reset() {
      lastSeen.clear();
    },
  };
}

/** A fresh scan id for POST /gate-scanner/scans (the server processes each id once). */
export function newScanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
