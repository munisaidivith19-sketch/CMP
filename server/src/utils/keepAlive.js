/**
 * Keep the Render free instance awake during the day, and let it sleep at night.
 *
 * Render spins a free web service down after 15 minutes without inbound HTTP
 * traffic. While running on Render, the server calls its own public URL every
 * 14 minutes — but only between 05:30 and 22:00 IST. After 22:00 it stops, the
 * instance sleeps for the night (saving free instance hours), and the GitHub
 * workflow .github/workflows/keep-alive.yml wakes it again at ~05:30 IST.
 *
 * Runs only where a public URL is known: RENDER_EXTERNAL_URL (set by Render
 * automatically) or KEEP_ALIVE_URL. Never in development or tests. Set
 * KEEP_ALIVE=false to switch it off.
 */
const INTERVAL_MS = 14 * 60 * 1000;
const WINDOW_START = 5 * 60 + 30; // 05:30 IST
const WINDOW_END = 22 * 60; // 22:00 IST
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Minutes since midnight, India time. */
export function istMinutes(date = new Date()) {
  const [h, m] = IST.format(date).split(':').map(Number);
  return h * 60 + m;
}

/** True between 05:30 (inclusive) and 22:00 (exclusive) IST. */
export const inKeepAliveWindow = (date = new Date()) => {
  const now = istMinutes(date);
  return now >= WINDOW_START && now < WINDOW_END;
};

/** The URL to ping, or null when keep-alive should not run here. */
export function keepAliveUrl(envVars = process.env) {
  if (envVars.KEEP_ALIVE === 'false' || envVars.NODE_ENV === 'test') return null;
  if (envVars.KEEP_ALIVE_URL) return envVars.KEEP_ALIVE_URL.trim();
  if (envVars.RENDER_EXTERNAL_URL) return `${envVars.RENDER_EXTERNAL_URL.trim().replace(/\/+$/, '')}/api/health`;
  return null;
}

let timer = null;

export function startKeepAlive() {
  const url = keepAliveUrl();
  if (!url || timer) return;
  const ping = async () => {
    if (!inKeepAliveWindow()) return; // night: let the instance sleep
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'vexon-keep-alive' } });
      if (!res.ok) console.warn(`[keep-alive] ${url} → HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[keep-alive] ping failed: ${err?.message || err}`);
    }
  };
  timer = setInterval(ping, INTERVAL_MS);
  console.log(`[keep-alive] pinging ${url} every 14 min, 05:30–22:00 IST`);
}
