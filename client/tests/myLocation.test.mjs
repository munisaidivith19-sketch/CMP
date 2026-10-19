// "My location" on the bus map. Geolocation is mocked — no real GPS is used.
// TEST DATA ONLY: synthetic coordinates near 13.000 N, 80.000 E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_ONLY_M, accuracyBounds, createLocator, myLocationMessage, recordingGeo, showsDot, sourceOf, stateOfFix, syncUserMarker, toMyFix } from '../src/pages/transport/myLocation.js';

const pos = (lat, lng, accuracy, ageMs = 0) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() - ageMs });

/** A fake navigator.geolocation: emits the given readings (or an error) and records watch start/stop. */
function fakeGeo(readings = [], { error, gapMs = 5 } = {}) {
  const geo = {
    active: 0,
    started: 0,
    watchPosition(ok, fail) {
      geo.active += 1;
      geo.started += 1;
      let live = true;
      const id = geo.started;
      geo.stops[id] = () => (live = false);
      if (error) setTimeout(() => live && fail(error), gapMs);
      readings.forEach((r, i) => setTimeout(() => live && ok(typeof r === 'function' ? r() : r), gapMs * (i + 1)));
      return id;
    },
    clearWatch(id) {
      geo.stops[id]?.();
      delete geo.stops[id];
      geo.active -= 1;
    },
    stops: {},
  };
  return geo;
}

const fakeWin = (geo, { secure = true, permission = 'prompt' } = {}) => ({
  isSecureContext: secure,
  navigator: { geolocation: geo, permissions: { query: async () => ({ state: permission }) } },
});

/** Run one request and collect every state change. */
async function run(win, opts = {}) {
  const seen = [];
  const l = createLocator({ win, onChange: (s) => seen.push(s), sampleMs: 120, refineMs: 120, ...opts });
  await l.request();
  return { seen, last: seen[seen.length - 1], locator: l };
}

test('1+2. a valid browser location is shown at exactly its latitude / longitude', async () => {
  const geo = fakeGeo([pos(13.0001, 80.0002, 12)]);
  const { seen, last } = await run(fakeWin(geo));
  assert.equal(seen[0].state, 'requesting');
  assert.equal(seen[0].message, 'Getting your location…');
  assert.equal(last.state, 'available');
  assert.equal(last.fix.lat, 13.0001);
  assert.equal(last.fix.lng, 80.0002);
  assert.equal(last.message, 'Location found. Accuracy: about 12 m.');
  // GeoJSON / MapLibre order is [lng, lat]: the bounds are centred on the fix, not swapped.
  const [[w, s], [e, n]] = accuracyBounds(last.fix);
  assert.ok(Math.abs((w + e) / 2 - 80.0002) < 1e-9 && Math.abs((s + n) / 2 - 13.0001) < 1e-9);
  assert.equal(geo.active, 0, 'listening stopped');
});

test('3. invalid coordinates are rejected — never drawn', async () => {
  assert.equal(toMyFix(pos(95, 80, 10)), null, 'latitude out of range');
  assert.equal(toMyFix(pos(13, 200, 10)), null, 'longitude out of range');
  assert.equal(toMyFix(pos(NaN, 80, 10)), null);
  assert.equal(toMyFix(pos(0, 0, 10)), null, '0,0 is a failed reading, not a place');
  assert.equal(toMyFix({ coords: { latitude: 13, longitude: 80 }, timestamp: Date.now() }), null, 'no accuracy → not invented');
  assert.equal(toMyFix(null), null);
  const { last } = await run(fakeWin(fakeGeo()), { read: async () => pos(0, 0, 10) });
  assert.equal(last.state, 'invalid');
  assert.equal(last.fix, null);
});

test('4. permission denied — and a site already blocked says how to unblock it', async () => {
  const denied = await run(fakeWin(fakeGeo([], { error: { code: 1 } })));
  assert.equal(denied.last.state, 'permission_denied');
  assert.match(denied.last.message, /Location permission denied/);
  const blocked = await run(fakeWin(fakeGeo([], { error: { code: 1 } }), { permission: 'denied' }));
  assert.equal(blocked.last.state, 'permission_denied');
  assert.match(blocked.last.message, /blocked for this site/);
});

test('5. no reading in time is a timeout, with nothing drawn', async () => {
  const geo = fakeGeo([]);
  const { last } = await run(fakeWin(geo));
  assert.equal(last.state, 'timeout');
  assert.equal(last.fix, null);
  assert.equal(geo.active, 0);
});

test('6. missing geolocation support or an insecure (http) page is reported, not attempted', async () => {
  const unsupported = await run({ isSecureContext: true, navigator: {} });
  assert.equal(unsupported.last.state, 'unavailable');
  assert.match(unsupported.last.message, /cannot share its location/);
  const insecure = await run(fakeWin(fakeGeo(), { secure: false }));
  assert.equal(insecure.last.state, 'unavailable');
  assert.match(insecure.last.message, /https/);
  assert.equal(insecure.seen.some((s) => s.state === 'requesting'), false);
});

test('7. a Wi-Fi / IP estimate is labelled approximate with its reported accuracy', async () => {
  const { last } = await run(fakeWin(fakeGeo([pos(13.02, 80.03, 1500)])));
  assert.equal(last.state, 'approximate');
  assert.match(last.message, /± 1\.5 km/);
  assert.equal(stateOfFix({ accuracy: 100 }), 'available');
  assert.equal(stateOfFix({ accuracy: 101 }), 'approximate');
});

test('8a. ROOT CAUSE: an old cached reading never beats a fresh one, however precise it claims to be', async () => {
  // A cached ±10 m fix from an hour ago (somewhere else), then the fresh reading of where the device is now.
  const geo = fakeGeo([pos(13.3, 80.3, 10, 3600_000), () => pos(13.0001, 80.0001, 45)]);
  const { last } = await run(fakeWin(geo));
  assert.equal(last.fix.lat, 13.0001, 'the fresh position, not the stale one');
  assert.equal(last.state, 'available');
  const onlyOld = await run(fakeWin(fakeGeo([pos(13.3, 80.3, 10, 3600_000)])));
  assert.equal(onlyOld.last.state, 'timeout');
  assert.match(onlyOld.last.message, /old location reading/);
  assert.equal(onlyOld.last.fix, null);
});

test('8b. an older request answering late cannot overwrite a newer one', async () => {
  const pending = [];
  const read = (_geo, { signal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, signal });
    signal.addEventListener('abort', () => reject({ kind: 'aborted' }));
  });
  const seen = [];
  const l = createLocator({ win: fakeWin(fakeGeo()), onChange: (s) => seen.push(s), read });
  const first = l.request();
  await new Promise((r) => setTimeout(r, 5));
  const second = l.request();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pending[0].signal.aborted, true, 'the first request was cancelled');
  pending[1].resolve(pos(13.0002, 80.0002, 15));
  pending[0].resolve(pos(13.9, 80.9, 5)); // late, from the superseded request
  await Promise.all([first, second]);
  const fixes = seen.filter((s) => s.fix);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].fix.lat, 13.0002);
});

test('9. My location can be retried after a failure and then succeeds', async () => {
  let attempt = 0;
  const read = async () => {
    attempt += 1;
    if (attempt === 1) throw { kind: 'timeout' };
    return pos(13.0003, 80.0003, 9);
  };
  const seen = [];
  const l = createLocator({ win: fakeWin(fakeGeo()), onChange: (s) => seen.push(s), read });
  await l.request();
  assert.equal(seen.at(-1).state, 'timeout');
  await l.request();
  assert.equal(seen.at(-1).state, 'available');
  assert.equal(seen.at(-1).fix.lat, 13.0003);
});

test('10+13. repeated clicks keep ONE user marker, separate from bus markers', () => {
  let created = 0;
  const busMarkers = new Map([['bus-1', { id: 'bus-1' }]]);
  const create = (fix) => {
    created += 1;
    return { at: [fix.lng, fix.lat], removed: false, setLngLat(p) { this.at = p; }, remove() { this.removed = true; } };
  };
  let marker = null;
  marker = syncUserMarker(marker, { lat: 13.0, lng: 80.0, accuracy: 10 }, create);
  marker = syncUserMarker(marker, { lat: 13.001, lng: 80.002, accuracy: 10 }, create);
  marker = syncUserMarker(marker, { lat: 13.002, lng: 80.004, accuracy: 10 }, create);
  assert.equal(created, 1, 'created once, then moved');
  assert.deepEqual(marker.at, [80.004, 13.002], '[lng, lat] for MapLibre');
  assert.deepEqual([...busMarkers.keys()], ['bus-1'], 'bus markers untouched');
  const old = marker;
  marker = syncUserMarker(marker, null, create);
  assert.equal(marker, null);
  assert.equal(old.removed, true);
});

test('11. leaving the page stops the watcher and silences the pending request', async () => {
  const geo = fakeGeo([], { gapMs: 50 });
  const seen = [];
  const l = createLocator({ win: fakeWin(geo), onChange: (s) => seen.push(s), sampleMs: 500 });
  const p = l.request();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(geo.active, 1);
  l.stop();
  await p;
  assert.equal(geo.active, 0, 'clearWatch called');
  assert.deepEqual(seen.map((s) => s.state), ['requesting'], 'nothing reported after stop');
  // A second click while the first is still listening never leaves two watchers.
  const geo2 = fakeGeo([], { gapMs: 50 });
  const l2 = createLocator({ win: fakeWin(geo2), onChange: () => {}, sampleMs: 100 });
  const a = l2.request();
  await new Promise((r) => setTimeout(r, 10));
  const b = l2.request();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(geo2.active, 1, 'one watcher at a time');
  await Promise.all([a, b]);
  assert.equal(geo2.active, 0);
});

test('12. no failure ever produces a position — a default map centre is never shown as "you"', async () => {
  for (const kind of ['denied', 'unavailable', 'timeout', 'stale']) {
    const { seen } = await run(fakeWin(fakeGeo()), { read: async () => { throw { kind }; } });
    assert.ok(seen.every((s) => s.fix === null), kind);
    assert.deepEqual(Object.keys(seen.at(-1)).sort(), ['fix', 'message', 'readings', 'seq', 'state']);
  }
  assert.equal(myLocationMessage('idle'), '');
});

test('the zoom frames the accuracy: a rough estimate is shown zoomed out, never at street level', () => {
  const span = (b) => b[1][1] - b[0][1];
  const precise = accuracyBounds({ lat: 13, lng: 80, accuracy: 8 });
  const rough = accuracyBounds({ lat: 13, lng: 80, accuracy: 3000 });
  assert.ok(span(rough) > 40 * span(precise));
  assert.ok(Math.abs(span(precise) - (2 * 60) / 111195) < 1e-9, 'a ±8 m fix is framed at ±60 m, not over-zoomed');
});

test('ROOT CAUSE (city shown instead of the village): an IP-level estimate is labelled, warned about and never drawn as "you"', async () => {
  // TEST DATA: the browser has no GPS / Wi-Fi fix and falls back to the IP
  // estimate — a synthetic hub-city point ~300 km from the device, ±25 km.
  const ipEstimate = pos(16.0, 80.5, 25000);
  const geo = fakeGeo([ipEstimate]);
  const { last } = await run(fakeWin(geo));
  assert.equal(last.state, 'approximate');
  assert.equal(last.fix.source, 'ip');
  assert.equal(showsDot(last.fix), false, 'only the shaded area is drawn');
  assert.match(last.message, /internet connection/);
  assert.match(last.message, /hundreds of km/);
  assert.match(last.message, /± 25\.0 km/);
  // The coordinates are the device's own — passed through unchanged, never replaced or "corrected".
  assert.equal(last.fix.lat, 16.0);
  assert.equal(last.fix.lng, 80.5);
  // A real GPS fix is drawn as a dot.
  assert.equal(showsDot({ accuracy: 12 }), true);
  assert.equal(showsDot({ accuracy: AREA_ONLY_M + 1 }), false);
});

test('likely source is inferred from what the browser reports, and always labelled "likely"', () => {
  assert.equal(sourceOf({ accuracy: 8 }).key, 'gps');
  assert.equal(sourceOf({ accuracy: 60, altitude: 41 }).key, 'gps', 'altitude only comes with satellite fixes');
  assert.equal(sourceOf({ accuracy: 60 }).key, 'wifi');
  assert.equal(sourceOf({ accuracy: 1200 }).key, 'cell');
  assert.equal(sourceOf({ accuracy: 20000 }).key, 'ip');
  assert.equal(sourceOf({}).key, 'unknown');
  assert.match(sourceOf({ accuracy: 8 }).label, /likely/);
});

test('every raw reading is recorded with lat, lng, accuracy, timestamp, age, source and verdict', async () => {
  const geo = fakeGeo([pos(13.5, 80.5, 10, 3600_000), pos(0, 0, 10), () => pos(13.0001, 80.0001, 15)]);
  const logged = [];
  const seen = [];
  const l = createLocator({ win: fakeWin(geo), onChange: (s) => seen.push(s), sampleMs: 300, log: (what, data) => logged.push(what) });
  await l.request();
  const last = seen.at(-1);
  assert.deepEqual(last.readings.map((r) => r.verdict), ['stale', 'invalid', 'fresh']);
  const used = last.readings[2];
  assert.equal(used.lat, 13.0001);
  assert.equal(used.lng, 80.0001);
  assert.equal(used.accuracy, 15);
  assert.ok(Number.isFinite(used.timestamp) && used.ageMs >= 0 && used.ageMs < 1000);
  assert.match(used.source, /GPS/);
  assert.ok(last.readings[0].ageMs >= 3600_000, 'the cached reading is visibly an hour old');
  assert.equal(last.fix.lat, 13.0001, 'only the fresh, valid reading is used');
  assert.deepEqual(logged, ['requesting a fresh high-accuracy position', 'reading', 'reading', 'reading', 'used']);
  // The recorder passes readings through unchanged and stops with the watch.
  const inner = fakeGeo([pos(13, 80, 5)]);
  const rec = recordingGeo(inner, () => {});
  const id = rec.watchPosition(() => {}, () => {});
  rec.clearWatch(id);
  assert.equal(inner.active, 0);
});

/**
 * A fake Windows location service replaying what was MEASURED on the user's
 * laptop: the internet-provider (IP) estimate at ±50 km comes first and keeps
 * repeating; the ±500 m Wi-Fi position only arrives later (~18 s there, scaled
 * to `wifiAfterMs` here). TEST DATA: synthetic points, not the user's location.
 */
function windowsLikeGeo({ wifiAfterMs }) {
  const t0 = Date.now();
  const geo = { active: 0, timers: new Map(), next: 0 };
  geo.watchPosition = (ok) => {
    const id = ++geo.next;
    geo.active += 1;
    const tick = () => {
      const late = Date.now() - t0 >= wifiAfterMs;
      ok(late ? pos(13.0001, 80.0001, 500) : pos(16.0, 80.5, 50000));
      if (geo.timers.has(id)) geo.timers.set(id, setTimeout(tick, 20)); // not if ok() just cleared this watch
    };
    geo.timers.set(id, setTimeout(tick, 5));
    return id;
  };
  geo.clearWatch = (id) => {
    clearTimeout(geo.timers.get(id));
    geo.timers.delete(id);
    geo.active -= 1;
  };
  return geo;
}

test('MEASURED ROOT CAUSE: the Wi-Fi position that arrives after the IP estimate is waited for and used', async () => {
  const geo = windowsLikeGeo({ wifiAfterMs: 200 });
  const seen = [];
  const l = createLocator({ win: fakeWin(geo), onChange: (s) => seen.push(s), sampleMs: 120, refineMs: 1000 });
  await l.request();
  const refining = seen.find((s) => s.state === 'requesting' && /rough estimate/.test(s.message));
  assert.ok(refining, 'the user is told it is still looking');
  assert.equal(refining.fix, null, 'the IP estimate is not drawn while waiting');
  const last = seen.at(-1);
  assert.equal(last.state, 'approximate');
  assert.equal(last.fix.accuracy, 500, 'the Wi-Fi fix, not the ±50 km IP estimate');
  assert.equal(last.fix.lat, 13.0001);
  assert.equal(showsDot(last.fix), true);
  assert.equal(geo.active, 0, 'listening stopped as soon as it arrived');
});

test('if the better position never comes, the IP estimate stays labelled and is drawn only as an area', async () => {
  const geo = windowsLikeGeo({ wifiAfterMs: 60_000 });
  const seen = [];
  const l = createLocator({ win: fakeWin(geo), onChange: (s) => seen.push(s), sampleMs: 80, refineMs: 150 });
  await l.request();
  const last = seen.at(-1);
  assert.equal(last.fix.source, 'ip');
  assert.equal(showsDot(last.fix), false);
  assert.match(last.message, /internet connection/);
  assert.equal(geo.active, 0);
});
