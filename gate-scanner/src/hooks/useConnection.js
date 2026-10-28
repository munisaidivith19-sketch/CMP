import { useCallback, useEffect, useRef, useState } from 'react';

const ONLINE_EVERY_MS = 15000;
const OFFLINE_EVERY_MS = 5000;

/**
 * Server reachability, from GET /api/health through the main process.
 * "offline" only after a real failed check — never assumed.
 */
export function useConnection() {
  const [state, setState] = useState({ status: 'checking', ms: null, kind: null, checkedAt: null });
  const timer = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const check = useCallback(async () => {
    clearTimeout(timer.current);
    const r = await window.gate.diag.health();
    const next = r.ok ? { status: 'online', ms: r.ms, kind: null, checkedAt: Date.now() } : { status: 'offline', ms: null, kind: r.kind || 'server', checkedAt: Date.now() };
    if (stateRef.current.status !== next.status) window.gate.diag.record({ event: 'connection', status: next.status, kind: next.kind });
    setState(next);
    timer.current = setTimeout(check, r.ok ? ONLINE_EVERY_MS : OFFLINE_EVERY_MS);
    return next;
  }, []);

  useEffect(() => {
    check();
    const recheck = () => check();
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
    };
  }, [check]);

  // A request that failed for network reasons: re-check right away.
  const reportFailure = useCallback(() => check(), [check]);

  return { ...state, online: state.status !== 'offline', check, reportFailure };
}
