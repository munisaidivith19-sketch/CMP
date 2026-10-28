// Scanner input: keyboard-wedge timing parser, serial line framing, payload reading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWedgeParser, isEditableTarget, MIN_SCAN_LENGTH } from '../src/lib/hidWedge.js';
import { createLineFramer } from '../src/lib/serialFraming.js';
import { describePayload, fingerprint } from '../src/lib/payload.js';
import { newScanId } from '../src/lib/scanId.js';

/** Type `text` as key events `gap` ms apart, then the terminator. */
function type(parser, text, { start = 0, gap = 5, end = 'Enter', capsLock = false } = {}) {
  let t = start;
  const consumed = [];
  for (const ch of text) {
    consumed.push(parser.handleKey({ key: ch, capsLock }, t));
    t += gap;
  }
  if (end) consumed.push(parser.handleKey({ key: end }, t));
  return { consumed, t };
}

function collect(opts = {}) {
  const scans = [];
  const problems = [];
  const parser = createWedgeParser({ onScan: (text, meta) => scans.push({ text, meta }), onIncomplete: (r, meta) => problems.push({ r, meta }), ...opts });
  return { parser, scans, problems };
}

test('USB / Bluetooth HID: a fast burst ending in Enter is one complete scan, characters intact', () => {
  const { parser, scans } = collect();
  const token = 'CCRT:aB3_xY-9kLmN0pQrStUvWxYz12345';
  const { consumed } = type(parser, token);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].text, token, 'case, underscores and dashes preserved');
  assert.ok(consumed.slice(1).every(Boolean), 'scanner keys after the first are swallowed (they never type into the page)');
});

test('rapid consecutive scans of different students are each captured separately', () => {
  const { parser, scans } = collect();
  let t = 0;
  for (const code of ['CCGP:A4G5', 'CCGP:B7K2', 'CCGP:Z9Q3']) t = type(parser, code, { start: t + 15 }).t;
  assert.deepEqual(scans.map((s) => s.text), ['CCGP:A4G5', 'CCGP:B7K2', 'CCGP:Z9Q3']);
});

test('a person typing (slow keys) never produces a scan, even when they press Enter', () => {
  const { parser, scans, problems } = collect();
  const { consumed } = type(parser, 'CCGP:A4G5', { gap: 180 });
  assert.equal(scans.length, 0);
  assert.equal(problems.length, 0);
  assert.ok(consumed.every((c) => c === false), 'nothing swallowed: normal typing is untouched');
});

test('incomplete and over-long bursts are reported as input problems, not sent', () => {
  const short = collect();
  type(short.parser, 'CCGP');
  assert.equal(short.scans.length, 0);
  assert.equal(short.problems[0].r, 'too_short');
  assert.ok('CCGP'.length < MIN_SCAN_LENGTH);

  const long = collect();
  type(long.parser, 'X'.repeat(250));
  assert.equal(long.problems[0].r, 'too_long');
});

test('a burst without the configured terminator is flagged as a suffix mismatch', () => {
  const { parser, scans, problems } = collect({ terminator: 'Enter' });
  const { t } = type(parser, 'CCGP:A4G5', { end: null });
  parser.checkStalled(t + 600);
  assert.equal(scans.length, 0);
  assert.equal(problems[0].r, 'no_terminator');
});

test('Tab terminator and no-terminator (idle flush) modes', async () => {
  const tab = collect({ terminator: 'Tab' });
  type(tab.parser, 'CCGP:A4G5', { end: 'Tab' });
  assert.equal(tab.scans[0].text, 'CCGP:A4G5');

  const none = collect({ terminator: 'none' });
  type(none.parser, 'CCGP:A4G5', { end: null });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(none.scans[0]?.text, 'CCGP:A4G5');
});

test('Caps Lock state is reported with the scan; modifier shortcuts reset the buffer', () => {
  const { parser, scans } = collect();
  type(parser, 'CCRT:abcdefghijklmnopqrstuv', { capsLock: true });
  assert.equal(scans[0].meta.capsLock, true);
  const p2 = collect();
  p2.parser.handleKey({ key: 'C' }, 0);
  p2.parser.handleKey({ key: 'v', ctrlKey: true }, 2);
  type(p2.parser, 'CCGP:A4G5', { start: 4 });
  assert.equal(p2.scans[0].text, 'CCGP:A4G5', 'Ctrl+V dropped the partial burst');
});

test('form fields are recognised so typing in them is never treated as a scan', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isEditableTarget({ tagName }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'BODY' }), false);
  assert.equal(isEditableTarget(null), false);
});

test('serial (virtual COM): lines split across chunks, CR / LF / CRLF endings, overflow and disconnect', () => {
  const lines = [];
  const errors = [];
  const framer = createLineFramer({ onLine: (l) => lines.push(l), onError: (e) => errors.push(e) });
  const enc = new TextEncoder();
  framer.push(enc.encode('CCGP:A4'));
  framer.push(enc.encode('G5\r\nCCRT:abc_DEF-ghi'));
  framer.push(enc.encode('jklmnopqrstuv\rCCGP:B7K2\n'));
  assert.deepEqual(lines, ['CCGP:A4G5', 'CCRT:abc_DEF-ghijklmnopqrstuv', 'CCGP:B7K2']);

  framer.push(enc.encode('Y'.repeat(300)));
  assert.deepEqual(errors, ['too_long']);
  framer.push(enc.encode('YYYY\nCCGP:Z9Q3\n'));
  assert.equal(lines.at(-1), 'CCGP:Z9Q3', 'the tail of the over-long line is dropped, the next line is fine');

  framer.push(enc.encode('CCGP:Q'));
  framer.end();
  assert.equal(errors.at(-1), 'incomplete');
});

test('payload reading: direction from the QR prefix, keys never contain the credential', () => {
  const exit = describePayload('ccgp:a4g5');
  assert.equal(exit.direction, 'out');
  assert.equal(exit.key, describePayload('CCGP:A4G5').key, 'case-insensitive exit codes share a key');
  assert.ok(!exit.key.includes('A4G5'));
  const ret = describePayload('CCRT:abcdefghijklmnopqrstuvwx');
  assert.equal(ret.direction, 'in');
  assert.equal(ret.caseSensitive, true);
  assert.ok(!ret.key.includes('abcdefghij'));
  assert.notEqual(describePayload('CCRT:abcdefghijklmnopqrstuvwx').key, describePayload('CCRT:ABCDEFGHIJKLMNOPQRSTUVWX').key);
  assert.equal(describePayload('A4G5', { kind: 'out' }).direction, 'out');
  assert.equal(describePayload('A4G5').direction, null);
  assert.equal(describePayload('https://example.com').label, 'Not a gate pass QR');
  assert.match(fingerprint('x'), /^[0-9a-f]{8}$/);
});

test('scan ids are v4 UUIDs the server accepts', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newScanId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
