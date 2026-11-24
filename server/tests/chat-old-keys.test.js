import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The key is read once at start-up, so each case runs in a fresh Node process
// with its own environment (like two servers with different .env files).
const cipherUrl = new URL('../src/utils/cipher.js', import.meta.url).href;
const cwd = fileURLToPath(new URL('..', import.meta.url));

function run(env, code) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const c = await import(${JSON.stringify(cipherUrl)}); ${code}`], {
    cwd,
    env: { ...process.env, NODE_ENV: 'test', CHAT_ENCRYPTION_KEYS_OLD: '', ...env },
    encoding: 'utf8',
  });
  return out.trim();
}
const seal = (key, text) => run({ CHAT_ENCRYPTION_KEY: key }, `process.stdout.write(c.seal(${JSON.stringify(text)}))`);
const open = (env, sealed) => run(env, `process.stdout.write(c.open(${JSON.stringify(sealed)}))`);

test('a message sealed with an old key is read through CHAT_ENCRYPTION_KEYS_OLD', () => {
  const sealed = seal('render-key-A', 'hello from the app');
  assert.ok(sealed.startsWith('enc:v1:'));
  // Another key and no old keys: unreadable (the bug as users saw it).
  assert.equal(open({ CHAT_ENCRYPTION_KEY: 'local-key-B' }, sealed), '[message could not be decrypted]');
  // Same server, old key listed (among others): readable again.
  assert.equal(open({ CHAT_ENCRYPTION_KEY: 'local-key-B', CHAT_ENCRYPTION_KEYS_OLD: 'unrelated, render-key-A ' }, sealed), 'hello from the app');
});

test('new messages are always sealed with the current key, not an old one', () => {
  const sealed = run({ CHAT_ENCRYPTION_KEY: 'current-C', CHAT_ENCRYPTION_KEYS_OLD: 'old-D' }, `process.stdout.write(c.seal('fresh'))`);
  assert.equal(open({ CHAT_ENCRYPTION_KEY: 'current-C' }, sealed), 'fresh');
  assert.equal(open({ CHAT_ENCRYPTION_KEY: 'old-D' }, sealed), '[message could not be decrypted]');
});

test('plain (pre-encryption) values pass through unchanged', () => {
  assert.equal(open({ CHAT_ENCRYPTION_KEY: 'any', CHAT_ENCRYPTION_KEYS_OLD: 'x,y' }, 'legacy plain text'), 'legacy plain text');
});
