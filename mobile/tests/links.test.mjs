import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobileRoute } from '../src/utils/links.js';

test('notification links open the matching mobile screen', () => {
  assert.equal(mobileRoute('/attendance?tab=od-leave'), '/od-leave');
  assert.equal(mobileRoute('/attendance?tab=corrections'), '/attendance?tab=corrections');
  assert.equal(mobileRoute('/gate-pass/64b000000000000000000001'), '/gate-pass/64b000000000000000000001');
  assert.equal(mobileRoute('/achievements/64b000000000000000000001'), '/achievements/64b000000000000000000001');
  assert.equal(mobileRoute('/admin/chat-requests'), '/admin/chat-requests');
});

test('web-only pages and foreign links never navigate', () => {
  assert.equal(mobileRoute('/admin/reports'), null);
  assert.equal(mobileRoute('/admin/clubs'), null);
  assert.equal(mobileRoute('https://evil.example/phish'), null);
  assert.equal(mobileRoute('//evil.example/phish'), null);
  assert.equal(mobileRoute('javascript:alert(1)'), null);
  assert.equal(mobileRoute(undefined), null);
  assert.equal(mobileRoute({ link: '/x' }), null);
});
