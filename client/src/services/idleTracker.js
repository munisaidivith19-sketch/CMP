/**
 * Pure inactivity bookkeeping for the web portal (no DOM, no React), so the
 * rules can be unit-tested with an injected clock and timers.
 *
 * - `activity({ local: true })`  real interaction in this tab: resets the idle
 *   clock, reports to the server at most once per `reportEveryMs` (plus one
 *   trailing report so the last burst is not lost) and tells other tabs at
 *   most once per `shareEveryMs`.
 * - `activity({ local: false })` another tab saw activity: resets the idle
 *   clock only (that tab reports it).
 * - `check()` expires once `limitMs` has passed without activity.
 *
 * Nothing else — a timer tick, a network response, the tab becoming visible —
 * ever counts as activity.
 */
export function createIdleTracker({
  limitMs,
  reportEveryMs = 30 * 1000,
  shareEveryMs = 5 * 1000,
  now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onReport,
  onShare,
  onExpire,
}) {
  let last = now();
  let lastReport = now() - reportEveryMs;
  let lastShare = -Infinity;
  let pending = false;
  let trailing = null;
  let ended = false;

  const report = () => {
    pending = false;
    lastReport = now();
    onReport?.();
  };

  return {
    activity({ local }) {
      if (ended) return;
      const t = now();
      last = t;
      if (!local) return;
      if (t - lastShare >= shareEveryMs) {
        lastShare = t;
        onShare?.();
      }
      pending = true;
      const since = t - lastReport;
      if (since >= reportEveryMs) report();
      else if (!trailing) {
        trailing = setTimer(() => {
          trailing = null;
          if (pending && !ended) report();
        }, reportEveryMs - since);
      }
    },
    check() {
      if (ended || now() - last < limitMs) return false;
      ended = true;
      clearTimer(trailing);
      onExpire?.();
      return true;
    },
    stop() {
      ended = true;
      clearTimer(trailing);
    },
    get ended() {
      return ended;
    },
  };
}
