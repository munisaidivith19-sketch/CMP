import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROXIMATE_M,
  MAX_FIX_AGE_MS,
  MESSAGES,
  SAMPLE_MS,
  locationProblem,
  permissionState,
  preflight,
  readFreshFix,
  readingBody,
  verifyProblem,
} from '../src/utils/returnLocation.js';

/** A scriptable navigator.geolocation with a fake clock and timers — no real waiting. */
function fakeGeo() {
  let t = 1_000_000;
  let timers = [];
  const watches = new Map();
  let nextId = 1;
  const geo = {
    options: null,
    cleared: [],
    watchPosition(ok, fail, options) {
      geo.options = options;
      const id = nextId++;
      watches.set(id, { ok, fail });
      return id;
    },
    clearWatch(id) {
      geo.cleared.push(id);
      watches.delete(id);
    },
  };
  const active = () => [...watches.values()][0];
  return {
    geo,
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { at: t + ms, fn };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      timers = timers.filter((x) => x !== h);
    },
    advance(ms) {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.fn());
    },
    fix(accuracy, { age = 0 } = {}) {
      active()?.ok({ coords: { latitude: 13.26, longitude: 80.1, accuracy }, timestamp: t - age });
    },
    error(code) {
      active()?.fail({ code });
    },
    watching: () => watches.size > 0,
  };
}
const opts = (f, extra = {}) => ({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer, ...extra });

test('asks for a fresh, high-accuracy reading and never a cached one', async () => {
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  assert.deepEqual(f.geo.options, { enableHighAccuracy: true, maximumAge: 0, timeout: SAMPLE_MS });
  f.fix(12);
  const fix = await p;
  assert.equal(fix.coords.accuracy, 12);
  assert.equal(f.watching(), false, 'stops listening once settled');
});

test('keeps listening for the most precise fix until the sample window ends', async () => {
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  f.fix(400);
  f.advance(3000);
  f.fix(60);
  f.advance(3000);
  f.fix(90);
  f.advance(SAMPLE_MS);
  assert.equal((await p).coords.accuracy, 60);
  assert.equal(f.watching(), false);
});

test('a cached / old reading is never sent', async () => {
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  f.fix(5, { age: MAX_FIX_AGE_MS + 1000 });
  f.advance(SAMPLE_MS);
  await assert.rejects(p, { kind: 'stale' });
});

test('a fix that went stale while sampling is replaced by a newer one', async () => {
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  f.fix(25, { age: MAX_FIX_AGE_MS - 5000 }); // recent enough when it arrives…
  f.advance(6000); // …but too old by now
  f.fix(45);
  f.advance(SAMPLE_MS);
  const fix = await p;
  assert.equal(fix.coords.accuracy, 45);
});

test('denied permission, unavailable position and timeout are told apart', async () => {
  for (const [code, kind] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    const f = fakeGeo();
    const p = readFreshFix(f.geo, opts(f));
    f.error(code);
    await assert.rejects(p, { kind }, `code ${code}`);
    assert.equal(f.watching(), false);
  }
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  f.advance(SAMPLE_MS); // no fix and no error at all
  await assert.rejects(p, { kind: 'timeout' });
});

test('a transient error after a good fix keeps the fix', async () => {
  const f = fakeGeo();
  const p = readFreshFix(f.geo, opts(f));
  f.fix(35);
  f.error(3);
  f.advance(SAMPLE_MS);
  assert.equal((await p).coords.accuracy, 35);
});

test('aborting (leaving the page) stops listening and sends nothing', async () => {
  const f = fakeGeo();
  const ctrl = new AbortController();
  const p = readFreshFix(f.geo, opts(f, { signal: ctrl.signal }));
  f.fix(80);
  ctrl.abort();
  await assert.rejects(p, { kind: 'aborted' });
  assert.equal(f.watching(), false);
});

test('preflight: insecure context and missing geolocation are separate problems', () => {
  assert.equal(preflight({ isSecureContext: false, navigator: { geolocation: {} } }), 'insecure');
  assert.equal(preflight({ isSecureContext: true, navigator: {} }), 'unsupported');
  assert.equal(preflight({ isSecureContext: true, navigator: { geolocation: {} } }), null);
});

test('permission state is read where the Permissions API exists, and never throws', async () => {
  assert.equal(await permissionState({ permissions: { query: async () => ({ state: 'denied' }) } }), 'denied');
  assert.equal(await permissionState({ permissions: { query: async () => { throw new TypeError('unsupported'); } } }), null);
  assert.equal(await permissionState({}), null);
});

test('each failure has its own message — "turn on GPS" is not the answer to everything', () => {
  const msgs = [
    locationProblem('insecure'),
    locationProblem('unsupported'),
    locationProblem('denied', 'prompt'),
    locationProblem('denied', 'denied'),
    locationProblem('unavailable'),
    locationProblem('timeout'),
    locationProblem('stale'),
  ];
  assert.equal(new Set(msgs).size, msgs.length);
  assert.equal(locationProblem('denied', 'denied'), MESSAGES.blocked);
  assert.equal(locationProblem('denied', 'granted'), MESSAGES.denied);
  for (const m of msgs) assert.doesNotMatch(m, /turn on (location )?\(?GPS/i);
});

test('server and network failures are worded from what actually happened', () => {
  const fix = (accuracy) => ({ coords: { latitude: 1, longitude: 2, accuracy }, timestamp: 0 });
  assert.equal(verifyProblem({ status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' }, fix(10)), MESSAGES.network);
  const reject = (code, message) => ({ status: 422, data: { message, errors: [{ code, message }] } });
  assert.equal(verifyProblem(reject('outside_geofence', 'Outside campus'), fix(10)), 'Outside campus');
  assert.equal(verifyProblem(reject('stale_location', 'Outdated'), fix(10)), 'Outdated');
  assert.equal(verifyProblem(reject('low_accuracy', 'x'), fix(APPROXIMATE_M + 1500)), MESSAGES.approximate);
  const poor = verifyProblem(reject('low_accuracy', 'x'), fix(87.4));
  assert.match(poor, /±87 m/);
  // Never leaks coordinates, and a 5xx body is not shown to the student.
  assert.doesNotMatch(poor, /13\.|80\./);
  assert.equal(verifyProblem({ status: 500, data: { message: 'MongoServerError: boom' } }, fix(10)), MESSAGES.failed);
  assert.equal(verifyProblem({ status: 429, data: { message: 'Too many location checks.' } }, fix(10)), 'Too many location checks.');
});

test('the body carries the raw reading plus the device clock at send time — nothing else', () => {
  const body = readingBody({ coords: { latitude: 13.2, longitude: 80.1, accuracy: 14, altitude: 3 }, timestamp: 1000 }, 1500);
  assert.deepEqual(body, { latitude: 13.2, longitude: 80.1, accuracy: 14, timestamp: 1000, sentAt: 1500 });
});
