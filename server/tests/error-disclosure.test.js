/**
 * Production error responses carry only text written for the user. A
 * library, driver or SDK error (its message, its `errors`/`data` fields, or
 * an upstream HTTP status such as an AI provider's 401) never reaches the
 * client; deliberate ApiErrors, mapped validation errors and body-parser's
 * exposable errors still do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { errorHandler, notFound } from '../src/middleware/error.js';
import { ApiError } from '../src/utils/http.js';
import { AIServiceError } from '../src/services/ai/groqService.js';

function run(err, { prod = true } = {}) {
  let out;
  const res = {
    status(s) { out = { status: s }; return this; },
    json(b) { out.body = b; },
    set() { return this; },
  };
  const saved = env.isProd;
  env.isProd = prod;
  const log = console.error;
  console.error = () => {};
  try {
    errorHandler(err, { headers: {} }, res, () => {});
  } finally {
    env.isProd = saved;
    console.error = log;
  }
  return out;
}

test('production: a third-party error with its own status, data and errors is masked to a plain 500', () => {
  const upstream = Object.assign(new Error('401 {"error":{"message":"Invalid API Key gsk_live_abc"}}'), {
    status: 401,
    data: { host: 'api.groq.com', apiKeyPrefix: 'gsk_live' },
    errors: [{ path: '/srv/app/node_modules/x.js' }],
  });
  assert.deepEqual(run(upstream), { status: 500, body: { message: 'Internal server error' } });
});

test('production: a Mongo driver error never exposes its text', () => {
  const err = Object.assign(new Error('connection 3 to cluster0-shard.mongodb.net:27017 closed'), { name: 'MongoNetworkError' });
  assert.deepEqual(run(err), { status: 500, body: { message: 'Internal server error' } });
});

test('malformed JSON bodies get a fixed message, not the parser output', () => {
  const err = Object.assign(new SyntaxError('Unexpected token } in JSON at position 12'), { type: 'entity.parse.failed', status: 400, expose: true });
  assert.deepEqual(run(err), { status: 400, body: { message: 'Malformed request body' } });
  assert.deepEqual(run(err, { prod: false }), { status: 400, body: { message: 'Malformed request body' } });
});

test('production: deliberate and mapped errors still reach the user', () => {
  assert.deepEqual(run(new ApiError(409, 'Already approved', undefined, { code: 'ALREADY' })), {
    status: 409,
    body: { message: 'Already approved', code: 'ALREADY' },
  });
  const cast = Object.assign(new Error('Cast to ObjectId failed for value "x" (type string) at path "_id"'), { name: 'CastError', path: '_id' });
  assert.deepEqual(run(cast), { status: 400, body: { message: 'Invalid _id' } });
  const dupe = Object.assign(new Error('E11000 duplicate key error collection: cc.users index: email_1'), { code: 11000, keyValue: { email: 'a@b.c' } });
  assert.deepEqual(run(dupe), { status: 409, body: { message: 'That email is already in use' } });
  const ai = new AIServiceError('rate_limit');
  const out = run(ai);
  assert.equal(out.status, ai.status);
  assert.equal(out.body.message, ai.message);
});

test('production 404s do not echo the request line', () => {
  let body;
  const res = { status() { return this; }, json(b) { body = b; } };
  const saved = env.isProd;
  env.isProd = true;
  try {
    notFound({ method: 'GET', originalUrl: '/api/<script>alert(1)</script>' }, res);
  } finally {
    env.isProd = saved;
  }
  assert.deepEqual(body, { message: 'Not found' });
});
