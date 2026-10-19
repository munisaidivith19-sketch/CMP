import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import PlatformState, { PLATFORM_MODES } from '../models/PlatformState.js';
import User from '../models/User.js';
import { SUPER_ADMIN_ROLE } from '../constants.js';

/**
 * Emergency-mode state machine.
 *
 *   normal ⇄ maintenance ⇄ lockdown, lockdown → normal, any → recovery → normal
 *
 * - Lifting maintenance or lockdown returns straight to normal. Recovery can
 *   only return to normal after a passing health check run since it was entered.
 * - Transitions are compare-and-set on `version`: a stale or concurrent
 *   request gets a conflict instead of interleaving, and asking for the mode
 *   the platform is already in is a no-op (idempotent).
 * - Nothing here deletes or alters data, sessions aside (lockdown revokes
 *   ordinary sessions, done by the caller). Super Admin access is never
 *   blocked, so the recovery path cannot be switched off from inside the app.
 *
 * Break-glass: PLATFORM_MODE_OVERRIDE=normal in the server environment forces
 * normal operation regardless of the stored mode (and
 * scripts/platform-mode.mjs resets the stored mode from a shell).
 */
export const TRANSITIONS = {
  normal: ['maintenance', 'lockdown'],
  maintenance: ['normal', 'lockdown', 'recovery'],
  // Lifting a lockdown may go straight back to normal (or via recovery checks).
  lockdown: ['normal', 'maintenance', 'recovery'],
  recovery: ['normal', 'maintenance', 'lockdown'],
};
export const HEALTH_CHECK_VALID_MS = 15 * 60 * 1000;
const CACHE_MS = 2000;
const DEFAULT_MESSAGE = 'VEXON is temporarily unavailable for maintenance. Please try again later.';

let cache = null; // { state, at }

export class TransitionError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const override = () => (process.env.PLATFORM_MODE_OVERRIDE || '').trim().toLowerCase();

async function load() {
  const doc = await PlatformState.findById('platform').lean();
  return doc || { _id: 'platform', mode: 'normal', version: 0 };
}

/** Current state (cached for a couple of seconds; refreshed on every change in this process). */
export async function getPlatformState({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.state;
  const state = await load();
  if (override() === 'normal') state.mode = 'normal';
  cache = { state, at: Date.now() };
  return state;
}

export const invalidatePlatformCache = () => {
  cache = null;
};

/** Public, non-sensitive view for the maintenance page. */
export async function publicStatus() {
  const s = await getPlatformState();
  // Lockdown / recovery are not revealed publicly: everyone outside sees "maintenance".
  return s.mode === 'normal' ? { mode: 'normal' } : { mode: 'maintenance', message: s.message || DEFAULT_MESSAGE };
}

/** May this user use the application in the current mode? Super Admin always may. */
export async function platformAllows(user) {
  if (user?.role === SUPER_ADMIN_ROLE) return true;
  const s = await getPlatformState().catch(() => ({ mode: 'normal' }));
  return s.mode === 'normal';
}

export function maintenanceBody(state) {
  return {
    message: state.message || DEFAULT_MESSAGE,
    code: 'MAINTENANCE',
    maintenance: true,
  };
}

/**
 * Compare-and-set transition. Returns { state, changed }. Throws
 * TransitionError(409) on a stale version / illegal transition and (422) when
 * recovery → normal lacks a passing, recent health check.
 */
export async function transition({ to, expectedVersion, actorId, reason, message }) {
  if (!PLATFORM_MODES.includes(to)) throw new TransitionError(422, 'Unknown mode');
  const current = await getPlatformState({ fresh: true });
  // Make sure the singleton exists so the compare-and-set below has a row to match.
  await PlatformState.updateOne({ _id: 'platform' }, { $setOnInsert: { mode: 'normal', version: 0 } }, { upsert: true }).catch((err) => {
    if (err?.code !== 11000) throw err; // a concurrent first insert won the race — fine
  });

  if (current.mode === to) return { state: current, changed: false };
  if (Number(expectedVersion) !== Number(current.version || 0)) {
    throw new TransitionError(409, 'The emergency state changed since you loaded it. Review the current state and try again.', { state: current });
  }
  if (!TRANSITIONS[current.mode]?.includes(to)) {
    throw new TransitionError(409, `Cannot move from ${current.mode} to ${to}`, { state: current });
  }
  if (current.mode === 'recovery' && to === 'normal') {
    const hc = current.lastHealthCheck;
    const recent = hc?.at && Date.now() - new Date(hc.at).getTime() <= HEALTH_CHECK_VALID_MS;
    const sinceRecovery = hc?.at && current.enteredRecoveryAt && new Date(hc.at) >= new Date(current.enteredRecoveryAt);
    if (!hc?.ok || !recent || !sinceRecovery) {
      throw new TransitionError(422, 'Run a passing health check in recovery mode (within the last 15 minutes) before reopening access.');
    }
  }

  const now = new Date();
  const set = { mode: to, reason, changedBy: actorId, changedAt: now, message: message || undefined };
  if (to === 'recovery') set.enteredRecoveryAt = now;
  const updated = await PlatformState.findOneAndUpdate(
    { _id: 'platform', version: current.version || 0, mode: current.mode },
    { $set: set, $inc: { version: 1 } },
    { new: true, lean: true }
  );
  invalidatePlatformCache();
  if (!updated) {
    throw new TransitionError(409, 'Another emergency operation completed first. Review the current state and try again.', {
      state: await getPlatformState({ fresh: true }),
    });
  }
  return { state: updated, changed: true };
}

/** Read the externally-written backup status file, if configured. Never returns its path or secrets. */
export async function backupStatus() {
  const file = process.env.BACKUP_STATUS_FILE;
  if (!file) return { configured: false };
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const lastBackupAt = raw.lastBackupAt ? new Date(raw.lastBackupAt) : null;
    const lastVerifiedAt = raw.lastVerifiedAt ? new Date(raw.lastVerifiedAt) : null;
    const valid = (d) => d && !Number.isNaN(d.getTime());
    return {
      configured: true,
      readable: true,
      lastBackupAt: valid(lastBackupAt) ? lastBackupAt : null,
      lastVerifiedAt: valid(lastVerifiedAt) ? lastVerifiedAt : null,
      lastResult: typeof raw.lastResult === 'string' ? raw.lastResult.slice(0, 40) : null,
    };
  } catch {
    return { configured: true, readable: false };
  }
}

/** Service health checks. Critical failures make the check fail; warnings do not. */
export async function runHealthChecks() {
  const checks = [];
  const add = (name, ok, severity, detail) => checks.push({ name, ok, severity, detail });

  const dbReady = mongoose.connection.readyState === 1;
  let pingOk = false;
  if (dbReady) {
    try {
      await mongoose.connection.db.admin().ping();
      pingOk = true;
    } catch {
      pingOk = false;
    }
  }
  add('database', dbReady && pingOk, 'critical', dbReady && pingOk ? 'Connected and responding' : 'Database is not responding');

  const supers = await User.countDocuments({ role: SUPER_ADMIN_ROLE, isActive: true }).catch(() => 0);
  add('recovery_access', supers > 0, 'critical', supers > 0 ? `${supers} active Super Admin account(s)` : 'No active Super Admin account');

  const backup = await backupStatus();
  const backupAge = backup.lastBackupAt ? Date.now() - new Date(backup.lastBackupAt).getTime() : null;
  if (!backup.configured) add('backup', false, 'warning', 'Backup status is not configured (BACKUP_STATUS_FILE)');
  else if (!backup.readable) add('backup', false, 'warning', 'Backup status file could not be read');
  else add('backup', backupAge !== null && backupAge < 48 * 3600 * 1000, 'warning', backup.lastBackupAt ? `Last backup ${new Date(backup.lastBackupAt).toISOString()}` : 'No backup recorded');

  const ok = checks.filter((c) => c.severity === 'critical').every((c) => c.ok);
  return { ok, checks, at: new Date() };
}

/** Store the result of a health check on the state document (does not bump the version). */
export async function recordHealthCheck(result, actorId) {
  await PlatformState.updateOne(
    { _id: 'platform' },
    { $set: { lastHealthCheck: { ok: result.ok, at: result.at, by: actorId, checks: result.checks } }, $setOnInsert: { mode: 'normal', version: 0 } },
    { upsert: true }
  );
  invalidatePlatformCache();
}
