/**
 * What the UI may show from a failed API call.
 *
 * The server writes its error messages for the user, but a proxy error page,
 * a crashed upstream or a library message must never reach the screen: no
 * HTML, stack frames, file paths, database driver text or parser output.
 * Every RTK Query error passes through sanitizeApiError (api.js), so the
 * `err.data.message` read by each page is already safe to display.
 */
const MAX_MESSAGE = 300;

// Text that is backend internals, not a message written for a person.
const INTERNAL = new RegExp(
  [
    '<!doctype', '<html', '<body', '<pre',
    '\\bat\\s+[\\w$.<>\\[\\] ]+\\s\\(', // stack frame "at fn (file:1:2)"
    '[\\w./\\\\-]+\\.(?:m?js|cjs|ts|jsx):\\d+', // file:line
    'node_modules', '[A-Za-z]:\\\\', '/(?:home|usr|var|opt|srv|app|src)/',
    'Mongo\\w*Error', 'E11000', 'Cast to \\w+ failed', 'BSON', '\\$(?:where|regex|ne|gt|in)\\b',
    'ECONN(?:REFUSED|RESET|ABORTED)', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    '\\b(?:Syntax|Type|Reference|Range)Error\\b', 'Unexpected token', 'is not valid JSON', 'undefined is not',
    'Cannot read propert', 'stack trace', 'Traceback',
  ].join('|'),
  'i'
);

export const GENERIC_SERVER = 'Something went wrong on our side. Please try again.';
export const GENERIC_REQUEST = 'The request could not be completed.';
const TRANSPORT = {
  FETCH_ERROR: 'Cannot reach the server',
  TIMEOUT_ERROR: 'The server took too long to respond',
  PARSING_ERROR: GENERIC_SERVER,
  CUSTOM_ERROR: GENERIC_REQUEST,
};

/** The message itself if it is safe to show, otherwise the fallback. */
export function safeMessage(message, fallback = GENERIC_REQUEST) {
  if (typeof message !== 'string') return fallback;
  const m = message.trim();
  if (!m || m.length > MAX_MESSAGE || INTERNAL.test(m)) return fallback;
  return m;
}

/** A copy of an RTK Query error with only displayable text left in it. */
export function sanitizeApiError(error) {
  if (!error || typeof error !== 'object') return error;
  const { status } = error;
  // Transport / parse failures: the raw text is a browser or parser message
  // (or a proxy's HTML body) — replaced entirely.
  if (typeof status !== 'number') {
    const out = { status, error: TRANSPORT[status] || GENERIC_REQUEST };
    if (typeof error.originalStatus === 'number') out.originalStatus = error.originalStatus;
    return out;
  }
  const fallback = status >= 500 ? GENERIC_SERVER : GENERIC_REQUEST;
  const data = error.data && typeof error.data === 'object' && !Array.isArray(error.data) ? { ...error.data } : {};
  data.message = safeMessage(data.message, fallback);
  if (Array.isArray(data.errors)) {
    data.errors = data.errors
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        ...e,
        ...(e.msg !== undefined ? { msg: safeMessage(e.msg, 'Invalid value') } : {}),
        ...(e.message !== undefined ? { message: safeMessage(e.message, 'Invalid value') } : {}),
      }));
  }
  return { ...error, data };
}
