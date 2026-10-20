import http from 'node:http';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { initSocket } from './config/socket.js';
import { createApp } from './app.js';
import { expireGatePasses } from './controllers/gatePassController.js';
import { startGatePassCodeQueue } from './services/gatePassCodeQueue.js';
import { startKeepAlive } from './utils/keepAlive.js';
import { syncSubjects } from './utils/syncSubjects.js';
import { normaliseBreakPeriods } from './services/timetablePeriods.js';
import { startAlumniSchedulers } from './utils/alumniSchedulers.js';
import { startIdleSessionSweeper } from './utils/sessionIdle.js';
import { warmAttendanceTotals } from './services/attendanceTotals.js';
import { startReminders } from './services/reminders.js';
import { startTripSweeper } from './services/transport/trips.js';
import { attachDbMonitor, attachProcessMonitor, registerJob, runJob } from './services/soc/monitors.js';
import { flushMetrics, startMetricsFlusher } from './services/soc/metrics.js';
import { sweepOrphanAssets } from './services/skillWallet/assets.js';
import { sweepPartialWrites } from './utils/privateStorage.js';
import { sweepOrphanUploads } from './services/orphanUploads.js';

async function start() {
  // SOC: observe crashes (does not change Node's crash behaviour).
  attachProcessMonitor();
  // SOC: record MongoDB disconnects / connection errors (listeners attach once).
  attachDbMonitor();
  await connectDB();
  // Make sure every subject in data/timetableData.js exists for the timetable.
  await syncSubjects()
    .then((n) => n && console.log(`[subjects] added ${n} subject(s) from data/timetableData.js`))
    .catch((err) => console.error('[subjects] sync failed:', err.message));
  // Breaks are not periods: renumber any class day saved while a break still
  // took a period number (P1 P2 P3 [Break P4] P5 → … [Break] P4). Idempotent.
  await normaliseBreakPeriods({ log: console.log })
    .then(({ days }) => days && console.log(`[timetable] renumbered periods on ${days} class day(s)`))
    .catch((err) => console.error('[timetable] period renumbering failed:', err.message));
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  // Close gate passes whose validity window has passed (also runs lazily on verify).
  registerJob('gate_pass.expiry_sweep', { intervalMs: 5 * 60 * 1000, description: 'Close expired gate passes' });
  const sweep = setInterval(() => runJob('gate_pass.expiry_sweep', expireGatePasses, { logTag: '[gate-pass] sweep' }), 5 * 60 * 1000);
  sweep.unref();

  // Bulk (bind-group) approvals: issue gate codes + QR a few at a time, retrying failures.
  startGatePassCodeQueue();

  // On Render: ping our own URL every 14 min, 05:30–22:00 IST only (sleeps at night).
  startKeepAlive();

  // Revoke web sessions idle past their limit and drop their sockets, even
  // when the tab sends no HTTP request at all (one indexed query / 30 s).
  startIdleSessionSweeper();

  // Start Alumni Network schedulers (reminders, housekeeping, capacity reconcile)
  startAlumniSchedulers();

  // Pre-compute the semester attendance totals the dashboards use, so the first
  // principal / HOD / COE dashboard after a (re)start is as fast as the rest.
  warmAttendanceTotals();

  // Next-period reminders and the daily attendance digest (one tick a minute).
  startReminders();

  // Bus trips: end idle / over-long trips and report lost tracking (one tick a minute).
  startTripSweeper();

  // SOC request / error counters: in memory, added to the database once a minute.
  startMetricsFlusher();

  // Skill Wallet: remove project images uploaded but never attached, and
  // leftover partial writes in private storage (hourly).
  registerJob('skill_wallet.orphan_sweep', { intervalMs: 60 * 60 * 1000, description: 'Remove orphaned Skill Wallet uploads' });
  const swSweep = setInterval(
    () => runJob('skill_wallet.orphan_sweep', () => Promise.all([sweepOrphanAssets(), sweepPartialWrites()]), { logTag: '[skill-wallet] sweep' }),
    60 * 60 * 1000
  );
  swSweep.unref();

  // Uploads (POST /api/uploads) kept in MongoDB but never attached to a record
  // within 24 hours are deleted (hourly). Attached files are never touched.
  registerJob('uploads.orphan_sweep', { intervalMs: 60 * 60 * 1000, description: 'Remove uploads never attached to a record' });
  const uploadSweep = setInterval(() => runJob('uploads.orphan_sweep', sweepOrphanUploads, { logTag: '[uploads] sweep' }), 60 * 60 * 1000);
  uploadSweep.unref();

  server.listen(env.port, () => {
    console.log(`[api] CampusConnect API listening on http://localhost:${env.port}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[api] ${signal} received — shutting down`);
    flushMetrics().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
