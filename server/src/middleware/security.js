import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';
import { isMobileClient } from '../utils/tokens.js';

export const CSRF_COOKIE = 'cc_csrf';

/**
 * Generate a cryptographically secure token for CSRF protection.
 */
export const generateCsrfToken = () => crypto.randomBytes(24).toString('base64url');

/**
 * Normalizes an origin/referer string to its base origin (e.g. "http://localhost:5173").
 */
function extractOrigin(urlStr) {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

// Build allowed origins set from configuration
const getAllowedOrigins = () => {
  const list = [...(env.clientUrls || []), env.appUrl].filter(Boolean).map((u) => {
    try {
      return new URL(u).origin.toLowerCase();
    } catch {
      return u.toLowerCase().replace(/\/$/, '');
    }
  });
  return new Set(list);
};

/**
 * 1. Strict Origin & Referer Validation Middleware
 * Protects all state-modifying requests (POST, PUT, PATCH, DELETE) against cross-site exploitation.
 */
export function csrfAndOriginGuard(req, res, next) {
  // Safe HTTP methods do not modify server state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Native mobile apps do not use browser origin semantics
  if (isMobileClient(req)) {
    return next();
  }

  const allowedOrigins = getAllowedOrigins();
  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  const requestOrigin = extractOrigin(originHeader) || extractOrigin(refererHeader);

  // If origin/referer is present, it MUST match the whitelisted origins
  if (requestOrigin) {
    let isAllowed = allowedOrigins.has(requestOrigin);

    // In local development, also allow localhost / 127.0.0.1 on any port
    if (!isAllowed && !env.isProd) {
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      return next(new ApiError(403, 'Cross-origin request blocked by security policy'));
    }
  }

  // Double-submit CSRF check: If client sent an X-CSRF-Token header or cookie, verify matching
  const csrfCookie = req.cookies?.[CSRF_COOKIE];
  const csrfHeader = req.headers['x-csrf-token'];
  if (csrfCookie && csrfHeader && csrfCookie !== csrfHeader) {
    return next(new ApiError(403, 'Invalid or expired CSRF token'));
  }

  next();
}

/**
 * Recursively strip null bytes (\u0000) and dangerous unprintable ASCII control characters.
 * Preserves standard whitespace (\t, \n, \r).
 */
export function sanitizeControlChars(value) {
  if (typeof value === 'string') {
    // Strips \u0000 (null byte) and control characters 0x01-0x08, 0x0B-0x0C, 0x0E-0x1F
    return value.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeControlChars);
  }
  if (value !== null && typeof value === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(value)) {
      // Prevent prototype pollution keys
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      cleaned[k] = sanitizeControlChars(v);
    }
    return cleaned;
  }
  return value;
}

/**
 * Query parameters that are permitted to be arrays.
 */
const ALLOWED_ARRAY_PARAMS = new Set([
  'roles',
  'categories',
  'departments',
  'tags',
  'ids',
  'status',
  'skills',
  'domains',
  'sections',
  'years',
  'teachingYears',
  'teachingSections',
]);

/**
 * 2. HTTP Parameter Pollution (HPP) & Null-Byte Sanitizer Middleware
 */
export function inputHygieneGuard(req, _res, next) {
  // Prevent HTTP Parameter Pollution on query strings
  if (req.query && typeof req.query === 'object') {
    for (const [key, val] of Object.entries(req.query)) {
      if (Array.isArray(val) && !ALLOWED_ARRAY_PARAMS.has(key)) {
        // Take the last parameter if duplicate was provided
        req.query[key] = val[val.length - 1];
      }
    }
    req.query = sanitizeControlChars(req.query);
  }

  // Strip null bytes and control chars in body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeControlChars(req.body);
  }

  // Strip null bytes in path params
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeControlChars(req.params);
  }

  // Global Pagination Hard-Cap (enforce maximum 50 rows per request)
  if (req.query?.limit !== undefined) {
    const parsed = parseInt(req.query.limit, 10);
    if (!Number.isNaN(parsed)) {
      req.query.limit = Math.min(50, Math.max(1, parsed));
    }
  }

  next();
}

/**
 * 3. PII & Sensitive Credential Masking in Server Logging
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'authorization',
  'cookie',
]);

export function redactSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveData);

  const redacted = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(lower)) {
      redacted[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      redacted[k] = redactSensitiveData(v);
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

