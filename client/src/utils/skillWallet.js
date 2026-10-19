/**
 * Skill Wallet form rules shared by the web forms. These mirror the server's
 * checks so a student sees a problem before submitting — the server repeats
 * every one of them and is the authority (a direct API call is validated the
 * same way).
 */

export const STAGES = [
  { value: 'developing', label: 'Developing' },
  { value: 'implemented', label: 'Implemented' },
];

export const VISIBILITY = [
  { value: 'private', label: 'Private', hint: 'Only your team and authorized reviewers' },
  { value: 'college', label: 'College-only', hint: 'Signed-in members of the college' },
  { value: 'public', label: 'Public', hint: 'Anyone on the internet' },
];

export const REVIEW_STATUS = {
  draft: { label: 'Draft', color: 'neutral' },
  submitted: { label: 'Under review', color: 'info' },
  changes_requested: { label: 'Changes requested', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Not approved', color: 'danger' },
};

export const CERT_STATUS = {
  pending: { label: 'Pending verification', color: 'info' },
  verified: { label: 'Verified', color: 'success' },
  correction_requested: { label: 'Correction requested', color: 'warning' },
  rejected: { label: 'Rejected', color: 'danger' },
};

export const INVITE_STATUS = {
  pending: { label: 'Pending', color: 'info' },
  accepted: { label: 'Accepted', color: 'success' },
  declined: { label: 'Declined', color: 'neutral' },
  cancelled: { label: 'Cancelled', color: 'neutral' },
  expired: { label: 'Expired', color: 'warning' },
};

export const LINK_PLATFORMS = [
  { value: 'github', label: 'GitHub' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'hackerrank', label: 'HackerRank' },
  { value: 'leetcode', label: 'LeetCode' },
  { value: 'tryhackme', label: 'TryHackMe' },
  { value: 'hackthebox', label: 'Hack The Box' },
  { value: 'portfolio', label: 'Personal portfolio' },
  { value: 'kaggle', label: 'Kaggle' },
  { value: 'codeforces', label: 'Codeforces' },
  { value: 'other', label: 'Other platform' },
];

export const MILESTONE_KINDS = [
  { value: 'patent_filed', label: 'Patent filed' },
  { value: 'patent_granted', label: 'Patent granted' },
  { value: 'startup_registered', label: 'Startup registered' },
  { value: 'funding_received', label: 'Funding received' },
  { value: 'other', label: 'Other milestone' },
];

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other', label: 'Other' },
];

/** Accepted certificate inputs; the server re-checks the real bytes and stores WebP. */
export const CERT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const CERT_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
export const PROJECT_IMAGE_ACCEPT = CERT_ACCEPT;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → true when it is a real calendar date. */
export function isRealDay(s) {
  if (!DAY.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Local "today" as YYYY-MM-DD. */
export const todayDay = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Server date (ISO) → YYYY-MM-DD for <input type="date">. */
export const toDayInput = (d) => (d ? String(d).slice(0, 10) : '');

/**
 * Project date rules. Developing: start only, no end date (sent as null).
 * Implemented: end date required, not before start, not in the future.
 * Returns { errors, payload } where payload.endedAt is what to send.
 */
export function checkProjectDates({ stage, startedAt, endedAt }, today = todayDay()) {
  const errors = {};
  if (!isRealDay(startedAt)) errors.startedAt = 'Choose the start date';
  else if (startedAt > today) errors.startedAt = 'The start date cannot be in the future';
  if (stage === 'implemented') {
    if (!isRealDay(endedAt)) errors.endedAt = 'An implemented project needs an end date';
    else if (isRealDay(startedAt) && endedAt < startedAt) errors.endedAt = 'The end date cannot be earlier than the start date';
    else if (endedAt > today) errors.endedAt = 'The end date cannot be in the future';
  }
  return { errors, payload: { startedAt, endedAt: stage === 'implemented' ? endedAt : null } };
}

/** Same skill normalisation as the server: trimmed, lower-case, single spaces, unique, max 20 × 40 chars. */
export function normaliseSkills(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const out = [];
  for (const raw of list) {
    const s = String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function checkSkills(skills) {
  if (skills.length > 20) return 'Add at most 20 skills';
  if (skills.some((s) => s.length > 40)) return 'Each skill can be at most 40 characters';
  if (skills.some((s) => !/^[\p{L}\p{N} +#.\-/&()]+$/u.test(s))) return 'Skills may use letters, numbers, spaces and . + # / & ( ) -';
  return null;
}

const hostIs = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * A quick client-side URL check (https, a real host, no credentials / IPs /
 * localhost). The server applies the authoritative, per-platform rules.
 */
export function checkHttpsUrl(value, { hosts } = {}) {
  const s = String(value || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return 'Enter a full link starting with https://';
  }
  if (u.protocol !== 'https:') return 'Only https:// links are accepted';
  if (u.username || u.password) return 'Links cannot contain a username or password';
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return 'Enter a link to a public website';
  if (hosts && !hostIs(host, hosts)) return `This link must be on ${hosts[0]}`;
  return null;
}

export const GITHUB_HOSTS = ['github.com'];
export const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com'];

/** GitHub repository links need an owner and a repository: https://github.com/owner/repo */
export function checkGithubRepo(value) {
  const base = checkHttpsUrl(value, { hosts: GITHUB_HOSTS });
  if (base || !String(value || '').trim()) return base;
  const parts = new URL(String(value).trim()).pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? null : 'Link to a repository: https://github.com/owner/repository';
}

/** Client-side file pre-check (type by declared MIME / extension, size). The server checks the real bytes. */
export function precheckImage(file, { maxMb = 5 } = {}) {
  if (!file) return 'Choose an image';
  const ext = String(file.name || '').toLowerCase().split('.').pop();
  const typeOk = CERT_TYPES.includes(file.type) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
  if (!typeOk) return 'Use a PNG, JPEG or WebP image (PDF, SVG, GIF, HEIC, BMP and TIFF are not accepted)';
  if (file.size > maxMb * 1024 * 1024) return `The image must be under ${maxMb} MB`;
  if (file.size === 0) return 'The file is empty';
  return null;
}

/** Plain-language publication state for a project the viewer is a member of. */
export function publicationSummary(p) {
  if (!p) return '';
  if (p.hidden) return 'Hidden by a moderator';
  if (p.visibility === 'public') return p.published?.revision !== p.revision ? 'Public (showing an earlier approved version)' : 'Public';
  if (p.visibility === 'college') return p.published?.revision !== p.revision ? 'College-only (showing an earlier version)' : 'College-only';
  if (p.publicRequest) return 'Waiting for team confirmation to go public';
  return 'Private';
}
