import net from 'node:net';
import { ApiError } from '../../utils/http.js';

/**
 * External link validation for the Skill Wallet. Links are parsed with the
 * WHATWG URL parser and only ever STORED — the server never fetches them.
 *
 * Every link must be https, have a real public-looking hostname (no IP
 * literals, localhost or single-label names) and carry no embedded
 * credentials. Platform links additionally need the platform's own domain;
 * paths are not over-constrained so legitimate profile URL formats pass.
 */
export const MAX_URL_LENGTH = 500;

const PLATFORM_HOSTS = {
  github: ['github.com'],
  linkedin: ['linkedin.com'],
  hackerrank: ['hackerrank.com'],
  leetcode: ['leetcode.com', 'leetcode.cn'],
  tryhackme: ['tryhackme.com'],
  hackthebox: ['hackthebox.com', 'hackthebox.eu'],
  kaggle: ['kaggle.com'],
  codeforces: ['codeforces.com'],
};
export const PLATFORM_LABELS = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  hackerrank: 'HackerRank',
  leetcode: 'LeetCode',
  tryhackme: 'TryHackMe',
  hackthebox: 'Hack The Box',
  portfolio: 'Personal portfolio',
  kaggle: 'Kaggle',
  codeforces: 'Codeforces',
  other: 'Other',
};

const hostMatches = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Parse and check one URL. Returns the normalised string (URL#href) or throws
 * a 422 ApiError naming the field. Empty → null when `optional`.
 */
export function safeHttpsUrl(value, { label = 'Link', optional = true, hosts } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (optional) return null;
    throw new ApiError(422, `${label} is required`);
  }
  if (typeof value !== 'string') throw new ApiError(422, `${label} must be a URL`);
  const raw = value.trim();
  if (raw.length > MAX_URL_LENGTH) throw new ApiError(422, `${label} is too long (max ${MAX_URL_LENGTH} characters)`);
  if (/\s/.test(raw)) throw new ApiError(422, `${label} must not contain spaces`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(422, `${label} must be a valid https:// URL`);
  }
  // Rejects javascript:, data:, file:, ftp:, http: …
  if (url.protocol !== 'https:') throw new ApiError(422, `${label} must start with https://`);
  if (url.username || url.password) throw new ApiError(422, `${label} must not contain a username or password`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || net.isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new ApiError(422, `${label} must use a public domain name`);
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some((p) => !p || p.length > 63)) {
    throw new ApiError(422, `${label} has an invalid domain name`);
  }
  if (hosts && !hostMatches(host, hosts)) {
    throw new ApiError(422, `${label} must be a ${hosts[0]} link`);
  }
  return url.href;
}

/** GitHub repository: https://github.com/<owner>/<repo>[/…]. */
export function githubRepoUrl(value) {
  const href = safeHttpsUrl(value, { label: 'GitHub repository URL', hosts: ['github.com'] });
  if (!href) return null;
  const url = new URL(href);
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new ApiError(422, 'GitHub repository URL must be a github.com link');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !/^[A-Za-z0-9-]{1,39}$/.test(parts[0]) || !/^[\w.-]{1,100}$/.test(parts[1])) {
    throw new ApiError(422, 'GitHub repository URL must look like https://github.com/owner/repository');
  }
  return href;
}

/** Google Drive / Docs link. Sharing state is never assumed or checked. */
export function googleDriveUrl(value) {
  const href = safeHttpsUrl(value, { label: 'Google Drive URL' });
  if (!href) return null;
  const host = new URL(href).hostname;
  if (!['drive.google.com', 'docs.google.com'].includes(host)) {
    throw new ApiError(422, 'Google Drive URL must be a drive.google.com or docs.google.com link');
  }
  return href;
}

/** A profile link for a known platform (or portfolio / other: any public https domain). */
export function profileLinkUrl(platform, value) {
  const hosts = PLATFORM_HOSTS[platform];
  return safeHttpsUrl(value, { label: `${PLATFORM_LABELS[platform] || 'Profile'} URL`, optional: false, hosts });
}
