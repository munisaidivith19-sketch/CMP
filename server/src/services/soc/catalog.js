/**
 * Error catalog: one stable definition per known error.
 *
 * An error is CLASSIFIED only when structured signals match a definition —
 * where it came from (source), the HTTP status, the error class name, the
 * driver error code or the `code` the server put on the response. A message
 * that merely *looks* like a known error is never enough, so an unfamiliar
 * failure stays UNCLASSIFIED instead of being given a made-up root cause.
 *
 * `causes` are POSSIBLE causes. A cause only becomes a confirmed finding when
 * a diagnostic test listed in its `tests` actually fails (see explain.js).
 *
 * Adding an error: call defineError({...}) below (or from another module at
 * start-up). Codes are unique; definitions are validated on registration.
 * Paths and setting names in repair steps must be ones that exist in this
 * repository.
 */
const catalog = new Map();

export const UNCLASSIFIED = 'UNCLASSIFIED';
export const CATALOG_VERSION = 1;
const CATALOG_UPDATED = '2026-10-17';

const REQUIRED = ['code', 'title', 'module', 'service', 'severity', 'severityReason', 'summary', 'meaning', 'technical', 'causes', 'affected', 'match', 'repair', 'verification'];

export function defineError(def) {
  for (const k of REQUIRED) if (def[k] === undefined) throw new Error(`Error definition ${def.code || '?'} is missing "${k}"`);
  if (!/^[A-Z][A-Z0-9_]{2,59}$/.test(def.code)) throw new Error(`Invalid error code ${def.code}`);
  if (catalog.has(def.code)) throw new Error(`Duplicate error code ${def.code}`);
  if (typeof def.match !== 'function') throw new Error(`${def.code}: match must be a function`);
  catalog.set(def.code, {
    classification: 'classified',
    version: CATALOG_VERSION,
    updatedAt: CATALOG_UPDATED,
    docs: [],
    ...def,
    diagnostics: [...new Set([...(def.diagnostics || []), ...def.causes.flatMap((c) => c.tests || []), ...def.verification.tests])],
  });
  return catalog.get(def.code);
}

export const getDefinition = (code) => catalog.get(code) || null;
export const allDefinitions = () => [...catalog.values()];

/** First definition whose matcher accepts the signal, or null (unclassified). */
export function classify(signal) {
  for (const def of catalog.values()) {
    try {
      if (def.match(signal)) return def;
    } catch {
      /* a broken matcher never blocks capture */
    }
  }
  return null;
}

/** Public view (no matcher function). */
export function publicDefinition(def) {
  if (!def) return null;
  const { match, ...rest } = def;
  return rest;
}

/** What is shown for an error no definition matches. */
export const UNCLASSIFIED_DEFINITION = {
  code: UNCLASSIFIED,
  classification: 'unclassified',
  title: 'Unclassified error',
  summary: 'VEXON recorded an error that does not match any known error definition yet.',
  meaning: 'The system captured the failure and its safe details, but nobody has written an explanation, diagnostic tests or a repair guide for this kind of error yet. Its cause is unknown until someone investigates it.',
  technical: 'No catalog matcher accepted the structured signals (source, HTTP status, error class, driver code, response code). Message text alone is never used to classify an error.',
  causes: [],
  affected: ['Unknown — the affected feature can only be inferred from the module and route recorded with the error.'],
  severityReason: 'Severity is derived from where the error happened (for example a 500 response or a crashed background job) — not from an understanding of the cause.',
  repair: null,
  verification: { tests: ['errors.recurrence'], criteria: 'The error does not occur again during the observation window after a change is made.' },
  docs: ['docs/SOC.md#unclassified-errors'],
};

// ── Signal helpers ────────────────────────────────────────────────────
const isDbDriverName = (n) => /^Mongo(ose)?(ServerSelection|Network|NotConnected|Timeout|Topology)/.test(n || '') || n === 'MongoNetworkTimeoutError';

const dbRepair = {
  symptoms: ['Pages show "Internal server error" or keep loading', 'Many different modules fail at the same time', 'The health page shows the database as FAIL'],
  preconditions: ['Access to the server environment (server/.env) and to the MongoDB host or Atlas console'],
  riskLevel: 'low',
  category: 'manual',
  steps: [
    { action: 'Run the "Database connectivity" diagnostic', where: 'Super Admin → SOC → Diagnostics', why: 'Confirms whether the API can reach MongoDB right now and how slow it is.', expected: 'PASS with a round-trip time under 500 ms.' },
    { action: 'Check which database the server is configured to use', where: 'server/.env — DB_TARGET, MONGO_URI (local) or MONGO_URI_ATLAS (Atlas)', why: 'A wrong host, database name or expired credentials make every query fail.', expected: 'DB_TARGET names the database you expect and the matching URI is set.', risk: 'Editing .env needs a server restart, which briefly interrupts users.' },
    { action: 'Confirm MongoDB itself is running and reachable', where: 'Local: the MongoDB service on the server. Atlas: cluster status and Network Access (IP allow-list)', why: 'If the database is down or the server\'s IP is not allowed, the API cannot connect.', expected: 'The cluster/service is running and the API server\'s IP is allowed.' },
    { action: 'Restart the API after fixing the configuration', where: 'Your process manager (Render dashboard, systemd, pm2)', why: 'server/src/config/db.js connects at start-up with five retries.', expected: 'The log shows "[db] MongoDB connected".', risk: 'Users are briefly disconnected during the restart.' },
  ],
  rollback: 'Restore the previous server/.env values and restart the API.',
};

// ── Definitions ───────────────────────────────────────────────────────

defineError({
  code: 'DB_UNAVAILABLE',
  title: 'Database unavailable',
  module: 'database',
  service: 'mongodb',
  severity: 'critical',
  severityReason: 'Almost every VEXON feature reads or writes MongoDB, so while it is unreachable most of the platform cannot work.',
  summary: 'The API could not reach the MongoDB database while handling a request.',
  meaning: 'MongoDB stores all VEXON data — accounts, attendance, timetables, gate passes, chats. When the API cannot connect to it, requests that need data fail.',
  technical: 'The MongoDB driver raised a server-selection / network / not-connected error (MongoServerSelectionError, MongoNetworkError, MongoNotConnectedError or similar).',
  causes: [
    { id: 'db_down', text: 'The MongoDB server or Atlas cluster is down or restarting.', tests: ['db.connectivity'] },
    { id: 'db_network', text: 'The network between the API server and the database is failing, or the server\'s IP is not on the Atlas allow-list.', tests: ['db.connectivity', 'db.connection_history'] },
    { id: 'db_config', text: 'The connection settings (DB_TARGET / MONGO_URI / MONGO_URI_ATLAS) point at the wrong place or use expired credentials.', tests: ['db.connectivity'] },
  ],
  affected: ['Sign-in and every page that loads data', 'Background jobs (reminders, gate-pass sweeps, bus trip sweeps)', 'Real-time updates that need database lookups'],
  match: (s) => s.source === 'express' && isDbDriverName(s.errName),
  repair: dbRepair,
  verification: { tests: ['db.connectivity', 'errors.recurrence'], criteria: 'Database connectivity passes and the error does not occur again during the observation window.' },
  docs: ['docs/SOC.md#database', 'server/.env.example'],
});

defineError({
  code: 'DB_CONNECTION_LOST',
  title: 'Database connection lost',
  module: 'database',
  service: 'mongodb',
  severity: 'high',
  severityReason: 'While disconnected, requests that need data fail; the driver usually reconnects on its own, so the impact may be short.',
  summary: 'The API\'s connection to MongoDB dropped (or reported a connection error).',
  meaning: 'The API keeps a pool of connections to MongoDB. This event means the pool lost contact with the database. The MongoDB driver retries automatically, so this can be a short blip or the start of an outage.',
  technical: 'Mongoose emitted a "disconnected" or "error" connection event (server/src/config/db.js listeners).',
  causes: [
    { id: 'db_network', text: 'A network interruption between the API and the database.', tests: ['db.connection_history', 'db.connectivity'] },
    { id: 'db_restart', text: 'The database restarted or failed over (for example an Atlas maintenance window).', tests: ['db.connection_history'] },
  ],
  affected: ['Any request made while the connection was down'],
  match: (s) => s.source === 'database',
  repair: dbRepair,
  verification: { tests: ['db.connectivity', 'db.connection_history', 'errors.recurrence'], criteria: 'Connected now, no new disconnects during the observation window.' },
  docs: ['docs/SOC.md#database'],
});

defineError({
  code: 'DB_OPERATION_TIMEOUT',
  title: 'Database operation timed out',
  module: 'database',
  service: 'mongodb',
  severity: 'high',
  severityReason: 'The request failed; repeated timeouts usually mean the database is overloaded or a query is missing an index.',
  summary: 'A database query took too long and was abandoned.',
  meaning: 'When a query waits longer than the allowed time, the API gives up so the user does not wait forever. The user sees an error instead of their data.',
  technical: 'Mongoose "buffering timed out" (the driver had no connection) or MongoServerError code 50 (MaxTimeMSExpired).',
  causes: [
    { id: 'db_no_connection', text: 'There was no live connection, so the query waited in Mongoose\'s buffer until it timed out.', tests: ['db.connectivity', 'db.connection_history'] },
    { id: 'db_missing_index', text: 'A query had to scan a large collection because a declared index is missing.', tests: ['db.indexes'] },
    { id: 'db_overloaded', text: 'The database is overloaded (slow round trips).', tests: ['db.connectivity'] },
  ],
  affected: ['The page or action that ran the slow query'],
  match: (s) => (s.errName === 'MongooseError' && /buffering timed out/.test(s.message || '')) || (s.errName === 'MongoServerError' && s.errCode === 50),
  repair: {
    ...dbRepair,
    steps: [
      { action: 'Run "Database connectivity" and "Database indexes"', where: 'Super Admin → SOC → Diagnostics', why: 'Separates "no connection" from "slow query" from "missing index".', expected: 'Both PASS.' },
      { action: 'If indexes are missing, restart the API', where: 'Your process manager', why: 'server/src/config/db.js builds every declared index (syncIndexes) at start-up.', expected: 'The indexes diagnostic passes after the restart.', risk: 'Building an index on a large collection adds database load for a while.' },
      ...dbRepair.steps.slice(1, 3),
    ],
  },
  verification: { tests: ['db.connectivity', 'db.indexes', 'errors.recurrence'], criteria: 'Connectivity and indexes pass; no new timeouts in the observation window.' },
  docs: ['docs/SOC.md#database'],
});

defineError({
  code: 'DB_SERVER_ERROR',
  title: 'Database rejected an operation',
  module: 'database',
  service: 'mongodb',
  severity: 'high',
  severityReason: 'The request failed with a server error; the impact depends on which feature ran the operation.',
  summary: 'MongoDB refused or failed a query or write.',
  meaning: 'The database was reachable but answered an operation with an error, so that action did not complete.',
  technical: 'A MongoServerError (other than duplicate key, which is answered as 409) reached the error handler. The driver error code is recorded in the technical details.',
  causes: [
    { id: 'db_permissions', text: 'The database user lacks permission for this operation.', tests: ['db.connectivity'] },
    { id: 'db_limits', text: 'A database limit was hit (document size, storage quota on the hosting plan).', tests: [] },
  ],
  affected: ['The action that performed the failing operation'],
  match: (s) => s.source === 'express' && s.errName === 'MongoServerError' && s.errCode !== 50,
  repair: {
    symptoms: ['One specific action keeps failing with a server error'],
    preconditions: ['Access to the MongoDB host or Atlas console'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Note the driver error code in Technical details', where: 'This error page', why: 'MongoDB error codes identify the exact rejection (for example 13 = unauthorized, 10334 = document too large).', expected: 'A numeric code is shown.' },
      { action: 'Look the code up and check the database user\'s roles and storage quota', where: 'MongoDB documentation; Atlas → Database Access / Metrics', why: 'Permissions and quota are the usual reasons a reachable database refuses work.', expected: 'The database user has readWrite on the VEXON database and storage is not full.' },
    ],
    rollback: 'No change is made by these steps.',
  },
  verification: { tests: ['db.connectivity', 'errors.recurrence'], criteria: 'No new occurrences after the change.' },
  docs: ['docs/SOC.md#database'],
});

defineError({
  code: 'AUTHZ_POLICY_DENIED',
  title: 'Admin policy refused an action',
  module: 'authorization',
  service: 'api',
  severity: 'low',
  severityReason: 'The security control worked as designed. Many refusals from one account can still be worth a look.',
  summary: 'A policy-managed Admin tried an action their module policies do not include.',
  meaning: 'Super Admins grant ordinary Admins specific modules and actions. The server refused a request outside those grants. Usually this is an Admin clicking something they are not allowed to use; repeated refusals can indicate probing.',
  technical: 'server/src/middleware/adminPolicy.js answered 403 with code POLICY_DENIED and wrote a POLICY_DENIED security log entry.',
  causes: [
    { id: 'missing_grant', text: 'The Admin genuinely needs this module and was not granted it.', tests: [] },
    { id: 'probing', text: 'Someone is trying URLs or API calls outside their role.', tests: ['security.authz_denials'] },
  ],
  affected: ['Only the refused request — nothing was changed'],
  match: (s) => s.httpStatus === 403 && s.dataCode === 'POLICY_DENIED',
  repair: {
    symptoms: ['An Admin reports "Your administrator policies do not include this action"'],
    preconditions: ['Super Admin access'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Decide whether the Admin should have this module', where: 'Super Admin → Admin accounts → the Admin → Policies', why: 'Policies are the intended way to widen access; there is nothing to "fix" if the refusal is correct.', expected: 'The Admin has exactly the modules their job needs.', risk: 'Granting more modules widens what that account can change.' },
      { action: 'If refusals are frequent and unexplained, check the account\'s security events', where: 'Super Admin → SOC → Event explorer (Security log, event POLICY_DENIED)', why: 'Many refusals across unrelated modules can mean a stolen session.', expected: 'Refusals line up with the Admin\'s normal work.' },
    ],
    rollback: 'Remove the added policy from the Admin account.',
  },
  verification: { tests: ['security.authz_denials'], criteria: 'Refusals return to the normal background level.' },
  docs: ['docs/SUPER_ADMIN.md'],
});

defineError({
  code: 'AUTHZ_CSRF_REJECTED',
  title: 'Browser request failed the CSRF check',
  module: 'authentication',
  service: 'api',
  severity: 'low',
  severityReason: 'The web app normally recovers automatically (it refreshes the token and retries). Persistent rejections block one user\'s writes.',
  summary: 'A browser sent a write without a matching CSRF token.',
  meaning: 'To stop other websites from acting on a signed-in user\'s behalf, every browser write must echo a secret token from a cookie. A missing or stale token is refused.',
  technical: 'server/src/middleware/security.js (csrfAndOriginGuard) answered 403 code CSRF_REJECTED. client/src/services/api.js refreshes the session and replays the write once.',
  causes: [
    { id: 'stale_cookie', text: 'The CSRF cookie expired, was cleared, or was rotated by another tab.', tests: [] },
    { id: 'cross_site', text: 'A request was sent from a page that is not the VEXON web app.', tests: ['config.cors'] },
  ],
  affected: ['The refused write only'],
  match: (s) => s.httpStatus === 403 && s.dataCode === 'CSRF_REJECTED',
  repair: {
    symptoms: ['Saving fails with "Invalid or expired CSRF token"'],
    preconditions: [],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Ask the user to reload the page and sign in again', where: 'The user\'s browser', why: 'Signing in issues a fresh CSRF cookie and token pair.', expected: 'The write succeeds.' },
      { action: 'Check that the site is served from one origin listed in CLIENT_URL', where: 'server/.env — CLIENT_URL', why: 'Cookies and origin checks assume the app is opened at a configured address.', expected: 'The address in the browser bar is one of the CLIENT_URL values.' },
    ],
    rollback: 'No change is made.',
  },
  verification: { tests: ['config.cors', 'errors.recurrence'], criteria: 'No further rejections for this route in the observation window.' },
  docs: ['docs/SOC.md#authentication'],
});

defineError({
  code: 'AUTHZ_ORIGIN_BLOCKED',
  title: 'Request from an unapproved website blocked',
  module: 'authentication',
  service: 'api',
  severity: 'medium',
  severityReason: 'Either the deployment\'s CLIENT_URL is wrong (users cannot work) or another site attempted a cross-site request.',
  summary: 'The API refused a request whose Origin/Referer is not an approved VEXON address.',
  meaning: 'Only pages from the configured VEXON web addresses may call the API from a browser. This protects users from malicious sites.',
  technical: 'csrfAndOriginGuard answered 403 code ORIGIN_BLOCKED because the Origin/Referer is not in CLIENT_URL.',
  causes: [
    { id: 'cors_config', text: 'CLIENT_URL does not include the address users actually open (for example a new domain).', tests: ['config.cors'] },
    { id: 'cross_site', text: 'A third-party page tried to call the API.', tests: [] },
  ],
  affected: ['Every browser request from that origin'],
  match: (s) => s.httpStatus === 403 && s.dataCode === 'ORIGIN_BLOCKED',
  repair: {
    symptoms: ['Users on a new address cannot save anything'],
    preconditions: ['Access to server/.env'],
    riskLevel: 'medium',
    category: 'manual',
    steps: [
      { action: 'Compare the blocked origin with CLIENT_URL', where: 'Technical details on this page; server/.env — CLIENT_URL (comma-separated)', why: 'The origin must be listed exactly (scheme, host and port).', expected: 'The legitimate web address is listed.', risk: 'Adding an origin you do not control lets that site make requests with users\' cookies.' },
      { action: 'Restart the API after editing CLIENT_URL', where: 'Your process manager', why: 'The origin list is read at start-up.', expected: 'Requests from the legitimate address succeed.' },
    ],
    rollback: 'Restore the previous CLIENT_URL and restart.',
  },
  verification: { tests: ['config.cors', 'errors.recurrence'], criteria: 'No new blocks from the legitimate origin.' },
  docs: ['docs/SOC.md#authentication'],
});

defineError({
  code: 'AUTHZ_REAUTH_REQUIRED',
  title: 'Password confirmation required',
  module: 'super_admin',
  service: 'api',
  severity: 'info',
  severityReason: 'Expected behaviour: sensitive Super Admin actions need a password re-entry every five minutes.',
  summary: 'A sensitive Super Admin action was attempted without a recent password confirmation.',
  meaning: 'Changing admin accounts or emergency modes requires the Super Admin to re-enter their password. The web console asks for it and retries.',
  technical: 'server/src/middleware/platform.js requireRecentReauth answered 403 code REAUTH_REQUIRED.',
  causes: [{ id: 'expected', text: 'The five-minute confirmation window had passed — normal behaviour.', tests: [] }],
  affected: ['Nothing — the action ran after the password was confirmed, or was cancelled'],
  match: (s) => s.httpStatus === 403 && s.dataCode === 'REAUTH_REQUIRED',
  repair: null,
  verification: { tests: [], criteria: 'No action needed.' },
  docs: ['docs/SUPER_ADMIN.md'],
});

defineError({
  code: 'AUTHZ_PASSWORD_CHANGE_REQUIRED',
  title: 'Temporary password must be changed',
  module: 'authentication',
  service: 'api',
  severity: 'info',
  severityReason: 'Expected behaviour after a password reset.',
  summary: 'An account with a temporary password tried to use the app before choosing a new password.',
  meaning: 'When a Super Admin or Admin resets a password, the user must pick a new one before doing anything else.',
  technical: 'passwordChangeGate (server/src/middleware/platform.js) answered 403 code PASSWORD_CHANGE_REQUIRED.',
  causes: [{ id: 'expected', text: 'The user has not yet changed their temporary password — normal behaviour.', tests: [] }],
  affected: ['That user only, until they change their password'],
  match: (s) => s.httpStatus === 403 && s.dataCode === 'PASSWORD_CHANGE_REQUIRED',
  repair: null,
  verification: { tests: [], criteria: 'No action needed.' },
  docs: [],
});

defineError({
  code: 'AUTHZ_FORBIDDEN',
  title: 'Request refused by a role check',
  module: 'authorization',
  service: 'api',
  severity: 'low',
  severityReason: 'The access control worked. A burst from one role or route can indicate a broken UI link or probing.',
  summary: 'A signed-in user asked for something their role is not allowed to do.',
  meaning: 'Each VEXON role (student, faculty, HOD, admin…) may only use certain features. The server refused a request outside the user\'s role. The UI usually hides such actions, so frequent refusals often mean a link shown to the wrong role.',
  technical: 'A 403 ApiError from authorize(), the confined-role guard or a controller-level check reached the error handler without a more specific code.',
  causes: [
    { id: 'ui_link', text: 'The web or mobile app shows an action to a role that cannot use it.', tests: [] },
    { id: 'probing', text: 'Someone is calling APIs outside their role.', tests: ['security.authz_denials'] },
  ],
  affected: ['Only the refused request — nothing was changed'],
  match: (s) => s.httpStatus === 403 && s.source === 'authorization',
  repair: {
    symptoms: ['Users report "You do not have permission to perform this action"'],
    preconditions: [],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Check which roles hit the refusal and on which route', where: 'This error page → Occurrences (roles, route)', why: 'Tells you whether one role keeps reaching a page it should not see.', expected: 'You can name the screen that sends the request.' },
      { action: 'If it is a UI link, hide it for that role in the client', where: 'client/src/components/layout/Sidebar.jsx and the page that issues the request', why: 'The server will keep refusing; the UI should not offer the action.', expected: 'The refusals stop for that role.' },
    ],
    rollback: 'Revert the client change.',
  },
  verification: { tests: ['security.authz_denials', 'errors.recurrence'], criteria: 'Refusals for this route stop or return to background level.' },
  docs: [],
});

defineError({
  code: 'RATE_LIMITED',
  title: 'Too many requests (rate limit)',
  module: 'api',
  service: 'api',
  severity: 'low',
  severityReason: 'Rate limits protect the platform. A burst can be an automated attack, a buggy client loop, or a whole campus behind one IP.',
  summary: 'A client sent requests faster than allowed and was told to slow down (HTTP 429).',
  meaning: 'VEXON limits how fast each network address or account may call sensitive endpoints (sign-in, OTP, uploads, AI). This stops password guessing and overload.',
  technical: 'express-rate-limit (server/src/middleware/rateLimit.js) answered 429.',
  causes: [
    { id: 'brute_force', text: 'Automated sign-in or OTP guessing.', tests: ['security.failed_logins'] },
    { id: 'client_loop', text: 'A client bug retrying in a tight loop.', tests: [] },
    { id: 'shared_ip', text: 'Many legitimate users behind one address (hostel NAT) or TRUST_PROXY set wrong so everyone shares the proxy\'s IP.', tests: ['config.proxy'] },
  ],
  affected: ['The limited client, until the window resets'],
  match: (s) => s.source === 'rate_limit' || s.httpStatus === 429,
  repair: {
    symptoms: ['Users see "Too many requests" messages'],
    preconditions: ['Access to server/.env for limit changes'],
    riskLevel: 'medium',
    category: 'manual',
    steps: [
      { action: 'Check whether failed sign-ins spiked at the same time', where: 'Run the "Failed sign-in volume" diagnostic', why: 'A brute-force attempt should stay limited — do not raise limits for it.', expected: 'You know whether the 429s are an attack or legitimate traffic.' },
      { action: 'Check the proxy setting', where: 'server/.env — TRUST_PROXY (1 on Render, 2 behind Cloudflare+Render)', why: 'With the wrong value every visitor appears to come from the proxy\'s address and they all share one limit.', expected: 'The "Proxy configuration" diagnostic passes.', risk: 'Trusting too many hops lets clients spoof their IP.' },
    ],
    rollback: 'Restore the previous TRUST_PROXY and restart.',
  },
  verification: { tests: ['config.proxy', 'errors.recurrence'], criteria: 'Rate-limit events return to the normal background level.' },
  docs: [],
});

defineError({
  code: 'AI_PROVIDER_ERROR',
  title: 'AI provider request failed',
  module: 'ai_assistant',
  service: 'groq',
  severity: 'medium',
  severityReason: 'The Study Assistant cannot answer; the rest of VEXON is unaffected.',
  summary: 'A request to the AI provider (Groq) failed.',
  meaning: 'The Study Assistant sends questions to an external AI service. When that service is unreachable, rejects the key or is overloaded, students get an error.',
  technical: 'An AIServiceError (server/src/services/ai/groqService.js) reached the error handler. Its category (config, auth, rate_limit, timeout, upstream…) is recorded in the technical details.',
  causes: [
    { id: 'ai_key', text: 'GROQ_API_KEY is missing, revoked or invalid.', tests: ['config.ai_provider'] },
    { id: 'ai_quota', text: 'The provider\'s rate limit or quota was reached.', tests: [] },
    { id: 'ai_outage', text: 'The provider is down or slow (timeout).', tests: [] },
  ],
  affected: ['JNN Study Assistant answers'],
  match: (s) => s.errName === 'AIServiceError',
  repair: {
    symptoms: ['Students see "The AI service is temporarily unavailable"'],
    preconditions: ['Access to server/.env and the Groq console'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Run "AI provider configuration"', where: 'Super Admin → SOC → Diagnostics', why: 'Confirms a key is configured (it is never displayed).', expected: 'PASS.' },
      { action: 'Check the category in Technical details', where: 'This error page', why: '"auth" means the key was rejected; "rate_limit" means quota; "timeout"/"upstream" mean the provider had trouble.', expected: 'You know which of the three it is.' },
      { action: 'For "auth": create a new key and set GROQ_API_KEY, then restart the API', where: 'Groq console; server/.env', why: 'The key is read at start-up.', expected: 'Study Assistant answers again.', risk: 'Never paste the key into chats, tickets or this dashboard.' },
    ],
    rollback: 'Restore the previous key and restart.',
  },
  verification: { tests: ['config.ai_provider', 'errors.recurrence'], criteria: 'No new AI errors in the observation window.' },
  docs: [],
});

defineError({
  code: 'JOB_FAILED',
  title: 'Background job failed',
  module: 'background_jobs',
  service: 'scheduler',
  severity: 'medium',
  severityReason: 'The job retries on its next tick, but while it keeps failing its work (reminders, expiring gate passes, ending idle bus trips…) does not happen.',
  summary: 'A scheduled background task threw an error.',
  meaning: 'VEXON runs timed tasks in the API process: class reminders, gate-pass expiry, gate-code issuing, idle-session sign-out, bus trip sweeps and alumni housekeeping. One of them failed this run.',
  technical: 'A job wrapped by services/soc/jobs.js runJob() rejected. The job name is the error\'s module detail.',
  causes: [
    { id: 'job_db', text: 'The database was unavailable during the run.', tests: ['db.connectivity'] },
    { id: 'job_stuck', text: 'The job keeps failing on every run (not a one-off).', tests: ['jobs.heartbeats'] },
  ],
  affected: ['The job\'s feature until its next successful run'],
  match: (s) => s.source === 'job',
  repair: {
    symptoms: ['Reminders not sent, gate passes not expiring, bus trips not closing'],
    preconditions: ['Access to the server logs'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Run "Background job heartbeats"', where: 'Super Admin → SOC → Diagnostics', why: 'Shows whether the job succeeded since this failure.', expected: 'The job\'s last run succeeded.' },
      { action: 'If it keeps failing, read the server log lines for that job', where: 'Server log, lines starting with the job\'s tag (for example "[reminders]", "[gate-code-queue]", "[transport]")', why: 'The full error text stays in the server log; only a redacted summary is stored here.', expected: 'The log shows the failing operation.' },
    ],
    rollback: 'No change is made.',
  },
  verification: { tests: ['jobs.heartbeats', 'errors.recurrence'], criteria: 'The job\'s latest run succeeded and no new failures occur.' },
  docs: ['docs/SOC.md#background-jobs'],
});

defineError({
  code: 'SOCKET_CONNECTION_ERROR',
  title: 'Real-time connection error',
  module: 'realtime',
  service: 'socket.io',
  severity: 'low',
  severityReason: 'Clients reconnect automatically; persistent errors stop live updates (chat, attendance, bus positions).',
  summary: 'A Socket.IO connection failed at the transport level.',
  meaning: 'Live updates travel over a WebSocket connection. This records connections the server could not establish (bad handshake, transport error).',
  technical: 'io.engine emitted "connection_error" (server/src/config/socket.js). Authentication refusals are not counted here.',
  causes: [
    { id: 'proxy_ws', text: 'A proxy in front of the API does not pass WebSocket upgrades.', tests: ['socket.server'] },
    { id: 'client_version', text: 'An outdated client using an incompatible protocol.', tests: [] },
  ],
  affected: ['Live updates for affected clients'],
  match: (s) => s.source === 'socket',
  repair: {
    symptoms: ['Chats or bus positions only update after a refresh'],
    preconditions: ['Access to the reverse-proxy configuration'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Run "Real-time server"', where: 'Super Admin → SOC → Diagnostics', why: 'Confirms Socket.IO is running and how many clients are connected.', expected: 'PASS with connected clients during working hours.' },
      { action: 'Check that the proxy forwards WebSocket upgrades for /socket.io/', where: 'Your reverse proxy (nginx: proxy_set_header Upgrade/Connection)', why: 'Without upgrades clients fall back or fail.', expected: 'WebSocket connections succeed.' },
    ],
    rollback: 'Restore the previous proxy configuration.',
  },
  verification: { tests: ['socket.server', 'errors.recurrence'], criteria: 'No new connection errors in the observation window.' },
  docs: [],
});

defineError({
  code: 'PROCESS_UNCAUGHT',
  title: 'Uncaught server exception',
  module: 'api',
  service: 'node',
  severity: 'critical',
  severityReason: 'An uncaught exception crashes the API process; users lose service until it restarts.',
  summary: 'The API process hit an error nothing handled.',
  meaning: 'An error escaped every handler. Node.js stops the process when this happens, so the platform restarts (if a process manager is configured).',
  technical: 'process "uncaughtExceptionMonitor" fired (origin uncaughtException or unhandledRejection). Recording is best-effort: the process may exit before the record is saved.',
  causes: [{ id: 'code_bug', text: 'A programming error in a code path without error handling.', tests: [] }],
  affected: ['Everyone, until the process restarts'],
  match: (s) => s.source === 'process',
  repair: {
    symptoms: ['Everyone is disconnected at once', 'The server log shows a stack trace followed by a restart'],
    preconditions: ['Access to server logs and the source code'],
    riskLevel: 'medium',
    category: 'manual',
    steps: [
      { action: 'Open Technical details and note the top stack frames', where: 'This error page', why: 'The frames point at the file and line that threw.', expected: 'A file under server/src is named.' },
      { action: 'Fix the code path and add a regression test', where: 'The named file; server/tests', why: 'Only a code change prevents the crash.', expected: 'The new test passes.' },
    ],
    rollback: 'Revert the deployment.',
  },
  verification: { tests: ['process.resources', 'errors.recurrence'], criteria: 'The process stays up and the error does not recur.' },
  docs: [],
});

const clientDef = (code, title, kind, extra) =>
  defineError({
    code,
    title,
    module: 'web_client',
    service: 'browser',
    severity: 'medium',
    severityReason: 'It affects the user who saw it; repeats across many users point at a bug in a release.',
    affected: ['The page the user was on (see route)'],
    match: (s) => s.source === 'client_web' && s.clientKind === kind,
    verification: { tests: ['errors.recurrence'], criteria: 'No new reports from that page after the fix is deployed.' },
    docs: ['docs/SOC.md#web-client'],
    ...extra,
  });

clientDef('CLIENT_RENDER_ERROR', 'Web page crashed while rendering', 'render', {
  summary: 'A page in the web app threw an error while drawing itself, so the user saw the error screen instead of the page.',
  meaning: 'The React app caught the crash with its error boundary and showed a recovery screen. The rest of the app kept working.',
  technical: 'client/src/components/ErrorBoundary.jsx componentDidCatch reported the error (message and component stack, redacted).',
  causes: [
    { id: 'unexpected_data', text: 'The page received data in a shape it did not expect (missing field, null).', tests: [] },
    { id: 'code_bug', text: 'A programming error in that page.', tests: [] },
  ],
  repair: {
    symptoms: ['A user sees "This part of VEXON hit a problem"'],
    preconditions: ['Access to the client source code'],
    riskLevel: 'low',
    category: 'manual',
    steps: [
      { action: 'Note the route and component stack', where: 'This error page → Technical details', why: 'They name the page and component that crashed.', expected: 'A component under client/src is named.' },
      { action: 'Reproduce on that route with the same role, fix and rebuild', where: 'client/src; `npm run build` in client/', why: 'Only a code change fixes a render crash.', expected: 'The page renders.' },
    ],
    rollback: 'Redeploy the previous client build.',
  },
});

clientDef('CLIENT_UNHANDLED_REJECTION', 'Unhandled promise rejection in the web app', 'unhandled_rejection', {
  summary: 'Background code in the web app failed and nothing handled the failure.',
  meaning: 'Some asynchronous work (a request, a timer) failed silently. The user may see stale data or a button that does nothing.',
  technical: 'window "unhandledrejection" was reported by client/src/services/errorReporter.js.',
  causes: [{ id: 'code_bug', text: 'A missing error handler in client code.', tests: [] }],
  repair: {
    symptoms: ['An action appears to do nothing'],
    preconditions: ['Access to the client source code'],
    riskLevel: 'low',
    category: 'manual',
    steps: [{ action: 'Find the code path from the message and route, and add error handling', where: 'client/src', why: 'Failures should show the user a message.', expected: 'No further reports.' }],
    rollback: 'Redeploy the previous client build.',
  },
});

clientDef('CLIENT_SCRIPT_ERROR', 'Script error in the web app', 'window_error', {
  summary: 'A JavaScript error happened in the web app outside React rendering.',
  meaning: 'Code in an event handler, timer or library threw. The page may partly stop working.',
  technical: 'window "error" event reported by client/src/services/errorReporter.js.',
  causes: [{ id: 'code_bug', text: 'A programming error, or a browser extension interfering with the page.', tests: [] }],
  repair: {
    symptoms: ['Part of a page stops responding'],
    preconditions: ['Access to the client source code'],
    riskLevel: 'low',
    category: 'manual',
    steps: [{ action: 'Use the message and route to find the failing code', where: 'client/src', why: 'Only a code change fixes it.', expected: 'No further reports.' }],
    rollback: 'Redeploy the previous client build.',
  },
});

clientDef('CLIENT_NETWORK_ERROR', 'Web app could not reach the API', 'network', {
  severity: 'low',
  severityReason: 'Often the user\'s own connection; many users at once means the API or its proxy is unreachable.',
  summary: 'A request from the web app never got an answer from the API (network failure or timeout).',
  meaning: 'The browser could not complete the request: the user went offline, the API was restarting, or a proxy dropped the connection.',
  technical: 'RTK Query returned FETCH_ERROR or TIMEOUT_ERROR and client/src/services/api.js reported it through errorReporter.js. If the network was fully down, the report itself may have been lost, so counts can be lower than reality.',
  causes: [
    { id: 'user_offline', text: 'The user\'s connection dropped.', tests: [] },
    { id: 'api_down', text: 'The API was down or restarting.', tests: ['process.resources'] },
  ],
  repair: {
    symptoms: ['"Failed to fetch" style errors'],
    preconditions: [],
    riskLevel: 'low',
    category: 'manual',
    steps: [{ action: 'Check whether reports come from many users at the same time', where: 'This error page → Occurrences', why: 'One user is usually their network; many users at once is the server.', expected: 'You know which it is.' }],
    rollback: 'No change is made.',
  },
});

clientDef('CLIENT_API_SERVER_ERROR', 'Web app received a server error', 'api', {
  summary: 'The web app received a 5xx answer from the API.',
  meaning: 'The API failed while handling the user\'s request. The matching server-side error (same correlation ID) has the details.',
  technical: 'RTK Query returned status >= 500; the X-Request-Id response header is recorded as the correlation ID.',
  causes: [{ id: 'server_error', text: 'A server-side error — see the linked server error with the same correlation ID.', tests: [] }],
  repair: {
    symptoms: ['"Internal server error" messages'],
    preconditions: [],
    riskLevel: 'low',
    category: 'manual',
    steps: [{ action: 'Open the related server error (same correlation ID)', where: 'This error page → Related errors', why: 'The server error has the real cause.', expected: 'A server-side error with the same correlation ID is listed.' }],
    rollback: 'No change is made.',
  },
});
