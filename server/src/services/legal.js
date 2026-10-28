import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PolicyVersion from '../models/PolicyVersion.js';
import PolicyAcceptance from '../models/PolicyAcceptance.js';
import Session from '../models/Session.js';
import { ApiError } from '../utils/http.js';
import { POLICY_REGISTRY, POLICY_TITLES, TERMS_CONSENT_TEXT } from '../legal/registry.js';

const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../legal/content');

export const hashContent = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/* ── Current versions (read on every gated request: cached briefly) ── */

const CACHE_MS = 30 * 1000;
let cache = { at: 0, value: null };

/** Forget cached versions (after a publish; tests). */
export function clearLegalCache() {
  cache = { at: 0, value: null };
  accepted.clear();
}

async function loadCurrent() {
  const now = new Date();
  const published = await PolicyVersion.find({ status: 'published', effectiveAt: { $lte: now } })
    .select('-content')
    .sort({ version: -1 })
    .lean();
  const value = {};
  for (const id of Object.keys(POLICY_TITLES)) {
    const versions = published.filter((v) => v.policyId === id);
    value[id] = {
      current: versions[0] || null,
      // The newest version everyone must have accepted (or accepted past).
      required: versions.find((v) => v.requiresAcceptance) || null,
    };
  }
  return value;
}

async function current() {
  if (!cache.value || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), value: await loadCurrent() };
  return cache.value;
}

/** Metadata of the current published version of a policy, or null. */
export async function currentVersion(policyId) {
  return (await current())[policyId]?.current || null;
}

/** Full current document (with text) for display. */
export async function currentDocument(policyId) {
  const meta = await currentVersion(policyId);
  return meta ? PolicyVersion.findById(meta._id).lean() : null;
}

/** A specific published version (historic or current); drafts are never returned. */
export function publishedDocument(policyId, version) {
  return PolicyVersion.findOne({ policyId, version, status: 'published', effectiveAt: { $lte: new Date() } }).lean();
}

/* ── Acceptance status ──────────────────────────────────────────── */

// Positive results only: acceptance records are never deleted, and a newer
// required version changes the key, so a cached "accepted" can never go stale.
const accepted = new Map();
const ACCEPTED_CACHE_MAX = 5000;

async function hasAccepted(userId, required) {
  const key = `${userId}:${required.version}`;
  if (accepted.has(key)) return true;
  const ok = Boolean(await PolicyAcceptance.exists({ user: userId, policyId: required.policyId, version: { $gte: required.version } }));
  if (ok) {
    if (accepted.size >= ACCEPTED_CACHE_MAX) accepted.delete(accepted.keys().next().value);
    accepted.set(key, true);
  }
  return ok;
}

/**
 * Must this user accept the Terms before using the app? False when no Terms
 * version requiring acceptance has been published.
 */
export async function termsAcceptanceRequired(userId) {
  const { required } = (await current()).terms;
  if (!required || !userId) return false;
  return !(await hasAccepted(userId, required));
}

/**
 * The `legal` block returned with the signed-in user (login, refresh,
 * /auth/me, /legal/status). Version numbers only — never the history.
 */
export async function legalStatus(userId, { enforced = true } = {}) {
  const { terms, privacy } = await current();
  const latest = userId
    ? await PolicyAcceptance.findOne({ user: userId, policyId: 'terms' }).sort({ version: -1 }).select('version').lean()
    : null;
  return {
    termsRequired: enforced && (await termsAcceptanceRequired(userId)),
    termsVersion: terms.current?.version ?? null,
    termsAcceptedVersion: latest?.version ?? null,
    privacyVersion: privacy.current?.version ?? null,
  };
}

/** The signed-in user as JSON with its `legal` status added. */
export async function withLegal(user, { enforced = true } = {}) {
  if (!user) return user;
  const json = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
  json.legal = await legalStatus(user._id, { enforced });
  return json;
}

/**
 * Record the authenticated user's acceptance of the CURRENT Terms version.
 * `version` is what the client displayed: a stale screen (a newer version was
 * published meanwhile) gets 409 and must reload. Idempotent: accepting the
 * same version twice returns the existing record.
 */
export async function acceptTerms({ user, version, sessionId }) {
  const doc = await currentVersion('terms');
  if (!doc) throw new ApiError(404, 'There are no Terms and Conditions to accept');
  if (version !== doc.version) {
    throw new ApiError(409, 'The Terms and Conditions were updated. Please read the current version.', undefined, {
      code: 'POLICY_VERSION_CHANGED',
      currentVersion: doc.version,
    });
  }
  const [privacy, session] = await Promise.all([
    currentVersion('privacy'),
    sessionId ? Session.findById(sessionId).select('client').lean() : null,
  ]);
  const client = session?.client;
  try {
    await PolicyAcceptance.create({
      user: user._id,
      policyId: 'terms',
      version: doc.version,
      policyVersion: doc._id,
      contentHash: doc.contentHash,
      consentText: TERMS_CONSENT_TEXT,
      privacyVersionShown: privacy?.version,
      client: session?.client,
      acceptedAt: new Date(),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err; // already accepted (double click, two devices): fine
  }
  return legalStatus(user._id, { enforced: client !== 'web' });
}

/* ── Publishing (start-up sync from legal/registry.js) ──────────── */

/**
 * Copy legal/registry.js into the PolicyVersion collection.
 *  - New versions are inserted.
 *  - A draft whose registry entry is now published is published (text may
 *    still change while it is a draft).
 *  - A published version whose file no longer matches the stored text is an
 *    error: in production start-up fails, elsewhere it is logged and the
 *    stored (accepted) text keeps being served. Bump the version instead.
 */
export async function syncPolicyVersions({ registry = POLICY_REGISTRY, readContent = defaultReader, isProd = process.env.NODE_ENV === 'production', log = console } = {}) {
  const result = { inserted: 0, published: 0, unchanged: 0, mismatched: [] };
  for (const entry of registry) {
    const content = (await readContent(entry.file)).replace(/\r\n/g, '\n').trim();
    if (!content) throw new Error(`[legal] ${entry.file} is empty`);
    const contentHash = hashContent(content);
    const fields = {
      title: POLICY_TITLES[entry.policyId],
      effectiveAt: new Date(entry.effectiveAt),
      requiresAcceptance: entry.policyId === 'terms' && Boolean(entry.requiresAcceptance),
      changeSummary: entry.changeSummary,
      content,
      contentHash,
    };
    if (Number.isNaN(fields.effectiveAt.getTime())) throw new Error(`[legal] ${entry.policyId} v${entry.version}: invalid effectiveAt`);
    const status = entry.status === 'draft' ? 'draft' : 'published';
    const find = () => PolicyVersion.findOne({ policyId: entry.policyId, version: entry.version }).select('status contentHash').lean();
    let existing = await find();

    if (!existing) {
      try {
        await PolicyVersion.create({ policyId: entry.policyId, version: entry.version, status, ...fields, publishedAt: status === 'published' ? new Date() : undefined });
        result.inserted++;
        continue;
      } catch (err) {
        // Another instance starting at the same moment inserted it first: compare with theirs.
        if (err?.code !== 11000) throw err;
        existing = await find();
      }
    }
    if (existing.status === 'draft') {
      await PolicyVersion.updateOne({ _id: existing._id }, { $set: { ...fields, status, ...(status === 'published' ? { publishedAt: new Date() } : {}) } });
      if (status === 'published') result.published++;
      else result.unchanged++;
    } else if (existing.contentHash !== contentHash) {
      result.mismatched.push(`${entry.policyId} v${entry.version}`);
    } else {
      result.unchanged++;
    }
  }
  clearLegalCache();
  if (result.mismatched.length) {
    const msg = `[legal] published policy text changed for ${result.mismatched.join(', ')} — published versions are immutable; add a new version in legal/registry.js instead`;
    if (isProd) throw new Error(msg);
    log.warn(`${msg} (still serving the stored text)`);
  }
  return result;
}

function defaultReader(file) {
  if (!/^[a-z0-9-]+\.md$/.test(file)) throw new Error(`[legal] invalid content file name: ${file}`);
  return fs.readFile(path.join(CONTENT_DIR, file), 'utf8');
}

/** Public shape of a version (no internal ids). */
export function publicPolicy(doc, { withContent = true } = {}) {
  if (!doc) return null;
  return {
    policyId: doc.policyId,
    title: doc.title,
    version: doc.version,
    effectiveAt: doc.effectiveAt,
    publishedAt: doc.publishedAt,
    requiresAcceptance: doc.requiresAcceptance,
    changeSummary: doc.changeSummary || null,
    ...(withContent ? { content: doc.content, contentHash: doc.contentHash } : {}),
  };
}
