/**
 * Local, UX-only reading of a scanned value: which kind of credential it looks
 * like, a de-duplication key and a masked label. It never decides validity —
 * the server does — and the label never shows the whole credential.
 */
import { GATE_QR_PREFIX } from '../../../client/src/utils/gateQr.js';

export { GATE_QR_PREFIX };

/** FNV-1a: a short de-duplication key, so the credential itself is not kept in the scan list. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function describePayload(raw, { kind } = {}) {
  const value = String(raw ?? '').trim();
  const upper = value.toUpperCase();
  if (upper.startsWith(GATE_QR_PREFIX.exit)) {
    const code = upper.slice(GATE_QR_PREFIX.exit.length).replace(/[\s-]/g, '');
    return { direction: 'out', key: `X:${fingerprint(code)}`, label: 'Exit QR', caseSensitive: false };
  }
  if (upper.startsWith(GATE_QR_PREFIX.return)) {
    const token = value.slice(GATE_QR_PREFIX.return.length);
    return { direction: 'in', key: `RT:${fingerprint(token)}`, label: 'Return QR', caseSensitive: true };
  }
  if (kind === 'out' || kind === 'in') {
    return { direction: kind, key: `${kind === 'out' ? 'X' : 'RC'}:${fingerprint(upper.replace(/[\s-]/g, ''))}`, label: kind === 'out' ? 'Exit code (typed)' : 'Return code (typed)', caseSensitive: false };
  }
  return { direction: null, key: `?:${fingerprint(value)}`, label: 'Not a gate pass QR', caseSensitive: false };
}
