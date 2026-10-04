import { useEffect } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { api } from '../../services/api';
import { disconnectSocket } from '../../services/socket';
import { loggedOut } from '../../features/authSlice';
import { broadcastSession, markIdleLogout, onSessionMessage } from '../../services/sessionSync';
import { createIdleTracker } from '../../services/idleTracker';

// Real interaction only. Network traffic, polling, timers and the tab merely
// being open or becoming visible never count.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
const CHECK_EVERY_MS = 5 * 1000;

/**
 * Web portal inactivity handling — a user-experience layer over the server's
 * own enforcement (the server ends the session regardless of this code).
 *
 * - Idle time is measured with performance.now(), so changing the computer's
 *   clock does not move it, and nothing is kept in storage to tamper with.
 * - Activity is reported to the server (POST /auth/activity) only after real
 *   interaction, at most once per 30 s (services/idleTracker.js). An idle user
 *   sends nothing at all.
 * - After `idleTimeoutSec` with no activity in ANY tab the session is ended for
 *   real: server logout, socket closed, state cleared, every tab signed out.
 * - Coming back to a tab re-checks at once and asks the server; a stale tab can
 *   never regain access.
 *
 * Logout broadcasts from other tabs are applied for every role; the idle timer
 * itself only runs when the server says the rule applies (idleTimeoutSec).
 */
export function useIdleSession() {
  const dispatch = useDispatch();
  const store = useStore();
  const userId = useSelector((s) => s.auth.user?._id);
  const idleSec = useSelector((s) => s.auth.idleTimeoutSec);

  // Another tab signed out (manually or idle): this tab follows immediately.
  useEffect(() => {
    if (!userId) return undefined;
    return onSessionMessage((msg) => {
      if (msg.type !== 'logout') return;
      if (msg.reason === 'idle') markIdleLogout();
      disconnectSocket();
      dispatch(loggedOut());
      dispatch(api.util.resetApiState());
    });
  }, [userId, dispatch]);

  useEffect(() => {
    if (!userId || !idleSec) return undefined;

    const tracker = createIdleTracker({
      limitMs: idleSec * 1000,
      now: () => performance.now(),
      // A 401 here (already expired server-side) signs the tab out via the base query.
      onReport: () => store.dispatch(api.endpoints.reportActivity.initiate()),
      onShare: () => broadcastSession({ type: 'activity' }),
      onExpire: async () => {
        markIdleLogout();
        broadcastSession({ type: 'logout', reason: 'idle' });
        // Real termination: the server revokes the session (cookie cleared too).
        await store.dispatch(api.endpoints.logout.initiate({ reason: 'idle' })).catch(() => null);
        disconnectSocket();
        dispatch(loggedOut());
        dispatch(api.util.resetApiState());
      },
    });

    // Returning to the tab is NOT activity: check the clock, then confirm with
    // the server (a 401 from an already-expired session signs the tab out).
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || tracker.ended) return;
      if (!tracker.check()) store.dispatch(api.endpoints.verifySession.initiate(undefined, { forceRefetch: true, subscribe: false }));
    };

    const onLocal = () => tracker.activity({ local: true });
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onLocal, { passive: true, capture: true }));
    // Scrolling inside panels does not bubble; capture it on the document.
    document.addEventListener('scroll', onLocal, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisible);
    const offShared = onSessionMessage((msg) => {
      if (msg.type === 'activity') tracker.activity({ local: false });
    });
    const timer = setInterval(() => tracker.check(), CHECK_EVERY_MS);

    // Opening / reloading the app is a user action.
    if (document.visibilityState === 'visible') tracker.activity({ local: true });

    return () => {
      tracker.stop();
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onLocal, { capture: true }));
      document.removeEventListener('scroll', onLocal, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      offShared();
      clearInterval(timer);
    };
  }, [userId, idleSec, dispatch, store]);
}
