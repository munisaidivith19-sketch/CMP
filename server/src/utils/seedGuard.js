/**
 * Seed / reset scripts wipe and refill collections with demo data and known
 * demo passwords. They must never run against a production database by
 * accident: refuse when NODE_ENV=production, when DB_TARGET=atlas, or when
 * the connection string points at MongoDB Atlas (mongodb+srv:// or a
 * *.mongodb.net host). Setting ALLOW_SEED_IN_PROD=yes-i-am-sure overrides
 * the guard on purpose.
 */
export const SEED_OVERRIDE_VALUE = 'yes-i-am-sure';

const ATLAS_URI = /^mongodb\+srv:\/\/|\.mongodb\.net(?=[:/?,]|$)/i;

/** Why seeding is refused for this environment, or null when it may run. */
export function seedRefusalReason(environ = process.env, uri = environ.MONGO_URI) {
  if (environ.ALLOW_SEED_IN_PROD === SEED_OVERRIDE_VALUE) return null;
  if (String(environ.NODE_ENV || '').trim().toLowerCase() === 'production') return 'NODE_ENV is production';
  if (String(environ.DB_TARGET || '').trim().toLowerCase() === 'atlas') return 'DB_TARGET is atlas';
  for (const u of [uri, environ.MONGO_URI]) {
    if (u && ATLAS_URI.test(String(u).trim())) return 'the MongoDB URI points at Atlas';
  }
  return null;
}

/** Exit the process (before connecting) when seeding is refused. */
export function assertSeedAllowed(scriptName, environ = process.env, uri = environ.MONGO_URI) {
  const reason = seedRefusalReason(environ, uri);
  if (!reason) return;
  console.error(`✖ Refusing to run ${scriptName}: ${reason}. This script overwrites data with demo records.`);
  console.error(`  If you really mean it, set ALLOW_SEED_IN_PROD=${SEED_OVERRIDE_VALUE}.`);
  process.exit(1);
}
