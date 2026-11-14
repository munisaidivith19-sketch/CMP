// Bus-map helpers. TEST DATA ONLY: synthetic coordinates near 13.000 N, 80.000 E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accuracyCircle, accuracyText, agoText, boundsOf, etaText, freshnessOf, lerpPosition, reliableHeading, remainingPath, routeAhead, shortestTurn } from '../src/pages/transport/busGeo.js';

// ── Off route: the road path back, never a straight line (SYNTHETIC coordinates) ──
const LINE = [{ lat: 13.0, lng: 80.0 }, { lat: 13.01, lng: 80.0 }, { lat: 13.02, lng: 80.0 }];
const OFF_BUS = { lat: 13.01, lng: 80.005 }; // ~540 m east of the route

test('on its route the line ahead starts at the bus, as before', () => {
  const a = routeAhead(LINE, { lat: 13.011, lng: 80 }, null);
  assert.deepEqual(a.route, remainingPath(LINE, { lat: 13.011, lng: 80 }));
  assert.deepEqual(a.detour, []);
  assert.equal(a.offRoute, false);
});

test('off route with a road path: the road back, then the route from where it rejoins', () => {
  const road = [[80.005, 13.01], [80.004, 13.012], [80.001, 13.011], [80.0, 13.01]];
  const a = routeAhead(LINE, OFF_BUS, { status: 'ok', geometry: road });
  assert.equal(a.offRoute, true);
  assert.deepEqual(a.detour, road.map(([lng, lat]) => ({ lat, lng })));
  // The route part starts at the rejoin point (on the route), not at the off-route bus.
  assert.deepEqual(a.route[0], { lat: 13.01, lng: 80.0 });
  assert.ok(a.route.every((p) => p.lng === 80.0), 'no point of the route line is off the route');
});

test('off route without a road path: no line reaches the bus at all', () => {
  for (const detour of [{ status: 'pending' }, { status: 'unavailable', reason: 'x' }, { status: 'ok', geometry: [[80, 13]] }]) {
    const a = routeAhead(LINE, OFF_BUS, detour);
    assert.equal(a.offRoute, true);
    assert.deepEqual(a.detour, []);
    assert.ok(!a.route.some((p) => p.lng === OFF_BUS.lng && p.lat === OFF_BUS.lat), JSON.stringify(detour));
    assert.ok(a.route.every((p) => p.lng === 80.0));
  }
});

test('the road path is drawn from the bus’s current place on it, not from where it was first asked', () => {
  const road = [[80.005, 13.01], [80.004, 13.012], [80.001, 13.011], [80.0, 13.01]];
  const a = routeAhead(LINE, { lat: 13.0119, lng: 80.0041 }, { status: 'ok', geometry: road });
  assert.deepEqual(a.detour[0], { lat: 13.012, lng: 80.004 });
  assert.equal(a.detour.length, 3);
});

test('accuracy label and area are shown exactly as the device reported them', () => {
  assert.equal(accuracyText(400), '± 400 m');
  assert.equal(accuracyText(2400), '± 2.4 km');
  assert.equal(accuracyText(undefined), '', 'no accuracy reported → none invented');
  const ring = accuracyCircle(13, 80, 100).geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'closed ring');
});

test('marker motion interpolates between fixes and never overshoots', () => {
  const a = { lat: 13.0, lng: 80.0 };
  const b = { lat: 13.01, lng: 80.02 };
  assert.deepEqual(lerpPosition(a, b, 0), a);
  assert.deepEqual(lerpPosition(a, b, 1), b);
  const mid = lerpPosition(a, b, 0.5);
  assert.ok(Math.abs(mid.lat - 13.005) < 1e-9 && Math.abs(mid.lng - 80.01) < 1e-9);
  assert.deepEqual(lerpPosition(a, b, 7), b, 'clamped');
});

test('rotation turns the short way and only with a reliable heading', () => {
  assert.equal(shortestTurn(350, 10), 20);
  assert.equal(shortestTurn(10, 350), -20);
  assert.equal(shortestTurn(0, 180), 180);
  assert.equal(reliableHeading({ heading: 90, speed: 8 }), 90);
  assert.equal(reliableHeading({ heading: 90, speed: 0.5 }), null, 'parked: heading is noise');
  assert.equal(reliableHeading({ heading: null, speed: 8 }), null);
});

test('freshness and age labels: a fix is never shown as live once it is old', () => {
  const now = Date.parse('2026-10-19T03:00:00Z');
  assert.equal(freshnessOf(null, {}, now), 'offline');
  assert.equal(freshnessOf(new Date(now - 30000), {}, now), 'live');
  assert.equal(freshnessOf(new Date(now - 120000), {}, now), 'stale');
  assert.equal(freshnessOf(new Date(now - 900000), {}, now), 'offline');
  assert.equal(agoText(new Date(now - 3000), now), 'just now');
  assert.equal(agoText(new Date(now - 125000), now), '2 min ago');
});

test('ETA text shows unavailability and low confidence honestly', () => {
  assert.equal(etaText({ status: 'unavailable', reason: 'Tracking is offline — no recent GPS position' }), 'Tracking is offline — no recent GPS position');
  assert.match(etaText({ status: 'ok', minutes: 4, arrivalAt: '2026-10-19T03:04:00Z', confidence: 'high' }), /^about 4 min · /);
  assert.match(etaText({ status: 'ok', minutes: 4, arrivalAt: '2026-10-19T03:04:00Z', confidence: 'low' }), /approximate/);
});

test('viewport bounds include the student and the bus; the remaining route starts at the bus', () => {
  const b = boundsOf([{ lat: 13.0, lng: 80.0 }, { lat: 13.02, lng: 80.01 }, null]);
  assert.deepEqual(b, [[80.0, 13.0], [80.01, 13.02]]);
  assert.equal(boundsOf([]), null);
  const route = [{ lat: 13.0, lng: 80 }, { lat: 13.01, lng: 80 }, { lat: 13.02, lng: 80 }];
  const rest = remainingPath(route, { lat: 13.011, lng: 80 });
  assert.deepEqual(rest[0], { lat: 13.011, lng: 80 });
  assert.deepEqual(rest.slice(1), [{ lat: 13.02, lng: 80 }]);
});
