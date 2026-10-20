import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/http.js';
import { captureError } from '../services/soc/capture.js';

export const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  let errors = err.errors;

  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.name === 'ValidationError') {
    status = 422;
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = errors[0]?.message || 'Validation failed';
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'value';
    message = `That ${field} is already in use`;
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${env.maxUploadMb} MB)` : err.message;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  // SOC: server faults and authorization refusals are recorded (redacted,
  // deduplicated). Ordinary 4xx answers — validation, not found, conflicts —
  // are the API working as intended and are not captured.
  if ((status >= 500 && err.data?.code !== 'MAINTENANCE') || status === 403) {
    captureError({ source: status === 403 ? 'authorization' : 'express', err, req, httpStatus: status, meta: errorMeta(err) });
  }

  // A maintenance 503 is an expected, controlled response — not a server fault.
  if (status >= 500 && err.data?.code !== 'MAINTENANCE') {
    console.error('[error]', err);
    // An ApiError's message is written for the user (e.g. "The college SMS
    // service is not configured yet") and says what to fix; only unexpected
    // errors, whose text can expose internals, are masked in production.
    if (env.isProd && !(err instanceof ApiError)) message = 'Internal server error';
  }

  const extra = err.data || (errors && !Array.isArray(errors) ? errors : null);

  if (req.id) res.set('X-Request-Id', req.id);
  res.status(status).json({
    message,
    ...(errors && Array.isArray(errors) ? { errors } : {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
  });
};

/** Safe, non-identifying metadata about an error for the SOC record. */
function errorMeta(err) {
  return {
    apiError: err instanceof ApiError,
    // AIServiceError's category ("auth", "rate_limit", "timeout"…), never the upstream text.
    ...(err?.category ? { category: String(err.category).slice(0, 30) } : {}),
  };
}

/**
 * Rate-limit responses are sent by express-rate-limit itself (they never
 * reach errorHandler), so they are recorded when the response finishes.
 * Anonymous 429s from the global limiter (no signed-in user, no matched
 * route — the path is whatever the client sent) are grouped into ONE record
 * whatever the path, method or module: a scanner hammering random URLs
 * cannot create a new SOC row per path. Signed-in 429s, and 429s from a
 * route's own limiter (a real, finite route such as /auth/login), keep their
 * route template.
 */
export const ANONYMOUS_RATE_LIMIT_ROUTE = 'anonymous:*';
export function captureRateLimited(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode !== 429) return;
    if (req.user || req.route) {
      captureError({ source: 'rate_limit', req, httpStatus: 429, message: 'Rate limit exceeded', route: req.originalUrl });
      return;
    }
    captureError({
      source: 'rate_limit',
      // Only what identifies the client type and correlation; no method / path.
      req: { headers: req.headers, id: req.id },
      httpStatus: 429,
      message: 'Rate limit exceeded (anonymous)',
      route: ANONYMOUS_RATE_LIMIT_ROUTE,
      module: 'anonymous_traffic',
    });
  });
  next();
}
