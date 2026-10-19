import SkillWalletConfig from '../../models/SkillWalletConfig.js';
import { ApiError } from '../../utils/http.js';

/**
 * Defaults for the editable Skill Wallet configuration — the only place the
 * lists are written out. Everything else reads them through getConfig().
 * The rubric weights are proposed defaults, not institutional policy.
 */
export const DEFAULT_DOMAINS = [
  ['web_development', 'Web Development'],
  ['app_development', 'App Development'],
  ['ai_ml', 'AI / Machine Learning'],
  ['data_science', 'Data Science'],
  ['cybersecurity', 'Cybersecurity'],
  ['iot_hardware', 'IoT / Hardware'],
  ['cloud_devops', 'Cloud / DevOps'],
  ['blockchain', 'Blockchain'],
  ['social_innovation', 'Social Innovation'],
  ['other', 'Other'],
].map(([key, label]) => ({ key, label, active: true }));

export const DEFAULT_INSTITUTIONS = [
  ['iit_madras', 'IIT Madras'],
  ['iit_kharagpur', 'IIT Kharagpur'],
  ['iit_bombay', 'IIT Bombay'],
  ['iit_delhi', 'IIT Delhi'],
  ['iit_kanpur', 'IIT Kanpur'],
  ['iit_roorkee', 'IIT Roorkee'],
  ['iit_guwahati', 'IIT Guwahati'],
  ['iisc_bangalore', 'IISc Bangalore'],
  ['other', 'Other / not listed'],
].map(([key, label]) => ({ key, label, active: true }));

export const DEFAULT_RUBRIC = {
  version: 1,
  criteria: [
    { key: 'originality', label: 'Originality and innovation', weight: 25 },
    { key: 'impact', label: 'Problem relevance and impact', weight: 20 },
    { key: 'feasibility', label: 'Technical feasibility', weight: 20 },
    { key: 'evidence', label: 'Prototype / testing evidence', weight: 20 },
    { key: 'presentation', label: 'Presentation / documentation', weight: 15 },
  ],
};

/** Scores are 0–10 per criterion; the weighted total is 0–100. */
export const RUBRIC_MAX_SCORE = 10;

export async function getConfig() {
  const doc = await SkillWalletConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default', domains: DEFAULT_DOMAINS, institutions: DEFAULT_INSTITUTIONS, rubric: DEFAULT_RUBRIC } },
    { upsert: true, new: true }
  ).lean();
  return doc;
}

export const activeKeys = (list) => list.filter((o) => o.active !== false).map((o) => o.key);
export const labelOf = (list, key) => list.find((o) => o.key === key)?.label || key;

const KEY_RE = /^[a-z0-9_]{2,40}$/;

function normaliseOptions(input, name, { keep = [] } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > 60) throw new ApiError(422, `${name} must be a list of 1–60 options`);
  const seen = new Set();
  const out = input.map((o) => {
    const key = String(o?.key || '').trim();
    const label = String(o?.label || '').trim();
    if (!KEY_RE.test(key)) throw new ApiError(422, `${name}: keys use 2–40 lowercase letters, digits or _`);
    if (!label || label.length > 80) throw new ApiError(422, `${name}: every option needs a label (max 80 characters)`);
    if (seen.has(key)) throw new ApiError(422, `${name}: "${key}" is listed twice`);
    seen.add(key);
    return { key, label, active: o.active !== false };
  });
  // An option already in use is retired (active: false), never deleted.
  for (const k of keep) if (!seen.has(k)) throw new ApiError(422, `${name}: "${k}" is in use — mark it inactive instead of removing it`);
  if (!out.some((o) => o.active)) throw new ApiError(422, `${name}: keep at least one active option`);
  return out;
}

export function normaliseRubric(input, current) {
  const criteria = input?.criteria;
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 12) throw new ApiError(422, 'The rubric needs 1–12 criteria');
  const seen = new Set();
  const out = criteria.map((c) => {
    const key = String(c?.key || '').trim();
    const label = String(c?.label || '').trim();
    const weight = Number(c?.weight);
    if (!KEY_RE.test(key)) throw new ApiError(422, 'Rubric keys use 2–40 lowercase letters, digits or _');
    if (!label || label.length > 80) throw new ApiError(422, 'Every rubric criterion needs a label');
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) throw new ApiError(422, 'Rubric weights are whole numbers from 1 to 100');
    if (seen.has(key)) throw new ApiError(422, `Rubric criterion "${key}" is listed twice`);
    seen.add(key);
    return { key, label, weight };
  });
  const total = out.reduce((s, c) => s + c.weight, 0);
  if (total !== 100) throw new ApiError(422, `Rubric weights must add up to 100 (now ${total})`);
  const same = JSON.stringify(out) === JSON.stringify(current.criteria.map(({ key, label, weight }) => ({ key, label, weight })));
  return { version: same ? current.version : current.version + 1, criteria: out };
}

export { normaliseOptions };
