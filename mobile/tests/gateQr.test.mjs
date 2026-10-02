import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanGate, GATE_QR_PREFIX, scanProblem } from '../src/utils/gateQr.js';

test('Vexon exit and return QR payloads pass on the screen they belong to', () => {
  assert.equal(scanProblem('CCGP:A4G5', 'exit'), null);
  assert.equal(scanProblem('ccgp:5ag4', 'exit'), null, 'case-insensitive prefix');
  assert.equal(scanProblem('CCRT:abcDEF123_-xyzXYZ789abcdef', 'return'), null);
  assert.equal(GATE_QR_PREFIX.exit, 'CCGP:');
  assert.equal(GATE_QR_PREFIX.return, 'CCRT:');
});

test('foreign QR codes are rejected as "Invalid Gate Pass QR code."', () => {
  for (const foreign of ['https://example.com/pay', 'upi://pay?pa=shop@bank', 'A4G5', '', null, undefined, 'WIFI:S:x;;']) {
    assert.equal(scanProblem(foreign, 'exit'), 'Invalid Gate Pass QR code.', String(foreign));
    assert.equal(scanProblem(foreign, 'return'), 'Invalid Gate Pass QR code.', String(foreign));
  }
});

test('a QR scanned on the wrong screen is named, not sent', () => {
  assert.match(scanProblem('CCRT:abcDEF123_-xyzXYZ789abcdef', 'exit'), /return QR/);
  assert.match(scanProblem('CCGP:A4G5', 'return'), /exit QR/);
});

test('the scan gate fires once per arming, so repeated frames cannot cause duplicate requests', () => {
  const sent = [];
  const gate = createScanGate((v) => sent.push(v));
  assert.equal(gate.fired, false);
  assert.equal(gate.handle({ type: 'qr', data: 'CCGP:A4G5' }), true);
  for (let i = 0; i < 25; i += 1) assert.equal(gate.handle({ type: 'qr', data: 'CCGP:A4G5' }), false);
  assert.equal(gate.handle({ type: 'qr', data: 'CCGP:ZZ99' }), false, 'a different code after the first is ignored too');
  assert.deepEqual(sent, ['CCGP:A4G5'], 'exactly one value delivered, unchanged');

  gate.reset();
  assert.equal(gate.handle({ type: 'qr', data: 'CCRT:tokentokentokentoken' }), true, 'scan again works after reset');
  assert.deepEqual(sent, ['CCGP:A4G5', 'CCRT:tokentokentokentoken']);
});

test('empty detections are ignored and do not consume the single scan', () => {
  const sent = [];
  const gate = createScanGate((v) => sent.push(v));
  assert.equal(gate.handle({ type: 'qr', data: '' }), false);
  assert.equal(gate.handle(undefined), false);
  assert.equal(gate.fired, false);
  assert.equal(gate.handle({ type: 'qr', data: 'CCGP:G54A' }), true);
  assert.deepEqual(sent, ['CCGP:G54A']);
});

test('the scanned value is passed through exactly — the case-sensitive return token is not altered', () => {
  const sent = [];
  createScanGate((v) => sent.push(v)).handle({ data: 'CCRT:AbC-dEf_123xYz789QrStUv' });
  assert.equal(sent[0], 'CCRT:AbC-dEf_123xYz789QrStUv');
});
