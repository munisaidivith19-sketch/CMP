#!/usr/bin/env node
/**
 * Break-glass: show or reset the platform emergency mode from a server shell,
 * independent of the web UI (for example if every Super Admin is locked out).
 *
 *   node scripts/platform-mode.mjs            # show the current mode
 *   node scripts/platform-mode.mjs normal     # force normal operation
 *
 * The change is recorded in the protected audit trail. Running servers pick it
 * up within a few seconds (their state cache is short-lived). Alternatively set
 * PLATFORM_MODE_OVERRIDE=normal in the server environment and restart.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import PlatformState from '../src/models/PlatformState.js';
import AuditLog from '../src/models/AuditLog.js';

const target = process.argv[2];
await connectDB(undefined, { attempts: 2, delayMs: 1000 });
if (mongoose.connection.readyState !== 1) {
  console.error('Not connected to MongoDB — nothing was changed.');
  process.exit(1);
}
try {
  const state = (await PlatformState.findById('platform').lean()) || { mode: 'normal', version: 0 };
  if (!target) {
    console.log(`Platform mode: ${state.mode} (version ${state.version || 0})`);
  } else if (target !== 'normal') {
    console.error('Only "normal" can be set from the shell; use the Emergency Control page for other modes.');
    process.exitCode = 1;
  } else {
    await PlatformState.updateOne(
      { _id: 'platform' },
      { $set: { mode: 'normal', reason: 'Reset from server shell', changedAt: new Date(), changedBy: null }, $inc: { version: 1 } },
      { upsert: true }
    );
    await AuditLog.create({ action: 'EMERGENCY_TRANSITION', actorRole: 'system', reason: 'Reset from server shell (scripts/platform-mode.mjs)', details: { from: state.mode, to: 'normal' } });
    console.log(`✔ Platform mode reset: ${state.mode} → normal`);
  }
} finally {
  await mongoose.disconnect();
}
