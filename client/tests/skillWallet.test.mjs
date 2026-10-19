import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGithubRepo,
  checkHttpsUrl,
  checkProjectDates,
  checkSkills,
  isRealDay,
  normaliseSkills,
  precheckImage,
  publicationSummary,
  DRIVE_HOSTS,
} from '../src/utils/skillWallet.js';

const TODAY = '2026-10-17';

test('developing projects never send an end date', () => {
  const r = checkProjectDates({ stage: 'developing', startedAt: '2026-09-01', endedAt: '2026-10-01' }, TODAY);
  assert.deepEqual(r.errors, {});
  assert.equal(r.payload.endedAt, null);
});

test('implemented projects need a valid end date', () => {
  assert.ok(checkProjectDates({ stage: 'implemented', startedAt: '2026-09-01', endedAt: '' }, TODAY).errors.endedAt);
  assert.match(checkProjectDates({ stage: 'implemented', startedAt: '2026-09-01', endedAt: '2026-08-01' }, TODAY).errors.endedAt, /earlier/);
  assert.match(checkProjectDates({ stage: 'implemented', startedAt: '2026-09-01', endedAt: '2026-11-01' }, TODAY).errors.endedAt, /future/);
  const ok = checkProjectDates({ stage: 'implemented', startedAt: '2026-09-01', endedAt: '2026-09-01' }, TODAY);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.payload.endedAt, '2026-09-01');
});

test('start date must be a real, past date', () => {
  assert.ok(checkProjectDates({ stage: 'developing', startedAt: '2026-02-30' }, TODAY).errors.startedAt);
  assert.ok(checkProjectDates({ stage: 'developing', startedAt: '2026-12-01' }, TODAY).errors.startedAt);
  assert.equal(isRealDay('2024-02-29'), true);
  assert.equal(isRealDay('2025-02-29'), false);
});

test('skills are normalised like the server does', () => {
  assert.deepEqual(normaliseSkills('ESP32, mqtt ,  React   Native,esp32'), ['esp32', 'mqtt', 'react native']);
  assert.equal(checkSkills(['c++', 'c#', 'node.js', '.net']), null);
  assert.ok(checkSkills(['<script>']));
  assert.ok(checkSkills(Array.from({ length: 21 }, (_, i) => `s${i}`)));
});

test('URL checks reject unsafe schemes, credentials and private hosts', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://github.com/a/b', 'https://user:pw@github.com/a/b', 'https://localhost/x', 'https://10.0.0.1/x', 'nonsense']) {
    assert.ok(checkHttpsUrl(bad), bad);
  }
  assert.equal(checkHttpsUrl('https://leetcode.com/u/someone/'), null);
  assert.equal(checkHttpsUrl(''), null, 'optional when empty');
  assert.ok(checkGithubRepo('https://github.com/owner'));
  assert.ok(checkGithubRepo('https://github.com.evil.io/a/b'));
  assert.equal(checkGithubRepo('https://github.com/owner/repo'), null);
  assert.ok(checkHttpsUrl('https://drive.google.com.evil.io/x', { hosts: DRIVE_HOSTS }));
  assert.equal(checkHttpsUrl('https://drive.google.com/drive/folders/abc', { hosts: DRIVE_HOSTS }), null);
});

test('image pre-check allows only PNG / JPEG / WebP within the size limit', () => {
  const f = (name, type, size = 1000) => ({ name, type, size });
  assert.equal(precheckImage(f('a.png', 'image/png')), null);
  assert.equal(precheckImage(f('a.JPG', '')), null);
  assert.equal(precheckImage(f('a.webp', 'image/webp')), null);
  for (const bad of [f('a.pdf', 'application/pdf'), f('a.svg', 'image/svg+xml'), f('a.gif', 'image/gif'), f('a.heic', 'image/heic'), f('a.bmp', 'image/bmp'), f('a.tiff', 'image/tiff')]) {
    assert.ok(precheckImage(bad), bad.name);
  }
  assert.ok(precheckImage(f('a.png', 'image/png', 6 * 1024 * 1024)));
  assert.ok(precheckImage(f('a.png', 'image/png', 0)));
});

test('publication summary explains the state in plain words', () => {
  assert.equal(publicationSummary({ visibility: 'private' }), 'Private');
  assert.equal(publicationSummary({ visibility: 'private', publicRequest: { revision: 1 } }), 'Waiting for team confirmation to go public');
  assert.equal(publicationSummary({ visibility: 'public', revision: 2, published: { revision: 2 } }), 'Public');
  assert.match(publicationSummary({ visibility: 'public', revision: 3, published: { revision: 2 } }), /earlier/);
  assert.equal(publicationSummary({ visibility: 'public', hidden: true }), 'Hidden by a moderator');
});
