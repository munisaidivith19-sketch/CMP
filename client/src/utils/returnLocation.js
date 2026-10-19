/**
 * Browser side of the gate pass "Return to campus" location check.
 *
 * The browser only reads one fresh position and sends the raw reading; the
 * server alone decides distance, accuracy and age. Everything here is about
 * getting a usable reading and telling the student exactly what went wrong —
 * never a "turn on GPS" catch-all, and never coordinates or server internals.
 *
 * Kept free of React and of `window` globals (they are passed in) so it runs
 * under node --test.
 */

export const SAMPLE_MS = 20000; // keep listening this long for a precise fix (cold GPS / Wi-Fi scan)
export const GOOD_ENOUGH_M = 20; // stop early once the fix is this precise
export const MAX_FIX_AGE_MS = 25000; // never send a reading this old (server limit is 30 s)
/** Readings this coarse come from "approximate" location (OS / browser precise-location off). */
export const APPROXIMATE_M = 500;

export const MESSAGES = {
  insecure:
    'Location only works on a secure (https://) connection. Open Vexon using its https:// address, then try again.',
  unsupported: 'This browser cannot share its location. Use an up-to-date Chrome, Edge, Safari or Firefox, or the Vexon app.',
  blocked:
    'Location is blocked for this site. Click the lock / settings icon next to the address bar → Site settings → Location → Allow, then reload the page and try again.',
  denied:
    'Location permission was denied. Tap "Verify my location" again and choose Allow. On Android, also check Settings → Apps → Chrome → Permissions → Location is allowed.',
  unavailable:
    'Your device could not work out its location. Make sure Location is turned on in your device settings (Android: quick settings → Location; Windows: Settings → Privacy & security → Location; Mac: System Settings → Privacy & Security → Location Services), then try again.',
  timeout: 'Finding your location took too long. Move near a window or outdoors, keep this page open, and try again.',
  stale: 'Your device only returned an old location reading. Please try again.',
  approximate:
    'Your device is sharing only an approximate location, which cannot confirm you are on campus. Turn on precise location (Android: Settings → Apps → Chrome → Permissions → Location → "Use precise location"; iPhone: Settings → Privacy → Location Services → Safari Websites → Precise Location), then try again.',
  poorAccuracy: (m) =>
    `Your location is not accurate enough yet (about ±${m} m). Move to an open area or near a window and try again — laptops without GPS are often too imprecise indoors; the Vexon app on your phone usually works better.`,
  network: 'Your location was read, but it could not be sent — check your internet connection and try again.',
  failed: 'Could not verify your location. Please try again.',
};

/**
 * Why location cannot even be requested here, or null. A browser only offers
 * geolocation in a secure context (https or localhost).
 */
export function preflight(win) {
  if (!win?.isSecureContext) return 'insecure';
  if (!win.navigator?.geolocation) return 'unsupported';
  return null;
}

/** 'granted' | 'prompt' | 'denied', or null where the Permissions API cannot answer (e.g. older Safari). */
export async function permissionState(nav) {
  try {
    const status = await nav?.permissions?.query?.({ name: 'geolocation' });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Listen for fresh high-accuracy positions for up to `sampleMs`, keeping the
 * most precise one that is still recent — never a cached position. Stops
 * listening before it settles. Resolves the position; rejects with
 * { kind } — 'denied' | 'unavailable' | 'timeout' | 'stale' | 'aborted'.
 */
export function readFreshFix(geo, { signal, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, sampleMs = SAMPLE_MS, goodEnoughM = GOOD_ENOUGH_M } = {}) {
  return new Promise((resolve, reject) => {
    let best = null;
    let sawOld = false;
    let done = false;
    let watchId = null;
    let timer = null;
    const recent = (pos) => Math.abs(now() - pos.timestamp) <= MAX_FIX_AGE_MS;
    const finish = (kind) => {
      if (done) return;
      done = true;
      if (watchId !== null) geo.clearWatch(watchId);
      clearTimer(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (kind === 'aborted') return reject({ kind });
      if (best && recent(best)) return resolve(best);
      reject({ kind: kind || (sawOld || best ? 'stale' : 'timeout') });
    };
    function onAbort() {
      finish('aborted');
    }
    if (signal?.aborted) return finish('aborted');
    signal?.addEventListener?.('abort', onAbort);
    timer = setTimer(() => finish(), sampleMs);
    watchId = geo.watchPosition(
      (pos) => {
        if (done) return;
        if (!pos?.coords || !Number.isFinite(pos.coords.accuracy) || !recent(pos)) {
          sawOld = true; // a cached / out-of-date reading: wait for a fresh one
          return;
        }
        if (!best || pos.coords.accuracy <= best.coords.accuracy || !recent(best)) best = pos;
        if (pos.coords.accuracy <= goodEnoughM) finish();
      },
      (err) => {
        // A permission problem is final. Unavailable/timeout are final only if no fix was received at all.
        if (err?.code === 1) return finish('denied');
        if (best) return; // keep the reading we already have; the sample timer will send it
        finish(err?.code === 2 ? 'unavailable' : 'timeout');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: sampleMs }
    );
  });
}

/**
 * Message for a failure to obtain a position. A denial while the Permissions
 * API already said "denied" before asking means the site is blocked (no prompt
 * was shown), not a fresh "No".
 */
export function locationProblem(kind, permissionBefore) {
  if (kind === 'denied') return permissionBefore === 'denied' ? MESSAGES.blocked : MESSAGES.denied;
  return MESSAGES[kind] || MESSAGES.failed;
}

/**
 * Message for a failed POST to the server. A server rejection (outside the
 * radius, stale, inaccurate) uses the server's own wording; the device's
 * accuracy — never its coordinates or the campus distance — is added only to
 * explain an accuracy rejection.
 */
export function verifyProblem(err, fix) {
  if (err?.status === 'FETCH_ERROR' || err?.status === 'TIMEOUT_ERROR') return MESSAGES.network;
  const code = err?.data?.errors?.[0]?.code;
  const accuracy = fix?.coords?.accuracy;
  if (code === 'low_accuracy' && Number.isFinite(accuracy)) {
    return accuracy >= APPROXIMATE_M ? MESSAGES.approximate : MESSAGES.poorAccuracy(Math.round(accuracy));
  }
  const server = err?.data?.message;
  if (typeof server === 'string' && server && typeof err?.status === 'number' && err.status < 500) return server;
  return MESSAGES.failed;
}

/** The body sent to the server: the raw reading plus this device's clock at send time. */
export const readingBody = (fix, now = Date.now()) => ({
  latitude: fix.coords.latitude,
  longitude: fix.coords.longitude,
  accuracy: fix.coords.accuracy,
  timestamp: fix.timestamp,
  sentAt: now,
});
