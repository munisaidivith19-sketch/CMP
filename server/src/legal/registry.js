/**
 * Published legal documents (Terms and Conditions, Privacy Policy).
 *
 * This file is the only way a policy version is published. On start-up
 * services/legal.js copies every entry here into the PolicyVersion collection,
 * where it becomes immutable: the text a user accepted is never overwritten.
 *
 * To publish a change:
 *   1. Add a NEW content file (never edit one that has been deployed).
 *   2. Add a NEW entry below with the next version number.
 *   3. Terms only: set `requiresAcceptance: true` when the change is material
 *      and every user must accept again; `false` for corrections (typos,
 *      contact details) that keep earlier acceptances valid.
 *   4. Deploy. The new version becomes current on its `effectiveAt` date.
 *
 * `status: 'draft'` keeps a version stored but never current or public.
 * A deployed version whose file has changed refuses to start in production
 * (see syncPolicyVersions), so published text cannot change silently.
 */
export const POLICY_IDS = ['terms', 'privacy'];

export const POLICY_TITLES = {
  terms: 'Terms and Conditions',
  privacy: 'Privacy Policy',
};

// Only the Terms are accepted. The Privacy Policy is shown and linked during
// acceptance but agreeing to the Terms is not consent to every kind of
// processing (see docs/LEGAL_POLICIES.md).
export const ACCEPTABLE_POLICY_IDS = ['terms'];

// The affirmative statement recorded with each acceptance. Changing it is a
// code change, so the wording a user ticked is always known.
export const TERMS_CONSENT_TEXT = 'I have read and agree to the Terms and Conditions.';

export const POLICY_REGISTRY = [
  {
    policyId: 'terms',
    version: 1,
    status: 'published',
    effectiveAt: '2026-10-22T00:00:00.000Z',
    requiresAcceptance: true,
    file: 'terms-v1.md',
    changeSummary: 'First published version.',
  },
  {
    policyId: 'privacy',
    version: 1,
    status: 'published',
    effectiveAt: '2026-10-22T00:00:00.000Z',
    requiresAcceptance: false,
    file: 'privacy-v1.md',
    changeSummary: 'First published version.',
  },
  // Version 2 (3 November 2026): the Technical Provider's role, no institutional fee,
  // data control, retention, breach handling and the other sections the College asked for.
  // Terms stay at "no re-acceptance": only Gate Scanner sessions accept Terms, and
  // those guards have already accepted version 1.
  {
    policyId: 'terms',
    version: 2,
    status: 'published',
    effectiveAt: '2026-11-03T00:00:00.000Z',
    requiresAcceptance: false,
    file: 'terms-v2.md',
    changeSummary: 'Rewritten: the role of the Technical Provider, the responsibilities of the College, no institutional fee, data control, liability and governing law.',
  },
  {
    policyId: 'privacy',
    version: 2,
    status: 'published',
    effectiveAt: '2026-11-03T00:00:00.000Z',
    requiresAcceptance: false,
    file: 'privacy-v2.md',
    changeSummary: 'Rewritten: who is responsible for personal data, information processed, retention, security incidents, user rights and information about children.',
  },
];
