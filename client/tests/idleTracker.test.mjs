import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdleTracker } from '../src/services/idleTracker.js';

/** A fake monotonic clock with fake timers — no real waiting. */
function fakeTime() {
  let t = 0;
  let timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = { at: t + ms, fn };
      timers.push(id);
      return id;
    },
    clearTimer: (id) => {
      timers = timers.filter((x) => x !== id);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        timers = timers.filter((x) => x !== due);
        due.fn();
      }
      t = end;
    },
  };
}

const LIMIT = 120000;
function setup() {
  const time = fakeTime();
  const calls = { report: 0, share: 0, expire: 0 };
  const tracker = createIdleTracker({
    limitMs: LIMIT,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    onReport: () => (calls.report += 1),
    onShare: () => (calls.share += 1),
    onExpire: () => (calls.expire += 1),
  });
  return { time, calls, tracker };
}

test('expires after 2 minutes without activity, exactly once', () => {
  const { time, calls, tracker } = setup();
  time.advance(LIMIT - 1);
  assert.equal(tracker.check(), false);
  time.advance(1);
  assert.equal(tracker.check(), true);
  assert.equal(tracker.check(), false, 'already ended');
  assert.equal(calls.expire, 1);
});

test('local activity resets the idle clock', () => {
  const { time, calls, tracker } = setup();
  time.advance(100000);
  tracker.activity({ local: true });
  time.advance(100000);
  assert.equal(tracker.check(), false);
  time.advance(20000);
  assert.equal(tracker.check(), true);
  assert.equal(calls.expire, 1);
});

test('activity is reported at most once per 30 s, with one trailing report', () => {
  const { time, calls, tracker } = setup();
  tracker.activity({ local: true }); // immediate
  assert.equal(calls.report, 1);
  for (let i = 0; i < 50; i += 1) {
    time.advance(200);
    tracker.activity({ local: true }); // a burst of mouse moves
  }
  assert.equal(calls.report, 1, 'throttled');
  time.advance(30000);
  assert.equal(calls.report, 2, 'one trailing report for the burst');
  time.advance(5 * 60000);
  assert.equal(calls.report, 2, 'an idle user sends nothing');
});

test('activity in another tab keeps this tab alive but is reported only by that tab', () => {
  const { time, calls, tracker } = setup();
  time.advance(110000);
  tracker.activity({ local: false });
  time.advance(110000);
  assert.equal(tracker.check(), false);
  assert.equal(calls.report, 0);
  assert.equal(calls.share, 0);
});

test('cross-tab "activity" messages are throttled to one per 5 s', () => {
  const { time, calls, tracker } = setup();
  for (let i = 0; i < 20; i += 1) {
    tracker.activity({ local: true });
    time.advance(500);
  }
  assert.equal(calls.share, 2);
});

test('a background tab keeps counting: no activity while hidden means expiry on return', () => {
  const { time, calls, tracker } = setup();
  tracker.activity({ local: true });
  // Tab hidden: no events arrive, timers may be throttled — nothing resets the clock.
  time.advance(LIMIT + 60000);
  // Becoming visible is not activity; the first check on return expires the session.
  assert.equal(tracker.check(), true);
  assert.equal(calls.expire, 1);
  tracker.activity({ local: true });
  assert.equal(tracker.check(), false, 'an expired tracker cannot be revived');
  assert.equal(calls.report, 1, 'no report after expiry');
});

test('stop() cancels a pending trailing report', () => {
  const { time, calls, tracker } = setup();
  tracker.activity({ local: true });
  time.advance(1000);
  tracker.activity({ local: true });
  tracker.stop();
  time.advance(60000);
  assert.equal(calls.report, 1);
});
