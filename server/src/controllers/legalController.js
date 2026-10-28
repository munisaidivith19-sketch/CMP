import { ApiError, asyncHandler } from '../utils/http.js';
import { POLICY_IDS } from '../legal/registry.js';
import { acceptTerms, currentDocument, currentVersion, legalStatus, publicPolicy, publishedDocument } from '../services/legal.js';

// Public policy documents change rarely; let browsers and proxies keep them
// briefly (the /api no-store default is for account data).
const cachePublic = (res) => res.set('Cache-Control', 'public, max-age=300');

/** GET /legal/policies — the current version of every policy (no text). Public. */
export const listPolicies = asyncHandler(async (_req, res) => {
  const docs = await Promise.all(POLICY_IDS.map((id) => currentVersion(id)));
  cachePublic(res);
  res.json({ policies: docs.filter(Boolean).map((d) => publicPolicy(d, { withContent: false })) });
});

/** GET /legal/policies/:policyId — the current published text. Public. */
export const getPolicy = asyncHandler(async (req, res) => {
  const doc = await currentDocument(req.params.policyId);
  if (!doc) throw new ApiError(404, 'This document has not been published yet');
  cachePublic(res);
  res.json(publicPolicy(doc));
});

/** GET /legal/policies/:policyId/versions/:version — an earlier published version. Public. */
export const getPolicyVersion = asyncHandler(async (req, res) => {
  const doc = await publishedDocument(req.params.policyId, req.params.version);
  if (!doc) throw new ApiError(404, 'This version does not exist');
  cachePublic(res);
  res.json(publicPolicy(doc));
});

/** GET /legal/status — the signed-in user's acceptance status (versions only). */
export const getStatus = asyncHandler(async (req, res) => {
  res.json(await legalStatus(req.user._id, { enforced: req.sessionClient !== 'web' }));
});

/**
 * POST /legal/accept { policyId: 'terms', version, agreed: true }
 * Always for the authenticated user; nothing in the body names an account.
 */
export const accept = asyncHandler(async (req, res) => {
  const status = await acceptTerms({ user: req.user, version: req.body.version, sessionId: req.sessionId });
  res.json(status);
});
