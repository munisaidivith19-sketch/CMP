/**
 * Cross-tab session signals for the web portal. Only bare events travel
 * between tabs ("someone was active", "this session ended") — never a token,
 * user id or any account data, and nothing is written to localStorage.
 *
 * All tabs of one browser share the same server session (the httpOnly refresh
 * cookie), so activity in any tab counts for all of them, and a logout or idle
 * expiry in one tab is applied to every other tab at once.
 */
const CHANNEL = 'vexon-session';
const REASON_KEY = 'vexon_logout_reason';

let channel = null;
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
} catch {
  channel = null;
}

export function broadcastSession(message) {
  try {
    channel?.postMessage(message);
  } catch {
    /* channel closed — nothing to tell */
  }
}

/** Subscribe to other tabs' session events. Returns an unsubscribe function. */
export function onSessionMessage(fn) {
  if (!channel) return () => {};
  const handler = (e) => {
    const data = e?.data;
    if (data && typeof data.type === 'string') fn(data);
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

/** Remember (for this tab only) why the user was signed out, to explain it on the login page. */
export function markIdleLogout() {
  try {
    sessionStorage.setItem(REASON_KEY, 'idle');
  } catch {
    /* storage unavailable */
  }
}

export function peekLogoutReason() {
  try {
    return sessionStorage.getItem(REASON_KEY);
  } catch {
    return null;
  }
}

export function clearLogoutReason() {
  try {
    sessionStorage.removeItem(REASON_KEY);
  } catch {
    /* storage unavailable */
  }
}

export const IDLE_LOGOUT_MESSAGE = 'Your session expired due to inactivity. Please log in again.';
