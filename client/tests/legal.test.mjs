// Terms and Conditions / Privacy Policy on the web: profile entries and public pages.
// The web app does not ask for acceptance (only the mobile apps do).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ABOUT_ENTRIES, ABOUT_PATH, PRIVACY_PATH, PUBLIC_LEGAL_PATHS, TERMS_PATH, fmtEffectiveDate } from '../src/utils/legal.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('the profile "About the App" section has exactly the three required entries', () => {
  assert.deepEqual(ABOUT_ENTRIES.map((e) => e.label), ['About the App', 'Terms and Conditions', 'Privacy Policy']);
  assert.deepEqual(ABOUT_ENTRIES.map((e) => e.to), ['/about', '/terms', '/privacy-policy']);
  assert.match(src('pages/people/Profile.jsx'), /title="About the App"/);
});

test('there is no Policy Acceptance History page, route or menu entry', () => {
  for (const file of ['App.jsx', 'pages/people/Profile.jsx', 'components/layout/navItems.js', 'utils/legal.js', 'services/legal.js']) {
    assert.doesNotMatch(src(file), /acceptance[\s-]*history|policy[\s-]*history|acceptances/i, file);
  }
});

test('the policy pages are public routes and the web has no acceptance screen or gate', () => {
  const app = src('App.jsx');
  assert.deepEqual(PUBLIC_LEGAL_PATHS, [ABOUT_PATH, TERMS_PATH, PRIVACY_PATH]);
  assert.match(app, /<Route path=\{ABOUT_PATH\} element=\{<AboutApp \/>\} \/>/);
  assert.match(app, /<Route path=\{TERMS_PATH\} element=\{<PolicyPage policyId="terms" \/>\} \/>/);
  assert.match(app, /<Route path=\{PRIVACY_PATH\} element=\{<PolicyPage policyId="privacy" \/>\} \/>/);
  assert.doesNotMatch(app, /AcceptTerms|accept-terms|needsTermsAcceptance/);
  assert.equal(existsSync(new URL('../src/pages/legal/AcceptTerms.jsx', import.meta.url)), false);
});

test('policy text is rendered by the safe Markdown component, never as HTML', () => {
  for (const file of ['pages/legal/PolicyPage.jsx', 'pages/legal/AboutApp.jsx']) {
    assert.doesNotMatch(src(file), /dangerouslySetInnerHTML|innerHTML/, file);
  }
});

test('effective dates are shown as calendar dates', () => {
  assert.equal(fmtEffectiveDate('2026-10-22T00:00:00.000Z'), '22 October 2026');
  assert.equal(fmtEffectiveDate(null), '');
  assert.equal(fmtEffectiveDate('not a date'), '');
});
