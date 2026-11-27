import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatGate, newScanId } from '../src/utils/gateQr.js';

test('fast scan sends each new QR at once and ignores the same QR held in view', () => {
  let t = 0;
  const sent = [];
  const gate = createRepeatGate((v) => sent.push(v), { windowMs: 3000, now: () => t });
  assert.equal(gate.handle('CCGP:AB12'), true);
  for (t = 100; t < 2000; t += 100) assert.equal(gate.handle('CCGP:AB12'), false, 'held in front of the camera');
  t = 2050;
  assert.equal(gate.handle('CCGP:CD34'), true, 'next student straight away');
  t = 2100;
  assert.equal(gate.handle('CCGP:EF56'), true);
  t = 9000;
  assert.equal(gate.handle('CCGP:AB12'), true, 'shown again after leaving view');
  assert.deepEqual(sent, ['CCGP:AB12', 'CCGP:CD34', 'CCGP:EF56', 'CCGP:AB12']);
  assert.equal(gate.handle(''), false);
});

test('scan ids are unique and match the server pattern', () => {
  const ids = new Set(Array.from({ length: 50 }, newScanId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9-]{8,64}$/);
});
