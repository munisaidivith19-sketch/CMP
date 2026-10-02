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
