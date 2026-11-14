import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_REQUEST, GENERIC_SERVER, safeMessage, sanitizeApiError } from '../src/services/safeError.js';

test('a proxy HTML page or parser output never becomes the message', () => {
  const parsing = {
    status: 'PARSING_ERROR',
    originalStatus: 502,
    data: '<!DOCTYPE html><html><body>502 Bad Gateway nginx/1.25</body></html>',
    error: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
  };
  assert.deepEqual(sanitizeApiError(parsing), { status: 'PARSING_ERROR', originalStatus: 502, error: GENERIC_SERVER });
  assert.deepEqual(sanitizeApiError({ status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' }), { status: 'FETCH_ERROR', error: 'Cannot reach the server' });
});

test('backend internals in a JSON message are replaced', () => {
  const cases = [
    "TypeError: Cannot read properties of undefined (reading 'x')",
    'at Object.handler (/srv/app/src/controllers/userController.js:42:11)',
    'E11000 duplicate key error collection: cc.users index: email_1',
    'MongoNetworkError: connect ECONNREFUSED 10.0.0.4:27017',
    'Cast to ObjectId failed for value "abc"',
    'x'.repeat(400),
  ];
  for (const message of cases) {
    const out = sanitizeApiError({ status: 500, data: { message, code: 'X' } });
    assert.equal(out.data.message, GENERIC_SERVER, message.slice(0, 40));
    assert.equal(out.data.code, 'X', 'machine-readable codes are kept');
  }
  assert.equal(sanitizeApiError({ status: 400, data: { message: 'Error in /home/u/x.js:1' } }).data.message, GENERIC_REQUEST);
});

test("the server's own user-facing messages pass through unchanged", () => {
  for (const message of ['Invalid email or password', 'That email is already in use', 'Invalid or expired CSRF token', 'File too large (max 5 MB)']) {
    assert.equal(sanitizeApiError({ status: 400, data: { message } }).data.message, message);
  }
  const v = sanitizeApiError({ status: 422, data: { message: 'Validation failed', errors: [{ path: 'title', msg: 'Title is required' }] } });
  assert.deepEqual(v.data.errors, [{ path: 'title', msg: 'Title is required' }]);
});

test('non-object bodies get a generic message; safeMessage rejects non-strings', () => {
  assert.equal(sanitizeApiError({ status: 503, data: 'Service Unavailable' }).data.message, GENERIC_SERVER);
  assert.equal(safeMessage({ toString: () => 'x' }, 'fb'), 'fb');
  assert.equal(safeMessage('  ', 'fb'), 'fb');
});
