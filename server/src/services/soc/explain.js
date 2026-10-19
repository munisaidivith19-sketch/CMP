import { getDefinition, publicDefinition, UNCLASSIFIED_DEFINITION } from './catalog.js';
import { diagnosticsFor, getDiagnostic, publicDiagnostic } from './diagnostics/registry.js';
import { RECURRENCE_WINDOW_MS } from './diagnostics/library.js';

/**
 * Builds the ten-section explanation for one error from three inputs only:
 * the catalog definition, the stored error record (what actually happened)
 * and stored diagnostic runs (what the tests actually found).
 *
 * Every statement is tagged with its `kind`:
 *   confirmed   — supported by a stored diagnostic result or the error record
 *   possible    — a catalog cause no test has supported yet
 *   recommended — a step to take
 *   unverified  — an assumption, or something nobody has checked
 * A cause becomes "confirmed" only when a test listed for it returned the
 * FAIL/WARNING its definition maps to that cause. A passing test makes a
 * cause less likely but is not reported as "ruled out".
 */
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const SEVERITY_WORDS = {
  info: 'Informational — expected behaviour, recorded for context.',
  low: 'Low — limited impact, usually one user or one request.',
  medium: 'Medium — a feature is not working for some users.',
  high: 'High — an important feature is failing or many users are affected.',
  critical: 'Critical — most of the platform can be affected.',
};

function latestByTest(runs) {
  const out = new Map();
  for (const r of runs) {
    if (['QUEUED', 'RUNNING'].includes(r.status)) continue;
    const prev = out.get(r.testId);
    if (!prev || new Date(r.createdAt) > new Date(prev.createdAt)) out.set(r.testId, r);
  }
  return out;
}

export function explainError(event, runs = []) {
  const def = getDefinition(event.code);
  const d = def || UNCLASSIFIED_DEFINITION;
  const latest = latestByTest(runs);
  const tests = diagnosticsFor(def, event.code);

  // ── Causes, with the evidence status of each.
  const causes = (d.causes || []).map((c) => {
    const relevant = (c.tests || []).map((id) => latest.get(id)).filter(Boolean);
    const supporting = relevant.filter((r) => r.confirmsCause === c.id && ['FAIL', 'WARNING'].includes(r.status));
    const passing = relevant.filter((r) => r.status === 'PASS');
    if (supporting.length) {
      return { id: c.id, text: c.text, kind: 'confirmed', evidence: supporting.map((r) => ({ runId: r._id, testId: r.testId, status: r.status, observed: r.observed, at: r.finishedAt })), note: 'Supported by a diagnostic result.' };
    }
    if (passing.length) {
      return { id: c.id, text: c.text, kind: 'possible', evidence: passing.map((r) => ({ runId: r._id, testId: r.testId, status: r.status, observed: r.observed, at: r.finishedAt })), note: 'A related test passed, which makes this less likely — but it is not ruled out.' };
    }
    return { id: c.id, text: c.text, kind: (c.tests || []).length ? 'possible' : 'unverified', note: (c.tests || []).length ? `Not tested yet. Run: ${c.tests.map((id) => getDiagnostic(id)?.name || id).join(', ')}.` : 'No automated test can check this; it needs a person to look.' };
  });

  const findings = [...latest.values()]
    .sort((a, b) => new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt))
    .map((r) => ({
      runId: r._id,
      testId: r.testId,
      testName: r.testName,
      status: r.status,
      purpose: r.purpose,
      checked: r.checked,
      observed: r.observed,
      reason: r.reason,
      meaning: meaningOf(r.status),
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      nextSteps: r.nextSteps,
    }));

  const occurrences = `${plural(event.count, 'time')} between ${new Date(event.firstSeenAt).toISOString()} and ${new Date(event.lastSeenAt).toISOString()}`;
  const unknowns = [];
  if (!def) {
    unknowns.push('What caused it — no catalog definition matches this error.');
    unknowns.push('Which users or features are affected beyond the recorded route and module.');
    unknowns.push('Whether it is a code bug, bad data, or an infrastructure problem.');
    if (!event.sample?.stack) unknowns.push('A stack trace (none was captured for this source).');
  }
  const untested = tests.filter((t) => !latest.has(t.id));

  return {
    classification: def ? 'classified' : 'unclassified',
    definition: def ? publicDefinition(def) : UNCLASSIFIED_DEFINITION,
    sections: {
      whatHappened: {
        title: '1. What happened?',
        text: d.summary,
        facts: [
          { kind: 'confirmed', text: `Recorded ${occurrences}.` },
          ...(event.route ? [{ kind: 'confirmed', text: `Where: ${event.method ? `${event.method} ` : ''}${event.route} (module: ${event.module}).` }] : []),
          ...(event.httpStatus ? [{ kind: 'confirmed', text: `The server answered with HTTP ${event.httpStatus}.` }] : []),
          { kind: 'confirmed', text: `Message (redacted): ${event.message || '—'}` },
        ],
      },
      whatItMeans: { title: '2. What does it mean?', text: d.meaning },
      whyItMightHappen: {
        title: '3. Why might it happen?',
        text: def ? 'Possible causes, and whether any test has supported them:' : 'This error is unclassified, so no causes have been written for it yet. Nothing below is a confirmed cause.',
        causes,
        unknowns,
      },
      whatIsAffected: {
        title: '4. What is affected?',
        potential: (d.affected || []).map((text) => ({ kind: def ? 'possible' : 'unverified', text })),
        observed: [
          { kind: 'confirmed', text: `Module: ${event.module}${event.service ? ` · service: ${event.service}` : ''}.` },
          ...(event.actorRoles?.length ? [{ kind: 'confirmed', text: `Seen for roles: ${event.actorRoles.join(', ')}.` }] : []),
          ...(event.clients?.length ? [{ kind: 'confirmed', text: `Clients: ${event.clients.join(', ')}.` }] : []),
        ],
      },
      howSerious: {
        title: '5. How serious is it?',
        severity: event.severity,
        text: SEVERITY_WORDS[event.severity] || event.severity,
        reason: d.severityReason,
        kind: def ? 'confirmed' : 'unverified',
      },
      whatTestsFound: {
        title: '6. What did the tests find?',
        text: findings.length ? `${plural(findings.length, 'test')} have results for this error.` : 'No diagnostic test has been run for this error yet. Nothing has been checked.',
        findings,
        untested: untested.map((t) => ({ id: t.id, name: t.name, purpose: t.purpose })),
      },
      howToFix: {
        title: '7. How do I fix it?',
        available: Boolean(d.repair),
        text: d.repair ? 'Work through these steps in order. Each says what to check, where, why, and what you should see.' : def ? 'No repair is needed — this is expected behaviour.' : 'No repair guide exists for this error yet. Use the facts above and "What if it still fails?" to investigate.',
        repair: d.repair || null,
      },
      howToVerify: {
        title: '8. How do I verify the fix?',
        tests: (d.verification?.tests || []).map((id) => ({ id, name: getDiagnostic(id)?.name || id, registered: Boolean(getDiagnostic(id)) })),
        criteria: d.verification?.criteria,
        windowMinutes: Math.round(RECURRENCE_WINDOW_MS / 60000),
        text: 'Mark the fix as applied, wait for the observation window, then press "Verify fix". The error is only marked resolved when every verification test passes.',
      },
      ifStillFailing: {
        title: '9. What if it still fails?',
        steps: [
          { kind: 'recommended', text: 'Re-run every relevant diagnostic and compare with the earlier results.' },
          { kind: 'recommended', text: 'Look for related errors with the same correlation IDs (Related errors) — the real cause may be another error.' },
          { kind: 'recommended', text: 'Read the server log lines around the last occurrence time; full error text stays in the server log, only a redacted summary is stored here.' },
          ...(untested.length ? [{ kind: 'recommended', text: `Run the tests not yet run: ${untested.map((t) => t.name).join(', ')}.` }] : []),
          { kind: 'recommended', text: 'Open an incident to track the investigation and record your findings in its timeline.' },
        ],
        missingEvidence: [
          ...unknowns,
          ...(event.correlationIds?.length ? [] : ['No correlation ID was captured, so related requests cannot be linked.']),
        ],
      },
      technical: {
        title: '10. Technical details',
        text: d.technical,
        details: {
          code: event.code,
          fingerprint: event.fingerprint,
          source: event.source,
          errorName: event.errorName,
          httpStatus: event.httpStatus,
          method: event.method,
          route: event.route,
          environment: event.environment,
          correlationIds: event.correlationIds,
          sample: event.sample,
        },
      },
    },
    availableTests: tests.map(publicDiagnostic),
  };
}

function meaningOf(status) {
  return {
    PASS: 'The component behaved correctly when checked.',
    FAIL: 'The check found a problem.',
    WARNING: 'The check found something that needs attention but is not a failure.',
    SKIPPED: 'The check did not run (a precondition was not met). It proves nothing.',
    INCONCLUSIVE: 'The check ran but could not reach a conclusion. It proves nothing.',
    TIMED_OUT: 'The check took too long and was stopped. It proves nothing.',
    CANCELLED: 'The check was cancelled. It proves nothing.',
  }[status];
}
