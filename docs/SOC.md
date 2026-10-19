# Security Operations (SOC) and troubleshooting

The Super Admin console has a **Security Ops** page at `/super-admin/soc` (sidebar → *Security Ops*). It is for the Super Admin role only. The server checks this on every request, so changing a URL or calling the API directly does not get round it.

The page answers four questions:

1. **Is anything suspicious happening?** (Overview, Security log, Incidents)
2. **What is failing?** (Error explorer → error page)
3. **Why, and how do I fix it?** (ten-section explanation, diagnostics, repair guide)
4. **Did the fix work?** (Verify fix → resolved only if every verification test passes)

Nothing on these pages is invented. Every number comes from stored records for a stated time range. Where there is no data, the page says **No data** or **UNKNOWN**, and never "healthy" or "0".

---

## Architecture and data flow

```
 Express request ──► correlationId (X-Request-Id) ──► requestMetrics ──► routes
        │                                                        │
        │ 5xx / 403 ─► errorHandler ─┐            429 ─► captureRateLimited ─┐
        │                            ▼                                      ▼
 background jobs (runJob) ──► services/soc/capture.js ◄── db events, Socket.IO engine errors,
 web app (POST /api/client-errors) ─┘    │ redact → classify → fingerprint → dedupe/storm cap
                                         ▼
                              MongoDB: ErrorEvent (one doc per distinct error)
                                       SocMetric (hourly counters, flushed every minute)

 Super Admin UI ──► /api/super-admin/soc/* ──► detections.js (alerts, overview from SecurityLog/AuditLog/ErrorEvent)
                                            ├► diagnostics/runner.js ──► registry.js + library.js ──► DiagnosticRun
                                            ├► explain.js (catalog + error record + stored runs)
                                            ├► health.js (registered diagnostics → PASS/WARNING/FAIL/UNKNOWN)
                                            ├► coverage.js (mounted routes + registries + tests/ files)
                                            └► Incident (timeline) ── every change ──► AuditLog (protected)
```

| Piece | File |
|---|---|
| Redaction | `server/src/services/soc/sanitize.js` |
| Capture, dedupe, storm protection | `server/src/services/soc/capture.js` |
| Job heartbeats, DB/socket/process monitors, correlation IDs | `server/src/services/soc/monitors.js` |
| Request/error counters | `server/src/services/soc/metrics.js`, `models/SocMetric.js` |
| Error catalog and repair guides | `server/src/services/soc/catalog.js` |
| Diagnostic registry / library / runner | `server/src/services/soc/diagnostics/` |
| Explanations | `server/src/services/soc/explain.js` |
| Alerts and overview | `server/src/services/soc/detections.js` |
| Health | `server/src/services/soc/health.js` |
| Coverage | `server/src/services/soc/coverage.js` |
| API | `server/src/controllers/socController.js`, routes in `server/src/routes/superAdminRoutes.js` |
| Models | `ErrorEvent`, `DiagnosticRun`, `Incident`, `SocMetric` in `server/src/models/` |
| Web reporting | `client/src/services/errorReporter.js`, `client/src/components/ErrorBoundary.jsx`, `client/src/services/api.js` |
| Pages | `client/src/pages/superadmin/Soc.jsx`, `SocErrorDetail.jsx`, `socModel.js` |

---

## Error event lifecycle

1. **Captured.** Something fails: a 5xx, a 403 refusal, a 429, a MongoDB disconnect, a background job, a Socket.IO transport error, an uncaught exception, or a crash reported by the web app.
2. **Redacted.** Credential keys are dropped. Bearer tokens, JWTs, API keys, connection-string passwords, e-mail addresses, phone numbers and `password=`/`otp=` values are masked. Control characters are removed. Routes keep their template (`/api/users/:id`) and lose the query string. Stack frames keep only the path from `server/` or `src/` down. Request bodies and headers are **never** stored.
3. **Classified.** The error is matched against the catalog using structured signals only: source, HTTP status, error class, driver code, or the response's `code`. A message that only *looks like* a known error is never enough. If nothing matches, the error is stored as `UNCLASSIFIED`. It is never discarded.
4. **Deduplicated.** One document per fingerprint (source + code + module + route, plus message shape for unclassified errors). Repeats increment `count`. Each fingerprint is written at most once every 5 s; repeats inside that window are added when it closes. At most 300 writes per minute per process; anything beyond is counted as *dropped*, and the health page shows it.
5. **Worked on.** `open → acknowledged → investigating → fix_applied`.
6. **Verified.** *Verify fix* runs the definition's verification tests one after another. If every one returns **PASS**, the error becomes `resolved`. Otherwise it goes back to `investigating`, with a note listing each result. Nobody can set `resolved` by hand.
7. **Regressed.** If a resolved error happens again, it is re-opened automatically (`regressions + 1`).

Retention: errors 90 days after last seen, diagnostic runs 180 days, counters 35 days. Incidents and the audit trail have no TTL.

---

## Error catalog

Each definition in `catalog.js` holds: code, title, module, service, severity and the reason for it, plain-English summary and meaning, technical explanation, **possible** causes (each naming the tests that can support it), affected features, a matcher, a repair guide, verification tests with success criteria, docs, version and date.

Current codes: `DB_UNAVAILABLE`, `DB_CONNECTION_LOST`, `DB_OPERATION_TIMEOUT`, `DB_SERVER_ERROR`, `AUTHZ_POLICY_DENIED`, `AUTHZ_CSRF_REJECTED`, `AUTHZ_ORIGIN_BLOCKED`, `AUTHZ_REAUTH_REQUIRED`, `AUTHZ_PASSWORD_CHANGE_REQUIRED`, `AUTHZ_FORBIDDEN`, `RATE_LIMITED`, `AI_PROVIDER_ERROR`, `JOB_FAILED`, `SOCKET_CONNECTION_ERROR`, `PROCESS_UNCAUGHT`, `CLIENT_RENDER_ERROR`, `CLIENT_UNHANDLED_REJECTION`, `CLIENT_SCRIPT_ERROR`, `CLIENT_NETWORK_ERROR`, `CLIENT_API_SERVER_ERROR`, plus `UNCLASSIFIED`.

To support this, the CSRF and origin guards (`middleware/security.js`) now add `code: 'CSRF_REJECTED'` / `code: 'ORIGIN_BLOCKED'` to their 403 bodies. The messages are unchanged.

### Adding an error

```js
// server/src/services/soc/catalog.js
defineError({
  code: 'EXAM_SCHEDULE_CONFLICT',           // UPPER_SNAKE, unique
  title: '…', module: 'exams', service: 'api',
  severity: 'medium', severityReason: '…',
  summary: '…', meaning: '…', technical: '…',
  causes: [{ id: 'overlap', text: '…', tests: ['some.test'] }],
  affected: ['…'],
  match: (s) => s.httpStatus >= 500 && s.dataCode === 'EXAM_CONFLICT', // structured signals only
  repair: { symptoms: [], preconditions: [], riskLevel: 'low', category: 'manual', steps: [{ action, where, why, expected, risk }], rollback: '…' },
  verification: { tests: ['errors.recurrence'], criteria: '…' },
});
```

Only name repository paths and settings that really exist. The coverage page lists any test a definition names that is not registered (*Broken catalog references*).

### Unclassified errors

The error page shows the facts, lists what is unknown, and gives no causes or repair guide. Coverage → *Unclassified errors* lists the next investigation step for each. Fixing one usually means writing a catalog definition for it.

---

## Diagnostic engine

### Registration

```js
// server/src/services/soc/diagnostics/library.js
registerDiagnostic({
  id: 'area.name', name, purpose,
  supports: { codes: ['ERROR_CODE'], services: ['mongodb'] },
  preconditions: ['…'], timeoutMs: 5000 /* ≤ 30 s */, expectedDurationMs, limits: '…',
  output: 'PASS when … WARNING when … FAIL when …', evidence: '{ … }',
  nextSteps: { PASS: [], FAIL: [], WARNING: [] }, verification: '…',
  causes: { FAIL: 'cause_id' },   // which catalog cause a FAIL supports
  async run({ signal, errorEvent }) { return { status, checked, observed, reason, evidence }; },
});
```

Rules:

- **Read-only.** Every test is read-only. The runner refuses a test marked otherwise.
- **Registered IDs only.** The API accepts only a registered ID. Nothing typed by a user, found in a log, or written by an AI is ever executed: no shell commands, no code, no queries.
- **Statuses:** `PASS`, `FAIL`, `WARNING`, `SKIPPED`, `INCONCLUSIVE`, `TIMED_OUT`, plus `CANCELLED`.
- **Failures are never PASS.** If a test throws, the result is `INCONCLUSIVE`. If it returns an unknown status, the result is `INCONCLUSIVE`. If it runs past its timeout, the result is `TIMED_OUT`.
- **Limits.** At most 3 runs at once per process (`SOC_DIAG_MAX_CONCURRENT`) and 2 per Super Admin. The same test cannot run twice at once for the same error. Each Super Admin may start 60 runs per 15 minutes (`SOC_RUN_RATE_LIMIT`).
- **Execution.** Runs start after the HTTP 202 response and the page polls for the result. Every start, completion and cancellation is written to the protected audit trail.

### Tests implemented

| ID | What it checks |
|---|---|
| `db.connectivity` | Connection state + ping round trip |
| `db.connection_history` | Disconnects/errors this process saw in the last hour |
| `db.indexes` | Declared model indexes vs indexes in MongoDB |
| `config.secrets` | JWT / chat secrets set, not dev defaults, ≥ 32 chars (values never shown) |
| `config.cors` | `CLIENT_URL` origins, https in production |
| `config.proxy` | `TRUST_PROXY` hop count in production |
| `config.ai_provider` | `GROQ_API_KEY` present (no provider call) |
| `config.sms_provider` | OTP SMS settings complete (no SMS sent) |
| `config.storage` | Cloudinary or writable upload dir (`fs.access`, nothing written) |
| `jobs.heartbeats` | Every background job's last run |
| `socket.server` | Socket.IO running, connected clients |
| `process.resources` | Heap and 1 s event-loop delay sample |
| `soc.pipeline` | Error capture and counter flush working |
| `platform.mode` | Emergency mode, last recovery health check, backup status |
| `auth.sessions` | Session store readable, an active Super Admin exists |
| `security.failed_logins` | Failed sign-ins in the last hour by network |
| `security.authz_denials` | Policy refusals in the last hour by account |
| `transport.tracking_freshness` | Active bus trips with a fix in the last 2 min |
| `errors.recurrence` | Whether the selected error occurred since the fix (verification) |

---

## How explanations are produced

`explain.js` builds the ten sections from exactly three inputs:

1. the catalog definition;
2. the stored error record;
3. stored diagnostic runs.

The ten sections are: What happened · What does it mean · Why might it happen · What is affected · How serious · What the tests found · How to fix · How to verify · What if it still fails · Technical details.

Each statement is tagged with one of four kinds:

- **Confirmed finding.** Backed by the error record, or by a test that actually returned the FAIL/WARNING its definition maps to that cause.
- **Possible cause.** A catalog cause that no failing test supports. If a related test passed, the page says the cause is *less likely*, never *ruled out*.
- **Recommended action.** A step to take.
- **Unverified assumption.** Something nobody has checked.

### Optional AI explanation

If `GROQ_API_KEY` is configured, *Ask AI to explain* sends a redacted summary to the existing Groq integration. The summary covers the error's facts, the catalog text, recent results and registered test names. The system prompt marks this data as untrusted and forbids invented results and claims that the problem is fixed. The answer is labelled *AI-generated, not verified*. It never changes the error and is recorded in the audit trail. Everything else works without an AI provider.

---

## Repair guides and safe recovery

Every repair guide is **manual guidance**: ordered steps, each giving what to check, where, why, what you should see and the risk, followed by rollback and verification. There are **no automated repairs**. The SOC never changes attendance, exams, timetables, gate passes, accounts, credentials or policies.

The only high-impact operations remain the existing Emergency Control actions. Those still need a password re-entry and write to the protected audit trail.

---

## Permissions and security controls

- `/api/super-admin/soc/*` sits behind `protect → platformGate → confinedRoleGuard → authorize('super_admin')`. Ordinary Admins, staff and students get 403. Unauthenticated callers get 401.
- `/api/client-errors` (POST) is open to any signed-in role. It only writes a redacted record, is rate-limited per user (30 per 10 min), and its input is validated.
- Every query is paginated (max 100). Aggregations use indexes and are bounded. Health results are cached for 15 s. Forced health checks and runs are rate-limited.
- Incidents start as *undetermined*, or *suspected* when opened from an alert. Marking one *confirmed* or *false positive* needs a written justification. Resolving needs resolution notes. The timeline is append-only and every change is in the AuditLog.
- Alerts are computed on demand from stored records and always carry `assessment: 'suspected'`.
- The UI renders all server text as text, never as HTML.
- Every error and run stores its `environment` (`SOC_ENVIRONMENT`, or `NODE_ENV` if unset), and the explorer can filter on it.

---

## Environment setup

`server/.env` (see `server/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `SOC_CAPTURE_ENABLED` | `true` | `false` stops recording (health shows FAIL) |
| `SOC_ENVIRONMENT` | `NODE_ENV` | Label such as `production` / `staging` |
| `SOC_VERIFY_WINDOW_MS` | `900000` | Quiet time after a fix before verification can pass |
| `SOC_DIAG_MAX_CONCURRENT` | `3` | Runs at once per process |
| `SOC_RUN_RATE_LIMIT` | `60` | Runs per Super Admin per 15 min |

No new dependencies were added.

## Test commands

```
cd server && node --test --test-concurrency=1 tests/soc.test.js   # SOC only (needs local MongoDB)
cd server && npm test                                             # whole backend suite
cd client && npm test                                             # includes socModel + errorReporter tests
cd client && npm run build
```

The SOC tests register fixture diagnostics whose IDs start with `test.`. These are test fixtures, not production checks.

## Local verification

1. Start MongoDB, then `cd server && npm run dev` and `cd client && npm run dev`.
2. Sign in as a Super Admin (`server/scripts/create-super-admin.mjs`).
3. Sidebar → **Security Ops**. The Overview shows real counters. Shortly after start, the telemetry note says the counters only cover part of the range.
4. Produce a real 403. In another browser, sign in as a student. Use that student's access token to call `GET /api/super-admin/overview` with `curl` (opening the page itself only redirects). Then find `AUTHZ_FORBIDDEN` in *Error explorer*.
5. Open the error. Run **Database connectivity** and watch the result fill in section 6.
6. Go through *Start investigating → Mark fix as applied*, wait for the observation window, then **Verify fix**.

## Safe production rollout and rollback

- **Rollout.** Deploy as usual. The new collections and indexes are created at start-up by `syncIndexes`. Capture adds one deduplicated write per distinct error per 5 s, and one counter flush per minute.
- **Check.** Afterwards, open *System health* and confirm `Error capture pipeline` is PASS.
- **Disable without a deploy.** Set `SOC_CAPTURE_ENABLED=false` and restart.
- **Rollback.** Redeploy the previous build. The `errorevents`, `diagnosticruns`, `incidents` and `socmetrics` collections can stay; nothing else reads them. The only change existing clients see is the new `code` field on CSRF/origin 403 responses and the `X-Request-Id` header.

## Limitations (coverage gaps)

- **Native apps.** The Android and iOS apps do not report errors yet (`client_mobile` is accepted by the API but not wired in the apps).
- **Sign-in page.** Errors on the web sign-in page are not captured, because the report endpoint needs a session.
- **Socket.IO.** Only transport-level `connection_error` events are captured. Handler failures that answer with an error acknowledgement are not.
- **Crashes.** Uncaught exceptions are recorded best-effort; the process may exit before the write completes.
- **Per-process state.** Job heartbeats, DB connection history and storm-protection windows live in each API process and reset on restart. With several instances, each one reports only itself. Hourly counters *are* summed across instances.
- **Limited checks.** The AI and SMS checks confirm configuration only. Validating keys would mean calling the provider.
- **4xx answers.** Validation, 404 and 409 responses are not captured on purpose: they are the API working as intended.
