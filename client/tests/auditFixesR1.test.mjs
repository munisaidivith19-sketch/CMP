// Regression tests for the security audit fixes, round 1 (B5, B10). See AUDIT_FIXES_R1.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createErrorReporter, pathOnly } from '../src/services/errorReporter.js';
import { safeHref } from '../src/utils/format.js';

const TOKEN64 = 'ab12'.repeat(16);

test('B5 claim / invite tokens and object ids never leave the browser in a reported path', async () => {
  assert.equal(pathOnly(`/alumni/claim/${TOKEN64}?x=1`), '/alumni/claim/:token');
  assert.equal(pathOnly('/api/users/64f1a2b3c4d5e6f708192a3b/reset'), '/api/users/:id/reset');
  assert.equal(pathOnly('/gate-pass/123'), '/gate-pass/123');
  assert.equal(pathOnly('/skill-wallet/projects'), '/skill-wallet/projects');
  const sent = [];
  const r = createErrorReporter({ send: async (b) => sent.push(b), now: () => 0, getRoute: () => `/alumni/claim/${TOKEN64}` });
  r.report({ kind: 'api', message: 'Server answered 500', status: 500, endpoint: `/api/auth/alumni-claim/${TOKEN64}` });
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent[0]).includes(TOKEN64));
  assert.equal(sent[0].endpoint, '/api/auth/alumni-claim/:token');
});

test('B10 safeHref allows only web links and same-site paths', () => {
  for (const ok of ['https://careers.example.com/apply', 'http://example.com', '/alumni/jobs', '/uploads/a.png']) assert.equal(safeHref(ok), ok);
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example.com', '/\\evil.example.com', '/a\\b', 'example.com', '', null, undefined]) {
    assert.equal(safeHref(bad), undefined, String(bad));
  }
});
