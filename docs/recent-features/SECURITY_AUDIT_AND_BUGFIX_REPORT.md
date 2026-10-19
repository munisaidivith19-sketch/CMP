# VEXON — Security Audit and Bug-Fix Report (Web · Backend · Kotlin Android · Native iOS)

Date: 2026-10-17 · Branch: `fix/csrf-legacy-cookie` · Everything here is local and uncommitted: nothing was committed, pushed or deployed. Every test ran against throw-away local MongoDB databases (`cmp_test`, `cmp_audit_test`). No production service, real account or external API was used.

> Earlier audit: `SECURITY_QA_REPORT.md` (repository root, 2026-10-12) covers the older modules (auth, CSRF, alumni, gate pass, exports…). This pass concentrates on the **recently added, still-uncommitted features**: Skill Wallet, Super Admin / emergency control, SOC / diagnostics, exams, staff early exits / cover, transport, and the web / Kotlin / iOS clients for them.

## 1. Executive summary

- **3 confirmed defects, all in Skill Wallet. All 3 are fixed and each has a regression test.** They are Medium ×2 and Low ×1. I found no Critical or High issue in the code I inspected.
- Each new test was **run against the unfixed code first and failed** (output in §12). With the fixes, all Skill Wallet tests pass.
- Web: 63/63 client tests pass, the production build passes, and the bundle secret/source-map scan is clean.
- iOS: the platform-independent core (`VEXONKit`) passes `swift test` (47/47) on Windows. **The iOS app itself was not compiled or run**: there is no macOS / Xcode / simulator here.
- Android: 52/52 unit tests pass; lint reports 1 error that predates this audit. No Kotlin source was changed.
- Server: **817/819 tests pass** after the fixes. The 2 failures are a gate-pass test with a hard-coded date that has now passed (see §13).

## 2. Architecture discovered

| Layer | What exists |
|---|---|
| Backend | Node 24 · Express 4 · Mongoose 8 · Socket.IO 4 (`server/src`). Route chain in `routes/index.js`: public routes → `publicPlatformGate` → **`protect`** (JWT HS256, pinned algorithm + live `Session` row + active user) → `platformGate` (maintenance/lockdown) → `passwordChangeGate` → `confinedRoleGuard` (deny-by-default for COE / Office / Transport / Super Admin) → `adminPolicyGuard` (policy-managed admins) → feature routers |
| Authorization | `authorize(...roles)` per route, plus checks in each handler. Skill Wallet has its own `services/skillWallet/access.js` (ownership, membership, designations) and `policies.js` / `adminPolicies.js` for admins |
| Storage | Public `/uploads` (legacy) and **private** storage for Skill Wallet (`utils/privateStorage.js`: disk or DB, server-generated `sw/<uuid>.<ext>` keys). Downloads use HMAC-signed, viewer-bound, short-lived tokens, and every download re-checks authorization (`services/skillWallet/assets.js`) |
| Images | `sharp` checks magic bytes, decodes the image with `limitInputPixels` and `failOn:'error'`, and re-encodes it. NPTEL certificates always become WebP, and the output is decoded again to prove it (`services/skillWallet/imagePipeline.js`) |
| SOC | `services/soc/*`: redaction (`sanitize.js`), errors stored once per fingerprint with storm caps (`capture.js`), read-only diagnostics, incidents. Super Admin only |
| Web | React 18 + Vite + RTK Query (`client/src`); Skill Wallet pages in `client/src/pages/skillwallet` |
| Android | Native Kotlin + Compose (`mobile-kotlin`). Refresh token is AES-encrypted with an AndroidKeyStore key (`core/SecureStore.kt`); backups disabled |
| iOS | Native SwiftUI (`mobile-ios/VEXON`) plus the Foundation-only core package `mobile-ios/Packages/VEXONKit` |

## 3. Scope and files inspected

Read in full: every `server/src/controllers/skillWallet/*.js`, `server/src/services/skillWallet/*.js`, `routes/skillWalletRoutes.js`, `routes/superAdminRoutes.js`, `middleware/{auth,platform,coeGuard}.js`, `utils/privateStorage.js`, `services/soc/sanitize.js`, the first half of `services/soc/capture.js`, `config/socket.js`, the GPS tracker webhook, and the role / policy paths of `adminController.js` and `accountController.js` (`resetUserPassword`).
Spot-checked: `examController.js` (edit / publish scope), `staffController.js` (early exit / cover), Android `AndroidManifest.xml`, `build.gradle.kts`, `MainActivity.kt` / `Push.kt` deep links, `SecureStore.kt`, `ui/Fields.kt` link opening, iOS `Info.plist` ATS, `KeychainStore.swift`, and repository-wide searches (raw-HTML sinks, `target="_blank"`, storage writes, TLS overrides, WebView bridges, logging).
**Not inspected line by line** (residual risk, see §14): `superAdminController.js` and `socController.js` bodies, `services/soc/{catalog,coverage,explain,monitors}.js`, `transportController.js` beyond the webhook, `attendanceMonitorController.js`, and most iOS SwiftUI screens.

## 4. Web security findings

- No `dangerouslySetInnerHTML` / `innerHTML`. Markdown renders to React elements only, and links are filtered with `SAFE_URL`.
- Skill Wallet external links go through `ExternalLink` (`components.jsx`) with `rel="noopener noreferrer nofollow"`, and only after validation.
- `localStorage` holds only the theme and a Study Assistant conversation id; `sessionStorage` holds only lockout / idle flags. No tokens are stored in browser storage.
- Some legacy pages use `rel="noreferrer"` without `noopener`. Modern browsers imply `noopener` for `noreferrer`, so this is Informational.
- **Changed:** `ReviewWorkspace.jsx` now sends the certificate `version` with a decision, and reloads the certificate on 409 (fix SW-3).

## 5. Backend / API security findings

### Confirmed and fixed

| ID | Severity | Area | Defect | Root cause | Fix (file) | Regression test |
|---|---|---|---|---|---|---|
| SW-1 | **Medium** | Skill Wallet review → publication | If a second authorized reviewer **rejected** (or requested changes to) a revision that another reviewer had already approved, the status became `rejected` but `review.approvedRevision` and `facultyScore` stayed. The owner could still publish that rejected revision **publicly** (`setPublication` checks only `approvedRevision`), and its score stayed on the faculty leaderboard | `submitReview` set `approvedRevision` on approve and never cleared it on a later negative decision for the same revision | A non-approve decision on the currently approved revision now clears `approvedRevision`, `facultyScore` and any pending `publicRequest` (`controllers/skillWallet/reviewController.js`) | `security-audit-skill-wallet.test.js` › SW-1 |
| SW-3 | **Medium** | NPTEL verification | A verifier's decision was not tied to the content they reviewed. A student could upload a genuine certificate, wait for the verifier to open it, then swap the image (`PUT /certifications/:id` is allowed while pending). The verifier's "Verified" click then applied to the **swapped image they never saw** | `decideCertification` matched only on `status: 'pending'`, not on the document version | `verifierDetail` returns `version` (`__v`, which the model's `optimisticConcurrency` bumps on every student edit). The decision now **requires** `version`, and the conditional update matches `__v`. A stale version answers 409, a missing one 422 (`certificationController.js`). Web client updated | SW-3, plus the 3 existing NPTEL decision tests updated to send `version` |
| SW-2 | Low | Skill Wallet designations | The Principal (the only grantor) could grant **themselves** `certificate_verifier` or `project_reviewer`. Only the `innovation_coordinator` self-grant was refused. That contradicts the least-privilege rule that the Principal gets no verification rights from the role | The self-grant check was limited to one capability | Every self-grant is refused (`managementController.js`) | SW-2 |

**API contract change (SW-3):** `POST /api/skill-wallet/review/certifications/:id/decision` now requires `version` (integer, from `GET …/review/certifications/:id`). The web client is the only caller; the Kotlin and iOS apps have no verifier screens, so no mobile client is affected.

### Verified controls (no change needed)

- **Skill Wallet**
  - Private projects answer 404 to non-members. Pending invitations grant nothing.
  - Accept and decline are conditional updates and idempotent. The team-seat check uses a conditional `$inc`, and unique indexes block duplicate invitations and memberships.
  - Roll-number lookup returns only name and class, and gives the same 404 for "no such student" and "ineligible account".
  - Gallery, leaderboard and portfolio read only the published snapshot through one audience filter, with no user ids, roll numbers, hall tickets or reviewer notes.
  - Assets are re-authorized on every download (`Cache-Control: no-store`, `nosniff`, restrictive CSP).
  - URLs are checked with the WHATWG parser and must be https, a public domain, with no credentials and the platform's own domain. They are never fetched, so there is no SSRF surface.
  - Hall tickets are encrypted at rest and deduplicated with a keyed hash; the full value is shown only to the owner and to verifiers in scope.
  - Image pipeline: format from magic bytes, sharp agreement, pixel / dimension limits, animated images rejected, full re-encode, WebP output re-verified. Nothing is stored before conversion succeeds, and the stored WebP is rolled back on failure.
- **Admin / Super Admin**
  - `admin` and `super_admin` accounts cannot be created, promoted to, edited, deleted or password-reset through `/admin/users` or `/users/:id/reset-password` (`moduleForRole` → `requirePolicy(null)`). Self role / status changes are refused.
  - Sensitive Super Admin writes need a password re-entered within 5 minutes; the proof is stored on the server-side session row.
  - The emergency transition uses optimistic `expectedVersion`.
- **Sessions:** HS256 pinned, live session row, active user, idle expiry. Sockets go through the same `authenticateAccessToken`, plus the maintenance gate.
- **Socket rooms:** chat, bus and hidden-discussion rooms are joined only after a database check. Typing events are relayed only inside rooms the socket was authorized to join.
- **SOC:** credential keys are dropped and secrets / PII in free text are masked. Control characters are stripped (no log injection). Stacks are reduced to project-relative frames. Errors are coalesced per fingerprint, with a global cap of 300 writes/min and a cap of 2,000 tracked fingerprints.
- **Exams / staff:** edit and publish go through `loadForWrite` / `canManageExam` (department and year authority). Early-exit actions are limited to the requester or a manager.
- **GPS tracker webhook:** HMAC-SHA256 over `timestamp.rawBody`, constant-time compare, ±5 min window, disabled (404) when no secret is set.

## 6. Kotlin Android findings

No defects confirmed. No code changed.

- `allowBackup=false`, data-extraction rules exclude shared prefs, and the refresh token is AES/GCM-encrypted with an AndroidKeyStore key.
- Only `MainActivity` is exported (launcher + `vexon://` deep link). Deep links and notification links pass through `Push.safeLink`: relative paths only, no `//` or `..`, known screens only, and each screen re-checks access with the server. Both services are `exported=false`. PendingIntents are `FLAG_IMMUTABLE`.
- No custom `TrustManager` / `HostnameVerifier`, no WebView, no JavaScript bridges. Markdown links open only for `https?://`.
- Location logging is wrapped in `BuildConfig.DEBUG`. Release is minified.
- **Informational:** `usesCleartextTraffic` is true in release when `apiUrl` is empty or `http://` (a documented campus-LAN option). Release builds for production should use an `https://` API URL.
- **Informational:** release is signed with the debug key unless a keystore is configured. That is fine for QA; a store build needs a real key.

## 7. Native iOS findings

No defects confirmed. No code changed.

- ATS uses defaults, with only `NSAllowsLocalNetworking` (no `NSAllowsArbitraryLoads`, no exception domains).
- Keychain items use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- No `UserDefaults.standard.set`, no `print(`, and no `serverTrust` / authentication-challenge overrides.
- The Skill Wallet is not implemented in the iOS app, so the SW fixes have no iOS impact.
- **Limitation:** the iOS app target (SwiftUI, UIKit, UserNotifications, Keychain) could not be compiled or tested here (Windows, no Xcode / simulator). Only the Foundation-only `VEXONKit` package was tested.

## 8. Cross-platform consistency

- The SW-3 contract change affects only the web client, which is updated. Android and iOS do not call the decision endpoint.
- All clients rely on the backend for authorization. The SW-1, SW-2 and SW-3 fixes are server-side, so they hold for every client.
- **Gap (functional, not security):** iOS has no Skill Wallet. Android has project creation but no image upload (it directs students to the web).

## 9. Severity totals

Critical 0 · High 0 · **Medium 2 (SW-1, SW-3)** · **Low 1 (SW-2)** · Informational: cleartext / debug-signing build options, `noreferrer`-only links, tracker-webhook replay within its 5-minute window (low impact: GPS fixes only).

## 10–11. Files changed and tests added

| File | Change |
|---|---|
| `server/src/controllers/skillWallet/reviewController.js` | SW-1: a negative decision withdraws the approval of the same revision |
| `server/src/controllers/skillWallet/certificationController.js` | SW-3: `version` in the verifier detail, required and matched in the decision |
| `server/src/controllers/skillWallet/managementController.js` | SW-2: no self-granted designation of any capability |
| `client/src/pages/skillwallet/ReviewWorkspace.jsx` | SW-3: sends `version`; reloads on 409 |
| `server/tests/security-audit-skill-wallet.test.js` | **New**: SW-1, SW-2, SW-3 regression tests |
| `server/tests/skill-wallet-nptel.test.js` | Decision calls now pass the version the verifier opened (needed for the new contract; the assertions are unchanged) |
| `docs/recent-features/SECURITY_AUDIT_AND_BUGFIX_REPORT.md` | This report |

## 12. Commands and real results

| Command | Ran | Result |
|---|---|---|
| `node --test tests/security-audit-skill-wallet.test.js` (before the fix) | yes | **3/3 FAIL** as expected. SW-1: `approvedRevision` was `1`, expected `null`. SW-2: self-grant returned `201`, expected `422`. SW-3: detail had no `version` |
| `node --test --test-concurrency=1` on the 4 Skill Wallet files (`security-audit-skill-wallet`, `skill-wallet-nptel`, `skill-wallet-projects`, `skill-wallet-invitations`), after the fix | yes | **48/48 pass** |
| `node --test tests/academic-authorization.test.js` (re-run alone) | yes | 17/17 pass (see §13) |
| `npm test --prefix server` (full suite, after the fix) | yes | **817/819 pass**; the 2 failures predate this audit (see §13) |
| `npm test --prefix client` | yes | **63/63 pass** |
| `npm run build --prefix client` | yes | **pass** (Vite, 27 s; only the existing chunk-size warning) |
| `npm run verify:bundle` | yes | **pass**: 116 files, no secrets, no source maps |
| `swift test` in `mobile-ios/Packages/VEXONKit` | yes | **47/47 pass** (6 suites) |
| `gradlew testDebugUnitTest lintDebug` in `mobile-kotlin` | yes | unit tests **52/52 pass**; lint **1 error** that predates this audit (see §13) |
| iOS app build / XCTest / UI tests | **no** | no macOS / Xcode |
| Android emulator / device run | **no** | not part of this run; no Kotlin code changed |
| `npm audit` / Gradle dependency scan | **no** | not run: it would send dependency manifests to a third-party registry, which GH.MD §1.15 asks to avoid. Recommended for CI |

## 13. Failed tests and pre-existing failures

**Authoritative full run after the fixes (`npm test --prefix server`, run alone, 31 min): 819 tests, 817 pass, 2 fail.** The 2 failures are the pre-existing `gate-exit-campus-day.test.js` tests described below. Nothing this audit introduced fails, and the 3 new regression tests pass.

The earlier mixed run (816 tests: 797 pass, 19 fail) started before the fixes and ran while they were being written. Its failures were classified as follows:

| Failures | File | Classification | Evidence |
|---|---|---|---|
| 17 | `academic-authorization.test.js` | **Transient (environment)**, not a defect | The first test took about 10 s, then every other test in the file failed in under 1 ms (setup timeout while other test runs loaded the same MongoDB). **Re-run alone: 17/17 pass.** The file covers People / Timetable, which this audit did not change |
| 2 | `gate-exit-campus-day.test.js` | **Pre-existing, date-dependent test failure.** Not caused by this audit, and no product bug | Fails the same way when run alone (`404`, expected `200`). The test sets `clock.now` to the fixed date `2026-10-10`, so the pass's verification window closes `2026-10-13`. `expireGatePasses()` (`controllers/gatePassController.js:112`) uses the real `new Date()`, which is now 2026-10-17, so it expires the pass before `verify`. In production, the real time and `clock.now` are the same. Not fixed (outside scope). Suggested fix: compute the test dates relative to today, or use `clock.now()` in `expireGatePasses` |

Other platforms:
- **Kotlin:** `testDebugUnitTest` **52/52 pass** (9 classes). `lintDebug` **fails with 1 error** (plus 66 warnings and 12 hints): `MissingPermission` on `NotificationManagerCompat.notify` in `push/Push.kt`. The error predates this audit (no Kotlin code was changed). In practice it is a false positive: the call is inside `runCatching`, so a `SecurityException` is caught, and `permissionGranted()` is checked first. Fix it with an explicit `checkSelfPermission` or `@SuppressLint`, or add a lint baseline.
- **iOS:** `swift test` (VEXONKit) **47/47 pass**. The app target was not built.

## 14. Unresolved risks

1. **Not fully reviewed:** the bodies of `superAdminController.js` / `socController.js`, the SOC catalog / explain / monitors, transport management and the attendance monitor. Their route guards and confinement were verified; the per-handler logic was not.
2. **SW-1 follow-up (policy decision):** a project that is already **public** keeps its published copy if a later reviewer rejects the same revision. Only new public publication is blocked. Decide whether a post-publication rejection should narrow it to college-only automatically.
3. **Socket rooms after a permission change:** a socket that joined a chat or bus room keeps it until it reconnects, even if access is revoked meanwhile. Sessions are disconnected on revocation (`disconnectSessions`), but not on a role or membership change.
4. **Tracker webhook replay:** a captured signed request can be replayed within 5 minutes. Recommendation: reject a timestamp per device that is not newer than the last one accepted.

## 15. Platform testing limitations

- iOS: only `VEXONKit` was tested; the app target was not compiled.
- Android: unit tests and lint only; no emulator or device run.
- Push (FCM / APNs) and SMS: not exercised (no credentials; tests use the in-memory providers).
- No browser automation was run against the UI.

## 16. Dependency and configuration risks

- No dependency audit was run (see §12).
- `SKILL_WALLET_ASSET_URL_SECRET`: if it is unset, the asset-URL key is derived from `JWT_ACCESS_SECRET`. Set a separate secret in production so rotating one does not affect the other.
- Android release cleartext / debug signing: see §6.

## 17. Manual device testing still required

- iOS: build in Xcode, then run the XCTest / UI tests on a simulator and a device. Check that lock-screen notification content is generic.
- Android: release APK on a device with an `https://` API URL. Check a deep link to an unauthorized screen (it should land on the 404 / notifications view) and the push-tap routing.
- Web: the verifier modal. Open a certificate, have the student replace the image in another session, then press Verify. Expect the 409 toast and the reloaded image.

## 18. Recommended next actions (by risk)

1. Review the remaining handler bodies listed in §14.1 (Super Admin, SOC, transport).
2. Make the SW-1 policy decision (§14.2).
3. Add a dependency audit (`npm audit`, Gradle dependency-check) to CI.
4. Leave socket rooms on role or membership change (§14.3); add per-device monotonic timestamps to the tracker webhook (§14.4).
5. Before release: an iOS Xcode build and test run, plus an Android release build with HTTPS and a real signing key.
