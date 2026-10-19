/**
 * Diagnostic test registry. Only tests registered here can ever run: the API
 * accepts a test ID, looks it up, and refuses anything unknown. There is no
 * way to submit code, a shell command or a query to execute.
 *
 * A test definition:
 *   id, name, version, purpose
 *   supports: { codes: [...], services: [...] }   — which errors/services it helps with
 *   preconditions: [text]
 *   authorization: 'super_admin'                     — enforced by the router and the runner
 *   readOnly: true                                   — state-changing tests are refused by the runner
 *   requiresError: boolean                           — needs a selected error (e.g. recurrence)
 *   timeoutMs, expectedDurationMs, limits: text
 *   output: text describing { status, checked, observed, reason }
 *   evidence: text describing the evidence object
 *   nextSteps: { PASS: [...], FAIL: [...], WARNING: [...], ... }
 *   verification: text
 *   causes: { FAIL: 'cause_id', WARNING: 'cause_id' } — which catalog cause a failure supports
 *   run({ signal, errorEvent }) → { status, checked, observed, reason, evidence }
 */
const tests = new Map();

const REQUIRED = ['id', 'name', 'purpose', 'supports', 'preconditions', 'timeoutMs', 'expectedDurationMs', 'limits', 'output', 'evidence', 'nextSteps', 'verification', 'run'];
export const RESULT = ['PASS', 'FAIL', 'WARNING', 'SKIPPED', 'INCONCLUSIVE'];

export function registerDiagnostic(def) {
  for (const k of REQUIRED) if (def[k] === undefined) throw new Error(`Diagnostic ${def.id || '?'} is missing "${k}"`);
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(def.id)) throw new Error(`Invalid diagnostic id ${def.id}`);
  if (tests.has(def.id)) throw new Error(`Duplicate diagnostic id ${def.id}`);
  if (typeof def.run !== 'function') throw new Error(`${def.id}: run must be a function`);
  if (def.timeoutMs > 30_000) throw new Error(`${def.id}: timeout above the 30 s limit`);
  tests.set(def.id, { version: 1, authorization: 'super_admin', readOnly: true, requiresError: false, causes: {}, ...def });
  return tests.get(def.id);
}

export const getDiagnostic = (id) => (typeof id === 'string' ? tests.get(id) || null : null);
export const allDiagnostics = () => [...tests.values()];
export const hasDiagnostic = (id) => tests.has(id);

/** Remove a test (test hook — production code never unregisters). */
export const unregisterDiagnostic = (id) => tests.delete(id);

export function publicDiagnostic(t) {
  if (!t) return null;
  const { run, ...rest } = t;
  return rest;
}

/** Tests relevant to an error: those listed by its catalog entry, then those that declare support for its code. */
export function diagnosticsFor(def, errorCode) {
  const ids = new Set(def?.diagnostics || []);
  for (const t of tests.values()) if (t.supports.codes?.includes(errorCode) || t.supports.codes?.includes('*')) ids.add(t.id);
  return [...ids].map((id) => tests.get(id)).filter(Boolean);
}
