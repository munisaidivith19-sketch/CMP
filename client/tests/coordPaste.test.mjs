// Pasting a stop position. TEST DATA ONLY: synthetic coordinates near 13.08 N, 80.27 E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates } from '../src/pages/transport/coordPaste.js';

const P = { lat: 13.08271, lng: 80.27069 };

test('plain "lat, lng" pairs in the usual shapes', () => {
  for (const t of ['13.08271, 80.27069', '13.08271,80.27069', ' 13.08271 80.27069 ', '(13.08271, 80.27069)', '13.08271; 80.27069']) {
    assert.deepEqual(parseCoordinates(t), P, t);
  }
  assert.deepEqual(parseCoordinates('-33.5, -70.25'), { lat: -33.5, lng: -70.25 });
});

test('a single number is not a pair, so typing stays normal', () => {
  assert.equal(parseCoordinates('13.08271'), null);
  assert.equal(parseCoordinates(''), null);
  assert.equal(parseCoordinates('Main gate'), null);
});

test('out-of-range numbers are refused with a reason', () => {
  assert.ok(parseCoordinates('95.1, 80.2').error);
  assert.ok(parseCoordinates('13.1, 190.2').error);
});

test('degrees, minutes, seconds', () => {
  const r = parseCoordinates(`13°04'57.8"N 80°16'14.5"E`);
  assert.ok(Math.abs(r.lat - 13.082722) < 1e-5 && Math.abs(r.lng - 80.270694) < 1e-5, JSON.stringify(r));
  const s = parseCoordinates(`13°04'57.8"S 80°16'14.5"W`);
  assert.ok(s.lat < 0 && s.lng < 0);
});

test('Google Maps links: the pin, ?q=, the place path, then the view centre', () => {
  // The pin (!3d!4d) wins over the view centre (@).
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/Bus+Stop/@13.1,80.3,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.08271!4d80.27069'), P);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps?q=13.08271,80.27069'), P);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/search/?api=1&query=13.08271%2C80.27069'), P);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/place/13.08271,80.27069'), P);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@13.08271,80.27069,17z'), P);
  assert.deepEqual(parseCoordinates('geo:13.08271,80.27069?z=17'), P);
});

test('short share links and links without a position explain what to do', () => {
  assert.match(parseCoordinates('https://maps.app.goo.gl/AbCdEf123').error, /Short share links/);
  assert.match(parseCoordinates('https://www.google.com/maps/place/Chennai').error, /No coordinates/);
  assert.equal(parseCoordinates('https://example.com/page'), null);
});
