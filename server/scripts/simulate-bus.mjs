#!/usr/bin/env node
/**
 * SYNTHETIC GPS SIMULATOR — FOR TESTING ONLY. Every position it sends is made
 * up: it walks a configured route's own stops/geometry at a constant speed.
 * Never run it against a real deployment's buses; it refuses when
 * NODE_ENV=production.
 *
 * It drives the REAL ingestion path — the signed tracker webhook — so the map,
 * ETA, socket updates and alerts can be exercised end to end.
 *
 * Setup (development only):
 *   1. In server/.env set TRACKER_WEBHOOK_SECRET=<any long random string>.
 *   2. In Manage buses, create a bus with GPS source "Vehicle GPS tracker",
 *      a route with stops, and Tracker device ID = SIM-TEST-1 (any id works).
 *   3. node scripts/simulate-bus.mjs --device SIM-TEST-1 --route "<route name>"
 *        [--api http://localhost:5000] [--speed 9] [--every 5]
 */
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import 'dotenv/config';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to send synthetic GPS data in production.');
  process.exit(1);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const device = arg('device');
const routeName = arg('route');
const api = arg('api', `http://localhost:${process.env.PORT || 5000}`);
const speed = Number(arg('speed', 9)); // m/s
const every = Number(arg('every', 5)); // seconds
const secret = process.env.TRACKER_WEBHOOK_SECRET;
if (!device || !routeName || !secret) {
  console.error('Usage: node scripts/simulate-bus.mjs --device <trackerDeviceId> --route "<route name>"  (needs TRACKER_WEBHOOK_SECRET)');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
const route = await mongoose.connection.db.collection('busroutes').findOne({ name: routeName, isActive: true });
await mongoose.disconnect();
if (!route) {
  console.error(`No active route named "${routeName}"`);
  process.exit(1);
}
const pts = (route.geometry?.length >= 2 ? route.geometry.map(([lng, lat]) => ({ lat, lng })) : route.stops.sort((a, b) => a.sequence - b.sequence).map((s) => ({ lat: s.lat, lng: s.lng })));

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2));
const bearing = (a, b) => {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

async function send(p, heading) {
  const body = JSON.stringify({ deviceId: device, fixes: [{ lat: p.lat, lng: p.lng, timestamp: Date.now(), accuracy: 8, speed, heading }] });
  const ts = String(Date.now());
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const res = await fetch(`${api}/api/transport/tracker/locations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-timestamp': ts, 'x-tracker-signature': sig }, body });
  console.log(`[SYNTHETIC] ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} → ${res.status} ${await res.text()}`);
}

console.log(`[SYNTHETIC] Driving "${routeName}" as ${device} at ${speed} m/s, one fix every ${every} s. Ctrl+C to stop.`);
for (let i = 1; i < pts.length; i += 1) {
  const a = pts[i - 1];
  const b = pts[i];
  const steps = Math.max(1, Math.ceil(dist(a, b) / (speed * every)));
  for (let k = 1; k <= steps; k += 1) {
    const t = k / steps;
    await send({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, bearing(a, b));
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}
console.log('[SYNTHETIC] Reached the end of the route.');
