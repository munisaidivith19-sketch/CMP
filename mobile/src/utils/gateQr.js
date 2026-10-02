// Pure gate-pass QR helpers (no React Native imports, so they can be unit-tested with node).

export const GATE_QR_PREFIX = { exit: 'CCGP:', return: 'CCRT:' };

/**
 * Early, UX-only check that a scanned value is a Vexon gate-pass QR meant for
 * this screen. It can only reject — anything that passes still goes to the
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

/**
 * Wraps a scan callback so it fires exactly once until re-armed: the camera
 * reports the same QR on many consecutive frames, and each must not become
 * another backend request.
 */
export function createScanGate(onScan) {
  let fired = false;
  return {
    handle(event) {
      if (fired || !event?.data) return false;
      fired = true;
      onScan(String(event.data));
      return true;
    },
    reset() {
      fired = false;
    },
    get fired() {
      return fired;
    },
  };
}
