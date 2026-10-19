import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIndianMobile, mobileDiffers } from '../src/utils/parentMobile.js';

test('valid Indian mobiles in common formats are accepted', () => {
  for (const n of ['9876543210', '+91 98765 43210', '919876543210', '09876543210', '98765-43210', '6123456789']) {
    assert.equal(isValidIndianMobile(n), true, n);
  }
});

test('invalid numbers are rejected', () => {
  for (const n of ['', null, undefined, '12345', '0000000000', '5123456789', '98765abcde', '+1 415 555 0100', '98765432101', { $ne: null }]) {
    assert.equal(isValidIndianMobile(n), false, String(n));
  }
});

test('the registered number written differently is not an edit', () => {
  assert.equal(mobileDiffers('+91 98765 43210', '9876543210'), false);
  assert.equal(mobileDiffers('9123456780', '9876543210'), true);
  assert.equal(mobileDiffers('', '9876543210'), true);
});
