/**
 * Keyboard-emulation (HID "wedge") scanner input — USB or Bluetooth.
 *
 * Such a scanner is, to Windows, just a keyboard: it types the QR contents as
 * fast key presses and (usually) presses Enter. Nothing in the browser or OS
 * says "this keystroke came from the scanner", so the parser tells them apart
 * by timing: a scanner types a whole code with only a few milliseconds between
 * keys; a person typing is an order of magnitude slower. A burst only counts as
 * a scan when it is fast, long enough and ends with the configured terminator.
 *
 * Pure: the caller feeds key events (with a timestamp) and gets callbacks.
 */

export const MIN_SCAN_LENGTH = 6; // shorter than any gate credential ("CCGP:" + 4)
export const MAX_SCAN_LENGTH = 200;
// With no terminator configured, a burst is complete after this much silence.
export const IDLE_FLUSH_MS = 120;

const TERMINATOR_KEYS = { Enter: ['Enter'], Tab: ['Tab'], none: [] };

/**
 * @param {object} o
 * @param {(text: string, meta: {capsLock: boolean, durationMs: number}) => void} o.onScan
 * @param {(reason: string, meta: object) => void} [o.onIncomplete]  a fast burst that did not form a usable scan
 * @param {'Enter'|'Tab'|'none'} [o.terminator]
 * @param {number} [o.maxKeyGapMs]  slower keystrokes are a person typing
 */
export function createWedgeParser({ onScan, onIncomplete = () => {}, terminator = 'Enter', maxKeyGapMs = 60 }) {
  let buffer = '';
  let lastAt = 0;
  let firstAt = 0;
  let fastKeys = 0;
  let capsLock = false;
  let flushTimer = null;

  const reset = () => {
    buffer = '';
    fastKeys = 0;
    capsLock = false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  };

  // A burst is scanner-made when (nearly) every gap was within maxKeyGapMs.
  const isScannerBurst = () => buffer.length >= 2 && fastKeys >= buffer.length - 1;

  function complete(at) {
    const text = buffer;
    const burst = isScannerBurst();
    const meta = { capsLock, durationMs: Math.round(at - firstAt), length: text.length };
    reset();
    if (!text) return;
    if (!burst) return; // a person typing: never a gate event
    if (text.length < MIN_SCAN_LENGTH) return onIncomplete('too_short', meta);
    if (text.length > MAX_SCAN_LENGTH) return onIncomplete('too_long', meta);
    onScan(text, meta);
  }

  return {
    /**
     * Feed one keydown. Returns true when the key was taken as scanner input
     * (the caller should then preventDefault so it does not type anywhere).
     * @param {{ key: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean, capsLock?: boolean }} e
     * @param {number} at  timestamp in ms (performance.now())
     */
    handleKey(e, at) {
      if (e.ctrlKey || e.altKey || e.metaKey) {
        reset();
        return false;
      }
      if (TERMINATOR_KEYS[terminator]?.includes(e.key)) {
        if (!buffer) return false;
        const consumed = isScannerBurst();
        complete(at);
        return consumed;
      }
      if (typeof e.key !== 'string' || e.key.length !== 1) return false; // Shift, arrows, F-keys …
      const gap = buffer ? at - lastAt : 0;
      if (buffer && gap > maxKeyGapMs) {
        // Too slow to be the same scan: whatever was buffered was typing.
        if (terminator === 'none' && isScannerBurst()) complete(lastAt);
        else reset();
      }
      if (!buffer) firstAt = at;
      else fastKeys += 1;
      buffer += e.key;
      lastAt = at;
      if (e.capsLock) capsLock = true;
      if (terminator === 'none') {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => complete(lastAt), IDLE_FLUSH_MS);
      }
      // Only swallow the key once it is clearly part of a fast burst.
      return buffer.length > 1 && isScannerBurst();
    },
    /** A fast burst that never got its terminator (scanner set to a different suffix). */
    checkStalled(at) {
      if (buffer && terminator !== 'none' && at - lastAt > 500 && isScannerBurst() && buffer.length >= MIN_SCAN_LENGTH) {
        const meta = { capsLock, durationMs: Math.round(lastAt - firstAt), length: buffer.length };
        reset();
        onIncomplete('no_terminator', meta);
      }
    },
    reset,
  };
}

/** Event-target check: typing into a form field is never treated as a scan. */
export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}
