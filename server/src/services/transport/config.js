/**
 * Bus-tracking settings, all from the server environment (read on each call,
 * so they can be changed without code edits). Safe defaults; see
 * server/.env.example for the meaning of each.
 */
const num = (name, fallback, min, max) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export function transportConfig() {
  return {
    // Map style (vector tiles). OpenFreeMap needs no key; a provider that does
    // (e.g. MapTiler) takes its PUBLIC client key in the URL — never a secret.
    mapStyleUrl: process.env.MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty',
    mapAttribution: process.env.MAP_ATTRIBUTION || '© OpenFreeMap · © OpenMapTiles · Data © OpenStreetMap contributors',
    // 'all': every signed-in viewer sees every active bus; 'assigned': students
    // see only the route / bus they are assigned to (staff still see all).
    studentVisibility: process.env.TRANSPORT_STUDENT_VISIBILITY === 'assigned' ? 'assigned' : 'all',
    // Freshness of the last fix shown on the map.
    liveSeconds: num('TRANSPORT_LIVE_SECONDS', 60, 10, 600),
    staleSeconds: num('TRANSPORT_STALE_SECONDS', 300, 30, 3600),
    // Ingestion validation.
    maxFixAgeSeconds: num('GPS_MAX_AGE_SECONDS', 120, 10, 3600),
    maxFutureSeconds: num('GPS_MAX_FUTURE_SECONDS', 30, 0, 300),
    maxAccuracyMeters: num('GPS_MAX_ACCURACY_M', 100, 5, 5000),
    maxSpeedMps: num('GPS_MAX_SPEED_MPS', 33, 5, 100), // ~120 km/h
    minIntervalMs: num('GPS_MIN_INTERVAL_MS', 2000, 0, 60000),
    historyIntervalMs: num('GPS_HISTORY_INTERVAL_MS', 10000, 0, 600000),
    // Trips end by themselves when the phone stops reporting or runs too long.
    tripIdleMinutes: num('TRIP_IDLE_MINUTES', 15, 1, 240),
    tripMaxHours: num('TRIP_MAX_HOURS', 5, 1, 24),
    trackingLostMinutes: num('TRACKING_LOST_MINUTES', 5, 1, 120),
    // "Approaching your stop" alert threshold.
    approachingMinutes: num('BUS_APPROACHING_MINUTES', 5, 1, 30),
    // Inbound vehicle-tracker webhook (disabled unless a secret is set).
    trackerSecret: process.env.TRACKER_WEBHOOK_SECRET || '',
  };
}

/** live | stale | offline for a fix time. */
export function freshness(at, now = Date.now(), cfg = transportConfig()) {
  if (!at) return 'offline';
  const age = (now - new Date(at).getTime()) / 1000;
  if (age <= cfg.liveSeconds) return 'live';
  if (age <= cfg.staleSeconds) return 'stale';
  return 'offline';
}
