import http from 'node:http';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { initSocket } from './config/socket.js';
import { createApp } from './app.js';
import { expireGatePasses } from './controllers/gatePassController.js';

async function start() {
  await connectDB();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  // Close gate passes whose validity window has passed (also runs lazily on verify).
  const sweep = setInterval(() => expireGatePasses().catch((err) => console.error('[gate-pass] sweep failed:', err.message)), 5 * 60 * 1000);
  sweep.unref();

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
