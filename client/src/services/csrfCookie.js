/**
 * Reads the double-submit CSRF token from a `document.cookie` string.
 *
 * Production issues __Host-cc_csrf; development issues cc_csrf. A browser
 * that signed in before the production rename can still hold a stale
 * cc_csrf beside the new __Host-cc_csrf, and document.cookie lists the older
 * one first — echoing it fails the server's check with 403. So the exact
 * __Host- name always wins, and the plain name is only a fallback.
 */
export function readCsrfToken(cookieString) {
  if (typeof cookieString !== 'string' || !cookieString) return null;
  const values = {};
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if ((name === '__Host-cc_csrf' || name === 'cc_csrf') && !(name in values)) {
      try {
        values[name] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        values[name] = part.slice(eq + 1).trim();
      }
    }
  }
  return values['__Host-cc_csrf'] || values.cc_csrf || null;
}

/** The server's message when a write's CSRF cookie/header pair is missing or stale. */
export const CSRF_REJECTION_MESSAGE = 'Invalid or expired CSRF token';

/**
 * True when an RTK Query error is the CSRF guard's 403. The browser's token
 * can go stale (cookie expired or cleared, rotated by a refresh in another
 * tab, a pre-rename legacy cookie); a refresh issues a fresh pair, so the
 * client refreshes once and replays the write instead of failing it.
 */
export function isCsrfRejection(error) {
  return error?.status === 403 && error?.data?.message === CSRF_REJECTION_MESSAGE;
}
