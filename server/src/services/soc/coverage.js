import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ErrorEvent from '../../models/ErrorEvent.js';
import { allDefinitions } from './catalog.js';
import { allDiagnostics, hasDiagnostic } from './diagnostics/registry.js';
import { moduleForPath } from './capture.js';
import { jobHeartbeats } from './monitors.js';

/**
 * Coverage inventory, measured — not declared. Modules come from the routes
 * actually mounted in server/src/routes (walked at runtime), definitions and
 * tests from the live registries, automated tests from server/tests file
 * names. Every gap is listed; nothing claims universal coverage.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.resolve(__dirname, '../../../tests');

// Diagnostics that check a module directly (beyond those its error definitions list).
const MODULE_TESTS = {
  database: ['db.connectivity', 'db.connection_history', 'db.indexes'],
  authentication: ['auth.sessions', 'security.failed_logins', 'config.secrets', 'config.cors'],
  authorization: ['security.authz_denials'],
  super_admin: ['platform.mode', 'auth.sessions'],
  ai_assistant: ['config.ai_provider'],
  gate_passes: ['config.sms_provider'],
  uploads: ['config.storage'],
  bus_tracking: ['transport.tracking_freshness'],
  background_jobs: ['jobs.heartbeats'],
  realtime: ['socket.server'],
  soc: ['soc.pipeline'],
  api: ['process.resources', 'config.proxy'],
};
// Words that identify a module's automated test files (server/tests/*.test.js).
const TEST_FILE_WORDS = {
  authentication: ['auth', 'login', 'csrf', 'idle-session', 'refresh'],
  attendance: ['attendance', 'od-leave'],
  staff_attendance: ['faculty', 'staff'],
  timetables: ['timetable'],
  exams: ['exam'],
  chat: ['chat'],
  notifications: ['notification'],
  gate_passes: ['gate', 'outpass', 'otp', 'day-scholar'],
  complaints: ['complaint'],
  events: ['event'],
  study_materials: ['study-material'],
  ai_assistant: ['study-assistant'],
  bus_tracking: ['transport'],
  user_admin: ['people', 'roles', 'role-assignments', 'user-title', 'profiles'],
  super_admin: ['super-admin'],
  alumni: ['alumni'],
  sos: ['sos'],
  hostel: ['hostel'],
  announcements: ['announcement'],
  holidays: ['holiday'],
  achievements: ['achievement'],
  class_management: ['class-in-charge'],
  dashboards: ['hod-dashboard', 'campus'],
  soc: ['soc'],
  database: ['db-connect'],
  realtime: ['realtime'],
};
const LIMITATIONS = {
  web_client: ['Only signed-in users can report client errors; crashes on the sign-in page are not captured.'],
  mobile_android: ['The Android app does not report errors to the SOC yet.'],
  mobile_ios: ['The iOS app does not report errors to the SOC yet.'],
  realtime: ['Socket.IO handler failures answered with an error acknowledgement are not captured; only transport-level connection errors are.'],
  background_jobs: ['Job heartbeats are per API process and reset on restart.'],
  api: ['Uncaught exceptions are recorded best-effort: the process may exit before the record is saved.'],
};

/** Mounted route paths, from the Express router stack. */
async function mountedPaths() {
  const { default: router } = await import('../../routes/index.js');
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route?.path) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const p of paths) if (typeof p === 'string') out.push(`${prefix}${p}`);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const m = String(layer.regexp?.source || '').match(/^\^\\\/([a-z0-9\\/-]+?)\\\/\?/i);
        walk(layer.handle.stack, m ? `${prefix}/${m[1].replace(/\\\//g, '/')}` : prefix);
      }
    }
  };
  walk(router.stack, '');
  return out;
}

async function testFiles() {
  try {
    return (await fs.readdir(TESTS_DIR)).filter((f) => f.endsWith('.test.js'));
  } catch {
    return null; // not shipped with this deployment
  }
}

export async function coverageReport() {
  const [paths, files, unclassified] = await Promise.all([
    mountedPaths(),
    testFiles(),
    ErrorEvent.find({ classified: false }).sort({ lastSeenAt: -1 }).limit(20).select('code source module route method errorName message count firstSeenAt lastSeenAt correlationIds sample').lean(),
  ]);
  const routeCounts = {};
  for (const p of paths) {
    const m = moduleForPath(p);
    routeCounts[m] = (routeCounts[m] || 0) + 1;
  }
  const defs = allDefinitions();
  // Modules: those with mounted routes + the platform components errors are attributed to.
  const names = new Set([...Object.keys(routeCounts), 'database', 'authorization', 'background_jobs', 'realtime', 'api', 'web_client', 'mobile_android', 'mobile_ios']);

  const modules = [...names].sort().map((name) => {
    const mDefs = defs.filter((d) => d.module === name);
    const diag = new Set([...mDefs.flatMap((d) => d.diagnostics), ...(MODULE_TESTS[name] || [])].filter(hasDiagnostic));
    const repairs = mDefs.filter((d) => d.repair).length;
    const verification = mDefs.filter((d) => d.verification?.tests?.length).length;
    const words = TEST_FILE_WORDS[name] || [name.replace(/_/g, '-')];
    const autoTests = files ? files.filter((f) => words.some((w) => f.includes(w))) : null;
    const isMobile = name.startsWith('mobile_');
    const capture = isMobile ? 'none' : routeCounts[name] ? 'express' : ['database', 'background_jobs', 'realtime', 'api', 'web_client', 'authorization'].includes(name) ? 'dedicated' : 'none';
    const dims = {
      errorCapture: capture !== 'none',
      errorDefinitions: mDefs.length > 0,
      diagnostics: diag.size > 0,
      repairGuides: repairs > 0,
      verificationTests: verification > 0,
      automatedTests: autoTests ? autoTests.length > 0 : false,
    };
    const score = Object.values(dims).filter(Boolean).length / Object.keys(dims).length;
    const gaps = [];
    if (!dims.errorCapture) gaps.push('Errors from this module are not captured.');
    if (!dims.errorDefinitions) gaps.push(capture === 'express' ? 'No module-specific error definitions: its server errors are captured but appear as generic or unclassified errors.' : 'No error definitions.');
    if (!dims.diagnostics) gaps.push('No diagnostic tests check this module directly.');
    if (!dims.repairGuides) gaps.push('No repair guides.');
    if (!dims.automatedTests) gaps.push(autoTests === null ? 'Automated test files are not present in this deployment, so test coverage is unknown.' : 'No automated test files found for this module.');
    return {
      module: name,
      routes: routeCounts[name] || 0,
      errorCapture: capture,
      errorDefinitions: mDefs.map((d) => d.code),
      diagnostics: [...diag],
      repairGuides: repairs,
      verificationDefinitions: verification,
      automatedTestFiles: autoTests,
      limitations: LIMITATIONS[name] || [],
      score: Math.round(score * 100),
      gaps,
    };
  });

  // Catalog consistency: definitions that name tests that do not exist.
  const brokenReferences = defs.flatMap((d) => d.diagnostics.filter((id) => !hasDiagnostic(id)).map((id) => ({ code: d.code, testId: id })));
  const sources = [
    { source: 'express', label: 'Express API errors (5xx)', connected: true },
    { source: 'authorization', label: 'Authorization refusals (403)', connected: true },
    { source: 'rate_limit', label: 'Rate-limit responses (429)', connected: true },
    { source: 'database', label: 'MongoDB connection events', connected: true },
    { source: 'job', label: 'Background jobs', connected: true, detail: `${jobHeartbeats().length} job(s) registered in this process` },
    { source: 'socket', label: 'Socket.IO transport errors', connected: true, detail: 'Handler-level errors are not captured' },
    { source: 'process', label: 'Uncaught exceptions / unhandled rejections', connected: true, detail: 'Best-effort before exit' },
    { source: 'client_web', label: 'Web app (render, promise, network, API)', connected: true, detail: 'Signed-in users only' },
    { source: 'client_mobile', label: 'Android / iOS apps', connected: false, detail: 'Not wired: the native apps do not call /api/client-errors yet' },
    { source: 'login_page', label: 'Web errors before sign-in', connected: false, detail: 'The report endpoint requires a session' },
  ];
  const overall = Math.round(modules.reduce((s, m) => s + m.score, 0) / modules.length);
  return {
    generatedAt: new Date(),
    overallScore: overall,
    totals: {
      modules: modules.length,
      mountedRoutes: paths.length,
      errorDefinitions: defs.length,
      diagnostics: allDiagnostics().length,
      repairGuides: defs.filter((d) => d.repair).length,
      modulesWithoutDefinitions: modules.filter((m) => !m.errorDefinitions.length).length,
      unclassifiedErrors: await ErrorEvent.countDocuments({ classified: false }),
    },
    sources,
    modules: modules.sort((a, b) => a.score - b.score || a.module.localeCompare(b.module)),
    brokenReferences,
    unclassified: unclassified.map((e) => ({
      id: e._id,
      facts: { source: e.source, module: e.module, route: e.route, method: e.method, errorName: e.errorName, message: e.message, count: e.count, firstSeenAt: e.firstSeenAt, lastSeenAt: e.lastSeenAt, hasStack: Boolean(e.sample?.stack), correlationIds: e.correlationIds?.length || 0 },
      missing: ['Cause', 'Catalog definition', 'Diagnostic tests', 'Repair guide'],
      nextStep: e.sample?.stack ? 'Open the error, read the top stack frames, and find the failing code path; then add a catalog definition for it.' : 'Open the error and use the route, time and correlation IDs to find the matching server log lines; then add a catalog definition for it.',
    })),
    notes: ['Coverage is computed from the running code. A higher score means more tooling exists for a module — not that the module has no bugs.'],
  };
}
