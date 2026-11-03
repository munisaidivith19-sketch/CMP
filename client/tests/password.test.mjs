// The password rule on the web, and passwords the app suggests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem, suggestPassword } from '../src/utils/password.js';

test('a password needs 8+ characters, a capital, a small letter, a number and a symbol', () => {
  assert.equal(passwordProblem('Campus@123'), null);
  assert.equal(passwordProblem('Ab1$'), 'At least 8 characters');
  assert.equal(passwordProblem('campus@123'), 'Include a capital letter');
  assert.equal(passwordProblem('CAMPUS@123'), 'Include a small letter');
  assert.equal(passwordProblem('Campus@abc'), 'Include a number');
  assert.equal(passwordProblem('Campus1234'), 'Include a symbol');
  assert.equal(passwordProblem('Campus 123'), 'Include a symbol', 'a space is not a symbol');
  assert.equal(passwordProblem(`${'A'.repeat(70)}a1$`), 'At most 72 characters');
});

test('suggested passwords always meet the rule', () => {
  for (let i = 0; i < 200; i += 1) assert.equal(passwordProblem(suggestPassword()), null);
});
