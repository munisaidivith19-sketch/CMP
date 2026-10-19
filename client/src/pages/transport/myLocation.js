/**
 * "My location" on the bus map — the viewer's own device position, kept apart
 * from bus positions. Reading the device is done by the shared, hardened
 * readFreshFix (utils/returnLocation.js): fresh high-accuracy readings only,
 * readings older than 25 s refused, the most precise kept, listening stopped
 * before it settles. This module adds what the map needs on top:
 *
 *  - validation of the reading (a bad one is `invalid`, never drawn);
 *  - an explicit state for every outcome, with its message;
 *  - one request at a time: a new request cancels the old one, and an older
 *    answer can never overwrite a newer one;
 *  - an honest label: coarse readings are `approximate`, and the accuracy shown
 *    is only ever the one the device reported.
 *
 * Free of React and of `window` globals (passed in) so it runs under node --test.
 */
import { MAX_FIX_AGE_MS, preflight, permissionState, readFreshFix } from '../../utils/returnLocation.js';
import { COARSE_FIX_M, accuracyText } from './busGeo.js';

export const MY_LOCATION_MS = 15000; // how long to listen for a precise fix
/**
 * If only a city-level estimate arrived in that time, keep listening this much
 * longer for a Wi-Fi / GPS position. Measured on a Windows laptop: Windows
 * first (and intermittently) reports the internet-provider (IP) estimate at
 * ±50 km and needs ~18 s, sometimes longer, to produce its ±500 m Wi-Fi fix.
 */
export const REFINE_MS = 30000;
/**
 * Coarser than this (metres) is a city-level estimate — typically from the
 * internet connection's IP address, which places the device at its provider's
 * hub city, possibly hundreds of km away. Such a reading is shown as an AREA
 * with a warning, never as a "you are here" dot.
 */
export const AREA_ONLY_M = 3000;

/**
 * Where a browser reading most likely came from. Browsers do not expose the
 * source, so this is inferred from what they DO report (accuracy; altitude is
 * only present on satellite fixes) and always labelled "likely".
 */
export function sourceOf(reading) {
  const acc = reading?.accuracy;
  if (!Number.isFinite(acc)) return { key: 'unknown', label: 'Unknown' };
  if (acc <= 30 || (acc <= 100 && Number.isFinite(reading.altitude))) return { key: 'gps', label: 'Satellite GPS (likely)' };
  if (acc <= 300) return { key: 'wifi', label: 'Wi-Fi / nearby networks (likely)' };
  if (acc <= AREA_ONLY_M) return { key: 'cell', label: 'Mobile-network towers (likely)' };
  return { key: 'ip', label: 'Internet address (IP) estimate — your provider’s city, not your device' };
}

/**
 * Wrap navigator.geolocation so every raw reading the browser returns is
 * recorded (and optionally logged) with its verdict — `fresh`, `stale` (older
 * than readFreshFix accepts) or `invalid` — before the shared reader judges it.
 * Nothing here leaves the browser.
 */
export function recordingGeo(geo, onReading, now = () => Date.now()) {
  return {
    watchPosition(ok, fail, opts) {
      return geo.watchPosition(
        (pos) => {
          const c = pos?.coords || {};
          const ageMs = Number.isFinite(pos?.timestamp) ? now() - pos.timestamp : null;
          const reading = {
            lat: c.latitude,
            lng: c.longitude,
            accuracy: c.accuracy,
            altitude: Number.isFinite(c.altitude) ? c.altitude : null,
            timestamp: pos?.timestamp ?? null,
            ageMs,
            verdict: !toMyFix(pos) ? 'invalid' : ageMs == null || Math.abs(ageMs) > MAX_FIX_AGE_MS ? 'stale' : 'fresh',
          };
          reading.source = sourceOf(reading).label;
          onReading(reading);
          // An invalid reading (e.g. 0,0) is dropped here, so it can neither be
          // chosen nor end the listening early — a later valid one still counts.
          if (reading.verdict !== 'invalid') ok(pos);
        },
        fail,
        opts
      );
    },
    clearWatch: (id) => geo.clearWatch(id),
  };
}

/** idle | requesting | available | approximate | permission_denied | unavailable | timeout | invalid */
export const STATES = ['idle', 'requesting', 'available', 'approximate', 'permission_denied', 'unavailable', 'timeout', 'invalid'];

/**
 * A browser GeolocationPosition → { lat, lng, accuracy, at }, or null when it
 * is not a usable position (non-numeric, out of range, 0,0 "null island", or
 * no accuracy reported — an accuracy is never invented).
 */
export function toMyFix(pos) {
  const c = pos?.coords;
  if (!c) return null;
  const { latitude: lat, longitude: lng, accuracy } = c;
  if (![lat, lng, accuracy].every(Number.isFinite)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  if (accuracy <= 0) return null;
  const altitude = Number.isFinite(c.altitude) ? c.altitude : null;
  return { lat, lng, accuracy, at: Number.isFinite(pos.timestamp) ? pos.timestamp : null, source: sourceOf({ accuracy, altitude }).key };
}

/** A fix shown as a precise "you are here" dot; coarser ones are drawn only as an area. */
export const showsDot = (fix) => Boolean(fix) && fix.accuracy <= AREA_ONLY_M;

/** available (precise enough to trust) or approximate (Wi-Fi / IP / "approximate" permission). */
export const stateOfFix = (fix) => (fix.accuracy > COARSE_FIX_M ? 'approximate' : 'available');

const FAILURE_STATE = { denied: 'permission_denied', blocked: 'permission_denied', insecure: 'unavailable', unsupported: 'unavailable', unavailable: 'unavailable', stale: 'timeout', timeout: 'timeout' };

/** The message for a state. `reason` refines unavailable / permission failures. */
export function myLocationMessage(state, { fix, reason } = {}) {
  switch (state) {
    case 'requesting':
      if (reason === 'refining')
        return `So far your device has only a rough estimate from your internet connection (${accuracyText(fix?.accuracy)}). Still waiting for a Wi-Fi or GPS position — on a laptop this can take up to 30 seconds…`;
      return 'Getting your location…';
    case 'available':
      return `Location found. Accuracy: about ${accuracyText(fix.accuracy).replace('± ', '')}.`;
    case 'approximate':
      if (fix.source === 'ip')
        return (
          `Your device did not provide a GPS or Wi-Fi position. The browser fell back to an estimate from your internet connection (${accuracyText(fix.accuracy)}), ` +
          'which places you at your internet provider’s city — this can be a different town, hundreds of km from where you are. It is shown as a shaded area, not as your position. ' +
          'For your real position: turn on Location (Windows: Settings → Privacy & security → Location) with Wi-Fi switched on, or use the VEXON phone app outdoors with precise location allowed.'
        );
      return (
        `Only an approximate location is available (${accuracyText(fix.accuracy)}), so the blue dot may be some distance from you. ` +
        'Computers without GPS estimate their position from Wi-Fi or the internet connection. Turn on precise location if your device supports it, or use the VEXON phone app outdoors.'
      );
    case 'permission_denied':
      return reason === 'blocked'
        ? 'Location is blocked for this site. Click the lock icon next to the address bar → Site settings → Location → Allow, then press My location again.'
        : 'Location permission denied. Allow location access in your browser settings, then press My location again.';
    case 'timeout':
      return reason === 'stale'
        ? 'Your device only returned an old location reading, so it was not used. Press My location to try again.'
        : 'Finding your location took too long. Move near a window or outdoors and press My location again.';
    case 'invalid':
      return 'Your device returned a location that is not valid, so it was not shown. Press My location to try again.';
    case 'unavailable':
      if (reason === 'insecure') return 'Location only works on a secure (https://) connection. Open VEXON using its https:// address and try again.';
      if (reason === 'unsupported') return 'This browser cannot share its location. Use an up-to-date Chrome, Edge, Safari or Firefox, or the VEXON app.';
      return 'Unable to obtain your location. Check your connection and that location is turned on in your device settings, then retry.';
    default:
      return '';
  }
}

/**
 * One "My location" request at a time. `onChange({ state, fix, message, seq })`
 * reports every step. `request()` cancels any request still running; an answer
 * belonging to an older request is dropped. `stop()` cancels and stops
 * listening (call it on unmount).
 */
export function createLocator({ win, onChange, read = readFreshFix, sampleMs = MY_LOCATION_MS, refineMs = REFINE_MS, log }) {
  let seq = 0;
  let controller = null;
  let readings = [];
  const emit = (s, state, fix = null, reason) => {
    if (s !== seq) return; // a newer request (or stop) has superseded this one
    // While still requesting, the rough estimate only feeds the message — it is not drawn.
    const shown = state === 'requesting' ? null : fix;
    onChange({ state, fix: shown, message: myLocationMessage(state, { fix, reason }), seq: s, readings: [...readings] });
  };
  return {
    async request() {
      controller?.abort();
      const s = ++seq;
      const ctrl = new AbortController();
      controller = ctrl;
      readings = [];
      const blocked = preflight(win);
      if (blocked) {
        log?.('request failed before asking the device', { reason: blocked });
        return emit(s, FAILURE_STATE[blocked], null, blocked);
      }
      emit(s, 'requesting');
      const before = await permissionState(win.navigator);
      log?.('requesting a fresh high-accuracy position', { permissionBefore: before });
      if (s !== seq) return;
      // Every raw reading is recorded for the "Location details" panel (and the console when logging is on).
      const geo = recordingGeo(win.navigator.geolocation, (r) => {
        if (s !== seq) return;
        readings = [...readings, r].slice(-10);
        log?.('reading', r);
      });
      try {
        let fix = toMyFix(await read(geo, { signal: ctrl.signal, sampleMs }));
        if (!fix) return emit(s, 'invalid');
        if (fix.accuracy > AREA_ONLY_M && refineMs > 0) {
          // Only the city-level (IP) estimate so far: listen longer, and stop as
          // soon as a real Wi-Fi / GPS position (within AREA_ONLY_M) arrives.
          log?.('only a city-level estimate — listening longer', { accuracy: fix.accuracy });
          emit(s, 'requesting', fix, 'refining');
          try {
            const better = toMyFix(await read(geo, { signal: ctrl.signal, sampleMs: refineMs, goodEnoughM: AREA_ONLY_M }));
            if (better && better.accuracy <= fix.accuracy) fix = better;
          } catch (err) {
            if (err?.kind === 'aborted') return;
            // No newer reading at all: keep the estimate we have (still labelled, drawn only as an area).
          }
        }
        log?.('used', { ...fix, state: stateOfFix(fix) });
        emit(s, stateOfFix(fix), fix);
      } catch (err) {
        if (err?.kind === 'aborted') return;
        const reason = err?.kind === 'denied' && before === 'denied' ? 'blocked' : err?.kind;
        log?.('failed', { kind: err?.kind, permissionBefore: before });
        emit(s, FAILURE_STATE[err?.kind] || 'unavailable', null, reason);
      } finally {
        if (controller === ctrl) controller = null;
      }
    },
    stop() {
      seq += 1;
      controller?.abort();
      controller = null;
    },
  };
}

/**
 * Bounds that show the whole accuracy area around a fix ([[w, s], [e, n]]).
 * A precise fix gets street level; a coarse one is shown zoomed out, so a rough
 * estimate never looks exact. At least `minMeters` so a ±5 m fix is not over-zoomed.
 */
export function accuracyBounds(fix, minMeters = 60) {
  const r = Math.max(fix.accuracy, minMeters);
  const dLat = r / 111195;
  const dLng = r / (111195 * Math.max(0.01, Math.cos((fix.lat * Math.PI) / 180)));
  return [
    [fix.lng - dLng, fix.lat - dLat],
    [fix.lng + dLng, fix.lat + dLat],
  ];
}

/**
 * Keep exactly one "you are here" marker: create it on the first fix, move it
 * on later ones, remove it when there is no fix. Returns the marker to keep.
 * `create(fix)` builds a marker exposing setLngLat / remove.
 */
export function syncUserMarker(current, fix, create) {
  if (!fix) {
    current?.remove();
    return null;
  }
  if (!current) return create(fix);
  current.setLngLat([fix.lng, fix.lat]);
  return current;
}
