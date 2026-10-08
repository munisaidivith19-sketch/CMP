import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inKeepAliveWindow, istMinutes, keepAliveUrl } from '../src/utils/keepAlive.js';

// UTC instants → IST (UTC+5:30)
const at = (utc) => new Date(`2026-10-08T${utc}:00Z`);

test('Keep-alive window is 05:30–22:00 IST', () => {
  assert.equal(istMinutes(at('00:00')), 5 * 60 + 30);
  assert.equal(inKeepAliveWindow(at('23:59')), false, '05:29 IST — still night');
  assert.equal(inKeepAliveWindow(at('00:00')), true, '05:30 IST — starts');
  assert.equal(inKeepAliveWindow(at('06:30')), true, '12:00 IST');
  assert.equal(inKeepAliveWindow(at('16:29')), true, '21:59 IST');
  assert.equal(inKeepAliveWindow(at('16:30')), false, '22:00 IST — stops');
  assert.equal(inKeepAliveWindow(at('20:00')), false, '01:30 IST');
});

test('Keep-alive runs only where a public URL is known, never in tests or when switched off', () => {
  assert.equal(keepAliveUrl({}), null, 'local development: off');
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://jnn.onrender.com/' }), 'https://jnn.onrender.com/api/health');
  assert.equal(keepAliveUrl({ KEEP_ALIVE_URL: 'https://x.example/api/health', RENDER_EXTERNAL_URL: 'https://jnn.onrender.com' }), 'https://x.example/api/health');
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://jnn.onrender.com', KEEP_ALIVE: 'false' }), null);
  assert.equal(keepAliveUrl({ RENDER_EXTERNAL_URL: 'https://jnn.onrender.com', NODE_ENV: 'test' }), null);
});
