import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectDB } from '../src/config/db.js';

test('connectDB retries a transient failure instead of exiting', async () => {
  let calls = 0;
  const origExit = process.exit;
  let exited = false;
  process.exit = () => { exited = true; };
  try {
    await connectDB('mongodb://unused', {
      attempts: 3,
      delayMs: 1,
      connect: async () => {
        calls += 1;
        if (calls < 2) throw new Error('read ECONNRESET');
      },
    });
  } finally {
    process.exit = origExit;
  }
  assert.equal(calls, 2);
  assert.equal(exited, false);
});

test('connectDB exits after all attempts fail', async () => {
  let calls = 0;
  const origExit = process.exit;
  let exitCode;
  process.exit = (code) => { exitCode = code; };
  try {
    await connectDB('mongodb://unused', {
      attempts: 2,
      delayMs: 1,
      connect: async () => { calls += 1; throw new Error('read ECONNRESET'); },
    });
  } finally {
    process.exit = origExit;
  }
  assert.equal(calls, 2);
  assert.equal(exitCode, 1);
});
