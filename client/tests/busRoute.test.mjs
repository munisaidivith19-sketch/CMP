// Route line, stops and route-editor helpers. TEST DATA ONLY: synthetic coordinates near 13.000 N, 80.000 E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIEW, busStatus, initialFit, routeLine, routeSummary, stopFeatures, stopsSignature } from '../src/pages/transport/busGeo.js';

const STOPS = [
  { _id: 'b', name: 'Synthetic B', lat: 13.01, lng: 80.0, sequence: 2 },
  { _id: 'a', name: 'Synthetic A', lat: 13.0, lng: 80.0, sequence: 1 },
  { _id: 'c', name: 'Synthetic College', lat: 13.02, lng: 80.0, sequence: 3 },
];
const ROAD = [[80.0, 13.0], [80.002, 13.004], [80.0, 13.01], [80.001, 13.016], [80.0, 13.02]];

test('road geometry is drawn as exact, reading GeoJSON [longitude, latitude] order', () => {
  const { points, exact } = routeLine({ stops: STOPS, geometry: ROAD });
  assert.equal(exact, true);
  assert.deepEqual(points[1], { lat: 13.004, lng: 80.002 });
  assert.equal(points.length, ROAD.length);
});

test('without road geometry the line is straight stop-to-stop, in travel order, and flagged approximate', () => {
  for (const geometry of [undefined, null, [], [[80, 13]]]) {
    const { points, exact } = routeLine({ stops: STOPS, geometry });
    assert.equal(exact, false, JSON.stringify(geometry));
    assert.deepEqual(points.map((p) => p.lat), [13.0, 13.01, 13.02]);
  }
  assert.deepEqual(routeLine(null), { points: [], exact: false });
});

test('stops: first is the start, last is the end, labels say so; selection and passed state kept', () => {
  const fc = stopFeatures(STOPS, { selectedStopId: 'b', passed: [1] });
  const [a, b, c] = fc.features.map((f) => f.properties);
  assert.equal(a.role, 'start');
  assert.equal(a.name, 'Start · 1. Synthetic A');
  assert.equal(a.passed, true);
  assert.equal(b.role, 'stop');
  assert.equal(b.name, '2. Synthetic B');
  assert.equal(b.selected, true);
  assert.equal(c.role, 'end');
  assert.equal(c.name, 'End · 3. Synthetic College');
  assert.deepEqual(fc.features[0].geometry.coordinates, [80.0, 13.0], 'points are [lng, lat]');
});

test('stops without usable coordinates are left off the map instead of drawn at 0,0', () => {
  const fc = stopFeatures([{ name: 'X', lat: '', lng: 'abc', sequence: 1 }, ...STOPS]);
  assert.equal(fc.features.length, 3);
  assert.deepEqual(stopFeatures(undefined).features, []);
});

test('the stop signature changes when a stop moves, is added or the order changes — not on renames', () => {
  const base = stopsSignature([STOPS[1], STOPS[0], STOPS[2]]);
  assert.equal(base, stopsSignature([{ ...STOPS[1], name: 'Renamed' }, STOPS[0], STOPS[2]]));
  assert.equal(base, stopsSignature([{ ...STOPS[1], lat: '13.0' }, STOPS[0], STOPS[2]]), 'form strings compare as numbers');
  assert.notEqual(base, stopsSignature([{ ...STOPS[1], lat: 13.0005 }, STOPS[0], STOPS[2]]));
  assert.notEqual(base, stopsSignature([STOPS[0], STOPS[1], STOPS[2]]), 'reordered');
  assert.notEqual(base, stopsSignature([STOPS[1], STOPS[0]]), 'removed');
});

test('route summary never invents numbers', () => {
  assert.equal(routeSummary(12400, 2100), '12.4 km · about 35 min by road (no traffic)');
  assert.equal(routeSummary(640, null), '640 m');
  assert.equal(routeSummary(null, undefined), '');
});

test('a phone-shared bus whose trip ended is "not sharing" — its old position is never live', () => {
  const now = 1_700_000_000_000;
  const loc = { lat: 13, lng: 80, at: new Date(now - 5000).toISOString() };
  const t = { liveSeconds: 60, staleSeconds: 300 };
  assert.equal(busStatus({ gpsSource: 'phone', trip: { status: 'active' } }, loc, t, now), 'live');
  assert.equal(busStatus({ gpsSource: 'phone', trip: null }, loc, t, now), 'not_sharing', 'stopped seconds ago: still not live');
  assert.equal(busStatus({ gpsSource: 'phone', trip: { status: 'active' } }, { ...loc, at: new Date(now - 120000).toISOString() }, t, now), 'stale');
  assert.equal(busStatus({ gpsSource: 'tracker', trip: null }, loc, t, now), 'live', 'trackers report without trips');
  assert.equal(busStatus({ gpsSource: 'phone', trip: { status: 'active' } }, null, t, now), 'offline');
});

test('maps open on Chennai at city level, [longitude, latitude]; a bus in the link is framed first', () => {
  const [lng, lat] = DEFAULT_VIEW.center;
  assert.ok(Math.abs(lat - 13.08) < 0.05 && Math.abs(lng - 80.27) < 0.05, 'Chennai, not swapped');
  assert.ok(DEFAULT_VIEW.zoom >= 10 && DEFAULT_VIEW.zoom <= 12, 'city level, not the whole world');
  assert.equal(initialFit('bus-1').kind, 'bus');
  assert.equal(initialFit('').kind, 'all');
});
