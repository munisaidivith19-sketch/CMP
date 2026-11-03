// Theme choice: Light / Dark / System.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEY, applyTheme, isDark, readTheme, saveTheme } from '../src/lib/theme.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const page = () => {
  const set = new Set();
  return { classList: { toggle: (c, on) => (on ? set.add(c) : set.delete(c)), has: (c) => set.has(c) }, style: {} };
};

test('system follows Windows; light and dark override it', () => {
  assert.equal(isDark('system', true), true);
  assert.equal(isDark('system', false), false);
  assert.equal(isDark('light', true), false);
  assert.equal(isDark('dark', false), true);
});

test('the choice is saved, "system" clears it, and junk or missing storage falls back to system', () => {
  const s = memory();
  assert.equal(readTheme(s), 'system');
  saveTheme('dark', s);
  assert.equal(readTheme(s), 'dark');
  saveTheme('system', s);
  assert.equal(s.getItem(THEME_KEY), null);
  s.setItem(THEME_KEY, 'purple');
  assert.equal(readTheme(s), 'system');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readTheme(broken), 'system');
  assert.doesNotThrow(() => saveTheme('light', broken));
});

test('applying a choice sets the dark class and the colour scheme', () => {
  const root = page();
  assert.equal(applyTheme('dark', { root, media: { matches: false } }), true);
  assert.ok(root.classList.has('dark'));
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(applyTheme('light', { root, media: { matches: true } }), false);
  assert.ok(!root.classList.has('dark'));
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(applyTheme('system', { root, media: { matches: true } }), true);
});
