// Bus-location sharing session. TEST DATA ONLY: a fake GPS, fake timers and a
// fake API; synthetic coordinates near 13.000 N, 80.000 E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShareSession, readPosition, toWire, SHARE_ERRORS } from '../src/pages/transport/shareSession.js';

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
};

function harness({ secure = true, geoMissing = false, startResult, startImpl, sendImpl, stopImpl } = {}) {
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const watches = new Map();
  let nextWatch = 1;
  const geo = geoMissing
    ? undefined
    : {
        watchPosition(ok, fail, opts) {
          const id = nextWatch++;
          watches.set(id, { ok, fail, opts });
          return id;
        },
        clearWatch(id) {
          watches.delete(id);
        },
      };
  const intervals = new Map();
  let nextTimer = 1;
  const timers = {
    setInterval(fn, ms) {
      const id = nextTimer++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
  };
  const calls = { start: [], send: [], stop: [] };
  const api = {
    start: async (busId) => {
      calls.start.push(busId);
      if (startImpl) return startImpl(busId);
      if (startResult instanceof Error || startResult?.status) throw startResult;
      return startResult || { tripId: 'trip-1', deviceKey: 'key-1' };
    },
    send: async (tripId, key, fixes) => {
      calls.send.push({ tripId, key, fixes });
      return sendImpl ? sendImpl(fixes, calls.send.length) : { accepted: fixes.length, rejected: [] };
    },
    stop: async (tripId) => {
      calls.stop.push(tripId);
      if (stopImpl) return stopImpl(tripId);
      return {};
    },
  };
  const states = [];
  const s = createShareSession({ geo, secure, api, now, timers, onChange: (st) => states.push(st) });
  const gps = (lat, { accuracy = 10, ageMs = 0, lng = 80.0 } = {}) => {
    for (const w of watches.values()) w.ok({ coords: { latitude: lat, longitude: lng, accuracy, speed: null, heading: null }, timestamp: clock - ageMs });
  };
  const gpsError = (code) => {
    for (const w of watches.values()) w.fail({ code });
  };
  const advance = async (ms) => {
    clock += ms;
    for (const t of [...intervals.values()]) t.fn();
    await settle();
  };
  return { s, calls, watches, intervals, states, gps, gpsError, advance, tick: (ms) => (clock += ms) };
}

test('nothing is read before Start; insecure pages and browsers without GPS are refused', () => {
  const h = harness();
  assert.equal(h.watches.size, 0, 'no location access on load');
  assert.equal(h.s.state.phase, 'idle');

  const insecure = harness({ secure: false });
  insecure.s.start('bus-1');
  assert.equal(insecure.s.state.phase, 'error');
  assert.equal(insecure.s.state.error.message, SHARE_ERRORS.insecure);
  assert.equal(insecure.watches.size, 0);

  const none = harness({ geoMissing: true });
  none.s.start('bus-1');
  assert.equal(none.s.state.error.code, 'unsupported');
});

test('the trip starts only after the device gives a usable position', async () => {
  const h = harness();
  h.s.start('bus-1');
  assert.equal(h.watches.size, 1);
  assert.equal([...h.watches.values()][0].opts.enableHighAccuracy, true);
  assert.equal([...h.watches.values()][0].opts.maximumAge, 0, 'no cached positions');
  assert.equal(h.s.state.phase, 'locating');

  h.gps(13.0, { accuracy: 800 });
  await settle();
  assert.equal(h.calls.start.length, 0, 'a rough reading starts nothing');
  assert.equal(h.s.state.warning, 'weak_gps');
  h.gps(13.0, { ageMs: 60_000 });
  await settle();
  assert.equal(h.calls.start.length, 0, 'an old cached reading starts nothing');

  h.gps(13.0001);
  await settle();
  assert.deepEqual(h.calls.start, ['bus-1']);
  assert.equal(h.s.state.phase, 'sharing');
  assert.equal(h.s.state.warning, null);
  assert.equal(h.calls.send.length, 1, 'the first position goes out at once');
  assert.equal(h.calls.send[0].key, 'key-1', 'sent with the device key');
  const [wire] = h.calls.send[0].fixes;
  assert.equal(wire.lat, 13.0001);
  assert.match(wire.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.ok(!('speed' in wire) && !('heading' in wire), 'unknown values are left out, not sent as null');
});

test('permission denied: nothing starts, the watcher and timer are cleared', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gpsError(1);
  await settle();
  assert.equal(h.s.state.phase, 'error');
  assert.equal(h.s.state.error.code, 'denied');
  assert.equal(h.watches.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.calls.start.length, 0);
});

test('denied in the middle of sharing ends the trip', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  h.gpsError(1);
  await settle();
  assert.deepEqual(h.calls.stop, ['trip-1']);
  assert.equal(h.watches.size, 0);
});

test('GPS temporarily unavailable keeps watching and says so', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  h.gpsError(2);
  assert.equal(h.s.state.warning, 'gps_unavailable');
  assert.equal(h.watches.size, 1, 'still watching');
  h.tick(6000);
  h.gps(13.0002);
  assert.equal(h.s.state.warning, null, 'cleared by the next good position');
});

test('positions are thinned: every few seconds standing still, sooner after real movement, never backwards', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  const queued = () => h.s.state.queued;
  h.tick(1000);
  h.gps(13.00001); // 1 s later, ~1 m: dropped
  assert.equal(queued(), 0);
  h.tick(2000);
  h.gps(13.0004); // 3 s after the kept one, ~44 m: kept (moved)
  assert.equal(queued(), 1);
  h.tick(1000);
  h.gps(13.0005); // only 1 s: dropped
  assert.equal(queued(), 1);
  h.tick(5000);
  h.gps(13.0005); // 6 s, standing still: kept
  assert.equal(queued(), 2);
  h.gps(13.0006, { ageMs: 10_000 }); // older than the last kept: dropped
  assert.equal(queued(), 2);
  await h.advance(0);
  assert.equal(h.calls.send.length, 2, 'the batch is sent on the next tick');
  assert.equal(h.calls.send[1].fixes.length, 2);
  assert.equal(queued(), 0);
});

test('network trouble keeps the newest positions (at most 20) and retries', async () => {
  let fail = true;
  const h = harness({ sendImpl: (fixes, n) => {
    if (n > 1 && fail) throw { status: 'FETCH_ERROR' };
    return { accepted: fixes.length, rejected: [] };
  } });
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  for (let i = 1; i <= 25; i += 1) {
    h.tick(5000);
    h.gps(13.0 + i * 0.0001);
    await h.advance(0);
  }
  assert.equal(h.s.state.warning, 'network');
  assert.equal(h.s.state.queued, 20, 'capped');
  fail = false;
  await h.advance(5000);
  assert.equal(h.s.state.warning, null);
  assert.equal(h.s.state.queued, 0);
  const last = h.calls.send[h.calls.send.length - 1].fixes;
  assert.equal(last.length, 20);
  assert.equal(last[19].lat, 13.0025, 'the newest positions were kept');
});

test('a trip the server ended (409) or a different device (403) stops the watcher at once', async () => {
  const ended = harness({ sendImpl: (f, n) => {
    if (n > 1) throw { status: 409, data: { code: 'trip_not_active' } };
    return { accepted: 1, rejected: [] };
  } });
  ended.s.start('bus-1');
  ended.gps(13.0);
  await settle();
  ended.tick(6000);
  ended.gps(13.0004);
  await ended.advance(0);
  assert.equal(ended.s.state.phase, 'ended');
  assert.equal(ended.s.state.error.message, SHARE_ERRORS.trip_not_active);
  assert.equal(ended.watches.size, 0);
  assert.equal(ended.intervals.size, 0);

  const other = harness({ sendImpl: () => {
    throw { status: 403, data: { code: 'wrong_device', message: 'x' } };
  } });
  other.s.start('bus-1');
  other.gps(13.0);
  await settle();
  assert.equal(other.s.state.phase, 'error');
  assert.equal(other.s.state.error.code, 'wrong_device');
  assert.equal(other.watches.size, 0);
});

test('a bus already being shared: the server message is shown and nothing keeps running', async () => {
  const h = harness({ startResult: { status: 409, data: { code: 'bus_busy', message: 'SHR-127 is already being shared by someone else.' } } });
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  assert.equal(h.s.state.phase, 'error');
  assert.equal(h.s.state.error.code, 'bus_busy');
  assert.match(h.s.state.error.message, /already being shared/);
  assert.equal(h.watches.size, 0);
  assert.equal(h.intervals.size, 0);
});

test('stop clears the watcher and timer, ends the trip, and ignores later readings', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  await h.s.stop();
  assert.equal(h.s.state.phase, 'stopped');
  assert.deepEqual(h.calls.stop, ['trip-1']);
  assert.equal(h.watches.size, 0);
  assert.equal(h.intervals.size, 0);
  const sent = h.calls.send.length;
  await h.advance(10_000);
  assert.equal(h.calls.send.length, sent, 'nothing sent after stopping');
});

test('stop pressed while the trip is being created ends that trip as soon as it exists', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ startImpl: () => gate });
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  assert.equal(h.s.state.phase, 'starting');
  assert.deepEqual(h.calls.start, ['bus-1']);
  await h.s.stop();
  assert.equal(h.s.state.phase, 'idle');
  assert.equal(h.watches.size, 0);
  release({ tripId: 'late-trip', deviceKey: 'k' });
  await settle();
  assert.deepEqual(h.calls.stop, ['late-trip'], 'the late trip is ended, not left running');
  assert.equal(h.s.state.phase, 'idle', 'never switches to sharing');
  assert.equal(h.calls.send.length, 0);
});

test('stop with no answer from the server still stops the device and says so', async () => {
  const h = harness({ stopImpl: () => Promise.reject({ status: 'FETCH_ERROR' }) });
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  await h.s.stop();
  assert.equal(h.s.state.phase, 'stopped');
  assert.equal(h.s.state.error.code, 'stop_unconfirmed');
  assert.equal(h.watches.size, 0);
});

test('unmounting the page releases everything and ends a running trip', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  const before = h.states.length;
  h.s.destroy();
  await settle();
  assert.equal(h.watches.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.deepEqual(h.calls.stop, ['trip-1']);
  h.gps(13.001);
  assert.equal(h.states.length, before, 'no updates after unmount');
});

test('no new position for a while is reported, not hidden', async () => {
  const h = harness();
  h.s.start('bus-1');
  h.gps(13.0);
  await settle();
  await h.advance(31_000);
  assert.equal(h.s.state.warning, 'no_fix');
});

test('readings are validated before use', () => {
  assert.equal(readPosition({ coords: { latitude: 95, longitude: 80, accuracy: 5 }, timestamp: 1 }), null);
  assert.equal(readPosition({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: 1 }), null);
  assert.equal(readPosition({ coords: { latitude: 13, longitude: 80, accuracy: 5 }, timestamp: NaN }), null);
  const f = readPosition({ coords: { latitude: 13, longitude: 80, accuracy: 5, speed: -1, heading: 400 }, timestamp: 5 });
  assert.equal(f.speed, null);
  assert.equal(f.heading, null);
  assert.deepEqual(Object.keys(toWire({ ...f, speed: 4, heading: 90 })).sort(), ['accuracy', 'heading', 'lat', 'lng', 'speed', 'timestamp']);
});
