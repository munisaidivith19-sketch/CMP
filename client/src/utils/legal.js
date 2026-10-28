/**
 * Terms / Privacy Policy helpers shared by the routes, the acceptance screen
 * and the profile. Free of React so they run under node --test. The server
 * decides whether the Terms must be accepted (user.legal / a 403 with
 * TERMS_ACCEPTANCE_REQUIRED); nothing here is a security boundary.
 */

export const APP_NAME = 'J.N.N Campus Connect';
export const INSTITUTION = 'J.N.N Institute of Engineering';
// Web app version (client/package.json). Mobile apps show their own build version.
export const APP_VERSION = '1.0.0';

export const ABOUT_PATH = '/about';
export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy-policy';


/** The profile's "About the App" section: exactly these three entries. */
export const ABOUT_ENTRIES = [
  { key: 'about', label: 'About the App', to: ABOUT_PATH },
  { key: 'terms', label: 'Terms and Conditions', to: TERMS_PATH },
  { key: 'privacy', label: 'Privacy Policy', to: PRIVACY_PATH },
];

/** Public pages that never need a session or an acceptance. */
export const PUBLIC_LEGAL_PATHS = [ABOUT_PATH, TERMS_PATH, PRIVACY_PATH];

/** "22 October 2026" — effective dates are calendar dates (UTC). */
export function fmtEffectiveDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
