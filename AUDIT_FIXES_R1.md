# Security audit fixes — round 1

Branch: `security/audit-fixes-r1` (local only, not pushed). Base: `85b5ddb`.

Every fix has a regression test. The server tests live in `server/tests/audit-fixes-r1.test.js`, the client test in `client/tests/auditFixesR1.test.mjs`, and the Android test in `mobile-kotlin/app/src/test/java/com/vexon/campus/AuditFixesR1Test.kt`.

**Proof that the tests are real.** All 29 server tests were run against a clean worktree of `85b5ddb`: **29/29 failed** there, and all 29 pass on this branch. The client test fails on `85b5ddb`: `pathOnly` was not exported and `safeHref` accepted `//host`. It passes here.

## Results

| Item | Files | Change | Test | Result |
|---|---|---|---|---|
| A1 | `server/src/policies.js`, `server/src/controllers/superAdminController.js` | `isPolicyManaged` returns `role === 'admin' && policyManaged === true` instead of a constant, so a policy-managed Admin is held to its module policies and DENY scopes. A legacy Admin keeps full access. **Follow-on bug found and fixed:** `POST /super-admin/admins` saved new Admins with `policyManaged: false`. The broken `isPolicyManaged` hid this; with A1 fixed, every Admin the Super Admin created "with only these policies" would have been an unrestricted legacy Admin. New Admins are now `policyManaged: true`, which the existing `super-admin.test.js` already expected. | `A1 a policy-managed Admin is held to its module policies…`, `A1 the department-scope DENY on role assignments…`, `A1 an Admin created by the Super Admin is policy-managed…` | pass |
| A2 | `mobile-kotlin/app/build.gradle.kts`, `mobile-kotlin/README.md` | Release signing comes only from `vexon.release.*` Gradle properties or `VEXON_RELEASE_*` env vars. The debug-key fallback is removed. A `checkReleaseSigning` task fails any `pre*ReleaseBuild` with a clear message listing what is missing. | `A2 release builds never fall back to the debug signing key` | pass. `assembleRelease` now fails as intended (see Android) |
| A3 | `server/src/utils/seedGuard.js` (new), `server/src/seed/seed.js`, `academic.js`, `alumniUsers.js` | Seeders refuse to run when `NODE_ENV=production`, `DB_TARGET=atlas`, or the URI is Atlas (`mongodb+srv://` or `*.mongodb.net`). The only override is `ALLOW_SEED_IN_PROD=yes-i-am-sure`. The check runs before any DB connection. | `A3 seed scripts refuse production / Atlas targets…` (also spawns each script) | pass |
| A4 | `.gitignore` | Adds `*.jks *.keystore *.pem *.p12 *.p8 *.mobileprovision mobile-kotlin/app/google-services.json`. None of these were tracked. | `A4 signing keys, certificates and the Firebase config are git-ignored` | pass |
| A5 | `.github/workflows/*.yml`, `render.yaml` | Every Action is pinned to a 40-character commit SHA with a version comment. Render `buildCommand` uses `npm ci` (only that line changed; both lockfiles are tracked). | `A5 every GitHub Action is pinned to a full commit SHA; Render installs with npm ci` | pass |
| B1 | `server/src/utils/loginSecurity.js`, `server/src/controllers/authController.js`, `server/src/models/LoginThrottle.js` | A successful sign-in no longer clears the per-IP failure counter. This stops an attacker who owns one account from resetting the IP lock between guesses. | `B1 successful sign-ins do not reset or decay the per-IP failure counter` | pass |
| B2 | same files | The unknown-email counter is keyed by email only (not IP+email) and kept 24 h, the same as an account counter. Unknown and known emails return the same status, message and body shape. | `B2 unknown and known accounts fail identically…` | pass |
| B3 | `server/src/middleware/platform.js` | In maintenance or lockdown the public gate verifies a Bearer token (`authenticateAccessToken`) and lets it through only when `platformAllows(user)`. Before, any `Authorization` header passed. | `B3 in lockdown a garbage (or any non-Super-Admin) bearer token does not open the public gate` | pass |
| B4 | `server/src/controllers/gatePassController.js` | The security role sees only `approved`, `active` and `completed` passes in the list, by ID and on the dashboards. `parentPhone` is masked and only guard-relevant student fields are returned (no phone or email). | `B4 security sees only approved / outside / returned passes…` | pass |
| B5 | `server/src/services/soc/sanitize.js`, `server/src/controllers/socController.js`, `client/src/services/errorReporter.js` | Path segments of 24+ characters mixing letters and digits become `:token`, and loose 32+ hex runs become `[redacted-token]`. This covers stored routes, messages, the AI-explain facts, and the client-reported `endpoint` on both server and client. Object IDs still become `:id`. | `B5 high-entropy path tokens are stored (and sent to the AI) as :token`, client `B5 claim / invite tokens…` | pass |
| B6 | `server/src/middleware/error.js`, `server/src/services/soc/capture.js` | Anonymous 429s from the global limiter (no signed-in user and no matched route, so the path is whatever the client sent) are grouped under one route (`anonymous:*`) whatever the path. A route's own limiter, such as `/auth/login`, is a finite real route and keeps its template, which the existing SOC test relies on. Rate-limit and authorization noise has its own budget of 100 writes per minute, so it can no longer use up the 300-per-minute budget that real faults need. | `B6 anonymous 429s are one record…` | pass |
| B7 | `server/src/config/env.js`, `models/StoredFile.js`, `models/UploadQuota.js` (new), `utils/uploadQuota.js` (new), `utils/storage.js`, `controllers/uploadController.js`, `services/orphanUploads.js` (new), `server.js` | Per-user daily quota on `POST /api/uploads`: `UPLOAD_DAILY_MAX_FILES` (60) and `UPLOAD_DAILY_MAX_MB` (150). It is reserved atomically and released if the upload fails; exceeding it gives 429 `UPLOAD_QUOTA`. An hourly job `uploads.orphan_sweep` deletes uploads that are older than 24 h and referenced by no record. It is fail-safe: nothing is deleted on a lookup error or when there are too many matches. | `B7 POST /uploads enforces a per-user daily quota…`, `B7 the orphan sweep deletes only unattached uploads older than 24 h` | pass |
| B8 | `alumni/mentorshipController.js`, `alumni/alumniEventsController.js`, `alumni/alumniJobsController.js`, `alumni/alumniImportController.js`, `adminRoleAssignmentController.js`, `analyticsController.js`, `attendanceController.js`, `odLeaveController.js`, `staffAttendanceController.js` | By-ID reads and actions now use the same scope as their lists:<br>• mentorship request by ID for an HOD<br>• unpublished alumni events, plus approve/reject, for an HOD outside the department<br>• job applications for an HOD<br>• import batches (read and commit)<br>• role-assignment overview for a department-scoped grant<br>• faculty analytics and corrections taken from the timetable, not `Subject.faculty`<br>• OD/leave queue for a faculty member with no in-charge class<br>• `parentPhone` removed for read-only oversight roles | 8 `B8 …` tests | pass |
| B9 | `alumniEventsController.js`, `alumniJobsController.js`, `complaintController.js`, `lostFoundController.js` | Conditional (race-safe) state transitions:<br>• cancel only from cancellable states<br>• close only from open or pending review<br>• reopen re-checks the deadline and the poster's active, verified status<br>• a withdrawn application is frozen<br>• a cancelled or closed grievance cannot be closed<br>• a staff `returned` lost-and-found record cannot be overwritten by its reporter | 4 `B9 …` tests | pass |
| B10 | `routes/alumniRoutes.js`, `alumniJobsController.js`, `routes/index.js`, `client/src/utils/format.js`, `client/src/pages/alumni/AlumniJobsTab.jsx` | `PATCH /alumni/jobs/:id` `externalUrl` must be http(s) with a protocol, and `external_link` requires one. Club `socialLinks` and mentorship `meetingLink` are https-only. Client `safeHref` rejects `//host`, `/\host` and backslashes; the job "Apply" link goes through `safeHref` and opens with `noopener,noreferrer`. | `B10 job edits, club social links and mentorship meeting links…`, client `B10 safeHref…` | pass |
| B11 | `mobile-kotlin/.../core/ApiPath.kt` (new), `core/Http.kt`, `core/Api.kt`, `push/IntentNonce.kt` (new), `push/Push.kt`, `MainActivity.kt`, `transport/TripLocationService.kt` | Every ID in an API path is validated (ObjectId, slug or keyword), and URLs are built with `HttpUrl.Builder.addPathSegment`. Empty, `.`, `..` and backslash segments, and non-http bases, are refused before any request is sent. Notification `PendingIntent`s carry a per-install random nonce; `MainActivity` honours `link` and `notificationId` extras only when the nonce matches, and marks a notification read only for a valid ID. | `AuditFixesR1Test` (4 JVM tests) | pass |
| B12 | `models/User.js`, `controllers/authController.js`, `services/pushService.js` | Each Expo push token records the session that registered it. Revoking sessions removes their tokens, and pushes go only to tokens of live sessions. | `B12 an Expo push token is bound to its session…` | pass |

## Full runs

| Run | Base `85b5ddb` (clean worktree) | This branch |
|---|---|---|
| Server `npm test` (all files, sequential) | 850 tests: 832 pass, **18 fail** | 879 tests: 875 pass, **4 fail** |
| `server/tests/audit-fixes-r1.test.js` alone | 29 fail | **29/29 pass** |
| Client `npm test` | — | **77/77 pass** (includes 2 new) |
| Client `npm run build` | — | **success** (only the usual chunk-size warning) |
| Android `:app:testDebugUnitTest` | — | **59/59 pass** |

**The 4 remaining server failures are pre-existing.** Each fails the same way on the clean `85b5ddb` worktree, and none involves code changed here:

- `gate-exit-campus-day.test.js` (2 tests): the clock is pinned to `2026-10-10T02:00+05:30`, which is now in the past (today is 2026-10-20). The pass lookup returns 404. The test depends on the date, not the code.
- `admin-delegation.test.js` "7. crafted requests cannot bypass the limits": it expects 201 when privileged fields are sent on create. The server now refuses them with 422 ("Policies were sent with 'No Additional Policies'"), a stricter rule from a later user-creation feature. The test is out of date; it does not assert insecure behaviour, so it was not rewritten.
- `staff-policies.test.js` "Admins assign staff policies only within their own authority": it expects the staff catalogue to exclude `attendance`, but a later feature made `attendance` staff-grantable (`STAFF_GRANTABLE`). Same reasoning: out of date, not rewritten.

The other 14 base failures (A1 policy tests, `skill-wallet-projects` "no Skill Wallet access from their role", `super-admin` create-Admin, and so on) were failing *because of* the A1 bug and now pass.

**Flaky:** in one full run `input-hardening.test.js` failed at file level before its server connected (no assertion ran). It passed on its own and in the final full run.

## Deviations, limits and skipped items

- **B3:** an *invalid* Bearer token gets **401** at the gate, not 503. A 401 lets the Super Admin client refresh an expired access token during a lockdown; a 503 would lock it out. A *valid* token for a non-allowed user still gets 503, and no data is returned either way.
- **A3:** `server/scripts/create-super-admin.mjs` is **not** guarded. It is the production provisioning tool, so it must run against production. `simulate-bus` already had its own production guard.
- **B12:** Expo tokens registered before this change have no session and are **skipped** by push until the app registers again. The Expo app re-registers on every start (`mobile/app/_layout.js`), so this heals on the next launch. Native FCM tokens are unchanged.
- **B7:** the orphan sweep finds references by scanning string and Mixed paths of every model for `/uploads/<filename>`. A file referenced only in some other form (for example a bare filename inside a binary field) would look orphaned. Only rows with `uploadedBy` set (uploads made through `POST /api/uploads` after this change) are ever candidates, so older files are never touched.
- **B2:** a per-account login *lease* still returns 429 when the same account receives parallel sign-ins. That response shape existed before and is not enumeration-relevant (it needs a real account and concurrency), but it is not identical to the unknown-email path.
- **SMS:** nothing SMS-related was touched: no edits to `otp/providers/*`, `collegeSmsProvider.js`, `SMS_*`, `OTP_SMS_ENABLED`, `SMS_ALLOW_INSECURE_HTTP`, or the SMS sections of `render.yaml`/`env.js`. No fix needed an SMS change.
- **Tests changed (no test deleted):**
  - `server/tests/hod-dashboard-cards.test.js` "breakdown: principal drill-down…": one assertion expected the principal to receive `parentPhone`. That is the old behaviour B8 removes for read-only oversight roles, so it now asserts the field is absent.
  - `server/tests/attendance-od-leave.test.js`: the faculty fixture had `section: 'A'` but no in-charge year. Under the old code that gave it section A of *every* year, the fallback B8 removes. The fixture now has `inChargeYear: 3, inChargeSemester: 5`, matching how a real class in-charge is assigned and the class of the student in the test. No assertion changed.

## Android (memory rule: rebuild APKs)

- `./gradlew :app:testDebugUnitTest`: **59/59 pass** (11 suites, including the 4 new `AuditFixesR1Test`).
- `assembleDebug`: **success**. Output: `mobile-kotlin/app/build/outputs/apk/debug/app-debug.apk`.
- `assembleRelease`: **fails as intended** at `:app:checkReleaseSigning` with "Release signing is not configured, so no release build is produced (release builds never fall back to the debug key). Missing: …". To build a release, set `VEXON_RELEASE_STORE_FILE`, `VEXON_RELEASE_STORE_PASSWORD`, `VEXON_RELEASE_KEY_ALIAS` and `VEXON_RELEASE_KEY_PASSWORD` (or the `vexon.release.*` Gradle properties).
- **Warning:** `mobile-kotlin/app/build/outputs/apk/release/app-release.apk` dated 17 Oct is a **stale, debug-signed** build of the old code. Do not distribute it. It was left in place, not deleted.

## Part C — not changed, decisions needed

1. **Cancelled complaints:** may an authority reopen or resolve a complaint that the student cancelled, or is `CANCELLED` final for everyone?
2. **HOD achievement posts:** should an HOD's achievement post be able to become an editable, pinnable, campus-wide announcement, or stay department-scoped and read-only once posted?
3. **Demoted authors:** when an author loses the role that let them post an announcement, should they keep edit and delete rights on their old announcements?
4. **Alumni edits after approval:** should edits to an approved alumni event or job send it back to review (or only some fields, such as the URL, date and audience)?
5. **`/uploads` delivery:** should `/uploads/*` move from public URLs to authenticated, short-lived signed-token delivery, accepting the client and mobile changes and the broken old links that implies?

## Push commands (not run)

```sh
git push -u origin security/audit-fixes-r1
# then open a PR from security/audit-fixes-r1 into main
```
