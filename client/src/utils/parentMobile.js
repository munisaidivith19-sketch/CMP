/**
 * Parent-OTP number checks for the faculty's "Send OTP to" field — the same
 * rules as the server's otpService.normalizeIndianMobile. UX only: the server
 * validates again and decides.
 */
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);

/** True when `typed` is a different number from `registered` (formatting ignored). */
export const mobileDiffers = (typed, registered) => last10(typed) !== last10(registered);

/** A 10-digit Indian mobile, optionally written with +91 / 0 / spaces / dashes. */
export function isValidIndianMobile(typed) {
  if (typeof typed !== 'string') return false;
  let d = typed.replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(d)) return false;
  d = d.replace(/^\+/, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
}
