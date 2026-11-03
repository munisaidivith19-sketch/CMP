// The password rule (mirrors server/src/utils/passwordPolicy.js, which is the real check).

export const PASSWORD_HINT = '8–72 characters with a capital letter, a small letter, a number and a symbol.';

/** The first rule this password breaks, or null. */
export function passwordProblem(v) {
  const p = String(v ?? '');
  if (p.length < 8) return 'At least 8 characters';
  if (p.length > 72) return 'At most 72 characters';
  if (!/[A-Z]/.test(p)) return 'Include a capital letter';
  if (!/[a-z]/.test(p)) return 'Include a small letter';
  if (!/\d/.test(p)) return 'Include a number';
  if (!/[^A-Za-z0-9\s]/.test(p)) return 'Include a symbol';
  return null;
}

/** A random password that meets the rule, without look-alike characters. */
export function suggestPassword() {
  const pick = (n, set) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]);
  const chars = [...pick(3, 'ABCDEFGHJKLMNPQRSTUVWXYZ'), ...pick(4, 'abcdefghijkmnpqrstuvwxyz'), ...pick(2, '23456789'), ...pick(1, '@#$%&*!?')];
  const order = crypto.getRandomValues(new Uint32Array(chars.length));
  return chars.map((c, i) => [order[i], c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c).join('');
}
