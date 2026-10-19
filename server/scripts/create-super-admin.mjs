#!/usr/bin/env node
/**
 * Provision (or re-key) a Super Admin account — the ONLY way one is created.
 * There is no default Super Admin and no API that creates or promotes one.
 *
 * Credentials come from the environment of the shell running this script and
 * are never written to the repository, logs or the database in plain text:
 *
 *   SUPER_ADMIN_EMAIL=ops@college.edu SUPER_ADMIN_NAME="Platform Owner" \
 *   SUPER_ADMIN_PASSWORD='…' node scripts/create-super-admin.mjs
 *
 * Flags:
 *   --reset-password  the account exists: set this password and sign it out everywhere
 *   --force-change    require a password change at first sign-in
 *
 * Connects to the database configured in .env (DB_TARGET / MONGO_URI…).
 * Refuses to turn an existing non-Super-Admin account into a Super Admin.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import AuditLog from '../src/models/AuditLog.js';

const args = new Set(process.argv.slice(2));
const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const name = String(process.env.SUPER_ADMIN_NAME || 'Super Admin').trim();
const password = process.env.SUPER_ADMIN_PASSWORD || '';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

if (!/^\S+@\S+\.\S+$/.test(email)) fail('Set SUPER_ADMIN_EMAIL to a valid email address');
if (password.length < 8 || password.length > 72) fail('SUPER_ADMIN_PASSWORD must be 8–72 characters');
if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  fail('SUPER_ADMIN_PASSWORD must contain a letter, a number and a symbol');
}
if (password.length < 12) console.warn('⚠ Passwords shorter than 12 characters are weak for a Super Admin. Change it after the first sign-in.');

await connectDB(undefined, { attempts: 2, delayMs: 1000 });
if (mongoose.connection.readyState !== 1) fail('Not connected to MongoDB — nothing was changed.');
try {
  const existing = await User.findOne({ email }).select('+password +tokenVersion');
  if (existing && existing.role !== 'super_admin') {
    fail(`${email} already belongs to a ${existing.role} account. Use a dedicated address for the Super Admin.`);
  }
  if (existing && !args.has('--reset-password')) {
    fail(`A Super Admin with ${email} already exists. Pass --reset-password to set a new password.`);
  }

  let user;
  if (existing) {
    existing.password = password;
    existing.isActive = true;
    existing.mustChangePassword = args.has('--force-change');
    existing.tokenVersion = (existing.tokenVersion || 0) + 1;
    user = await existing.save();
    const { modifiedCount } = await Session.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'provisioning_reset' } });
    console.log(`✔ Password reset for Super Admin ${email}; ${modifiedCount} session(s) signed out.`);
  } else {
    user = await User.create({ name, email, password, role: 'super_admin', mustChangePassword: args.has('--force-change') });
    console.log(`✔ Super Admin created: ${email}`);
  }
  await AuditLog.create({
    action: existing ? 'ADMIN_PASSWORD_RESET' : 'ADMIN_CREATED',
    actorRole: 'system',
    target: user._id,
    targetRole: 'super_admin',
    reason: 'Provisioned with scripts/create-super-admin.mjs',
    details: { email, via: 'provisioning_script' },
  });
} finally {
  await mongoose.disconnect();
}
