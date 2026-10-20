/**
 * Live bus-location sharing from this browser — the logic behind the "Share
 * bus location" page. Free of React and of `window` (the geolocation object,
 * timers and API calls are passed in) so it runs under node --test.
 *
 * - Location is read only after start() — an explicit user action — and the
 *   trip is created on the server only after the device has produced a usable
 *   position (so a denied permission never leaves a trip running).
 * - Positions are thinned before sending (every few seconds, or sooner after
 *   real movement), batched, and kept briefly while the network is down.
 * - Readings rougher than the server accepts are shown but never sent.
 * - stop() / destroy() clear the location watcher and every timer; a trip the
 *   server ended (manager stop, idle timeout) stops the watcher at once.
 * Browsers stop delivering positions when the page is closed or the device
 * sleeps — this cannot share in the background, and says so.
 */

export const SHARE_DEFAULTS = {
  sendEveryMs: 5000, // batch upload interval
  minGapMs: 5000, // keep a position at most this often while standing still…
  moveGapMs: 2500, // …or this often once the device has moved
  moveMeters: 30,
  maxAccuracyM: 100, // the server's default limit (GPS_MAX_ACCURACY_M)
  maxCachedAgeMs: 25000, // never send a cached / old reading
  maxBuffer: 20, // the server takes at most 20 fixes per request
  noFixWarnMs: 30000,
};

export const SHARE_ERRORS = {
  insecure: 'Location sharing needs a secure (https) connection to VEXON.',
  unsupported: 'This browser cannot read the device location. Use a phone browser or the VEXON Android app.',
  denied: 'Location permission was denied, so nothing was shared. Allow location for this site in your browser settings, then press Start sharing again.',
  network: 'VEXON could not be reached. Check your connection and try again.',
  forbidden: 'You are not allowed to share this bus’s location.',
  wrong_device: 'This trip is now being shared from another browser tab or device, so sharing here has stopped.',
  trip_not_active: 'This trip has ended — stopped by a transport manager, or ended automatically after no locations arrived. Start sharing again if the bus is still running.',
  failed: 'Sharing could not start. Try again.',
};

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A browser GeolocationPosition → a fix, or null when unusable. */
export function readPosition(pos) {
  const c = pos?.coords;
  const lat = Number(c?.latitude);
  const lng = Number(c?.longitude);
  const at = Number(pos?.timestamp);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null;
  if (!Number.isFinite(at)) return null;
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const speed = num(c.speed);
  const heading = num(c.heading);
  return {
    lat,
    lng,
    at,
    accuracy: num(c.accuracy),
    speed: speed !== null && speed >= 0 ? speed : null,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
  };
}

/** What the server is sent for one fix (ISO time, no nulls). */
export const toWire = (f) => ({
  lat: f.lat,
  lng: f.lng,
  timestamp: new Date(f.at).toISOString(),
  accuracy: f.accuracy,
  ...(f.speed !== null ? { speed: f.speed } : {}),
  ...(f.heading !== null ? { heading: f.heading } : {}),
});

/** RTK Query / fetch error → { status, code, message }. */
export function errorInfo(e) {
  const status = e?.status;
  const network = status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR' || status === undefined || (typeof status === 'number' && status >= 500);
  return { status, code: e?.data?.code || (network ? 'network' : status === 403 ? 'forbidden' : 'failed'), message: e?.data?.message || '' };
}

const ACTIVE = ['locating', 'starting', 'sharing'];

/**
 * @param {object} o
 * @param {Geolocation} o.geo        navigator.geolocation (or a fake)
 * @param {boolean}     o.secure     window.isSecureContext
 * @param {object}      o.api        { start(busId) → { tripId, deviceKey }, send(tripId, key, fixes) → { accepted, rejected }, stop(tripId) }
 * @param {Function}    o.onChange   receives a new state object on every change
 */
export function createShareSession({ geo, secure, api, onChange = () => {}, now = () => Date.now(), timers = globalThis, options = {} }) {
  const cfg = { ...SHARE_DEFAULTS, ...options };
  let state = { phase: 'idle', busId: null, tripId: null, lastFix: null, lastSentAt: null, lastAcceptedAt: null, accepted: 0, warning: null, warningDetail: null, error: null, queued: 0 };
  let key = null;
  let watchId = null;
  let timer = null;
  let buffer = [];
  let lastKept = null;
  let lastFixSeenAt = 0;
  let inFlight = false;
  let firstGood = null;
  let destroyed = false;
  let generation = 0; // bumps on every start / stop so late answers are ignored

  const emit = (patch) => {
    state = { ...state, ...patch, queued: buffer.length };
    if (!destroyed) onChange(state);
  };

  function clearLocal() {
    if (watchId !== null) geo?.clearWatch?.(watchId);
    watchId = null;
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    buffer = [];
    lastKept = null;
    firstGood = null;
    inFlight = false;
  }

  function fail(code, message) {
    generation += 1;
    const tripId = state.tripId;
    clearLocal();
    emit({ phase: code === 'trip_not_active' ? 'ended' : 'error', error: { code, message: message || SHARE_ERRORS[code] || SHARE_ERRORS.failed }, warning: null, tripId: null });
    return tripId;
  }

  function keep(fix) {
    if (lastKept && fix.at <= lastKept.at) return false;
    if (lastKept) {
      const gap = fix.at - lastKept.at;
      const moved = distanceM(lastKept, fix);
      if (gap < cfg.minGapMs && !(moved >= cfg.moveMeters && gap >= cfg.moveGapMs)) return false;
    }
    lastKept = fix;
    buffer.push(fix);
    if (buffer.length > cfg.maxBuffer) buffer = buffer.slice(-cfg.maxBuffer);
    return true;
  }

  async function flush() {
    const gen = generation;
    if (inFlight || !buffer.length || !state.tripId || state.phase !== 'sharing') return;
    const batch = buffer.splice(0, cfg.maxBuffer);
    inFlight = true;
    emit({});
    try {
      const r = await api.send(state.tripId, key, batch.map(toWire));
      if (gen !== generation) return;
      const rejected = r?.rejected || [];
      emit({
        lastSentAt: now(),
        ...(r?.accepted ? { lastAcceptedAt: now(), accepted: state.accepted + r.accepted } : {}),
        ...(r?.accepted || !rejected.length ? { warning: state.warning === 'network' || state.warning === 'rate_limited' || state.warning === 'rejected' ? null : state.warning, warningDetail: null } : { warning: 'rejected', warningDetail: rejected[rejected.length - 1]?.reason || null }),
      });
    } catch (e) {
      if (gen !== generation) return;
      const info = errorInfo(e);
      // 409 here = the trip (or the bus) is no longer active on the server.
      if (info.status === 409) return void fail('trip_not_active');
      if (info.status === 403) return void fail(info.code === 'wrong_device' ? 'wrong_device' : 'forbidden', info.code === 'wrong_device' ? SHARE_ERRORS.wrong_device : info.message);
      if (info.status === 422) return void emit({ warning: 'rejected', warningDetail: info.message || null });
      // Network trouble / rate limit / server error: keep the newest positions and retry on the next tick.
      buffer = [...batch, ...buffer].slice(-cfg.maxBuffer);
      emit({ warning: info.status === 429 ? 'rate_limited' : 'network', warningDetail: null });
    } finally {
      if (gen === generation) inFlight = false;
    }
  }

  async function beginTrip(busId, gen) {
    try {
      const r = await api.start(busId);
      if (gen !== generation) {
        // Stopped while the trip was being created: end it straight away.
        if (r?.tripId) api.stop(r.tripId).catch(() => {});
        return;
      }
      key = r.deviceKey || null;
      emit({ phase: 'sharing', tripId: r.tripId, error: null });
      if (firstGood) keep(firstGood);
      firstGood = null;
      flush();
    } catch (e) {
      if (gen !== generation) return;
      const info = errorInfo(e);
      fail(info.code, info.message);
    }
  }

  function onPosition(pos) {
    if (destroyed || !ACTIVE.includes(state.phase)) return;
    const fix = readPosition(pos);
    if (!fix) return;
    if (now() - fix.at > cfg.maxCachedAgeMs) return; // a cached reading, not where the device is now
    lastFixSeenAt = now();
    const weak = !Number.isFinite(fix.accuracy) || fix.accuracy > cfg.maxAccuracyM;
    emit({ lastFix: fix, warning: weak ? 'weak_gps' : ['weak_gps', 'gps_unavailable', 'no_fix'].includes(state.warning) ? null : state.warning });
    if (weak) return;
    if (state.phase === 'locating') {
      firstGood = fix;
      emit({ phase: 'starting' });
      beginTrip(state.busId, generation);
    } else if (state.phase === 'starting') {
      firstGood = fix; // the newest one is sent once the trip exists
    } else if (keep(fix)) {
      if (buffer.length === 1 && !state.lastSentAt) flush(); // the first position goes out at once
      else emit({});
    }
  }

  function onError(err) {
    if (destroyed || !ACTIVE.includes(state.phase)) return;
    if (err?.code === 1) {
      const tripId = fail('denied');
      if (tripId) api.stop(tripId).catch(() => {});
      return;
    }
    emit({ warning: 'gps_unavailable' }); // 2 = position unavailable, 3 = timeout: keep watching
  }

  function tick() {
    if (state.phase !== 'sharing') return;
    if (lastFixSeenAt && now() - lastFixSeenAt > cfg.noFixWarnMs && state.warning !== 'no_fix') emit({ warning: 'no_fix' });
    flush();
  }

  function watch() {
    watchId = geo.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    timer = timers.setInterval(tick, cfg.sendEveryMs);
  }

  return {
    get state() {
      return state;
    },
    /** Explicit user action: read the location, then start a trip for `busId`. */
    start(busId) {
      if (destroyed || ACTIVE.includes(state.phase) || state.phase === 'stopping') return false;
      if (!secure) return void fail('insecure');
      if (!geo?.watchPosition) return void fail('unsupported');
      generation += 1;
      clearLocal();
      key = null;
      lastFixSeenAt = 0;
      emit({ phase: 'locating', busId, tripId: null, lastFix: null, lastSentAt: null, lastAcceptedAt: null, accepted: 0, warning: null, warningDetail: null, error: null });
      watch();
      return true;
    },
    /** Continue a trip this tab started before a reload (its key was kept for this tab only). */
    resume({ busId, tripId, deviceKey }) {
      if (destroyed || ACTIVE.includes(state.phase)) return false;
      if (!secure) return void fail('insecure');
      if (!geo?.watchPosition) return void fail('unsupported');
      generation += 1;
      clearLocal();
      key = deviceKey || null;
      lastFixSeenAt = 0;
      emit({ phase: 'sharing', busId, tripId, lastFix: null, lastSentAt: null, lastAcceptedAt: null, accepted: 0, warning: null, warningDetail: null, error: null });
      watch();
      return true;
    },
    /** Stop reading the location and end the trip on the server. */
    async stop() {
      if (destroyed) return;
      const tripId = state.tripId;
      generation += 1;
      clearLocal();
      if (!tripId) return void emit({ phase: state.phase === 'error' || state.phase === 'ended' ? state.phase : 'idle', warning: null });
      emit({ phase: 'stopping', warning: null });
      try {
        await api.stop(tripId);
        emit({ phase: 'stopped', tripId: null, error: null });
      } catch (e) {
        // The device has already stopped reading its location; only the server confirmation is missing.
        emit({ phase: 'stopped', tripId: null, error: { code: 'stop_unconfirmed', message: errorInfo(e).message || 'Sharing stopped on this device, but VEXON did not confirm it. The trip ends by itself when no locations arrive.' } });
      }
    },
    /** Leaving the page: release the watcher and timers; end a running trip (best effort). */
    destroy() {
      if (destroyed) return;
      const tripId = ACTIVE.includes(state.phase) ? state.tripId : null;
      generation += 1;
      clearLocal();
      destroyed = true;
      if (tripId) api.stop(tripId).catch(() => {});
    },
  };
}
