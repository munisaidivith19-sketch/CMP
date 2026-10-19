import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, groupCauses, isFinal, percentLabel, statusTone, telemetryNotice, verifyState, STATUS_MEANING } from '../src/pages/superadmin/socModel.js';

test('statuses that prove nothing are never shown as healthy (green)', () => {
  assert.equal(statusTone('PASS'), 'success');
  for (const s of ['SKIPPED', 'INCONCLUSIVE', 'TIMED_OUT', 'CANCELLED', 'UNKNOWN', 'SOMETHING_NEW', undefined]) {
    assert.notEqual(statusTone(s), 'success', String(s));
  }
  assert.equal(statusTone('FAIL'), 'danger');
  assert.equal(statusTone('DEGRADED'), 'warning');
  for (const s of ['PASS', 'FAIL', 'WARNING', 'SKIPPED', 'INCONCLUSIVE', 'TIMED_OUT']) assert.ok(STATUS_MEANING[s], s);
  assert.match(STATUS_MEANING.UNKNOWN, /not the same as healthy/);
});

test('missing data reads differently from zero', () => {
  assert.equal(countLabel(0), '0');
  assert.equal(countLabel(null), 'No data');
  assert.equal(countLabel(undefined), 'No data');
  assert.equal(percentLabel(null), 'No data');
  assert.equal(percentLabel(0), '0.0 %');
  assert.equal(percentLabel(0.0004), '<0.1 %');
  assert.equal(percentLabel(0.025), '2.5 %');
});

test('telemetry notice explains incomplete or missing counters', () => {
  assert.match(telemetryNotice({ coverageStart: null }), /unavailable, not zero/);
  assert.match(telemetryNotice({ coverageStart: '2026-10-17T10:00:00Z', complete: false }), /earlier parts of the range have no data/);
  assert.match(telemetryNotice({ coverageStart: '2026-10-01T00:00:00Z', complete: true }), /whole range/);
  assert.match(telemetryNotice({ lastFlushError: 'db down', coverageStart: 'x', complete: true }), /could not be saved/);
  assert.match(telemetryNotice(null), /unknown/);
});

test('causes are grouped confirmed → possible → unverified, empty groups dropped', () => {
  const g = groupCauses([{ id: 'a', kind: 'possible' }, { id: 'b', kind: 'confirmed' }, { id: 'c', kind: 'possible' }]);
  assert.deepEqual(g.map((x) => x.kind), ['confirmed', 'possible']);
  assert.equal(g[1].items.length, 2);
  assert.equal(g[0].label, 'Confirmed finding');
  assert.deepEqual(groupCauses([]), []);
});

test('verify is only offered once a fix is marked applied', () => {
  assert.equal(verifyState('fix_applied').enabled, true);
  for (const s of ['open', 'acknowledged', 'investigating', 'resolved']) assert.equal(verifyState(s).enabled, false, s);
  assert.equal(isFinal('RUNNING'), false);
  assert.equal(isFinal('QUEUED'), false);
  assert.equal(isFinal('TIMED_OUT'), true);
});
