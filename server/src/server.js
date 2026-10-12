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

async function start() {
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
  const sweep = setInterval(() => expireGatePasses().catch((err) => console.error('[gate-pass] sweep failed:', err.message)), 5 * 60 * 1000);
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

  server.listen(env.port, () => {
    console.log(`[api] CampusConnect API listening on http://localhost:${env.port}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[api] ${signal} received — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
