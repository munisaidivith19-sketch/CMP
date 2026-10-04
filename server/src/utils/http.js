export class ApiError extends Error {
  constructor(status, message, errors, data) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.data = data || (errors && !Array.isArray(errors) ? errors : undefined);
  }
}

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function paginate(req, defaultLimit = 12, maxLimit = 50) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export const pageMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
});

export const escapeRegex = (s = '') => String(s).slice(0, 64).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Copy only whitelisted keys from a request body (prevents mass assignment). */
export function pick(obj = {}, keys = []) {
  return keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});
}

/**
 * Throw 422 unless `value` is an absolute http(s) URL. Every user-supplied
 * link that the web app renders as an <a href> must pass this on the server:
 * a `javascript:` or `data:` URL there runs in the app's own origin on click.
 * Empty values are allowed (the field is optional).
 */
export function assertHttpUrl(value, label = 'Link') {
  if (value === undefined || value === null || value === '') return;
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new ApiError(422, `${label} must be a valid http(s) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || String(value) !== String(value).trim()) {
    throw new ApiError(422, `${label} must start with http:// or https://`);
  }
}
